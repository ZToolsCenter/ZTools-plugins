// Executes only the frozen, model-free E01-E16 safety scenarios.
// Run after case/source freeze: node scripts/ai-scenario-eval/run-controlled.mjs
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readSourceManifest, sha256, verifyFrozenSource } from "./freeze-source.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, "../..");
const acceptanceRoot = path.join(pluginRoot, ".cache/acceptance/ai-scenarios/v1");
const frozenRoot = path.join(acceptanceRoot, "source");
const caseManifestPath = path.join(acceptanceRoot, "case-manifest.json");
const sourceManifestPath = path.join(acceptanceRoot, "source-manifest.json");
const outputPath = path.join(acceptanceRoot, "controlled-001.json");
const expectedIds = Array.from({ length: 16 }, (_, index) => `E${String(index + 1).padStart(2, "0")}`);

function errorValue(error) {
  return {
    name: error?.name ?? "Error",
    code: error?.code ?? null,
    message: String(error?.message ?? error)
  };
}

function assertNoSymlinkPath(target, boundary = pluginRoot) {
  const absolute = path.resolve(target);
  const relative = path.relative(boundary, absolute);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error(`Controlled runner path escaped plugin boundary: ${target}`);
  }
  let current = absolute;
  while (current !== boundary) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Controlled runner refuses symlink path: ${path.relative(boundary, current)}`);
    }
    current = path.dirname(current);
  }
}

function createReport() {
  return {
    schemaVersion: 1,
    runId: "controlled-001",
    caseSetId: null,
    status: "running",
    startedAt: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    model: { newModelCalls: 0, profile: null, id: null, reason: "Controlled safety fixtures use a local mock invoke." },
    network: { used: false, fetchAttempts: 0, policy: "No service, cache, or network client is imported by this runner." },
    manifest: {
      caseManifestSha256: null,
      caseManifestSha256After: null,
      sourceManifestSha256: null,
      sourceCaseManifestSha256: null,
      frozenFileCount: 0,
      frozenFiles: null
    },
    sourceVerification: { before: null, after: null },
    expectedTotal: expectedIds.length,
    actualTotal: 0,
    notRunIds: [...expectedIds],
    cases: [],
    errors: []
  };
}

function serializeCase(item, passed) {
  return {
    ...item,
    status: passed ? "passed" : "failed",
    newModelCalls: 0
  };
}

function completeCoverage(report, resultsById) {
  report.cases = expectedIds.map((id) => resultsById.get(id) ?? {
    id,
    status: "not_run",
    newModelCalls: 0,
    error: { name: "NotRun", code: null, message: "The controlled runner did not return a result for this case." }
  });
  report.actualTotal = report.cases.filter((item) => item.status !== "not_run").length;
  report.notRunIds = report.cases.filter((item) => item.status === "not_run").map((item) => item.id);
}

function assertManifestCases(caseManifest, safetyCases) {
  const controlledCases = caseManifest?.controlledCases;
  if (!Array.isArray(controlledCases) || controlledCases.length !== expectedIds.length) {
    throw new Error("Frozen case manifest must contain exactly 16 controlled cases.");
  }
  if (JSON.stringify(controlledCases.map(({ id }) => id)) !== JSON.stringify(expectedIds)) {
    throw new Error("Frozen controlled case IDs must be E01-E16 in order.");
  }
  if (JSON.stringify(controlledCases) !== JSON.stringify(safetyCases)) {
    throw new Error("Frozen execution-safety cases differ from the frozen case manifest.");
  }
}

async function loadFrozenProductModules(server) {
  const planned = await server.ssrLoadModule("/src/core/ai/plannedTaskRunner.ts");
  const editing = await server.ssrLoadModule("/src/core/ai/editProposal.ts");
  const modules = {
    runPlannedAiTask: planned.runPlannedAiTask,
    isAiProposalCurrent: editing.isAiProposalCurrent,
    resolveAiEdit: editing.resolveAiEdit
  };
  const missing = Object.entries(modules).filter(([, value]) => typeof value !== "function").map(([name]) => name);
  if (missing.length) throw new Error(`Frozen v1 source is missing required safety exports: ${missing.join(", ")}`);
  return modules;
}

export async function runControlledSafety() {
  if (fs.existsSync(outputPath)) throw new Error("controlled-001.json already exists; refusing to overwrite it.");

  const report = createReport();
  let server = null;
  let sourceManifest = null;
  const resultsById = new Map();
  let originalFetch;
  let fetchGuardInstalled = false;
  try {
    if (Number(process.versions.node.split(".")[0]) !== 24) {
      throw new Error(`Use Node 24 for controlled evaluation; current runtime is ${process.version}`);
    }
    assertNoSymlinkPath(acceptanceRoot);
    assertNoSymlinkPath(frozenRoot);
    assertNoSymlinkPath(caseManifestPath);
    assertNoSymlinkPath(sourceManifestPath);
    assertNoSymlinkPath(outputPath);
    sourceManifest = readSourceManifest();
    const caseManifestBytes = fs.readFileSync(caseManifestPath);
    const sourceManifestBytes = fs.readFileSync(sourceManifestPath);
    const caseManifest = JSON.parse(caseManifestBytes.toString("utf8"));
    report.caseSetId = caseManifest.caseSetId ?? sourceManifest.caseSetId ?? null;
    report.manifest = {
      caseManifestSha256: sha256(caseManifestBytes),
      sourceManifestSha256: sha256(sourceManifestBytes),
      sourceCaseManifestSha256: sourceManifest.caseManifestSha256,
      frozenFileCount: sourceManifest.paths.length,
      frozenFiles: sourceManifest.files
    };

    const verifiedBefore = verifyFrozenSource({ manifest: sourceManifest });
    report.sourceVerification.before = {
      passed: true,
      checkedFiles: sourceManifest.paths.length,
      hashesMatchManifest: sourceManifest.paths.every((relative) =>
        verifiedBefore.liveFiles[relative].sha256 === sourceManifest.files[relative].sha256 &&
        verifiedBefore.frozenFiles[relative].sha256 === sourceManifest.files[relative].sha256)
    };
    if (!report.sourceVerification.before.hashesMatchManifest) throw new Error("Frozen source hashes did not match before execution.");

    const frozenSafetyPath = path.join(frozenRoot, "scripts/ai-scenario-eval/execution-safety.mjs");
    assertNoSymlinkPath(frozenSafetyPath);
    const frozenSafety = await import(pathToFileURL(frozenSafetyPath).href);
    if (!Array.isArray(frozenSafety.executionSafetyCases) || typeof frozenSafety.runExecutionSafety !== "function") {
      throw new Error("Frozen execution-safety module is missing its case list or runner.");
    }
    assertManifestCases(caseManifest, frozenSafety.executionSafetyCases);

    server = await createServer({
      root: frozenRoot,
      configFile: false,
      server: { middlewareMode: true, hmr: false, ws: false },
      cacheDir: path.join(pluginRoot, ".cache/vite-ai-controlled-safety-v1")
    });
    const modules = await loadFrozenProductModules(server);
    report.loadedModules = {
      root: path.relative(pluginRoot, frozenRoot),
      requested: [
        "src/core/ai/plannedTaskRunner.ts",
        "src/core/ai/editProposal.ts",
        "scripts/ai-scenario-eval/execution-safety.mjs"
      ],
      hashes: Object.fromEntries([
        "src/core/ai/plannedTaskRunner.ts",
        "src/core/ai/editProposal.ts",
        "scripts/ai-scenario-eval/execution-safety.mjs"
      ].map((relative) => [relative, sourceManifest.files[relative]?.sha256 ?? null]))
    };

    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      report.network.fetchAttempts += 1;
      report.network.used = true;
      throw new Error("Network requests are prohibited in model-free controlled evaluation.");
    };
    fetchGuardInstalled = true;
    try {
      const results = await frozenSafety.runExecutionSafety(modules);
      for (const item of results) {
        if (!expectedIds.includes(item.id)) {
          report.errors.push({ name: "UnexpectedCase", code: null, message: `Ignored unexpected result ID ${item.id}.` });
          continue;
        }
        if (resultsById.has(item.id)) {
          report.errors.push({ name: "DuplicateResult", code: null, message: `Ignored duplicate result ID ${item.id}.` });
          continue;
        }
        resultsById.set(item.id, serializeCase(item, item.passed === true));
      }
    } catch (error) {
      report.errors.push({ stage: "controlled-cases", ...errorValue(error) });
    } finally {
      if (fetchGuardInstalled) {
        globalThis.fetch = originalFetch;
        fetchGuardInstalled = false;
      }
    }
  } catch (error) {
    report.errors.push({ stage: "harness", ...errorValue(error) });
  } finally {
    if (fetchGuardInstalled) globalThis.fetch = originalFetch;
    if (server) {
      try { await server.close(); }
      catch (error) { report.errors.push({ stage: "vite-close", ...errorValue(error) }); }
    }
    if (sourceManifest) {
      try {
        const verifiedAfter = verifyFrozenSource({ manifest: sourceManifest });
        const hashesMatchManifest = sourceManifest.paths.every((relative) =>
          verifiedAfter.liveFiles[relative].sha256 === sourceManifest.files[relative].sha256 &&
          verifiedAfter.frozenFiles[relative].sha256 === sourceManifest.files[relative].sha256);
        report.sourceVerification.after = { passed: hashesMatchManifest, checkedFiles: sourceManifest.paths.length, hashesMatchManifest };
        if (!hashesMatchManifest) report.errors.push({ stage: "source-verification-after", name: "SourceDrift", code: null, message: "Source hashes changed during controlled execution." });
      } catch (error) {
        report.sourceVerification.after = { passed: false, error: errorValue(error) };
        report.errors.push({ stage: "source-verification-after", ...errorValue(error) });
      }
    }
  }

  try {
    report.manifest.caseManifestSha256After = sha256(fs.readFileSync(caseManifestPath));
    if (report.manifest.caseManifestSha256After !== report.manifest.caseManifestSha256) {
      report.errors.push({ stage: "case-manifest-verification-after", name: "ManifestDrift", code: null, message: "Case manifest hash changed during controlled execution." });
    }
  } catch (error) {
    report.errors.push({ stage: "case-manifest-verification-after", ...errorValue(error) });
  }

  completeCoverage(report, resultsById);
  report.finishedAt = new Date().toISOString();
  report.status = report.notRunIds.length || report.errors.length
    ? "incomplete"
    : report.cases.some((item) => item.status === "failed") ? "failed" : "passed";
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    console.error("Usage: node scripts/ai-scenario-eval/run-controlled.mjs");
    process.exitCode = 2;
  } else {
    runControlledSafety().then((report) => {
      console.log(JSON.stringify({ status: report.status, expectedTotal: report.expectedTotal, actualTotal: report.actualTotal, notRunIds: report.notRunIds, output: path.relative(pluginRoot, outputPath) }));
      if (report.status !== "passed") process.exitCode = 1;
    }).catch((error) => {
      console.error(error?.stack ?? String(error));
      process.exitCode = 1;
    });
  }
}

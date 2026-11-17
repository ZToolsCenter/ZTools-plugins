import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const errorValue = (error) => ({ name: error?.name ?? "Error", code: error?.code ?? null, message: String(error?.message ?? error) });
const expectedIds = Array.from({ length: 16 }, (_, index) => `E${String(index + 1).padStart(2, "0")}`);

function within(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function walkFiles(root, current = root, result = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Snapshot contains a symlink: ${path.relative(root, absolute)}`);
    if (entry.isDirectory()) walkFiles(root, absolute, result);
    else if (entry.isFile()) result.push(path.relative(root, absolute).split(path.sep).join("/"));
    else throw new Error(`Snapshot contains a non-regular file: ${path.relative(root, absolute)}`);
  }
  return result.sort();
}

function verifySnapshot(root, manifest) {
  const paths = walkFiles(root);
  if (JSON.stringify(paths) !== JSON.stringify([...manifest.paths].sort())) throw new Error("Frozen source path set changed.");
  for (const relative of paths) {
    if (path.isAbsolute(relative) || relative.split("/").includes("..")) throw new Error(`Unsafe source manifest path: ${relative}`);
    const absolute = path.resolve(root, relative);
    if (!within(root, absolute) || !fs.lstatSync(absolute).isFile()) throw new Error(`Invalid source manifest file: ${relative}`);
    if (sha256(fs.readFileSync(absolute)) !== manifest.files[relative]?.sha256) throw new Error(`Frozen source hash changed: ${relative}`);
  }
}

function verifyTools(toolRoot, config, manifest) {
  const paths = walkFiles(toolRoot);
  if (JSON.stringify(paths) !== JSON.stringify([...manifest.paths].sort())) throw new Error("Frozen tool path set changed.");
  for (const relative of paths) if (sha256(fs.readFileSync(path.join(toolRoot, relative))) !== manifest.files[relative]?.sha256) throw new Error(`Frozen tool hash changed: ${relative}`);
  if (sha256(fs.readFileSync(path.join(toolRoot, "config.json"))) !== manifest.configSha256) throw new Error("Frozen tool config changed.");
  const caseFile = path.join(toolRoot, config.caseSets[manifest.caseSetId]);
  if (sha256(fs.readFileSync(caseFile)) !== manifest.caseManifestSha256) throw new Error("Frozen case manifest changed.");
}

function atomicJson(filePath, value) {
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "w" });
  fs.renameSync(temporary, filePath);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, child]) => child !== undefined).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function productModules(server) {
  const planned = await server.ssrLoadModule("/src/core/ai/plannedTaskRunner.ts");
  const editing = await server.ssrLoadModule("/src/core/ai/editProposal.ts");
  if (typeof planned.runPlannedAiTask !== "function" || typeof editing.isAiProposalCurrent !== "function" || typeof editing.resolveAiEdit !== "function") {
    throw new Error("Selected source snapshot lacks controlled-test product exports.");
  }
  return { runPlannedAiTask: planned.runPlannedAiTask, isAiProposalCurrent: editing.isAiProposalCurrent, resolveAiEdit: editing.resolveAiEdit };
}

export async function runControlledScenariosV2({ pluginRoot, options, resolved }) {
  if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error(`Use Node 24; current runtime is ${process.version}`);
  const sourceManifestBytes = fs.readFileSync(resolved.sourceManifestPath);
  const sourceManifest = JSON.parse(sourceManifestBytes.toString("utf8"));
  verifySnapshot(resolved.sourceRoot, sourceManifest);
  const toolManifestBytes = fs.readFileSync(resolved.toolManifestPath);
  const toolManifest = JSON.parse(toolManifestBytes.toString("utf8"));
  verifyTools(resolved.toolRoot, resolved.config, toolManifest);
  const caseBytes = fs.readFileSync(resolved.caseManifestPath);
  const caseManifest = JSON.parse(caseBytes.toString("utf8"));
  if (sourceManifest.caseManifestSha256 !== sha256(caseBytes)) throw new Error("Selected source snapshot is not bound to the frozen v2 case set.");
  if (caseManifest.schemaVersion !== 1 || caseManifest.caseSetId !== resolved.caseSetId || JSON.stringify(caseManifest.controlledCases.map(({ id }) => id)) !== JSON.stringify(expectedIds)) {
    throw new Error("Frozen controlled case manifest must contain E01-E16 for the selected case set.");
  }
  const runDirectory = path.join(resolved.outputRoot, `${options.variant}-controlled-${options.runId}`);
  if (!within(pluginRoot, runDirectory)) throw new Error("Controlled run directory escaped the plugin.");
  if (fs.existsSync(runDirectory)) throw new Error(`Controlled run exists; refusing to overwrite: ${path.relative(pluginRoot, runDirectory)}`);
  fs.mkdirSync(resolved.outputRoot, { recursive: true });
  fs.mkdirSync(runDirectory, { recursive: false });
  const reportPath = path.join(runDirectory, "controlled-report.json");
  const report = {
    schemaVersion: 2, evaluationId: resolved.config.evaluationId, variant: options.variant, runId: options.runId,
    caseSetId: resolved.caseSetId, status: "running", startedAt: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    model: { newModelCalls: 0, deploymentAllowed: false },
    network: { used: false, fetchAttempts: 0, policy: "Global fetch is blocked throughout the controlled run." },
    source: { root: path.relative(pluginRoot, resolved.sourceRoot), manifest: path.relative(pluginRoot, resolved.sourceManifestPath), manifestSha256: sha256(sourceManifestBytes), verificationMode: "snapshot-only" },
    tools: { root: path.relative(pluginRoot, resolved.toolRoot), manifestSha256: sha256(toolManifestBytes), caseManifestSha256: sha256(caseBytes) },
    dependencyPathsAndHashes: {
      dependencyRoot: path.join(pluginRoot, "node_modules"),
      packageJsonSha256: sourceManifest.files["package.json"]?.sha256 ?? null,
      packageLockSha256: sourceManifest.files["package-lock.json"]?.sha256 ?? null
    },
    expectedTotal: expectedIds.length, actualTotal: 0, notRunIds: [...expectedIds], cases: [], errors: []
  };
  atomicJson(reportPath, report);
  let server; let originalFetch;
  const results = new Map();
  try {
    server = await createServer({ root: resolved.sourceRoot, configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, cacheDir: path.join(pluginRoot, resolved.config.viteCacheRoot, "controlled", options.variant) });
    const modules = await productModules(server);
    const safetyPath = path.join(resolved.toolRoot, "scripts/ai-scenario-eval/execution-safety.mjs");
    const frozenSafety = await import(pathToFileURL(safetyPath).href);
    if (JSON.stringify(frozenSafety.executionSafetyCases.map(({ id }) => id)) !== JSON.stringify(expectedIds)) throw new Error("Frozen execution-safety fixture IDs differ from the selected case manifest.");
    if (stableJson(caseManifest.controlledCases) !== stableJson(frozenSafety.executionSafetyCases)) throw new Error("Frozen controlled case definitions differ from the original execution-safety fixtures.");
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { report.network.fetchAttempts += 1; report.network.used = true; throw new Error("Network requests are prohibited in model-free controlled evaluation."); };
    const outcomes = await frozenSafety.runExecutionSafety(modules);
    for (const item of outcomes) {
      if (!expectedIds.includes(item.id) || results.has(item.id)) {
        report.errors.push({ name: results.has(item.id) ? "DuplicateResult" : "UnexpectedCase", code: null, message: `Ignored invalid result id ${item.id}.` });
        continue;
      }
      results.set(item.id, { ...item, status: item.passed === true ? "passed" : "failed", newModelCalls: 0 });
    }
  } catch (error) { report.errors.push({ stage: "controlled-run", ...errorValue(error) }); }
  finally {
    if (originalFetch) globalThis.fetch = originalFetch;
    if (server) { try { await server.close(); } catch (error) { report.errors.push({ stage: "vite-close", ...errorValue(error) }); } }
  }
  report.cases = expectedIds.map((id) => results.get(id) ?? { id, status: "not_run", newModelCalls: 0, error: { name: "NotRun", code: null, message: "The controlled runner produced no result." } });
  report.actualTotal = report.cases.filter(({ status }) => status !== "not_run").length;
  report.notRunIds = report.cases.filter(({ status }) => status === "not_run").map(({ id }) => id);
  try {
    verifySnapshot(resolved.sourceRoot, sourceManifest);
    verifyTools(resolved.toolRoot, resolved.config, toolManifest);
    if (sha256(fs.readFileSync(resolved.caseManifestPath)) !== sha256(caseBytes)) throw new Error("Case manifest changed during controlled evaluation.");
    report.source.stableAfter = true;
  } catch (error) { report.source.stableAfter = false; report.errors.push({ stage: "snapshot-after", ...errorValue(error) }); }
  report.finishedAt = new Date().toISOString();
  report.status = report.notRunIds.length || report.errors.length ? "incomplete" : report.cases.some(({ status }) => status === "failed") ? "failed" : "passed";
  atomicJson(reportPath, report);
  return report;
}

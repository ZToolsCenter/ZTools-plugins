import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertFreshOutputPath, assertNoSymlinkPath, isWithin, pluginRoot, resolvePluginPath } from "./scenario-v2-paths.mjs";

const v2Root = path.join(pluginRoot, ".cache/acceptance/ai-scenarios/v2-r4");
const toolRoot = path.join(v2Root, "tool-source");
const toolManifestPath = path.join(v2Root, "tool-manifest.json");
const v1Root = path.join(pluginRoot, ".cache/acceptance/ai-scenarios/v1");
const v1CasePath = path.join(v1Root, "case-manifest.json");
const v1SourceRoot = path.join(v1Root, "source");
const v1SourceManifestPath = path.join(v1Root, "source-manifest.json");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const toolFiles = [
  "scripts/ai-scenario-eval/scenario-v2-oracles.mjs",
  "scripts/ai-scenario-eval/scenario-v2-runner.mjs",
  "scripts/ai-scenario-eval/scenario-v2-controlled-runner.mjs",
  "scripts/ai-scenario-eval/scenario-inference.mjs",
  "scripts/ai-scenario-eval/module-graph-audit.mjs",
  "scripts/ai-scenario-eval/generation-quality.mjs",
  "scripts/ai-scenario-eval/generation-format.mjs",
  "scripts/ai-scenario-eval/execution-safety.mjs",
  "scripts/ai-replace-intent-local-runtime.mjs"
];
const baselineToolFiles = new Set([
  "scripts/ai-scenario-eval/module-graph-audit.mjs",
  "scripts/ai-scenario-eval/generation-quality.mjs",
  "scripts/ai-scenario-eval/generation-format.mjs",
  "scripts/ai-scenario-eval/execution-safety.mjs",
  "scripts/ai-replace-intent-local-runtime.mjs"
]);
const recipeFiles = [
  "src/core/ai/aiTaskRequest.ts",
  "src/core/ai/agentOrchestrator.ts",
  "src/core/ai/aiTaskPrompts.ts",
  "src/core/ai/aiChunkingPolicy.ts"
];
const productFiles = ["package.json", "package-lock.json", "plugin.json"];
const bootstrapFiles = [
  "scripts/ai-scenario-eval/scenario-v2-paths.mjs",
  "scripts/ai-scenario-eval/scenario-v2-snapshot.mjs",
  "scripts/ai-scenario-eval/run-scenarios-v2.mjs"
];

function walkFiles(root, current = root, files = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Snapshot refuses symlinks: ${path.relative(root, absolute)}`);
    if (entry.isDirectory()) walkFiles(root, absolute, files);
    else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join("/"));
    else throw new Error(`Snapshot refuses non-regular files: ${path.relative(root, absolute)}`);
  }
  return files;
}

function sourcePaths(root) {
  const result = [];
  for (const directory of ["src", "preload"]) {
    const absolute = path.join(root, directory);
    const stat = fs.lstatSync(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Expected a regular ${directory}/ source directory.`);
    result.push(...walkFiles(root, absolute));
  }
  for (const file of productFiles) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute) || !fs.lstatSync(absolute).isFile() || fs.lstatSync(absolute).isSymbolicLink()) {
      throw new Error(`Required product snapshot input is missing or unsafe: ${file}`);
    }
    result.push(file);
  }
  return [...new Set(result)].sort();
}

function hashes(root, paths) {
  return Object.fromEntries(paths.map((relative) => {
    const absolute = path.resolve(root, relative);
    if (!isWithin(root, absolute)) throw new Error(`Snapshot path escaped its root: ${relative}`);
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected a regular file: ${relative}`);
    const bytes = fs.readFileSync(absolute);
    return [relative, { sha256: sha256(bytes), bytes: bytes.byteLength }];
  }));
}

function verifySnapshot({ sourceRoot, manifest }) {
  const actualPaths = walkFiles(sourceRoot).sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify([...manifest.paths].sort())) throw new Error("Snapshot file set differs from its manifest.");
  const actual = hashes(sourceRoot, actualPaths);
  for (const relative of actualPaths) if (actual[relative].sha256 !== manifest.files[relative]?.sha256) throw new Error(`Snapshot hash mismatch: ${relative}`);
  return actual;
}

function copyFile(source, destination) {
  assertNoSymlinkPath(source);
  assertNoSymlinkPath(destination);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
}

function copyPaths(sourceRoot, targetRoot, paths) {
  for (const relative of paths) copyFile(path.join(sourceRoot, relative), path.join(targetRoot, relative));
}

function verifyV1Inputs(caseBytes, sourceManifest) {
  if (sha256(caseBytes) !== sourceManifest.caseManifestSha256) throw new Error("v1 case manifest no longer matches the v1 source manifest.");
  verifySnapshot({ sourceRoot: v1SourceRoot, manifest: sourceManifest });
}

function freezeBSource({ caseManifestSha256 }) {
  const destination = path.join(v2Root, "snapshots/B/source");
  const manifestPath = path.join(v2Root, "snapshots/B/source-manifest.json");
  if (fs.existsSync(destination) || fs.existsSync(manifestPath)) throw new Error("B source snapshot exists; refusing to overwrite or repair it.");
  const pathsBefore = sourcePaths(pluginRoot);
  const filesBefore = hashes(pluginRoot, pathsBefore);
  fs.mkdirSync(destination, { recursive: false });
  copyPaths(pluginRoot, destination, pathsBefore);
  const pathsAfter = sourcePaths(pluginRoot);
  const filesAfter = hashes(pluginRoot, pathsAfter);
  if (JSON.stringify(pathsBefore) !== JSON.stringify(pathsAfter) || JSON.stringify(filesBefore) !== JSON.stringify(filesAfter)) {
    throw new Error("Live product source changed while B was being frozen; the partial snapshot is retained and must not be overwritten.");
  }
  const manifest = {
    schemaVersion: 2, variant: "B", capturedAt: new Date().toISOString(),
    caseManifestSha256,
    capturedFrom: "live product source at v2 snapshot time", verificationMode: "snapshot-only-after-freeze",
    paths: pathsBefore, files: filesBefore
  };
  verifySnapshot({ sourceRoot: destination, manifest });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return { sourceRoot: destination, sourceManifestPath: manifestPath, manifest, manifestSha256: sha256(fs.readFileSync(manifestPath)) };
}

function freezeToolSource({ caseBytes, caseManifest, v1SourceManifest, requestBuilderRoot }) {
  fs.mkdirSync(toolRoot, { recursive: false });
  const caseRelative = "cases/live-markdown-multiscenario-v1.json";
  const casePath = path.join(toolRoot, caseRelative);
  fs.mkdirSync(path.dirname(casePath), { recursive: true });
  fs.writeFileSync(casePath, caseBytes, { flag: "wx" });
  for (const relative of toolFiles) {
    const source = baselineToolFiles.has(relative)
      ? path.join(v1SourceRoot, relative)
      : path.join(pluginRoot, relative);
    const target = path.join(toolRoot, relative);
    copyFile(source, target);
  }
  const requestRecipeRoot = path.join(toolRoot, "request-recipe");
  for (const relative of recipeFiles) {
    const source = relative === "src/core/ai/aiTaskRequest.ts"
      ? path.join(requestBuilderRoot, relative)
      : path.join(v1SourceRoot, relative);
    if (relative !== "src/core/ai/aiTaskRequest.ts" && !v1SourceManifest.files[relative]) throw new Error(`v1 source manifest lacks request recipe dependency: ${relative}`);
    copyFile(source, path.join(requestRecipeRoot, relative));
  }
  const config = {
    schemaVersion: 2,
    evaluationId: "live-markdown-ai-harness-ab-v2",
    caseSets: { [caseManifest.caseSetId]: caseRelative },
    defaultCaseSetId: caseManifest.caseSetId,
    toolManifestPath: "../tool-manifest.json",
    outputRoot: ".cache/acceptance/ai-scenarios/v2-r4/runs",
    localAiDirectory: ".cache/acceptance/local-ai",
    viteCacheRoot: ".cache/vite-ai-scenario-eval-v2-r4",
    requestRecipe: {
      relativePath: "request-recipe/src/core/ai/aiTaskRequest.ts",
      sharedModules: recipeFiles.map((relative) => `request-recipe/${relative}`),
      intent: "A loads frozen v2 request builder with role/action/chunk dependencies verified against v1; B loads the builder from B product snapshot."
    },
    sourceVariants: {
      A: {
        label: "A: original v1 frozen product and preload",
        sourceRoot: ".cache/acceptance/ai-scenarios/v1/source",
        sourceManifest: ".cache/acceptance/ai-scenarios/v1/source-manifest.json",
        originalCaseManifest: ".cache/acceptance/ai-scenarios/v1/case-manifest.json",
        provenance: "existing-frozen-v1-snapshot",
        verificationMode: "snapshot-only"
      },
      B: {
        label: "B: live product snapshot captured when --phase=freeze-b runs",
        sourceRoot: ".cache/acceptance/ai-scenarios/v2-r4/snapshots/B/source",
        sourceManifest: ".cache/acceptance/ai-scenarios/v2-r4/snapshots/B/source-manifest.json",
        provenance: "captured-live-product-at-v2-freeze-time",
        verificationMode: "snapshot-only"
      }
    },
    runtimeDependenciesRoot: "node_modules",
    model: { provider: "local", activeRoleId: "general", profileId: "light", modelId: "Qwen3-0.6B-Q4_K_M.gguf", retries: 0, deploymentAllowed: false },
    limits: { maxCallsPerCase: 64, runnerDeadlineMs: 90_000, independentHarnessDeadlineMs: 90_000, productionDeadlineMs: 300_000 },
    execution: "Sequential; no editor writeback; one real task invocation per case; controlled suite uses mock invoke and no model calls."
  };
  const configPath = path.join(toolRoot, "config.json");
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx" });
  const paths = walkFiles(toolRoot).sort();
  const files = hashes(toolRoot, paths);
  const manifest = {
    schemaVersion: 2, evaluationId: config.evaluationId, capturedAt: new Date().toISOString(),
    caseSetId: caseManifest.caseSetId, caseManifestSha256: sha256(caseBytes), configSha256: sha256(fs.readFileSync(configPath)),
    requestBuilderSha256: files[config.requestRecipe.relativePath].sha256,
    bootstrap: Object.fromEntries(bootstrapFiles.map((relative) => [relative, { sha256: sha256(fs.readFileSync(path.join(pluginRoot, relative))), bytes: fs.statSync(path.join(pluginRoot, relative)).size }])),
    paths, files
  };
  fs.writeFileSync(toolManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return { configPath, config, manifest, toolManifestSha256: sha256(fs.readFileSync(toolManifestPath)) };
}

export function verifyV2ToolSnapshot({ configPath, toolManifestPath }) {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const manifest = JSON.parse(fs.readFileSync(toolManifestPath, "utf8"));
  const toolRoot = path.dirname(configPath);
  if (manifest.schemaVersion !== 2 || manifest.configSha256 !== sha256(fs.readFileSync(configPath))) throw new Error("Frozen v2 tool config hash mismatch.");
  if (manifest.caseManifestSha256 !== sha256(fs.readFileSync(path.join(toolRoot, config.caseSets[config.defaultCaseSetId])))) throw new Error("Frozen v2 case manifest hash mismatch.");
  const actualPaths = walkFiles(toolRoot).sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(manifest.paths)) throw new Error("Frozen v2 tool file set differs from its manifest.");
  const actual = hashes(toolRoot, actualPaths);
  for (const relative of actualPaths) if (actual[relative].sha256 !== manifest.files[relative]?.sha256) throw new Error(`Frozen v2 tool hash mismatch: ${relative}`);
  for (const [relative, expected] of Object.entries(manifest.bootstrap ?? {})) {
    const absolute = resolvePluginPath(relative, "v2 bootstrap", { mustExist: true });
    if (sha256(fs.readFileSync(absolute)) !== expected.sha256) throw new Error(`v2 bootstrap changed after freeze: ${relative}`);
  }
  return { config, manifest, actual };
}

function frozenV1Inputs() {
  if (!fs.existsSync(v1CasePath) || !fs.existsSync(v1SourceManifestPath) || !fs.existsSync(v1SourceRoot)) throw new Error("Required v1 case/source snapshot is missing; v1 is read-only and must be prepared first.");
  const caseBytes = fs.readFileSync(v1CasePath);
  const caseManifest = JSON.parse(caseBytes.toString("utf8"));
  const v1SourceManifest = JSON.parse(fs.readFileSync(v1SourceManifestPath, "utf8"));
  if (caseManifest.schemaVersion !== 1 || caseManifest.realCases?.length !== 80 || caseManifest.controlledCases?.length !== 16) throw new Error("v1 case set must contain exactly 80 real and 16 controlled cases.");
  verifyV1Inputs(caseBytes, v1SourceManifest);
  return { caseBytes, caseManifest, v1SourceManifest };
}

function assertV1SharedRecipeDependencies(v1SourceManifest) {
  const recipeHashes = hashes(pluginRoot, recipeFiles);
  for (const relative of recipeFiles.slice(1)) {
    if (recipeHashes[relative].sha256 !== v1SourceManifest.files[relative]?.sha256) throw new Error(`Shared request recipe dependency changed since v1; resolve A/B recipe compatibility before freezing: ${relative}`);
  }
  return recipeHashes;
}

function prepareAToolSnapshot() {
  assertFreshOutputPath(v2Root, "v2 snapshot path");
  const { caseBytes, caseManifest, v1SourceManifest } = frozenV1Inputs();
  const recipeHashesBefore = assertV1SharedRecipeDependencies(v1SourceManifest);
  const liveToolFiles = [...toolFiles.filter((relative) => !baselineToolFiles.has(relative)), ...bootstrapFiles];
  const liveToolHashesBefore = hashes(pluginRoot, liveToolFiles);
  fs.mkdirSync(v2Root, { recursive: false });
  const tool = freezeToolSource({ caseBytes, caseManifest, v1SourceManifest, requestBuilderRoot: pluginRoot });
  const recipeHashesAfter = hashes(pluginRoot, recipeFiles);
  if (JSON.stringify(recipeHashesBefore) !== JSON.stringify(recipeHashesAfter)) throw new Error("Shared request recipe changed while the v2 tool snapshot was being assembled.");
  const liveToolHashesAfter = hashes(pluginRoot, liveToolFiles);
  if (JSON.stringify(liveToolHashesBefore) !== JSON.stringify(liveToolHashesAfter)) throw new Error("v2 harness code changed while its immutable tool snapshot was being assembled.");
  if (tool.manifest.requestBuilderSha256 !== recipeHashesBefore["src/core/ai/aiTaskRequest.ts"].sha256) throw new Error("Frozen A request recipe differs from the captured shared request builder.");
  const v1ManifestBytes = fs.readFileSync(v1SourceManifestPath);
  const v1Manifest = JSON.parse(v1ManifestBytes.toString("utf8"));
  verifySnapshot({ sourceRoot: v1SourceRoot, manifest: v1Manifest });
  if (!fs.readFileSync(v1CasePath).equals(caseBytes)) throw new Error("Read-only v1 case set changed while the v2 tools were being frozen.");
  const verifiedTool = verifyV2ToolSnapshot({ configPath: tool.configPath, toolManifestPath });
  return {
    status: "A-ready",
    caseSetId: caseManifest.caseSetId,
    realCases: caseManifest.realCases.length,
    controlledCases: caseManifest.controlledCases.length,
    toolManifestSha256: tool.toolManifestSha256,
    caseManifestSha256: tool.manifest.caseManifestSha256,
    configSha256: tool.manifest.configSha256,
    sources: {
      A: { root: path.relative(pluginRoot, v1SourceRoot), manifest: path.relative(pluginRoot, v1SourceManifestPath), manifestSha256: sha256(v1ManifestBytes), verificationMode: "snapshot-only" },
      B: { status: "deferred-until-product-snapshot-is-stable", root: path.relative(pluginRoot, path.join(v2Root, "snapshots/B/source")), manifest: path.relative(pluginRoot, path.join(v2Root, "snapshots/B/source-manifest.json")) }
    },
    toolFiles: verifiedTool.manifest.paths.length,
    config: path.relative(pluginRoot, tool.configPath)
  };
}

function freezeBProductSnapshot() {
  if (!fs.existsSync(v2Root) || !fs.existsSync(toolManifestPath)) throw new Error("Freeze the immutable v2 tool/request-recipe snapshot first with --phase=prepare-a.");
  const { caseBytes, v1SourceManifest } = frozenV1Inputs();
  const frozenTool = verifyV2ToolSnapshot({ configPath: path.join(toolRoot, "config.json"), toolManifestPath });
  if (sha256(fs.readFileSync(path.join(toolRoot, "cases/live-markdown-multiscenario-v1.json"))) !== sha256(caseBytes)) throw new Error("Frozen v2 case set differs from the read-only v1 case set.");
  const recipeHashes = assertV1SharedRecipeDependencies(v1SourceManifest);
  if (recipeHashes["src/core/ai/aiTaskRequest.ts"].sha256 !== frozenTool.manifest.requestBuilderSha256) throw new Error("Live request builder differs from the A builder frozen for v2; cannot compare A/B recipes.");
  const destination = path.join(v2Root, "snapshots/B/source");
  const manifestPath = path.join(v2Root, "snapshots/B/source-manifest.json");
  const bSnapshotRoot = path.dirname(destination);
  if (fs.existsSync(destination) || fs.existsSync(manifestPath) || fs.existsSync(bSnapshotRoot)) throw new Error("B source snapshot path exists; refusing to overwrite or repair it.");
  fs.mkdirSync(bSnapshotRoot, { recursive: true });
  const b = freezeBSource({ caseManifestSha256: sha256(caseBytes) });
  if (b.manifest.files["src/core/ai/aiTaskRequest.ts"]?.sha256 !== frozenTool.manifest.requestBuilderSha256) throw new Error("B request builder differs from the shared v2 builder used for A.");
  const v1ManifestBytes = fs.readFileSync(v1SourceManifestPath);
  verifySnapshot({ sourceRoot: v1SourceRoot, manifest: v1SourceManifest });
  verifySnapshot({ sourceRoot: b.sourceRoot, manifest: b.manifest });
  const verifiedTool = verifyV2ToolSnapshot({ configPath: path.join(toolRoot, "config.json"), toolManifestPath });
  return {
    status: "B-ready",
    caseSetId: JSON.parse(caseBytes.toString("utf8")).caseSetId,
    toolManifestSha256: sha256(fs.readFileSync(toolManifestPath)),
    caseManifestSha256: verifiedTool.manifest.caseManifestSha256,
    configSha256: verifiedTool.manifest.configSha256,
    sources: {
      A: { root: path.relative(pluginRoot, v1SourceRoot), manifest: path.relative(pluginRoot, v1SourceManifestPath), manifestSha256: sha256(v1ManifestBytes), verificationMode: "snapshot-only" },
      B: { root: path.relative(pluginRoot, b.sourceRoot), manifest: path.relative(pluginRoot, b.sourceManifestPath), manifestSha256: b.manifestSha256, verificationMode: "snapshot-only" }
    },
    toolFiles: verifiedTool.manifest.paths.length,
    config: path.relative(pluginRoot, path.join(toolRoot, "config.json"))
  };
}

export function prepareV2Snapshots(phase = "prepare-a") {
  if (phase === "prepare-a") return prepareAToolSnapshot();
  if (phase === "freeze-b") return freezeBProductSnapshot();
  if (phase === "all") {
    prepareAToolSnapshot();
    return freezeBProductSnapshot();
  }
  throw new Error("Snapshot phase must be prepare-a, freeze-b, or all.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const phaseArgs = args.filter((argument) => argument.startsWith("--phase="));
  if (args.length !== phaseArgs.length || phaseArgs.length > 1) throw new Error("Usage: node scripts/ai-scenario-eval/scenario-v2-snapshot.mjs [--phase=prepare-a|freeze-b|all]");
  console.log(JSON.stringify(prepareV2Snapshots(phaseArgs[0]?.slice("--phase=".length) ?? "prepare-a"), null, 2));
}

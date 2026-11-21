// Freeze one independent B8 source snapshot and four additional model runs.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evaluationRoot = path.join(root, ".cache/acceptance/ai-common-failures/v1");
const attemptId = "authorized-run-02";
const attemptRoot = path.join(evaluationRoot, attemptId);
const snapshotRoot = path.join(evaluationRoot, "snapshots/B8");
const runtimePath = path.join(root, ".cache/acceptance/ai-model-comparison/v1/runtime-preparation.json");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const profileModels = {
  balanced: { modelId: "Qwen3-1.7B-Q4_K_M.gguf", modelSha256: "b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897" },
  light: { modelId: "Qwen3-0.6B-Q4_K_M.gguf", modelSha256: "ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a" }
};
export const B8_SCHEDULE = Object.freeze([
  Object.freeze({ round: 1, profile: "balanced", variant: "B8", runId: "common-b8-balanced-r1" }),
  Object.freeze({ round: 1, profile: "light", variant: "B8", runId: "common-b8-light-r1" }),
  Object.freeze({ round: 2, profile: "light", variant: "B8", runId: "common-b8-light-r2" }),
  Object.freeze({ round: 2, profile: "balanced", variant: "B8", runId: "common-b8-balanced-r2" })
]);

function safePath(base, relative) {
  const absolute = path.resolve(base, relative);
  const rel = path.relative(path.resolve(base), absolute);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) throw new Error("Path escaped its root: " + relative);
  for (let current = absolute; current !== path.resolve(base); current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error("Symlink path is not allowed: " + relative);
  }
  return absolute;
}

function walk(base, current = base, files = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Symlink is not allowed: " + path.relative(base, absolute));
    if (entry.isDirectory()) walk(base, absolute, files);
    else if (entry.isFile()) files.push(path.relative(base, absolute).split(path.sep).join("/"));
    else throw new Error("Non-regular entry is not allowed: " + path.relative(base, absolute));
  }
  return files.sort();
}

function hashFiles(base, files) {
  return Object.fromEntries(files.map(relative => {
    const bytes = fs.readFileSync(safePath(base, relative));
    return [relative, { sha256: hash(bytes), bytes: bytes.byteLength }];
  }));
}

function hashTree(base) { return hashFiles(base, walk(base)); }

function productPaths() {
  const files = [];
  for (const directory of ["src", "preload"]) {
    const absolute = path.join(root, directory);
    if (!fs.lstatSync(absolute).isDirectory()) throw new Error("Missing product directory: " + directory);
    files.push(...walk(absolute).map(relative => path.join(directory, relative).split(path.sep).join("/")));
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && (/^package(?:-[^.]+)?\.json$/u.test(entry.name) || entry.name === "plugin.json")) files.push(entry.name);
    if (entry.isSymbolicLink() && (/^package(?:-[^.]+)?\.json$/u.test(entry.name) || entry.name === "plugin.json")) throw new Error("Product metadata is a symlink: " + entry.name);
  }
  if (!files.includes("package.json") || !files.includes("plugin.json")) throw new Error("Product snapshot requires package.json and plugin.json.");
  return [...new Set(files)].sort();
}

function verifyTreeManifest(base, manifest) {
  const actual = hashTree(base);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) throw new Error("Frozen tree differs from its file manifest.");
  return actual;
}

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function writeJson(filePath, value) { fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", { flag: "wx" }); }

function replaceAllowedB8Fields(config) {
  const value = structuredClone(config);
  value.evaluationId = "ai-common-failures-b8-v1";
  value.outputRoot = ".cache/acceptance/ai-common-failures/v1/" + attemptId + "/runs/" + config.model.profileId;
  value.viteCacheRoot = ".cache/vite-ai-common-failures-v1/" + attemptId + "/" + config.model.profileId;
  const source = value.sourceVariants.B;
  value.sourceVariants.B = {
    ...source,
    label: "B8: fixed candidate after B7 real evaluation, " + config.model.profileId,
    sourceRoot: ".cache/acceptance/ai-common-failures/v1/snapshots/B8/source",
    sourceManifest: ".cache/acceptance/ai-common-failures/v1/snapshots/B8/source-manifest.json",
    provenance: "captured-fixed-candidate-after-B7",
    verificationMode: "snapshot-only"
  };
  return value;
}

function stableConfigFields(config) {
  const value = structuredClone(config);
  for (const key of ["evaluationId", "outputRoot", "viteCacheRoot"]) delete value[key];
  const source = value.sourceVariants.B;
  for (const key of ["label", "sourceRoot", "sourceManifest", "provenance", "verificationMode"]) delete source[key];
  return value;
}

export function buildB8ProfileConfig(baseConfig) {
  if (!["light", "balanced"].includes(baseConfig?.model?.profileId)) throw new Error("Unexpected B8 model profile.");
  const next = replaceAllowedB8Fields(baseConfig);
  if (JSON.stringify(stableConfigFields(baseConfig)) !== JSON.stringify(stableConfigFields(next))) {
    throw new Error("B8 profile rebind changed the frozen role, request recipe, case set, model or budgets.");
  }
  return next;
}

export function buildB8AttemptPlan({ caseManifestSha256, derivedCaseManifestSha256, b7SourceManifestSha256, b7ToolManifestSha256, b7RunLedgerSha256, runtimePreparationSha256, profiles }) {
  if (caseManifestSha256 !== derivedCaseManifestSha256) throw new Error("B8 case set does not match the frozen 87-case set.");
  if (profiles?.length !== 2 || new Set(profiles.map(profile => profile.id)).size !== 2 || profiles.some(profile => !profile.configSha256 || !profile.toolManifestSha256)) {
    throw new Error("B8 attempt requires two uniquely bound profile tools.");
  }
  return {
    schemaVersion: 1,
    evaluationId: "ai-common-failures-b8-v1",
    attemptId,
    purpose: "Four additional no-retry runs of the fixed B8 candidate; preserves every B7 result.",
    inputs: { caseManifestSha256, b7SourceManifestSha256, b7ToolManifestSha256, b7RunLedgerSha256, runtimePreparationSha256 },
    profiles,
    schedule: B8_SCHEDULE,
    policy: {
      realCases: 87, controlledCases: 16, retries: 0, downloadsAllowed: false, deploymentAllowed: false,
      editorWriteback: false, sequential: true, maxCallsPerCase: 64, runnerDeadlineMs: 90000,
      harnessDeadlineMs: 90000, taskDeadlineMs: 300000, sourceMaxBytes: 1048576, maxChunks: 50
    },
    exclusions: ["No B6 rerun.", "No changes to the B7 frozen source, profile tools, or eight-run schedule.", "No single-case retries."]
  };
}

function verifyFrozenInputs() {
  const freezePath = path.join(evaluationRoot, "freeze-manifest.json");
  const freeze = readJson(freezePath);
  for (const [relative, expected] of Object.entries(freeze.files)) {
    const bytes = fs.readFileSync(safePath(evaluationRoot, relative));
    if (hash(bytes) !== expected.sha256 || bytes.byteLength !== expected.bytes) throw new Error("Frozen B7 evaluation input changed: " + relative);
  }
  const derived = readJson(path.join(evaluationRoot, "run-inputs/derived-manifest.json"));
  const casePath = safePath(root, derived.casePath);
  const caseBytes = fs.readFileSync(casePath);
  const cases = JSON.parse(caseBytes.toString("utf8"));
  if (hash(caseBytes) !== derived.caseManifestSha256 || derived.counts?.totalReal !== 87 || derived.counts?.controlled !== 16
      || cases.realCases?.length !== 87 || cases.controlledCases?.length !== 16
      || cases.baseCaseManifestSha256 !== derived.baseCaseManifestSha256) throw new Error("Expected the unchanged frozen 87+16 case set.");
  const controlledIds = cases.controlledCases.map(item => item.id);
  const expectedControlledIds = Array.from({ length: 16 }, (_, index) => "E" + String(index + 1).padStart(2, "0"));
  if (JSON.stringify(controlledIds) !== JSON.stringify(expectedControlledIds)) throw new Error("Expected the unchanged controlled E01-E16 boundary suite.");
  const b7SourcePath = path.join(evaluationRoot, "snapshots/B7/source-manifest.json");
  const b7Source = readJson(b7SourcePath);
  if (b7Source.variant !== "B7" || b7Source.caseManifestSha256 !== derived.baseCaseManifestSha256) throw new Error("B7 source snapshot is not bound to the original frozen cases.");
  verifyTreeManifest(path.join(evaluationRoot, "snapshots/B7/source"), b7Source);
  const frozenConfig = readJson(path.join(evaluationRoot, "config.json"));
  const b7LedgerPath = path.join(evaluationRoot, "authorized-run-01/execution-ledger.json");
  const b7Ledger = readJson(b7LedgerPath);
  const expectedB7Runs = frozenConfig.schedule.flat().map((item, index) => ({
    runId: "common-" + (item.variant === "B6" ? "b6" : "b7") + "-" + item.profile + "-" + (index < 4 ? "r1" : "r2"),
    variant: item.variant, profile: item.profile
  }));
  if (b7Ledger.runs?.length !== 8 || JSON.stringify(b7Ledger.schedule) !== JSON.stringify(frozenConfig.schedule)
      || b7Ledger.runs.some((run, index) => run.runId !== expectedB7Runs[index].runId
        || run.variant !== expectedB7Runs[index].variant || run.profile !== expectedB7Runs[index].profile
        || run.status !== "execution-complete" || run.cleanupErrors?.length)) {
    throw new Error("B8 requires the original eight B7/B6 runs to be complete and cleanup-clean.");
  }
  const runtimeBytes = fs.readFileSync(runtimePath);
  const runtime = JSON.parse(runtimeBytes.toString("utf8"));
  if (runtime.status !== "configured-from-verified-cache" || runtime.deploymentPerformed !== false || runtime.downloadBytes !== 0 || runtime.profiles?.length !== 2) {
    throw new Error("B8 may use only the previously verified cached models; downloads and deployment are disabled.");
  }
  for (const [id, expected] of Object.entries(profileModels)) {
    const profile = runtime.profiles.find(item => item.profileId === id);
    if (!profile || !profile.cachedIntegrityVerified || profile.modelId !== expected.modelId || profile.modelSha256 !== expected.modelSha256
        || !fs.statSync(safePath(root, profile.path)).isDirectory()) throw new Error("Verified cached model profile is unavailable: " + id);
  }
  const baseProfiles = {};
  for (const id of ["balanced", "light"]) {
    const profileRoot = path.join(evaluationRoot, "profiles", id);
    const toolRoot = path.join(profileRoot, "tool-source");
    const toolManifest = readJson(path.join(profileRoot, "tool-manifest.json"));
    verifyTreeManifest(toolRoot, toolManifest);
    const config = readJson(path.join(toolRoot, "config.json"));
    if (toolManifest.evaluationId !== "ai-common-failures-v1" || toolManifest.caseManifestSha256 !== derived.caseManifestSha256
        || config.model.profileId !== id || config.model.modelId !== profileModels[id].modelId
        || config.model.retries !== 0 || config.model.deploymentAllowed !== false
        || config.sourceVariants.B?.sourceManifest !== ".cache/acceptance/ai-common-failures/v1/snapshots/B7/source-manifest.json") {
      throw new Error("Frozen B7 profile does not match its original model/tool contract: " + id);
    }
    baseProfiles[id] = { profileRoot, toolRoot, toolManifest, config };
  }
  if (fs.existsSync(snapshotRoot) || fs.existsSync(attemptRoot)) throw new Error("B8 snapshot or authorized run already exists; refusing overwrite.");
  return { freeze, derived, cases, caseBytes, controlledIds, b7Source, b7SourcePath, b7LedgerPath, b7Ledger, runtime, runtimeBytes, baseProfiles };
}

function copySnapshotB8(input) {
  const paths = productPaths();
  const before = hashFiles(root, paths);
  fs.mkdirSync(snapshotRoot, { recursive: false });
  const sourceRoot = path.join(snapshotRoot, "source");
  fs.mkdirSync(sourceRoot, { recursive: false });
  for (const relative of paths) {
    const from = safePath(root, relative);
    const to = safePath(sourceRoot, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
  }
  const after = hashFiles(root, paths);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Product source changed during B8 capture; partial snapshot retained and cannot be overwritten.");
  const copied = hashTree(sourceRoot);
  if (JSON.stringify(copied) !== JSON.stringify(before)) throw new Error("B8 copied source does not match the live source hash.");
  const manifest = {
    schemaVersion: 1, variant: "B8", capturedAt: new Date().toISOString(),
    caseManifestSha256: input.derived.baseCaseManifestSha256,
    provenance: "captured-fixed-candidate-after-B7-real-evaluation",
    verificationMode: "snapshot-only-after-freeze", paths, files: copied, stable: true,
    parentB7SourceManifestSha256: hash(fs.readFileSync(input.b7SourcePath))
  };
  const manifestPath = path.join(snapshotRoot, "source-manifest.json");
  writeJson(manifestPath, manifest);
  return { sourceRoot, manifestPath, manifest };
}

function copyB8Profile(id, baseProfile, derived) {
  const profileRoot = path.join(attemptRoot, "profiles", id);
  const toolRoot = path.join(profileRoot, "tool-source");
  fs.mkdirSync(profileRoot, { recursive: false });
  fs.cpSync(baseProfile.toolRoot, toolRoot, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: false });
  const configPath = path.join(toolRoot, "config.json");
  const config = buildB8ProfileConfig(baseProfile.config);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", { flag: "w" });
  const basePaths = walk(baseProfile.toolRoot);
  const paths = walk(toolRoot);
  if (JSON.stringify(paths) !== JSON.stringify(basePaths)) throw new Error("B8 tool copy changed the B7 tool file set.");
  for (const relative of paths) {
    if (relative === "config.json") continue;
    const oldHash = hash(fs.readFileSync(safePath(baseProfile.toolRoot, relative)));
    const newHash = hash(fs.readFileSync(safePath(toolRoot, relative)));
    if (oldHash !== newHash) throw new Error("B8 changed a frozen B7 tool file: " + relative);
  }
  const manifest = {
    schemaVersion: 2, evaluationId: config.evaluationId, caseSetId: config.defaultCaseSetId,
    derivedFromB7ProfileToolManifestSha256: hash(fs.readFileSync(path.join(baseProfile.profileRoot, "tool-manifest.json"))),
    b7SourceManifestSha256: hash(fs.readFileSync(baseProfile.config.sourceVariants.B.sourceManifest
      ? safePath(root, baseProfile.config.sourceVariants.B.sourceManifest) : path.join(evaluationRoot, "snapshots/B7/source-manifest.json"))),
    b8SourceManifestSha256: hash(fs.readFileSync(path.join(snapshotRoot, "source-manifest.json"))),
    caseManifestSha256: derived.caseManifestSha256,
    configSha256: hash(fs.readFileSync(configPath)), paths, files: hashTree(toolRoot),
    bootstrap: baseProfile.toolManifest.bootstrap, requestBuilderSha256: baseProfile.toolManifest.requestBuilderSha256
  };
  const manifestPath = path.join(profileRoot, "tool-manifest.json");
  writeJson(manifestPath, manifest);
  return {
    id, modelId: config.model.modelId, modelSha256: profileModels[id].modelSha256,
    config: path.relative(root, configPath).split(path.sep).join("/"), configSha256: manifest.configSha256,
    toolManifest: path.relative(root, manifestPath).split(path.sep).join("/"),
    toolManifestSha256: hash(fs.readFileSync(manifestPath)), files: manifest.files
  };
}

export function freezeB8({ productStable = false } = {}) {
  if (productStable !== true) throw new Error("B8 freeze requires explicit product-stable confirmation.");
  const input = verifyFrozenInputs();
  fs.mkdirSync(attemptRoot, { recursive: false });
  fs.mkdirSync(path.join(attemptRoot, "profiles"), { recursive: false });
  const snapshot = copySnapshotB8(input);
  const profiles = ["balanced", "light"].map(id => copyB8Profile(id, input.baseProfiles[id], input.derived));
  const caseManifestSha256 = hash(input.caseBytes);
  const plan = buildB8AttemptPlan({
    caseManifestSha256,
    derivedCaseManifestSha256: caseManifestSha256,
    b7SourceManifestSha256: hash(fs.readFileSync(input.b7SourcePath)),
    b7ToolManifestSha256: hash(fs.readFileSync(path.join(evaluationRoot, "profiles/light/tool-manifest.json"))),
    b7RunLedgerSha256: hash(fs.readFileSync(input.b7LedgerPath)),
    runtimePreparationSha256: hash(input.runtimeBytes),
    profiles
  });
  const attemptManifest = {
    ...plan,
    frozenAt: new Date().toISOString(),
    sourceSnapshot: {
      root: path.relative(root, snapshot.sourceRoot).split(path.sep).join("/"),
      manifest: path.relative(root, snapshot.manifestPath).split(path.sep).join("/"),
      manifestSha256: hash(fs.readFileSync(snapshot.manifestPath)),
      parentB7ManifestSha256: hash(fs.readFileSync(input.b7SourcePath))
    },
    controlledBoundary: {
      caseCount: input.controlledIds.length,
      caseIds: input.controlledIds,
      execution: "Run E01-E16 separately with controlled mode for every scheduled group; keep this 16-case denominator separate from the 87 real user-task cases.",
      modelCallsExpected: 0
    },
    frozenInputs: {
      freezeManifestSha256: hash(fs.readFileSync(path.join(evaluationRoot, "freeze-manifest.json"))),
      derivedCaseManifestSha256: input.derived.caseManifestSha256,
      B7ToolManifestSha256: plan.inputs.b7ToolManifestSha256,
      runtimePreparationSha256: plan.inputs.runtimePreparationSha256
    },
    boundary: "All files are new B8 evidence. B7 snapshots, tools, reports, records, and the eight-run schedule remain unchanged."
  };
  const attemptManifestPath = path.join(attemptRoot, "attempt-manifest.json");
  writeJson(attemptManifestPath, attemptManifest);
  return {
    status: "B8-frozen",
    attemptId,
    attemptManifest: path.relative(root, attemptManifestPath).split(path.sep).join("/"),
    attemptManifestSha256: hash(fs.readFileSync(attemptManifestPath)),
    sourceManifest: path.relative(root, snapshot.manifestPath).split(path.sep).join("/"),
    sourceManifestSha256: hash(fs.readFileSync(snapshot.manifestPath)),
    profiles: profiles.map(({ id, config, configSha256, toolManifest, toolManifestSha256 }) => ({ id, config, configSha256, toolManifest, toolManifestSha256 })),
    schedule: attemptManifest.schedule
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== "--product-stable") {
    throw new Error("Usage: node scripts/ai-scenario-eval/prepare-ai-common-failures-b8.mjs --product-stable");
  }
  try { console.log(JSON.stringify(freezeB8({ productStable: true }), null, 2)); }
  catch (error) { console.error(error?.stack ?? String(error)); process.exitCode = 1; }
}

// Freeze a B9 candidate and an isolated, no-retry four-run attempt linked to B8 evidence.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assessControlledB8Report, assessControlledB8Supplement } from "./b8-controlled-assessment.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evaluationRoot = path.join(root, ".cache/acceptance/ai-common-failures/v1");
const attemptId = "authorized-run-03";
const attemptRoot = path.join(evaluationRoot, attemptId);
const snapshotRoot = path.join(evaluationRoot, "snapshots/B9");
const runtimePath = path.join(root, ".cache/acceptance/ai-model-comparison/v1/runtime-preparation.json");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const changedB8Paths = Object.freeze(["src/core/ai/aiTaskRunner.ts", "src/core/ai/proseEditFactGuard.ts"]);
const profiles = Object.freeze({
  balanced: { modelId: "Qwen3-1.7B-Q4_K_M.gguf", modelSha256: "b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897" },
  light: { modelId: "Qwen3-0.6B-Q4_K_M.gguf", modelSha256: "ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a" }
});
export const B9_SCHEDULE = Object.freeze([
  Object.freeze({ round: 1, profile: "balanced", variant: "B9", runId: "common-b9-balanced-r1" }),
  Object.freeze({ round: 1, profile: "light", variant: "B9", runId: "common-b9-light-r1" }),
  Object.freeze({ round: 2, profile: "light", variant: "B9", runId: "common-b9-light-r2" }),
  Object.freeze({ round: 2, profile: "balanced", variant: "B9", runId: "common-b9-balanced-r2" })
]);

function safePath(base, relative) {
  const absolute = path.resolve(base, relative);
  const rel = path.relative(path.resolve(base), absolute);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) throw new Error(`Path escaped root: ${relative}`);
  for (let current = absolute; current !== path.resolve(base); current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlink path is not allowed: ${relative}`);
  }
  return absolute;
}

function walk(base, current = base, files = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink is not allowed: ${path.relative(base, absolute)}`);
    if (entry.isDirectory()) walk(base, absolute, files);
    else if (entry.isFile()) files.push(path.relative(base, absolute).split(path.sep).join("/"));
    else throw new Error(`Non-regular entry is not allowed: ${path.relative(base, absolute)}`);
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
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" }); }
function relative(file) { return path.relative(root, file).split(path.sep).join("/"); }

function productPaths() {
  const files = [];
  for (const directory of ["src", "preload"]) {
    const absolute = path.join(root, directory);
    if (!fs.lstatSync(absolute).isDirectory()) throw new Error(`Missing product directory: ${directory}`);
    files.push(...walk(absolute).map(file => path.join(directory, file).split(path.sep).join("/")));
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && (/^package(?:-[^.]+)?\.json$/u.test(entry.name) || entry.name === "plugin.json")) files.push(entry.name);
    if (entry.isSymbolicLink() && (/^package(?:-[^.]+)?\.json$/u.test(entry.name) || entry.name === "plugin.json")) throw new Error(`Product metadata is a symlink: ${entry.name}`);
  }
  if (!files.includes("package.json") || !files.includes("plugin.json")) throw new Error("Product snapshot requires package.json and plugin.json.");
  return [...new Set(files)].sort();
}

function verifyManifestTree(base, manifest, label) {
  const actualPaths = walk(base);
  if (JSON.stringify(actualPaths) !== JSON.stringify([...manifest.paths].sort())) throw new Error(`${label} path set changed.`);
  const actual = hashFiles(base, actualPaths);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) throw new Error(`${label} file manifest changed.`);
  return actual;
}

function verifyFrozenCasesAndInputs() {
  const freezePath = path.join(evaluationRoot, "freeze-manifest.json");
  const freeze = readJson(freezePath);
  for (const [file, expected] of Object.entries(freeze.files ?? {})) {
    const bytes = fs.readFileSync(safePath(evaluationRoot, file));
    if (hash(bytes) !== expected.sha256 || bytes.byteLength !== expected.bytes) throw new Error(`Frozen evaluation input changed: ${file}`);
  }
  const derived = readJson(path.join(evaluationRoot, "run-inputs/derived-manifest.json"));
  const caseBytes = fs.readFileSync(safePath(root, derived.casePath));
  const cases = JSON.parse(caseBytes.toString("utf8"));
  if (hash(caseBytes) !== derived.caseManifestSha256 || derived.counts?.totalReal !== 87 || derived.counts?.controlled !== 16 ||
      cases.realCases?.length !== 87 || cases.controlledCases?.length !== 16 || cases.baseCaseManifestSha256 !== derived.baseCaseManifestSha256) {
    throw new Error("B9 must preserve the frozen 87 real cases and 16 controlled cases.");
  }
  const ids = cases.controlledCases.map(({ id }) => id);
  const expectedIds = Array.from({ length: 16 }, (_, index) => `E${String(index + 1).padStart(2, "0")}`);
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) throw new Error("B9 controlled case set must remain E01-E16.");
  return { freeze, derived, caseBytes, cases, ids };
}

function verifyRun02Lineage(derived, caseBytes) {
  const b8SourcePath = path.join(evaluationRoot, "snapshots/B8/source-manifest.json");
  const b8Source = readJson(b8SourcePath);
  const b8AttemptPath = path.join(evaluationRoot, "authorized-run-02/attempt-manifest.json");
  const b8LedgerPath = path.join(evaluationRoot, "authorized-run-02/execution-ledger.json");
  const b8EventsPath = path.join(evaluationRoot, "authorized-run-02/execution-ledger.jsonl");
  const b8ReportPath = path.join(evaluationRoot, "authorized-run-02/runs/balanced/B-controlled-common-b8-balanced-r1/controlled-report.json");
  const b8AttemptBytes = fs.readFileSync(b8AttemptPath);
  const b8LedgerBytes = fs.readFileSync(b8LedgerPath);
  const b8ReportBytes = fs.readFileSync(b8ReportPath);
  const b8Attempt = JSON.parse(b8AttemptBytes.toString("utf8"));
  const b8Ledger = JSON.parse(b8LedgerBytes.toString("utf8"));
  const b8Report = JSON.parse(b8ReportBytes.toString("utf8"));
  if (hash(caseBytes) !== b8Attempt.inputs?.caseManifestSha256 || b8Attempt.sourceSnapshot?.manifestSha256 !== hash(fs.readFileSync(b8SourcePath)) ||
      b8Source.variant !== "B8" || b8Source.caseManifestSha256 !== derived.baseCaseManifestSha256) throw new Error("B8 source or case lineage changed.");
  verifyManifestTree(path.join(evaluationRoot, "snapshots/B8/source"), b8Source, "B8 source snapshot");
  if (b8Ledger.status !== "controlled-failed" || b8Ledger.completedGroups?.length !== 1 || b8Ledger.completedGroups[0]?.real ||
      b8Ledger.completedGroups[0]?.runId !== "common-b8-balanced-r1" || b8Ledger.caseManifestSha256 !== hash(caseBytes)) {
    throw new Error("B9 must retain the original B8 controlled-only stop with zero real runs.");
  }
  const eventText = fs.readFileSync(b8EventsPath, "utf8");
  if (eventText.includes('"type":"real-started"')) throw new Error("B8 parent ledger contains an unexpected real-model start.");
  const eventLines = eventText.trimEnd().split("\n");
  const last = eventLines.at(-1);
  const stop = JSON.parse(last);
  const stopRecordBytes = Buffer.from(`${last}\n`);
  if (stop.type !== "attempt-stopped" || stop.data?.status !== "controlled-failed") throw new Error("B8 stop record is not the preserved controlled-only stop.");
  const controlledSourceManifestSha256 = b8Ledger.controlledSourceAlias?.sha256;
  const bindings = { caseManifestSha256: hash(caseBytes), sourceManifestSha256: controlledSourceManifestSha256 };
  const strict = assessControlledB8Report(b8Report, bindings);
  const supplement = assessControlledB8Supplement(b8Report, bindings);
  if (strict.status !== "controlled-failed" || strict.strictPasses !== 14 || JSON.stringify(strict.failedCaseIds) !== JSON.stringify(["E15", "E16"]) ||
      supplement.status !== "controlled-safety-passed") throw new Error("Run02 must remain strict 14/16 with only E15/E16 safely rejected before model calls.");
  return {
    sourceManifestSha256: hash(fs.readFileSync(b8SourcePath)), attemptManifestSha256: hash(b8AttemptBytes),
    ledgerSha256: hash(b8LedgerBytes), eventLedgerSha256: hash(fs.readFileSync(b8EventsPath)),
    controlledReportSha256: hash(b8ReportBytes), stopRecordSha256: hash(stopRecordBytes), stopEventHash: stop.eventHash,
    controlledSourceManifestSha256, strictPasses: strict.strictPasses, strictFailedIds: strict.failedCaseIds,
    supplementalSafeIds: supplement.supplementalSafeIds, b8Attempt, b8Ledger
  };
}

function buildB9Config(config, profileId) {
  const next = structuredClone(config);
  next.evaluationId = "ai-common-failures-b9-v1";
  next.outputRoot = `.cache/acceptance/ai-common-failures/v1/${attemptId}/runs/${profileId}`;
  next.viteCacheRoot = `.cache/vite-ai-common-failures-v1/${attemptId}/${profileId}`;
  next.sourceVariants.B = {
    ...next.sourceVariants.B, label: `B9: grounded tech-spec gate and escaped formula delimiter guard, ${profileId}`,
    sourceRoot: ".cache/acceptance/ai-common-failures/v1/snapshots/B9/source",
    sourceManifest: ".cache/acceptance/ai-common-failures/v1/snapshots/B9/source-manifest.json",
    provenance: "captured-fixed-candidate-after-B8-controlled-stop", verificationMode: "snapshot-only"
  };
  return next;
}

function stableConfig(config) {
  const value = structuredClone(config);
  for (const key of ["evaluationId", "outputRoot", "viteCacheRoot"]) delete value[key];
  for (const key of ["label", "sourceRoot", "sourceManifest", "provenance", "verificationMode"]) delete value.sourceVariants.B[key];
  return value;
}

export function buildB9AttemptPlan({ caseManifestSha256, derivedCaseManifestSha256, b8SourceManifestSha256,
  b8ToolManifestSha256, runtimePreparationSha256, previousAttempt, profiles: profileManifests }) {
  if (caseManifestSha256 !== derivedCaseManifestSha256) throw new Error("B9 case hash differs from the frozen 87+16 case set.");
  if (profileManifests?.length !== 2 || new Set(profileManifests.map(profile => profile.id)).size !== 2 ||
      profileManifests.some(profile => !profile.configSha256 || !profile.toolManifestSha256)) throw new Error("B9 requires exactly two bound profile tools.");
  return {
    schemaVersion: 1, evaluationId: "ai-common-failures-b9-v1", candidateId: "B9", attemptId,
    purpose: "Four sequential no-retry real runs of the fixed B9 candidate; B8 controlled-only evidence remains unchanged.",
    inputs: {
      caseManifestSha256, b7SourceManifestSha256: previousAttempt.b8Attempt.inputs.b7SourceManifestSha256,
      b7ToolManifestSha256: previousAttempt.b8Attempt.inputs.b7ToolManifestSha256,
      b7RunLedgerSha256: previousAttempt.b8Attempt.inputs.b7RunLedgerSha256,
      runtimePreparationSha256, b8SourceManifestSha256,
      b8ToolManifestSha256, previousAttempt: {
        attemptId: "authorized-run-02", manifestSha256: previousAttempt.attemptManifestSha256,
        ledgerSha256: previousAttempt.ledgerSha256, eventLedgerSha256: previousAttempt.eventLedgerSha256,
        stopRecordSha256: previousAttempt.stopRecordSha256, stopEventHash: previousAttempt.stopEventHash,
        controlledReportSha256: previousAttempt.controlledReportSha256,
        controlledSourceManifestSha256: previousAttempt.controlledSourceManifestSha256
      }
    },
    profiles: profileManifests, schedule: B9_SCHEDULE,
    policy: {
      realCases: 87, controlledCases: 16, retries: 0, downloadsAllowed: false, deploymentAllowed: false,
      editorWriteback: false, sequential: true, maxCallsPerCase: 64, runnerDeadlineMs: 90000,
      harnessDeadlineMs: 90000, taskDeadlineMs: 300000, sourceMaxBytes: 1048576, maxChunks: 50,
      controlledAssessment: "strict-plus-cursor-precondition-safety-v1"
    },
    exclusions: ["B8 run02 remains immutable at strict 14/16 and supplemental-safe E15/E16; no rescore or overwrite.", "No model downloads or deployment.", "No single-case retries; each real attempt is a full 87-case group."]
  };
}

function captureB9Source(input, b8Source, b8SourceManifestSha256) {
  const paths = productPaths();
  if (JSON.stringify(paths) !== JSON.stringify([...b8Source.paths].sort())) throw new Error("B9 product file list differs from B8.");
  const before = hashFiles(root, paths);
  const changed = paths.filter(file => before[file].sha256 !== b8Source.files[file]?.sha256 || before[file].bytes !== b8Source.files[file]?.bytes);
  if (JSON.stringify(changed) !== JSON.stringify(changedB8Paths)) throw new Error(`B9 may differ from B8 only in ${changedB8Paths.join(" and ")}; found ${changed.join(", ")}.`);
  fs.mkdirSync(snapshotRoot, { recursive: false });
  const sourceRoot = path.join(snapshotRoot, "source");
  fs.mkdirSync(sourceRoot, { recursive: false });
  for (const file of paths) {
    const to = safePath(sourceRoot, file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(safePath(root, file), to, fs.constants.COPYFILE_EXCL);
  }
  const after = hashFiles(root, paths);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Product source changed during B9 snapshot capture; partial output remains immutable.");
  const copied = hashTree(sourceRoot);
  if (JSON.stringify(copied) !== JSON.stringify(before)) throw new Error("B9 snapshot bytes differ from the captured product tree.");
  const manifest = {
    schemaVersion: 1, variant: "B9", capturedAt: new Date().toISOString(),
    caseManifestSha256: input.derived.baseCaseManifestSha256,
    provenance: "captured-fixed-candidate-after-B8-controlled-stop", verificationMode: "snapshot-only-after-freeze",
    paths, files: copied, stable: true, changedFromB8: changedB8Paths,
    parentB8SourceManifestSha256: b8SourceManifestSha256
  };
  const manifestPath = path.join(snapshotRoot, "source-manifest.json");
  writeJson(manifestPath, manifest);
  return { sourceRoot, manifestPath, manifest, manifestSha256: hash(fs.readFileSync(manifestPath)) };
}

function freezeProfile(profileId, snapshot, derived) {
  const b8Profile = path.join(evaluationRoot, "authorized-run-02/profiles", profileId);
  const b8ToolRoot = path.join(b8Profile, "tool-source");
  const b8ToolManifestPath = path.join(b8Profile, "tool-manifest.json");
  const b8Manifest = readJson(b8ToolManifestPath);
  verifyManifestTree(b8ToolRoot, b8Manifest, `B8 ${profileId} profile tool`);
  const b8Config = readJson(path.join(b8ToolRoot, "config.json"));
  if (b8Manifest.evaluationId !== "ai-common-failures-b8-v1" || b8Manifest.b8SourceManifestSha256 !== hash(fs.readFileSync(path.join(evaluationRoot, "snapshots/B8/source-manifest.json"))) ||
      b8Manifest.caseManifestSha256 !== derived.caseManifestSha256 || b8Config.sourceVariants.B.sourceManifest !== ".cache/acceptance/ai-common-failures/v1/snapshots/B8/source-manifest.json" ||
      b8Config.model?.profileId !== profileId || b8Config.model?.modelId !== profiles[profileId].modelId || b8Config.model?.retries !== 0 || b8Config.model?.deploymentAllowed !== false) {
    throw new Error(`B8 ${profileId} profile no longer matches its frozen no-retry model and source contract.`);
  }
  const profileRoot = path.join(attemptRoot, "profiles", profileId);
  const toolRoot = path.join(profileRoot, "tool-source");
  fs.mkdirSync(profileRoot, { recursive: false });
  fs.cpSync(b8ToolRoot, toolRoot, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: false });
  const configPath = path.join(toolRoot, "config.json");
  const config = buildB9Config(b8Config, profileId);
  if (JSON.stringify(stableConfig(b8Config)) !== JSON.stringify(stableConfig(config))) throw new Error(`B9 ${profileId} config changed more than its evaluation/output/source binding.`);
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: "w" });
  const originalPaths = walk(b8ToolRoot);
  const copiedPaths = walk(toolRoot);
  if (JSON.stringify(originalPaths) !== JSON.stringify(copiedPaths)) throw new Error(`B9 ${profileId} tool file list differs from B8.`);
  for (const file of copiedPaths) {
    if (file === "config.json") continue;
    if (hash(fs.readFileSync(safePath(b8ToolRoot, file))) !== hash(fs.readFileSync(safePath(toolRoot, file)))) throw new Error(`B9 changed frozen harness file ${file}.`);
  }
  const configBytes = fs.readFileSync(configPath);
  const manifest = {
    ...b8Manifest, evaluationId: config.evaluationId,
    derivedFromB8ProfileToolManifestSha256: hash(fs.readFileSync(b8ToolManifestPath)),
    b9SourceManifestSha256: snapshot.manifestSha256, configSha256: hash(configBytes), files: hashTree(toolRoot)
  };
  delete manifest.derivedFromB7ProfileToolManifestSha256;
  delete manifest.b8SourceManifestSha256;
  const manifestPath = path.join(profileRoot, "tool-manifest.json");
  writeJson(manifestPath, manifest);
  return {
    id: profileId, modelId: config.model.modelId, modelSha256: profiles[profileId].modelSha256,
    config: relative(configPath), configSha256: hash(configBytes), toolManifest: relative(manifestPath),
    toolManifestSha256: hash(fs.readFileSync(manifestPath)), files: manifest.files
  };
}

function verifyPrerequisites() {
  if (fs.existsSync(snapshotRoot) || fs.existsSync(attemptRoot)) throw new Error("B9 snapshot or authorized run already exists; refusing overwrite.");
  const input = verifyFrozenCasesAndInputs();
  const b8SourcePath = path.join(evaluationRoot, "snapshots/B8/source-manifest.json");
  const b8SourceBytes = fs.readFileSync(b8SourcePath);
  const b8Source = JSON.parse(b8SourceBytes.toString("utf8"));
  const b8SourceHash = hash(b8SourceBytes);
  if (b8Source.variant !== "B8" || b8Source.caseManifestSha256 !== input.derived.baseCaseManifestSha256) throw new Error("B8 frozen source is not bound to the canonical base case set.");
  verifyManifestTree(path.join(evaluationRoot, "snapshots/B8/source"), b8Source, "B8 source snapshot");
  const previousAttempt = verifyRun02Lineage(input.derived, input.caseBytes);
  const b8Attempt = previousAttempt.b8Attempt;
  const b7LedgerPath = path.join(evaluationRoot, "authorized-run-01/execution-ledger.json");
  const b7ToolPath = path.join(evaluationRoot, "profiles/light/tool-manifest.json");
  const runtimeBytes = fs.readFileSync(runtimePath);
  const runtime = JSON.parse(runtimeBytes.toString("utf8"));
  if (hash(fs.readFileSync(b7LedgerPath)) !== b8Attempt.inputs.b7RunLedgerSha256 || hash(fs.readFileSync(b7ToolPath)) !== b8Attempt.inputs.b7ToolManifestSha256 ||
      hash(runtimeBytes) !== b8Attempt.inputs.runtimePreparationSha256 || runtime.status !== "configured-from-verified-cache" || runtime.deploymentPerformed !== false || runtime.downloadBytes !== 0) {
    throw new Error("B9 must reuse the same verified frozen inputs and cached runtime as B8 without downloading or deploying.");
  }
  return { ...input, b8Source, b8SourceHash, previousAttempt, runtimeBytes };
}

export function freezeB9({ productStable = false } = {}) {
  if (productStable !== true) throw new Error("B9 freeze requires explicit product-stable confirmation.");
  const input = verifyPrerequisites();
  fs.mkdirSync(attemptRoot, { recursive: false });
  fs.mkdirSync(path.join(attemptRoot, "profiles"), { recursive: false });
  const snapshot = captureB9Source(input, input.b8Source, input.b8SourceHash);
  const profileManifests = ["balanced", "light"].map(id => freezeProfile(id, snapshot, input.derived));
  const caseManifestSha256 = hash(input.caseBytes);
  const b8ToolPath = path.join(evaluationRoot, "authorized-run-02/profiles/light/tool-manifest.json");
  const plan = buildB9AttemptPlan({
    caseManifestSha256, derivedCaseManifestSha256: caseManifestSha256,
    b8SourceManifestSha256: input.b8SourceHash,
    b8LedgerSha256: input.previousAttempt.ledgerSha256,
    b8ToolManifestSha256: hash(fs.readFileSync(b8ToolPath)),
    runtimePreparationSha256: hash(input.runtimeBytes), previousAttempt: input.previousAttempt, profiles: profileManifests
  });
  const attemptManifest = {
    ...plan, frozenAt: new Date().toISOString(),
    sourceSnapshot: {
      root: relative(snapshot.sourceRoot), manifest: relative(snapshot.manifestPath),
      manifestSha256: snapshot.manifestSha256, parentB8ManifestSha256: input.b8SourceHash
    },
    controlledBoundary: {
      caseCount: input.ids.length, caseIds: input.ids,
      execution: "Run E01-E16 separately before each scheduled real group; report strict oracle and supplemental cursor-precondition safety separately.",
      modelCallsExpected: 0, strictPriorRun: "authorized-run-02 remains strict 14/16; no rewriting of its report or score."
    },
    frozenInputs: {
      freezeManifestSha256: hash(fs.readFileSync(path.join(evaluationRoot, "freeze-manifest.json"))),
      derivedCaseManifestSha256: input.derived.caseManifestSha256,
      b8SourceManifestSha256: input.b8SourceHash,
      b8AttemptManifestSha256: input.previousAttempt.attemptManifestSha256,
      b8LedgerSha256: input.previousAttempt.ledgerSha256,
      runtimePreparationSha256: plan.inputs.runtimePreparationSha256
    },
    boundary: "B9 is an explicit new product snapshot. B8 and earlier source, tool manifests, reports, records, and ledgers remain unchanged."
  };
  const manifestPath = path.join(attemptRoot, "attempt-manifest.json");
  writeJson(manifestPath, attemptManifest);
  return {
    status: "B9-frozen", attemptId, candidateId: "B9", attemptManifest: relative(manifestPath),
    attemptManifestSha256: hash(fs.readFileSync(manifestPath)), sourceManifest: relative(snapshot.manifestPath),
    sourceManifestSha256: snapshot.manifestSha256, changedFromB8: changedB8Paths,
    fileCount: snapshot.manifest.paths.length,
    profiles: profileManifests.map(({ id, config, configSha256, toolManifest, toolManifestSha256 }) => ({ id, config, configSha256, toolManifest, toolManifestSha256 })),
    schedule: attemptManifest.schedule,
    verifyCommand: `node scripts/ai-scenario-eval/run-ai-common-failures-b8.mjs --attempt=authorized-run-03 --candidate=B9 --manifest-sha256=${hash(fs.readFileSync(manifestPath))} --verify-only`,
    executeCommand: `node scripts/ai-scenario-eval/run-ai-common-failures-b8.mjs --attempt=authorized-run-03 --candidate=B9 --manifest-sha256=${hash(fs.readFileSync(manifestPath))} --execute`
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== "--product-stable") throw new Error("Usage: node scripts/ai-scenario-eval/prepare-ai-common-failures-b9.mjs --product-stable");
  try { console.log(JSON.stringify(freezeB9({ productStable: true }), null, 2)); }
  catch (error) { console.error(error?.stack ?? String(error)); process.exitCode = 1; }
}

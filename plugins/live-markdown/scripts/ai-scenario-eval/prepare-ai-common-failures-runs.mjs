// Builds immutable, snapshot-only run inputs for the frozen common-failures evaluation.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evaluationRoot = path.join(root, ".cache/acceptance/ai-common-failures/v1");
const legacyRoot = path.join(root, ".cache/acceptance/ai-scenarios/v1");
const v2Root = path.join(root, ".cache/acceptance/ai-scenarios/v2-r4");
const runtimePath = path.join(root, ".cache/acceptance/ai-model-comparison/v1/runtime-preparation.json");
const profiles = {
  light: { id: "light", modelId: "Qwen3-0.6B-Q4_K_M.gguf" },
  balanced: { id: "balanced", modelId: "Qwen3-1.7B-Q4_K_M.gguf" }
};
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

function safePath(base, relative) {
  const absolute = path.resolve(base, relative);
  const relativePath = path.relative(path.resolve(base), absolute);
  if (relativePath.startsWith(`..${path.sep}`) || relativePath === ".." || path.isAbsolute(relativePath)) throw new Error(`Path escaped root: ${relative}`);
  for (let current = absolute; current !== path.resolve(base); current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlink path is not allowed: ${relative}`);
  }
  return absolute;
}

function walk(rootPath, current = rootPath, files = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink is not allowed: ${path.relative(rootPath, absolute)}`);
    if (entry.isDirectory()) walk(rootPath, absolute, files);
    else if (entry.isFile()) files.push(path.relative(rootPath, absolute).split(path.sep).join("/"));
    else throw new Error(`Non-regular entry is not allowed: ${path.relative(rootPath, absolute)}`);
  }
  return files.sort();
}

function hashTree(rootPath) {
  return Object.fromEntries(walk(rootPath).map((relative) => {
    const bytes = fs.readFileSync(safePath(rootPath, relative));
    return [relative, { sha256: hash(bytes), bytes: bytes.byteLength }];
  }));
}

function productPaths() {
  const paths = [];
  for (const directory of ["src", "preload"]) {
    const absolute = path.join(root, directory);
    const stat = fs.lstatSync(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Expected a regular ${directory}/ directory.`);
    for (const relative of walk(absolute)) paths.push(path.join(directory, relative).split(path.sep).join("/"));
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && (/^package(?:-[^.]+)?\.json$/u.test(entry.name) || entry.name === "plugin.json")) paths.push(entry.name);
    if (entry.isSymbolicLink() && (/^package(?:-[^.]+)?\.json$/u.test(entry.name) || entry.name === "plugin.json")) throw new Error(`Product metadata is a symlink: ${entry.name}`);
  }
  if (!paths.includes("package.json") || !paths.includes("plugin.json")) throw new Error("Product source snapshot requires package.json and plugin.json.");
  return paths.sort();
}

function hashPaths(rootPath, paths) {
  return Object.fromEntries(paths.map((relative) => {
    const bytes = fs.readFileSync(safePath(rootPath, relative));
    return [relative, { sha256: hash(bytes), bytes: bytes.byteLength }];
  }));
}

function copyTree(sourceRoot, destinationRoot) {
  const files = walk(sourceRoot);
  fs.mkdirSync(destinationRoot, { recursive: false });
  for (const relative of files) {
    const source = safePath(sourceRoot, relative);
    const destination = safePath(destinationRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  }
  const sourceHashes = hashTree(sourceRoot);
  const destinationHashes = hashTree(destinationRoot);
  if (JSON.stringify(sourceHashes) !== JSON.stringify(destinationHashes)) throw new Error("Copied snapshot differs from its source hash manifest.");
  return { paths: files, files: destinationHashes };
}

function verifyFrozenEvaluationInputs() {
  const manifestPath = path.join(evaluationRoot, "freeze-manifest.json");
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  for (const [relative, expected] of Object.entries(manifest.files)) {
    const bytes = fs.readFileSync(safePath(evaluationRoot, relative));
    if (hash(bytes) !== expected.sha256 || bytes.byteLength !== expected.bytes) throw new Error(`Frozen evaluation input changed: ${relative}`);
  }
  const sourceManifestBytes = fs.readFileSync(path.join(evaluationRoot, "legacy-source-manifest.json"));
  const sourceManifest = JSON.parse(sourceManifestBytes.toString("utf8"));
  const caseBytes = fs.readFileSync(path.join(evaluationRoot, "legacy-cases.json"));
  if (hash(caseBytes) !== manifest.sourceEvidence.originalCaseManifestSha256 || sourceManifest.caseManifestSha256 !== hash(caseBytes)) throw new Error("Frozen legacy cases lost their source binding.");
  return { manifest, manifestSha256: hash(manifestBytes), caseBytes, caseManifest: JSON.parse(caseBytes.toString("utf8")) };
}

function genericExpected(holdout) {
  const rewrite = holdout.expected.operation === "rewrite";
  const task = holdout.expected.artifact === "mermaid" ? "diagram" : holdout.expected.artifact === "table" ? "custom" : rewrite ? "polish" : "custom";
  return {
    intent: { kind: "edit", operation: rewrite ? "rewrite" : "insert", target: rewrite ? "document" : "document_end", mode: "generate", task },
    effect: "patch",
    calls: { planning: 1, contentMin: 0, contentMax: 63 }
  };
}

export function buildExtendedCaseManifest(caseManifest, holdouts, baseCaseManifestSha256) {
  const base = structuredClone(caseManifest);
  const existingIds = new Set(base.realCases.map(({ id }) => id));
  const held = holdouts.cases.map((holdout) => {
    if (existingIds.has(holdout.id)) throw new Error(`Holdout case collides with a frozen baseline id: ${holdout.id}`);
    existingIds.add(holdout.id);
    return {
      id: holdout.id, family: holdout.family, title: holdout.family, instruction: holdout.instruction,
      source: holdout.source ?? holdout.sourceText, selection: null, cursor: null,
      expected: genericExpected(holdout), qualityOnly: true, qualityExpectation: holdout.expected
    };
  });
  if (held.some(({ source }) => typeof source !== "string")) throw new Error("A holdout case is missing source text.");
  return {
    schemaVersion: 1,
    caseSetId: "ai-common-failures-80-plus-7-v1",
    frozenFrom: "legacy 80+16 and ai-common-failures-holdout-v1",
    baseCaseManifestSha256,
    qualityOnlyHoldoutCount: held.length,
    realCases: [...base.realCases, ...held],
    controlledCases: base.controlledCases
  };
}

export function isIntentOutputSchema(schema) {
  const pending = [schema];
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || Array.isArray(current)) continue;
    const properties = current.properties;
    if (properties && typeof properties === "object") {
      const version = properties.version?.const ?? (properties.version?.enum?.length === 1 ? properties.version.enum[0] : undefined);
      const kinds = properties.kind?.const !== undefined ? [properties.kind.const] : properties.kind?.enum;
      if (version === 1 && Array.isArray(kinds) && kinds.some((value) => ["edit", "answer", "clarify", "unsupported"].includes(value))) return true;
    }
    for (const key of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(current[key])) pending.push(...current[key]);
  }
  return false;
}

export function deriveInferenceSource(source) {
  const originalPhase = 'const phase = index === 1 ? "planning" : "generation";';
  const phase = 'const phase = outputSchema && isIntentOutputSchema(outputSchema) ? "planning" : "generation";';
  const marker = 'function isoNow() {\n  return new Date().toISOString();\n}\n';
  const detector = `${marker}\nfunction isIntentOutputSchema(schema) {\n  const pending = [schema];\n  while (pending.length) {\n    const current = pending.pop();\n    if (!current || typeof current !== "object" || Array.isArray(current)) continue;\n    const properties = current.properties;\n    if (properties && typeof properties === "object") {\n      const version = properties.version?.const ?? (properties.version?.enum?.length === 1 ? properties.version.enum[0] : undefined);\n      const kinds = properties.kind?.const !== undefined ? [properties.kind.const] : properties.kind?.enum;\n      if (version === 1 && Array.isArray(kinds) && kinds.some((value) => ["edit", "answer", "clarify", "unsupported"].includes(value))) return true;\n    }\n    for (const key of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(current[key])) pending.push(...current[key]);\n  }\n  return false;\n}\n`;
  const optionsMarker = '      onProgress: (message) => { if (!harnessTimedOut) record.progress.push({ at: Date.now(), message }); },';
  const evidenceOptions = `${optionsMarker}\n      onProsePlan: (plan) => { record.prosePlanEvidence = writeProsePlanEvidence(record, plan, sha256); },`;
  const imports = 'import fs from "node:fs";\nimport path from "node:path";\n';
  const evidenceWriter = `\nexport function writeProsePlanEvidence(record, plan, sha256) {\n  if (typeof record.preplanDirectory !== "string" || !Array.isArray(plan?.batches) || !Array.isArray(plan?.slots) || typeof sha256 !== "function") throw new Error("Invalid frozen prose plan evidence input.");\n  const evidence = {\n    schemaVersion: 1, caseId: record.id, sourceHash: plan.sourceHash, revision: plan.revision ?? null, scope: plan.scope,\n    sourceOwnedRanges: plan.slots.map(({ id, range, paragraphId }) => ({ id, range, paragraphId })),\n    batches: plan.batches.map(({ id, slots, prompt, systemPrompt, maxTokens, contextTokens, maxOutputBytes }) => ({\n      id, slotIds: slots.map(({ id: slotId }) => slotId), prompt, systemPrompt, maxTokens, contextTokens, maxOutputBytes\n    }))\n  };\n  const bytes = Buffer.from(JSON.stringify(evidence, null, 2) + "\\n", "utf8");\n  const filePath = path.join(record.preplanDirectory, record.id + ".json");\n  fs.writeFileSync(filePath, bytes, { flag: "wx" });\n  return { path: path.relative(process.cwd(), filePath).split(path.sep).join("/"), sha256: sha256(bytes), sourceHash: plan.sourceHash, batchCount: plan.batches.length, slotCount: plan.slots.length };\n}\n`;
  if (source.split(originalPhase).length !== 2 || source.split(marker).length !== 2 || source.split(optionsMarker).length !== 2 || source.includes("writeProsePlanEvidence")) throw new Error("Frozen inference tool no longer matches the reviewed phase/evidence integration points.");
  return imports + source.replace(marker, detector).replace(originalPhase, phase).replace(optionsMarker, evidenceOptions) + evidenceWriter;
}

export function deriveRunnerSource(source) {
  const originalDirectories = 'fs.mkdirSync(path.join(resolved.runDirectory, "records"), { recursive: false });';
  const directories = `${originalDirectories}\n  fs.mkdirSync(path.join(resolved.runDirectory, "preplans"), { recursive: false });`;
  const originalBinding = 'if (sourceManifest.caseManifestSha256 !== sha256(caseBytes)) throw new Error("Selected source snapshot is not bound to the frozen v2 case set.");';
  const binding = 'const sourceCaseBinding = caseManifest.baseCaseManifestSha256 ?? sha256(caseBytes);\n  if (sourceManifest.caseManifestSha256 !== sourceCaseBinding) throw new Error("Selected source snapshot is not bound to the original frozen case set.");';
  const originalCount = 'if (ids.size !== 80 || manifest.controlledCases.length !== 16) throw new Error("The frozen comparison case set must retain the original 80 real and 16 controlled cases.");';
  const count = 'const validCounts = (ids.size === 80 && manifest.controlledCases.length === 16) || (ids.size === 87 && manifest.qualityOnlyHoldoutCount === 7 && manifest.controlledCases.length === 16);\n  if (!validCounts) throw new Error("Expected either the original 80+16 set or its frozen 87+16 quality-holdout extension.");';
  const originalScore = 'record.evaluation = evaluateScenarioV2(item, record, product);\n        record.status = record.harnessTimedOut || record.runnerDeadlineExceeded ? "blocked" : record.evaluation.passed ? "passed" : "failed";';
  const qualityScore = `const legacyEvaluation = evaluateScenarioV2(item, record, product);\n        if (item.qualityOnly) {\n          const notApplicable = (reason) => ({ pass: null, reason });\n          record.evaluation = { ...legacyEvaluation, passed: false, outcome: "quality-review-required", strictIntent: notApplicable("Holdout is outside the frozen legacy strict oracle."), strictScore: { pass: null, layer: notApplicable("Holdout is outside the frozen legacy strict oracle.") }, quality: notApplicable("Score with the independent frozen quality contract."), range: notApplicable("Exact output relation/range requires the independent holdout review."), userTaskQualityRangeScore: notApplicable("Do not aggregate holdout completion until semantic quality is scored."), qualityReview: { required: true, expectation: item.qualityExpectation ?? null } };\n          record.status = record.harnessTimedOut || record.runnerDeadlineExceeded ? "blocked" : legacyEvaluation.safety.pass === false || legacyEvaluation.userTask.pass === false || legacyEvaluation.callBudget.pass === false ? "failed" : "review_required";\n        } else {\n          record.evaluation = legacyEvaluation;\n          record.status = record.harnessTimedOut || record.runnerDeadlineExceeded ? "blocked" : record.evaluation.passed ? "passed" : "failed";\n        }`;
  const recordFields = 'expected: item.expected, snapshot, sourceSha256: sha256(item.source), calls: [], result: null, resolvedEdit: null,';
  const recordFieldsWithQuality = 'expected: item.expected, qualityExpectation: item.qualityExpectation ?? null, preplanDirectory: path.join(resolved.runDirectory, "preplans"), snapshot, sourceSha256: sha256(item.source), calls: [], result: null, resolvedEdit: null,';
  const originalReplay = 'if (!planning) { record.plannerError = { name: "ReplayUnavailable", code: null, message: "No captured planner response." }; return; }';
  const replay = 'if (!planning) {\n    const resolvedIntent = record.result?.resolvedIntent;\n    record.planningMode = record.result?.planningMode ?? (resolvedIntent ? "program" : "unavailable");\n    if (resolvedIntent) record.plannerIntent = resolvedIntent;\n    else record.planningEvidence = { mode: record.planningMode, note: "No model intent schema call was captured; body calls are not replayed as planner output." };\n    return;\n  }\n  record.planningMode = "model";';
  if (source.split(originalDirectories).length !== 2 || source.split(originalBinding).length !== 2 || source.split(originalCount).length !== 2 || source.split(originalScore).length !== 2 || source.split(recordFields).length !== 2 || source.split(originalReplay).length !== 2) throw new Error("Frozen runner no longer matches the reviewed v2 integration points; refusing an implicit patch.");
  source = source.replace(originalDirectories, directories).replace(originalBinding, binding).replace(originalCount, count).replace(originalScore, qualityScore).replace(recordFields, recordFieldsWithQuality).replace(originalReplay, replay);
  return source;
}

function patchDerivedRunner(runnerPath) {
  fs.writeFileSync(runnerPath, deriveRunnerSource(fs.readFileSync(runnerPath, "utf8")), { flag: "w" });
}

function deriveCaseSet(input) {
  const target = path.join(evaluationRoot, "run-inputs");
  if (fs.existsSync(target)) throw new Error("Derived run inputs already exist; refusing to overwrite.");
  const holdouts = JSON.parse(fs.readFileSync(path.join(evaluationRoot, "holdout-cases.json"), "utf8"));
  const extended = buildExtendedCaseManifest(input.caseManifest, holdouts, hash(input.caseBytes));
  if (extended.realCases.length !== 87 || extended.controlledCases.length !== 16) throw new Error("Expected frozen 80+7 real cases and the original 16 controlled cases.");
  fs.mkdirSync(target, { recursive: false });
  const casePath = path.join(target, "case-manifest.json");
  fs.writeFileSync(casePath, `${JSON.stringify(extended, null, 2)}\n`, { flag: "wx" });
  const holdoutBytes = fs.readFileSync(path.join(evaluationRoot, "holdout-cases.json"));
  const derived = {
    schemaVersion: 1,
    derivedAt: new Date().toISOString(),
    baseCaseManifestSha256: hash(input.caseBytes),
    holdoutFileSha256: hash(holdoutBytes),
    caseManifestSha256: hash(fs.readFileSync(casePath)),
    counts: { baselineReal: 80, holdoutReal: 7, totalReal: 87, controlled: 16 },
    casePath: path.relative(root, casePath).split(path.sep).join("/")
  };
  fs.writeFileSync(path.join(target, "derived-manifest.json"), `${JSON.stringify(derived, null, 2)}\n`, { flag: "wx" });
  return derived;
}

function verifyDerivedCaseSet() {
  const derivedPath = path.join(evaluationRoot, "run-inputs/derived-manifest.json");
  const casesPath = path.join(evaluationRoot, "run-inputs/case-manifest.json");
  const derived = JSON.parse(fs.readFileSync(derivedPath, "utf8"));
  const caseBytes = fs.readFileSync(casesPath);
  const holdoutBytes = fs.readFileSync(path.join(evaluationRoot, "holdout-cases.json"));
  if (hash(caseBytes) !== derived.caseManifestSha256 || hash(holdoutBytes) !== derived.holdoutFileSha256) throw new Error("Derived frozen case set or its holdout source has changed.");
  const value = JSON.parse(caseBytes.toString("utf8"));
  if (value.realCases?.length !== 87 || value.controlledCases?.length !== 16 || value.baseCaseManifestSha256 !== derived.baseCaseManifestSha256) throw new Error("Derived frozen case counts or source binding changed.");
  return derived;
}

function freezeB7(input) {
  const snapshots = path.join(evaluationRoot, "snapshots");
  const target = path.join(snapshots, "B7");
  if (fs.existsSync(target)) throw new Error("B7 already exists; product snapshots are immutable and cannot be replaced.");
  const originalBytes = input.caseBytes;
  const paths = productPaths();
  const before = hashPaths(root, paths);
  fs.mkdirSync(target, { recursive: false });
  const source = path.join(target, "source");
  fs.mkdirSync(source, { recursive: false });
  for (const relative of paths) {
    const from = safePath(root, relative);
    const to = safePath(source, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
  }
  const after = hashPaths(root, paths);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Live workspace changed during B7 snapshot; partial snapshot retained, do not overwrite.");
  const files = hashTree(source);
  const baseManifest = {
    schemaVersion: 1, variant: "B7", capturedAt: new Date().toISOString(),
    caseManifestSha256: hash(originalBytes), provenance: "live-product-candidate-frozen-after-implementation",
    verificationMode: "snapshot-only-after-freeze", paths, files
  };
  const manifestPath = path.join(target, "source-manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(baseManifest, null, 2)}\n`, { flag: "wx" });
  return { source: path.relative(root, source).split(path.sep).join("/"), manifest: path.relative(root, manifestPath).split(path.sep).join("/"), manifestSha256: hash(fs.readFileSync(manifestPath)), fileCount: paths.length };
}

function copyAndPrepareProfile(profile, baseTool, caseBytes, sourceBinding, profileDirectory = profile.id) {
  const profileRoot = path.join(evaluationRoot, "profiles", profileDirectory);
  if (fs.existsSync(profileRoot)) throw new Error(`Profile tool snapshot already exists: ${profileDirectory}`);
  fs.mkdirSync(path.dirname(profileRoot), { recursive: true });
  fs.mkdirSync(profileRoot, { recursive: false });
  const toolRoot = path.join(profileRoot, "tool-source");
  const copied = copyTree(baseTool, toolRoot);
  const configPath = path.join(toolRoot, "config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const caseRelative = config.caseSets[config.defaultCaseSetId];
  const casePath = safePath(toolRoot, caseRelative);
  fs.writeFileSync(casePath, caseBytes, { flag: "w" });
  config.evaluationId = "ai-common-failures-v1";
  const caseSetId = JSON.parse(caseBytes.toString("utf8")).caseSetId;
  config.caseSets = { [caseSetId]: caseRelative };
  config.defaultCaseSetId = caseSetId;
  config.outputRoot = `.cache/acceptance/ai-common-failures/v1/runs/${profile.id}`;
  config.localAiDirectory = `.cache/acceptance/ai-model-comparison/v1/runtime/${profile.id}`;
  config.viteCacheRoot = `.cache/vite-ai-common-failures-v1/${profile.id}`;
  config.model = { ...config.model, provider: "local", activeRoleId: "general", profileId: profile.id, modelId: profile.modelId, retries: 0, deploymentAllowed: false };
  config.sourceVariants.B = {
    ...config.sourceVariants.B,
    label: `${sourceBinding.variant}: ${sourceBinding.label}, ${profile.id}`,
    sourceRoot: sourceBinding.source,
    sourceManifest: sourceBinding.manifest,
    provenance: sourceBinding.provenance,
    verificationMode: "snapshot-only"
  };
  config.limits = { ...config.limits, maxCallsPerCase: 64, runnerDeadlineMs: 90_000, independentHarnessDeadlineMs: 90_000, productionDeadlineMs: 300_000 };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: "w" });
  const runnerPath = path.join(toolRoot, "scripts/ai-scenario-eval/scenario-v2-runner.mjs");
  patchDerivedRunner(runnerPath);
  const inferencePath = path.join(toolRoot, "scripts/ai-scenario-eval/scenario-inference.mjs");
  fs.writeFileSync(inferencePath, deriveInferenceSource(fs.readFileSync(inferencePath, "utf8")), { flag: "w" });
  const paths = walk(toolRoot);
  const files = hashTree(toolRoot);
  if (JSON.stringify(paths) !== JSON.stringify(copied.paths)) throw new Error("Derived tool file list changed unexpectedly.");
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(v2Root, "tool-manifest.json"), "utf8"));
  const manifest = {
    schemaVersion: 2, evaluationId: config.evaluationId, caseSetId: config.defaultCaseSetId,
    derivedFromToolManifestSha256: hash(fs.readFileSync(path.join(v2Root, "tool-manifest.json"))),
    caseManifestSha256: hash(fs.readFileSync(casePath)), configSha256: hash(fs.readFileSync(configPath)),
    requestBuilderSha256: sourceManifest.requestBuilderSha256, bootstrap: sourceManifest.bootstrap, paths, files
  };
  const manifestPath = path.join(profileRoot, "tool-manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return { profile: profile.id, profileDirectory, sourceVariant: sourceBinding.variant, config: path.relative(root, configPath).split(path.sep).join("/"), configSha256: manifest.configSha256, toolManifest: path.relative(root, manifestPath).split(path.sep).join("/"), toolManifestSha256: hash(fs.readFileSync(manifestPath)), originalV2ToolManifestSha256: manifest.derivedFromToolManifestSha256 };
}

function prepareB6Light(input) {
  const derived = fs.existsSync(path.join(evaluationRoot, "run-inputs/derived-manifest.json")) ? verifyDerivedCaseSet() : deriveCaseSet(input);
  const b6Manifest = path.join(evaluationRoot, "snapshots/B6/source-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(b6Manifest, "utf8"));
  if (manifest.variant !== "B6" || manifest.caseManifestSha256 !== derived.baseCaseManifestSha256) throw new Error("B6 source snapshot is not bound to the original frozen case set.");
  const runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8"));
  const cachedLight = runtime.profiles?.find(({ profileId }) => profileId === "light");
  if (runtime.downloadBytes !== 0 || !cachedLight?.cachedIntegrityVerified || cachedLight.modelId !== profiles.light.modelId) throw new Error("The verified cached light profile is required; downloads are disabled.");
  const baseTool = path.join(v2Root, "tool-source");
  const sourceBinding = {
    variant: "B6", label: "frozen pre-implementation baseline",
    source: path.relative(root, path.join(path.dirname(b6Manifest), "source")).split(path.sep).join("/"),
    manifest: path.relative(root, b6Manifest).split(path.sep).join("/"),
    provenance: "existing-frozen-B6-source-snapshot"
  };
  return copyAndPrepareProfile(profiles.light, baseTool, fs.readFileSync(path.join(root, derived.casePath)), sourceBinding, "b6-light");
}

export function prepareAiCommonFailuresRuns(phase = "prepare") {
  const input = verifyFrozenEvaluationInputs();
  if (phase === "freeze-inputs") return deriveCaseSet(input);
  if (phase === "freeze-b7") return freezeB7(input);
  if (phase === "prepare-b6-light") return prepareB6Light(input);
  if (phase !== "prepare") throw new Error("Usage: prepare-ai-common-failures-runs.mjs [--phase=freeze-inputs|freeze-b7|prepare-b6-light|prepare]");
  const derivedPath = path.join(evaluationRoot, "run-inputs/derived-manifest.json");
  let derived;
  if (fs.existsSync(derivedPath)) derived = verifyDerivedCaseSet();
  else derived = deriveCaseSet(input);
  const b7Manifest = path.join(evaluationRoot, "snapshots/B7/source-manifest.json");
  if (!fs.existsSync(b7Manifest)) throw new Error("Freeze B7 after the product implementation is ready before preparing model runs.");
  const b7 = { source: path.relative(root, path.join(path.dirname(b7Manifest), "source")).split(path.sep).join("/"), manifest: path.relative(root, b7Manifest).split(path.sep).join("/") };
  const runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8"));
  if (runtime.downloadBytes !== 0 || runtime.profiles?.length !== 2 || runtime.profiles.some(({ cachedIntegrityVerified }) => !cachedIntegrityVerified)) throw new Error("Only the two previously verified cached model profiles may be used.");
  const baseTool = path.join(v2Root, "tool-source");
  const profilesRoot = path.join(evaluationRoot, "profiles");
  if (fs.existsSync(profilesRoot)) {
    const existing = fs.readdirSync(profilesRoot, { withFileTypes: true });
    if (existing.some((entry) => !entry.isDirectory() || !["b6-light"].includes(entry.name))) throw new Error("Profile run tools already exist; refusing to overwrite.");
  } else fs.mkdirSync(profilesRoot, { recursive: false });
  const prepared = [];
  for (const profileId of ["light", "balanced"]) {
    const selected = runtime.profiles.find(({ profileId: id }) => id === profileId);
    if (!selected || selected.modelId !== profiles[profileId].modelId) throw new Error(`Unexpected cached profile identity for ${profileId}.`);
    prepared.push(copyAndPrepareProfile(profiles[profileId], baseTool, fs.readFileSync(path.join(root, derived.casePath)), { variant: "B7", label: "post-implementation candidate", ...b7, provenance: "captured-post-implementation-product-candidate" }));
  }
  return { evaluationRoot: path.relative(root, evaluationRoot).split(path.sep).join("/"), extendedCasesSha256: derived.caseManifestSha256, b7SourceManifestSha256: hash(fs.readFileSync(b7Manifest)), profiles: prepared, schedule: JSON.parse(fs.readFileSync(path.join(evaluationRoot, "config.json"), "utf8")).schedule };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !args[0].startsWith("--phase="))) throw new Error("Usage: node scripts/ai-scenario-eval/prepare-ai-common-failures-runs.mjs [--phase=freeze-inputs|freeze-b7|prepare-b6-light|prepare]");
  const phase = args[0]?.slice("--phase=".length) ?? "prepare";
  try { console.log(JSON.stringify(prepareAiCommonFailuresRuns(phase), null, 2)); }
  catch (error) { console.error(error?.stack ?? String(error)); process.exitCode = 1; }
}

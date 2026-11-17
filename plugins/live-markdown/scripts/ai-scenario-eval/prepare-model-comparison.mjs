import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isWithin, pluginRoot, assertNoSymlinkPath } from "./scenario-v2-paths.mjs";
import { verifyV2ToolSnapshot } from "./scenario-v2-snapshot.mjs";

const v2Root = path.join(pluginRoot, ".cache/acceptance/ai-scenarios/v2-r4");
const sourceToolRoot = path.join(v2Root, "tool-source");
const sourceConfigPath = path.join(sourceToolRoot, "config.json");
const sourceManifestPath = path.join(v2Root, "tool-manifest.json");
const b6Root = path.join(v2Root, "snapshots/B6");
const b6SourceRoot = path.join(b6Root, "source");
const b6SourceManifestPath = path.join(b6Root, "source-manifest.json");
const caseManifestPath = path.join(pluginRoot, ".cache/acceptance/ai-scenarios/v1/case-manifest.json");
const outputRoot = path.join(pluginRoot, ".cache/acceptance/ai-model-comparison/v1");
const profiles = [
  { id: "light", modelId: "Qwen3-0.6B-Q4_K_M.gguf" },
  { id: "balanced", modelId: "Qwen3-1.7B-Q4_K_M.gguf" }
];

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function checkedPath(root, relative, label) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || relative.includes("\\")) {
    throw new Error(`${label} must be a safe relative path: ${relative}`);
  }
  const absolute = path.resolve(root, relative);
  if (!isWithin(root, absolute)) throw new Error(`${label} escaped its root: ${relative}`);
  assertNoSymlinkPath(absolute);
  return absolute;
}

function walkFiles(root, current = root, result = []) {
  assertNoSymlinkPath(current);
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    assertNoSymlinkPath(absolute);
    if (entry.isSymbolicLink()) throw new Error(`Model comparison refuses symlinks: ${path.relative(root, absolute)}`);
    if (entry.isDirectory()) walkFiles(root, absolute, result);
    else if (entry.isFile()) result.push(path.relative(root, absolute).split(path.sep).join("/"));
    else throw new Error(`Model comparison refuses non-regular files: ${path.relative(root, absolute)}`);
  }
  return result.sort();
}

function hashFiles(root, paths) {
  return Object.fromEntries(paths.map((relative) => {
    const absolute = checkedPath(root, relative, "file path");
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected a regular file: ${relative}`);
    const bytes = fs.readFileSync(absolute);
    return [relative, { sha256: sha256(bytes), bytes: bytes.byteLength }];
  }));
}

function verifyFrozenB6(expectedCaseSha) {
  assertNoSymlinkPath(b6Root);
  const manifestBytes = fs.readFileSync(b6SourceManifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.capture?.name !== "B6" || manifest.capture?.stability?.stable !== true) {
    throw new Error("B6 source manifest is missing or did not record a stable capture.");
  }
  if (manifest.caseManifestSha256 !== expectedCaseSha) throw new Error("B6 source was frozen against a different case manifest.");
  const actualPaths = walkFiles(b6SourceRoot);
  if (JSON.stringify(actualPaths) !== JSON.stringify([...manifest.paths].sort())) throw new Error("B6 source paths differ from its frozen manifest.");
  const actual = hashFiles(b6SourceRoot, actualPaths);
  for (const relative of actualPaths) {
    const expected = manifest.files?.[relative];
    if (!expected || actual[relative].sha256 !== expected.sha256 || actual[relative].bytes !== expected.bytes) {
      throw new Error(`B6 source hash differs from its frozen manifest: ${relative}`);
    }
  }
  return { manifest, manifestSha256: sha256(manifestBytes) };
}

function copySource(sourceSnapshot, destinationRoot) {
  for (const relative of sourceSnapshot.manifest.paths) {
    const source = checkedPath(sourceToolRoot, relative, "v2 tool source");
    const destination = checkedPath(destinationRoot, relative, "model comparison destination");
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected a regular source file: ${relative}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  }
}

function comparisonConfig(source, profile) {
  const config = structuredClone(source);
  config.evaluationId = "model-size-ab-v1";
  config.outputRoot = `.cache/acceptance/ai-model-comparison/v1/runs/${profile.id}`;
  config.viteCacheRoot = `.cache/vite-ai-model-comparison-v1-${profile.id}`;
  config.localAiDirectory = `.cache/acceptance/ai-model-comparison/v1/runtime/${profile.id}`;
  config.model = { ...config.model, profileId: profile.id, modelId: profile.modelId };
  config.sourceVariants.B = {
    ...config.sourceVariants.B,
    label: `B: B6 frozen product, ${profile.id} model comparison`,
    sourceRoot: ".cache/acceptance/ai-scenarios/v2-r4/snapshots/B6/source",
    sourceManifest: ".cache/acceptance/ai-scenarios/v2-r4/snapshots/B6/source-manifest.json",
    provenance: "existing-frozen-B6-snapshot",
    verificationMode: "snapshot-only"
  };
  if (config.toolManifestPath !== "../tool-manifest.json") throw new Error("Source toolManifestPath changed; expected ../tool-manifest.json.");
  return config;
}

function prepareProfile(profile, sourceSnapshot, sourceManifestBytes, caseBytes, b6) {
  const profileRoot = path.join(outputRoot, profile.id);
  assertNoSymlinkPath(profileRoot);
  if (fs.existsSync(profileRoot)) throw new Error(`Refusing to overwrite model comparison profile: ${path.relative(pluginRoot, profileRoot)}`);
  if (!isWithin(pluginRoot, profileRoot)) throw new Error("Model comparison output escaped the plugin directory.");

  fs.mkdirSync(profileRoot, { recursive: false });
  const toolRoot = path.join(profileRoot, "tool-source");
  fs.mkdirSync(toolRoot, { recursive: false });
  copySource(sourceSnapshot, toolRoot);

  const configPath = path.join(toolRoot, "config.json");
  assertNoSymlinkPath(configPath);
  if (!fs.lstatSync(configPath).isFile()) throw new Error("Copied tool config is not a regular file.");
  const sourceConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const config = comparisonConfig(sourceConfig, profile);
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: "w" });

  const paths = walkFiles(toolRoot);
  const files = hashFiles(toolRoot, paths);
  for (const relative of sourceSnapshot.manifest.paths) {
    if (relative === "config.json") continue;
    if (files[relative]?.sha256 !== sourceSnapshot.manifest.files[relative]?.sha256) {
      throw new Error(`Copied harness input changed unexpectedly: ${relative}`);
    }
  }
  const copiedCasePath = checkedPath(toolRoot, config.caseSets[config.defaultCaseSetId], "case manifest");
  if (sha256(fs.readFileSync(copiedCasePath)) !== sha256(caseBytes) || sha256(caseBytes) !== sourceSnapshot.manifest.caseManifestSha256) {
    throw new Error("Copied case manifest differs from the frozen v2 case set.");
  }
  const manifest = {
    schemaVersion: sourceSnapshot.manifest.schemaVersion,
    evaluationId: config.evaluationId,
    capturedAt: sourceSnapshot.manifest.capturedAt,
    derivedAt: new Date().toISOString(),
    derivedFrom: { toolManifestSha256: sha256(sourceManifestBytes) },
    caseSetId: sourceSnapshot.manifest.caseSetId,
    caseManifestSha256: sha256(caseBytes),
    configSha256: sha256(fs.readFileSync(configPath)),
    requestBuilderSha256: files[config.requestRecipe.relativePath].sha256,
    bootstrap: structuredClone(sourceSnapshot.manifest.bootstrap),
    paths,
    files
  };
  const manifestPath = path.join(profileRoot, "tool-manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  const verified = verifyV2ToolSnapshot({ configPath, toolManifestPath: manifestPath });
  if (verified.manifest.derivedFrom?.toolManifestSha256 !== sha256(sourceManifestBytes)) {
    throw new Error("Derived tool manifest lost its source manifest hash.");
  }
  return {
    profile: profile.id,
    configPath: path.relative(pluginRoot, configPath),
    configSha256: manifest.configSha256,
    toolManifestPath: path.relative(pluginRoot, manifestPath),
    toolManifestSha256: sha256(fs.readFileSync(manifestPath)),
    derivedFromToolManifestSha256: sha256(sourceManifestBytes),
    b6SourceManifestSha256: b6.manifestSha256,
    files: verified.manifest.paths.length
  };
}

export function prepareModelComparison() {
  assertNoSymlinkPath(outputRoot);
  const targetRoots = profiles.map(({ id }) => path.join(outputRoot, id));
  for (const target of targetRoots) {
    assertNoSymlinkPath(target);
    if (fs.existsSync(target)) throw new Error(`Refusing to overwrite model comparison profile: ${path.relative(pluginRoot, target)}`);
  }
  fs.mkdirSync(outputRoot, { recursive: true });

  const tool = verifyV2ToolSnapshot({ configPath: sourceConfigPath, toolManifestPath: sourceManifestPath });
  const sourceManifestBytes = fs.readFileSync(sourceManifestPath);
  const sourceFingerprint = JSON.stringify({ manifestSha256: sha256(sourceManifestBytes), actual: tool.actual });
  const caseBytes = fs.readFileSync(caseManifestPath);
  const caseManifest = JSON.parse(caseBytes.toString("utf8"));
  if (sha256(caseBytes) !== tool.manifest.caseManifestSha256 || caseManifest.caseSetId !== tool.manifest.caseSetId) {
    throw new Error("Frozen tool case set does not match its manifest.");
  }
  const b6 = verifyFrozenB6(sha256(caseBytes));
  const results = profiles.map((profile) => prepareProfile(profile, tool, sourceManifestBytes, caseBytes, b6));

  const after = verifyV2ToolSnapshot({ configPath: sourceConfigPath, toolManifestPath: sourceManifestPath });
  const afterFingerprint = JSON.stringify({ manifestSha256: sha256(fs.readFileSync(sourceManifestPath)), actual: after.actual });
  if (sourceFingerprint !== afterFingerprint) throw new Error("Frozen v2 tool source changed while model comparison copies were prepared.");
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error("Usage: node scripts/ai-scenario-eval/prepare-model-comparison.mjs");
  console.log(JSON.stringify(prepareModelComparison(), null, 2));
}

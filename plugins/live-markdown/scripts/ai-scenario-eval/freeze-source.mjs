import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const acceptanceRoot = path.join(pluginRoot, ".cache/acceptance/ai-scenarios/v1");
const sourceRoot = path.join(acceptanceRoot, "source");
const manifestPath = path.join(acceptanceRoot, "source-manifest.json");
const caseManifestPath = path.join(acceptanceRoot, "case-manifest.json");
const fixedFiles = ["package.json", "package-lock.json", "plugin.json", "scripts/ai-replace-intent-local-runtime.mjs"];

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assertNoSymlinkPath(target, boundary = pluginRoot) {
  const absolute = path.resolve(target);
  if (!isWithin(boundary, absolute)) throw new Error(`Write path escaped the plugin directory: ${target}`);
  let current = absolute;
  while (current !== boundary) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Source freeze refuses symlink path components: ${path.relative(boundary, current)}`);
    }
    current = path.dirname(current);
  }
}

function walkFiles(root, current = root, files = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Source freeze refuses symlinks: ${path.relative(root, absolute)}`);
    if (entry.isDirectory()) walkFiles(root, absolute, files);
    else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join("/"));
    else throw new Error(`Source freeze refuses non-regular files: ${path.relative(root, absolute)}`);
  }
  return files;
}

export function collectSourcePaths(root = pluginRoot) {
  const paths = [];
  for (const directory of ["src", "preload", "scripts/ai-scenario-eval"]) {
    const absolute = path.join(root, directory);
    const stat = fs.lstatSync(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Missing or unsafe source directory: ${directory}`);
    const files = walkFiles(root, absolute);
    paths.push(...(directory === "scripts/ai-scenario-eval" ? files.filter((file) => file.endsWith(".mjs")) : files));
  }
  for (const relative of fixedFiles) {
    const absolute = path.join(root, relative);
    if (fs.existsSync(absolute)) {
      const stat = fs.lstatSync(absolute);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected a regular source file: ${relative}`);
      paths.push(relative);
    } else {
      throw new Error(`Missing required source file: ${relative}`);
    }
  }
  return [...new Set(paths)].sort();
}

export function sourceHashMap(root = pluginRoot, relativePaths = collectSourcePaths(root)) {
  return Object.fromEntries(relativePaths.map((relative) => {
    const absolute = path.resolve(root, relative);
    if (!isWithin(root, absolute)) throw new Error(`Source path escaped the plugin directory: ${relative}`);
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Source hash refuses non-regular files: ${relative}`);
    const bytes = fs.readFileSync(absolute);
    return [relative, { sha256: sha256(bytes), bytes: bytes.byteLength }];
  }));
}

export function readSourceManifest() {
  if (!fs.existsSync(caseManifestPath)) throw new Error("Freeze the scenario case manifest before freezing source.");
  assertNoSymlinkPath(caseManifestPath);
  const caseManifest = JSON.parse(fs.readFileSync(caseManifestPath, "utf8"));
  if (caseManifest.schemaVersion !== 1 || !Array.isArray(caseManifest.realCases)) {
    throw new Error("Unsupported or incomplete scenario case manifest; expected schemaVersion 1 and realCases.");
  }
  if (!fs.existsSync(manifestPath) || !fs.existsSync(sourceRoot)) {
    throw new Error("Scenario source is not frozen yet; run freeze-source.mjs after the case manifest is ready.");
  }
  assertNoSymlinkPath(manifestPath);
  assertNoSymlinkPath(sourceRoot);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || !manifest.files || !Array.isArray(manifest.paths)) {
    throw new Error("Invalid scenario source manifest.");
  }
  if (manifest.caseManifestSha256 !== sha256(fs.readFileSync(caseManifestPath))) {
    throw new Error("Scenario case manifest changed after the source freeze.");
  }
  return manifest;
}

export function verifyFrozenSource({ root = pluginRoot, frozenRoot = sourceRoot, manifest = readSourceManifest() } = {}) {
  const expectedPaths = [...manifest.paths].sort();
  const livePaths = collectSourcePaths(root);
  if (JSON.stringify(livePaths) !== JSON.stringify(expectedPaths)) {
    throw new Error("Live source file set differs from the frozen scenario manifest.");
  }
  const liveFiles = sourceHashMap(root, expectedPaths);
  const frozenFiles = sourceHashMap(frozenRoot, expectedPaths);
  for (const relative of expectedPaths) {
    const expected = manifest.files[relative];
    if (!expected || liveFiles[relative].sha256 !== expected.sha256 || frozenFiles[relative].sha256 !== expected.sha256) {
      throw new Error(`Live or frozen source hash differs from the scenario manifest: ${relative}`);
    }
  }
  return { liveFiles, frozenFiles };
}

export function freezeSource() {
  if (!fs.existsSync(caseManifestPath)) throw new Error("Freeze the scenario case manifest before freezing source.");
  assertNoSymlinkPath(caseManifestPath);
  const caseManifest = JSON.parse(fs.readFileSync(caseManifestPath, "utf8"));
  if (caseManifest.schemaVersion !== 1 || !Array.isArray(caseManifest.realCases)) {
    throw new Error("Unsupported or incomplete scenario case manifest; expected schemaVersion 1 and realCases.");
  }

  const paths = collectSourcePaths();
  const files = sourceHashMap(pluginRoot, paths);
  const caseManifestSha256 = sha256(fs.readFileSync(caseManifestPath));
  assertNoSymlinkPath(sourceRoot);
  assertNoSymlinkPath(manifestPath);
  if (fs.existsSync(sourceRoot) || fs.existsSync(manifestPath)) {
    if (!fs.existsSync(sourceRoot) || !fs.existsSync(manifestPath)) {
      throw new Error("A partial source freeze already exists; refusing to overwrite it. Create a new case-set version.");
    }
    const existing = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (existing.caseManifestSha256 !== caseManifestSha256 || JSON.stringify(existing.paths) !== JSON.stringify(paths) || JSON.stringify(existing.files) !== JSON.stringify(files)) {
      throw new Error("Existing frozen source differs from the current live source; refusing to overwrite it.");
    }
    verifyFrozenSource({ manifest: existing });
    return existing;
  }

  fs.mkdirSync(sourceRoot, { recursive: false });
  for (const relative of paths) {
    const destination = path.join(sourceRoot, relative);
    if (!isWithin(sourceRoot, destination)) throw new Error(`Source path escaped the snapshot: ${relative}`);
    assertNoSymlinkPath(destination);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(pluginRoot, relative), destination, fs.constants.COPYFILE_EXCL);
  }
  const manifest = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    caseSetId: caseManifest.caseSetId ?? "v1",
    caseManifestSha256,
    paths,
    files
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  verifyFrozenSource({ manifest });
  return manifest;
}

function isCli() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isCli()) {
  try {
    const manifest = freezeSource();
    console.log(JSON.stringify({ status: "frozen", caseSetId: manifest.caseSetId, files: manifest.paths.length, sourceRoot: path.relative(pluginRoot, sourceRoot) }));
  } catch (error) {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  }
}

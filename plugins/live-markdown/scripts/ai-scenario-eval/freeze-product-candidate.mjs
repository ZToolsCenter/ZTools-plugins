import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pluginRoot } from "./scenario-v2-paths.mjs";

const v1RootRelative = ".cache/acceptance/ai-scenarios/v1";
const outputRootRelative = ".cache/acceptance/ai-scenarios/v2-r4/snapshots";
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function isWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function lstatMaybe(target) {
  try { return fs.lstatSync(target); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

function assertBoundedNoSymlink(root, target, label) {
  const boundary = path.resolve(root);
  const absolute = path.resolve(target);
  if (!isWithin(boundary, absolute)) throw new Error(`${label} escaped the plugin directory: ${target}`);
  const rootStat = lstatMaybe(boundary);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Plugin root must be a regular directory.");
  let current = absolute;
  while (current !== boundary) {
    const stat = lstatMaybe(current);
    if (stat?.isSymbolicLink()) throw new Error(`${label} refuses symlink path components: ${path.relative(boundary, current)}`);
    current = path.dirname(current);
  }
}

function assertRegularFile(root, relative, label = "Product source") {
  const absolute = path.resolve(root, relative);
  assertBoundedNoSymlink(root, absolute, label);
  const stat = lstatMaybe(absolute);
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file: ${relative}`);
  return absolute;
}

function walkFiles(root, directory, result = []) {
  assertBoundedNoSymlink(root, directory, "Product source");
  const stat = lstatMaybe(directory);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error(`Expected a regular source directory: ${path.relative(root, directory)}`);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (entry.isSymbolicLink()) throw new Error(`Product snapshot refuses symlinks: ${relative}`);
    const childStat = fs.lstatSync(absolute);
    if (childStat.isDirectory()) walkFiles(root, absolute, result);
    else if (childStat.isFile()) result.push(relative);
    else throw new Error(`Product snapshot refuses non-regular files: ${relative}`);
  }
  return result;
}

function collectProductPaths(root) {
  const paths = [];
  for (const directory of ["src", "preload"]) {
    paths.push(...walkFiles(root, path.join(root, directory)));
  }
  const rootEntries = fs.readdirSync(root, { withFileTypes: true });
  const packageFiles = rootEntries.filter((entry) => /^package.*\.json$/u.test(entry.name));
  if (!packageFiles.some((entry) => entry.name === "package.json")) throw new Error("Required product snapshot input is missing: package.json");
  for (const entry of packageFiles) {
    const relative = entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Product snapshot refuses symlinks: ${relative}`);
    assertRegularFile(root, relative);
    paths.push(relative);
  }
  assertRegularFile(root, "plugin.json");
  paths.push("plugin.json");
  return [...new Set(paths)].sort();
}

function hashFiles(root, paths) {
  return Object.fromEntries(paths.map((relative) => {
    const absolute = assertRegularFile(root, relative, "Product source");
    const bytes = fs.readFileSync(absolute);
    return [relative, { sha256: sha256(bytes), bytes: bytes.byteLength }];
  }));
}

function readFrozenCaseSet(root) {
  const casePath = path.join(root, v1RootRelative, "case-manifest.json");
  const sourceManifestPath = path.join(root, v1RootRelative, "source-manifest.json");
  const caseBytes = fs.readFileSync(assertRegularFile(root, casePath, "Frozen case manifest"));
  const sourceManifestBytes = fs.readFileSync(assertRegularFile(root, sourceManifestPath, "Frozen source manifest"));
  const cases = JSON.parse(caseBytes.toString("utf8"));
  const sourceManifest = JSON.parse(sourceManifestBytes.toString("utf8"));
  const caseManifestSha256 = sha256(caseBytes);
  if (cases.schemaVersion !== 1 || !Array.isArray(cases.realCases) || cases.realCases.length !== 80 || typeof cases.caseSetId !== "string" || !cases.caseSetId) {
    throw new Error("Frozen v1 case manifest must contain exactly 80 real cases and a caseSetId.");
  }
  if (sourceManifest.schemaVersion !== 1 || sourceManifest.caseManifestSha256 !== caseManifestSha256 || sourceManifest.caseSetId !== cases.caseSetId) {
    throw new Error("Frozen v1 source manifest does not bind the current 80-case manifest.");
  }
  return { casePath, caseManifestSha256, caseSetId: cases.caseSetId };
}

function mapSha256(value) {
  return sha256(JSON.stringify(value));
}

function copyPaths(root, destination, paths) {
  for (const relative of paths) {
    const source = assertRegularFile(root, relative, "Product source");
    const target = path.resolve(destination, relative);
    if (!isWithin(destination, target)) throw new Error(`Product snapshot path escaped its root: ${relative}`);
    assertBoundedNoSymlink(root, target, "Product snapshot output");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    assertBoundedNoSymlink(root, target, "Product snapshot output");
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  }
}

function verifySnapshot(sourceRoot, paths, expectedFiles) {
  const actualPaths = walkFiles(sourceRoot, sourceRoot).sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(paths)) throw new Error("Frozen candidate file set differs from the captured source list.");
  const actualFiles = hashFiles(sourceRoot, actualPaths);
  for (const relative of actualPaths) {
    if (actualFiles[relative].sha256 !== expectedFiles[relative]?.sha256 || actualFiles[relative].bytes !== expectedFiles[relative]?.bytes) {
      throw new Error(`Frozen candidate hash mismatch: ${relative}`);
    }
  }
  return actualFiles;
}

export function parseFreezeCandidateArgs(argv) {
  const values = new Map();
  for (const argument of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/u.exec(argument);
    if (!match) throw new Error(`Arguments must use --name=value syntax: ${argument}`);
    if (match[1] !== "name") throw new Error(`Unknown freeze candidate argument: --${match[1]}`);
    if (values.has(match[1])) throw new Error("Duplicate --name argument.");
    if (match[2] === undefined) throw new Error("Arguments must use --name=value syntax.");
    values.set(match[1], match[2]);
  }
  const name = values.get("name");
  if (!name) throw new Error("Usage: node scripts/ai-scenario-eval/freeze-product-candidate.mjs --name=<safeName>");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u.test(name)) throw new Error("--name must be a safe identifier (1-40 letters, numbers, dot, underscore, or hyphen).");
  return { name };
}

export function freezeProductCandidate({ name, root = pluginRoot } = {}) {
  if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u.test(name)) {
    throw new Error("Candidate name must be a safe identifier (1-40 letters, numbers, dot, underscore, or hyphen).");
  }
  const boundary = path.resolve(root);
  const frozenCases = readFrozenCaseSet(boundary);
  const snapshotsRoot = path.join(boundary, outputRootRelative);
  const candidateRoot = path.join(snapshotsRoot, name);
  const sourceRoot = path.join(candidateRoot, "source");
  const manifestPath = path.join(candidateRoot, "source-manifest.json");
  assertBoundedNoSymlink(boundary, candidateRoot, "Product snapshot output");
  if (lstatMaybe(candidateRoot)) throw new Error(`Named product snapshot already exists; refusing to overwrite: ${path.relative(boundary, candidateRoot)}`);

  const pathsBefore = collectProductPaths(boundary);
  const filesBefore = hashFiles(boundary, pathsBefore);
  const caseShaBefore = sha256(fs.readFileSync(frozenCases.casePath));
  if (caseShaBefore !== frozenCases.caseManifestSha256) throw new Error("Frozen 80-case manifest changed before product capture.");

  fs.mkdirSync(snapshotsRoot, { recursive: true });
  assertBoundedNoSymlink(boundary, candidateRoot, "Product snapshot output");
  fs.mkdirSync(candidateRoot, { recursive: false });
  fs.mkdirSync(sourceRoot, { recursive: false });
  copyPaths(boundary, sourceRoot, pathsBefore);

  const pathsAfter = collectProductPaths(boundary);
  const filesAfter = hashFiles(boundary, pathsAfter);
  const caseShaAfter = sha256(fs.readFileSync(frozenCases.casePath));
  const pathsStable = JSON.stringify(pathsBefore) === JSON.stringify(pathsAfter);
  const filesStable = JSON.stringify(filesBefore) === JSON.stringify(filesAfter);
  const casesStable = caseShaBefore === caseShaAfter;
  if (!pathsStable || !filesStable || !casesStable) {
    throw new Error("Product or frozen cases changed during capture; partial snapshot retained and must not be overwritten.");
  }
  const copiedFiles = verifySnapshot(sourceRoot, pathsBefore, filesBefore);
  if (JSON.stringify(copiedFiles) !== JSON.stringify(filesBefore)) throw new Error("Copied product hashes differ from the stable source hashes.");

  const manifest = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    caseSetId: frozenCases.caseSetId,
    caseManifestSha256: caseShaBefore,
    capturedFrom: "live product source at explicit candidate freeze time",
    paths: pathsBefore,
    files: filesBefore,
    capture: {
      name,
      scope: ["src/", "preload/", "package*.json", "plugin.json"],
      stability: {
        pathsBeforeSha256: mapSha256(pathsBefore),
        pathsAfterSha256: mapSha256(pathsAfter),
        filesBeforeSha256: mapSha256(filesBefore),
        filesAfterSha256: mapSha256(filesAfter),
        caseManifestBeforeSha256: caseShaBefore,
        caseManifestAfterSha256: caseShaAfter,
        stable: true
      }
    }
  };
  assertBoundedNoSymlink(boundary, manifestPath, "Product snapshot output");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return {
    status: "frozen", name, caseSetId: manifest.caseSetId,
    sourceRoot: path.relative(boundary, sourceRoot).split(path.sep).join("/"),
    sourceManifestPath: path.relative(boundary, manifestPath).split(path.sep).join("/"),
    files: pathsBefore.length, manifestSha256: sha256(fs.readFileSync(manifestPath))
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { name } = parseFreezeCandidateArgs(process.argv.slice(2));
    console.log(JSON.stringify(freezeProductCandidate({ name }), null, 2));
  } catch (error) {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  }
}

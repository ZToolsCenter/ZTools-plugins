import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function within(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function assertNoSymlinkPath(root, target, { allowMissingLeaf = false } = {}) {
  const boundary = path.resolve(root);
  const absolute = path.resolve(target);
  if (!within(boundary, absolute)) throw new Error(`Scoped evaluation path escaped the plugin root: ${target}`);
  for (let current = absolute; current !== boundary; current = path.dirname(current)) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Scoped evaluation refuses symlink path components: ${path.relative(boundary, current)}`);
    } catch (error) {
      if (error?.code !== "ENOENT" || !allowMissingLeaf) throw error;
    }
  }
  return absolute;
}

function safeRelative(relative, label) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/u).includes("..")) {
    throw new Error(`${label} must be a bounded relative path.`);
  }
}

function walkRegularFiles(root, current = root, result = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Frozen candidate contains a symlink: ${path.relative(root, absolute)}`);
    if (entry.isDirectory()) walkRegularFiles(root, absolute, result);
    else if (entry.isFile()) result.push(path.relative(root, absolute).split(path.sep).join("/"));
    else throw new Error(`Frozen candidate contains a non-regular file: ${path.relative(root, absolute)}`);
  }
  return result.sort();
}

/** Validates the whole immutable source tree against its freeze manifest. */
export function verifyCandidate(root, candidate, snapshotsPath) {
  const candidateRoot = assertNoSymlinkPath(root, path.join(root, snapshotsPath, candidate));
  const manifestPath = assertNoSymlinkPath(root, path.join(candidateRoot, "source-manifest.json"));
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.schemaVersion !== 1 || manifest.capture?.name !== candidate || manifest.capture?.stability?.stable !== true ||
      !Array.isArray(manifest.paths) || !manifest.files || typeof manifest.files !== "object") {
    throw new Error(`Frozen source manifest is invalid or is not bound to candidate ${candidate}.`);
  }
  const sourceRoot = assertNoSymlinkPath(root, path.join(candidateRoot, "source"));
  const actualPaths = walkRegularFiles(sourceRoot);
  const expectedPaths = [...manifest.paths].sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) throw new Error("Frozen candidate tree differs from its source manifest.");
  const verified = {};
  for (const relative of expectedPaths) {
    safeRelative(relative, "Candidate manifest entry");
    const absolute = assertNoSymlinkPath(sourceRoot, path.join(sourceRoot, relative));
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Candidate manifest entry is not a regular file: ${relative}`);
    const bytes = fs.readFileSync(absolute);
    const digest = sha256(bytes);
    if (digest !== manifest.files[relative]?.sha256 || bytes.byteLength !== manifest.files[relative]?.bytes) {
      throw new Error(`Frozen candidate file hash mismatch: ${relative}`);
    }
    verified[relative] = { sha256: digest, bytes: bytes.byteLength };
  }
  return { candidateRoot, sourceRoot, manifestPath, manifestBytes, manifest, verified };
}

/** Loads original frozen cases and validates the independent derived hash/count ledger. */
export function readFrozenCases(root, casePath, derivedPath) {
  const caseManifestPath = assertNoSymlinkPath(root, path.join(root, casePath));
  const derivedManifestPath = assertNoSymlinkPath(root, path.join(root, derivedPath));
  const caseBytes = fs.readFileSync(caseManifestPath);
  const derivedBytes = fs.readFileSync(derivedManifestPath);
  const manifest = JSON.parse(caseBytes.toString("utf8"));
  const derived = JSON.parse(derivedBytes.toString("utf8"));
  const actualHash = sha256(caseBytes);
  if (manifest.schemaVersion !== 1 || manifest.realCases?.length !== 87 || derived.caseManifestSha256 !== actualHash || derived.counts?.totalReal !== 87) {
    throw new Error("Frozen 87-case follow-up source manifest did not pass its bound SHA/count checks.");
  }
  return { casePath: caseManifestPath, caseBytes, caseHash: actualHash, derivedPath: derivedManifestPath, derivedBytes, derivedHash: sha256(derivedBytes), manifest };
}

/** Uses only the pre-isolated, already cached model/runtime profiles; never provisions them. */
export function readRuntimeProfiles(root, preparationPath, runtimeRoot) {
  const prepPath = assertNoSymlinkPath(root, path.join(root, preparationPath));
  const prepBytes = fs.readFileSync(prepPath);
  const preparation = JSON.parse(prepBytes.toString("utf8"));
  if (preparation.status !== "configured-from-verified-cache" || preparation.deploymentPerformed !== false || preparation.downloadBytes !== 0) {
    throw new Error("Runtime preparation must be an already verified cache with no deployment or download.");
  }
  const profiles = {};
  for (const profileId of ["light", "balanced"]) {
    const entry = preparation.profiles?.find((profile) => profile.profileId === profileId);
    const expectedRelative = path.join(runtimeRoot, profileId);
    if (!entry || entry.cachedIntegrityVerified !== true || entry.path !== expectedRelative || !/^[a-f0-9]{64}$/u.test(entry.modelSha256 ?? "")) {
      throw new Error(`Verified isolated model runtime profile is missing or unsafe: ${profileId}`);
    }
    const directory = assertNoSymlinkPath(root, path.join(root, entry.path));
    const activePath = assertNoSymlinkPath(directory, path.join(directory, "active-model.json"));
    const metadataPath = assertNoSymlinkPath(directory, path.join(directory, "managed-resources.json"));
    const active = JSON.parse(fs.readFileSync(activePath, "utf8"));
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    if (active.profileId !== profileId || active.modelId !== entry.modelId || active.modelResourceId == null ||
        !metadata.resources?.some((resource) => resource.id === active.modelResourceId && resource.version === active.modelVersion) ||
        !metadata.resources?.some((resource) => resource.id === active.runtimeId && resource.version === active.runtimeVersion)) {
      throw new Error(`Isolated runtime metadata does not match the verified ${profileId} profile.`);
    }
    const modelPath = assertNoSymlinkPath(directory, path.resolve(directory, active.modelPath));
    if (!within(directory, modelPath) || !fs.statSync(modelPath).isFile()) throw new Error(`Isolated model file is missing: ${profileId}`);
    profiles[profileId] = { ...entry, runtimeDirectory: directory, activeModelSha256: sha256(fs.readFileSync(activePath)), managedResourcesSha256: sha256(fs.readFileSync(metadataPath)), modelPath, verifiedModelSha256: null };
  }
  return { prepPath, prepBytes, preparation, profiles };
}

export async function verifyModelFiles(profiles) {
  for (const profile of Object.values(profiles)) {
    const digest = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(profile.modelPath)) digest.update(chunk);
    const actual = digest.digest("hex");
    if (actual !== profile.modelSha256) throw new Error(`Isolated model SHA-256 mismatch: ${profile.profileId}`);
    profile.verifiedModelSha256 = actual;
  }
}

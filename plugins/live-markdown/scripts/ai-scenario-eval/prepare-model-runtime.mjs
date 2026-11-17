// Configure isolated experiments from verified local resources; never deploy or download.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = path.join(root, ".cache/acceptance/local-ai");
const experiment = path.join(root, ".cache/acceptance/ai-model-comparison/v1");
const destination = path.join(experiment, "runtime");
const frozen = path.join(root, ".cache/acceptance/ai-scenarios/v2-r4/snapshots/B6/source");
const requireFrozen = createRequire(path.join(frozen, "preload/local-ai/service.cjs"));
const { createManifestCatalog, DEFAULT_MANIFEST } = requireFrozen("./manifest.cjs");
const { validateInstalled } = requireFrozen("./installer.cjs");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const catalog = createManifestCatalog(DEFAULT_MANIFEST);

function safePath(base, relative) {
  const target = path.resolve(base, relative);
  if (!target.startsWith(`${base}${path.sep}`)) throw new Error("Resource escaped the managed cache.");
  for (let current = target; current !== root; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error("Cache paths must not traverse symlinks.");
  }
  return target;
}
function assertRegularTree(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Resource tree contains a symlink.");
    if (entry.isDirectory()) assertRegularTree(target);
    else if (!entry.isFile()) throw new Error("Resource tree contains a non-regular file.");
  }
}

if (fs.existsSync(destination)) throw new Error("Isolated runtime already exists; refusing to overwrite.");
const originalActive = fs.readFileSync(path.join(source, "active-model.json"));
const originalMetadata = fs.readFileSync(path.join(source, "managed-resources.json"));
const metadata = JSON.parse(originalMetadata);
const inputs = [];
for (const profileId of ["light", "balanced"]) {
  const profile = catalog.profiles[profileId];
  if (!profile?.available) throw new Error(`No pinned ${profileId} profile for this platform.`);
  const resources = [];
  for (const resource of [profile.runtime, profile.model]) {
    const entry = metadata.resources.find(item => item.id === resource.id && item.version === resource.version);
    if (!entry) throw new Error(`Required resource is not cached: ${resource.id}`);
    const directory = safePath(source, entry.relativePath);
    assertRegularTree(directory);
    if (!await validateInstalled(directory, resource)) throw new Error(`Cached integrity check failed: ${resource.id}`);
    resources.push({ resource, entry, directory });
  }
  inputs.push({ profileId, profile, resources });
}

fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
const prepared = [];
for (const { profileId, profile, resources } of inputs) {
  const targetRoot = safePath(destination, profileId);
  fs.mkdirSync(targetRoot, { mode: 0o700 });
  for (const { resource, entry, directory } of resources) {
    const target = safePath(targetRoot, entry.relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.cpSync(directory, target, { recursive: true, force: false, errorOnExist: true, mode: fs.constants.COPYFILE_FICLONE });
    if (!await validateInstalled(target, resource)) throw new Error(`Cloned resource integrity check failed: ${resource.id}`);
  }
  const active = {
    schemaVersion: 1, profileId, modelId: profile.modelId,
    runtimeId: profile.runtime.id, runtimeVersion: profile.runtime.version,
    modelResourceId: profile.model.id, modelVersion: profile.model.version,
    modelPath: path.join(resources[1].entry.relativePath, profile.model.entryPoint)
  };
  fs.writeFileSync(path.join(targetRoot, "managed-resources.json"), JSON.stringify({ schemaVersion: 1, resources: resources.map(({ entry }) => entry) }), { mode: 0o600, flag: "wx" });
  fs.writeFileSync(path.join(targetRoot, "active-model.json"), JSON.stringify(active), { mode: 0o600, flag: "wx" });
  prepared.push({ profileId, modelId: profile.modelId, modelBytes: profile.model.size, modelSha256: profile.model.sha256, runtimeId: profile.runtime.id, requestedBackend: profile.runtime.backend, path: path.relative(root, targetRoot), cachedIntegrityVerified: true });
}
if (!originalActive.equals(fs.readFileSync(path.join(source, "active-model.json"))) || !originalMetadata.equals(fs.readFileSync(path.join(source, "managed-resources.json")))) throw new Error("Original cache metadata changed during preparation.");
const report = { status: "configured-from-verified-cache", deploymentPerformed: false, downloadBytes: 0, originalActiveSha256: hash(originalActive), originalMetadataSha256: hash(originalMetadata), profiles: prepared };
fs.writeFileSync(path.join(experiment, "runtime-preparation.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(report, null, 2));

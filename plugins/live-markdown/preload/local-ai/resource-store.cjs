"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PLUGIN_DIRECTORY_NAME = "live-markdown";
const MAX_METADATA_BYTES = 1024 * 1024;

function defaultDataDirectory(options = {}) {
  const platform = options.platform || process.platform;
  const home = options.home || os.homedir();
  if (platform === "win32") {
    const localAppData = options.localAppData || process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return path.join(localAppData, "ZTools", PLUGIN_DIRECTORY_NAME, "local-ai");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "ZTools", PLUGIN_DIRECTORY_NAME, "local-ai");
  }
  const xdg = options.xdgDataHome || process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.join(xdg, "ztools", PLUGIN_DIRECTORY_NAME, "local-ai");
}

function resolveWithin(root, ...parts) {
  const base = path.resolve(root);
  const target = path.resolve(base, ...parts);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    throw new Error("Local AI path escapes its managed data directory");
  }
  return target;
}

function ensurePrivateDirectory(directory) {
  const target = path.resolve(directory);
  const root = path.parse(target).root;
  const segments = target.slice(root.length).split(path.sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error("Local AI data path must not traverse symbolic links or non-directories");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      fs.mkdirSync(current, { mode: 0o700 });
    }
  }
  try { fs.chmodSync(target, 0o700); } catch {}
  if (!isSafeDirectory(target)) throw new Error("Local AI data path must not traverse symbolic links or non-directories");
}

function isSafeDirectory(directory) {
  let current = path.resolve(directory);
  while (true) {
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    } catch { return false; }
    const parent = path.dirname(current);
    if (parent === current) return true;
    current = parent;
  }
}

function readManagedMetadata(root) {
  if (!isSafeDirectory(root)) return { schemaVersion: 1, resources: [] };
  const file = resolveWithin(root, "managed-resources.json");
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_METADATA_BYTES) return { schemaVersion: 1, resources: [] };
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data && data.schemaVersion === 1 && Array.isArray(data.resources)
      ? data
      : { schemaVersion: 1, resources: [] };
  } catch {
    return { schemaVersion: 1, resources: [] };
  }
}

function writeManagedMetadata(root, data) {
  ensurePrivateDirectory(root);
  const safeData = { schemaVersion: 1, resources: Array.isArray(data?.resources) ? data.resources : [] };
  const content = JSON.stringify(safeData);
  if (Buffer.byteLength(content, "utf8") > MAX_METADATA_BYTES) throw new Error("Managed resource metadata is too large");
  const target = resolveWithin(root, "managed-resources.json");
  const temp = resolveWithin(root, `.managed-${process.pid}-${Date.now()}.tmp`);
  fs.writeFileSync(temp, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.renameSync(temp, target);
}

function removeManagedResource(root, id) {
  if (typeof id !== "string" || !/^[a-z0-9._-]{1,100}$/i.test(id)) {
    throw new Error("Invalid managed resource id");
  }
  if (!isSafeDirectory(root)) throw new Error("Local AI data directory is unsafe");
  const metadata = readManagedMetadata(root);
  const entry = metadata.resources.find((item) => item && item.id === id);
  if (!entry || typeof entry.relativePath !== "string") return false;
  const target = resolveWithin(root, entry.relativePath);
  if (target === path.resolve(root)) throw new Error("Refusing to remove the local AI data directory");
  const rootReal = fs.realpathSync(root);
  let targetReal;
  try {
    targetReal = fs.realpathSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (targetReal !== rootReal && !targetReal.startsWith(`${rootReal}${path.sep}`)) {
    throw new Error("Refusing to remove a path outside the managed data directory");
  }
  fs.rmSync(target, { recursive: true, force: true });
  writeManagedMetadata(root, {
    ...metadata,
    resources: metadata.resources.filter((item) => item !== entry)
  });
  return true;
}

module.exports = {
  defaultDataDirectory,
  resolveWithin,
  isSafeDirectory,
  ensurePrivateDirectory,
  readManagedMetadata,
  writeManagedMetadata,
  removeManagedResource
};

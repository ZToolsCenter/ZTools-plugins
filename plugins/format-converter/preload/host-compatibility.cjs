"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const MINIMUM_VERSION = "2.4.0";

function parseVersion(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^\s*v?(\d+)\.(\d+)(?:\.(\d+))?(?:[-+][0-9A-Za-z.-]+)?\s*$/);
  if (!match) return null;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  const leftPrerelease = typeof left === "string" && /^\s*v?\d+\.\d+(?:\.\d+)?-/.test(left);
  const rightPrerelease = typeof right === "string" && /^\s*v?\d+\.\d+(?:\.\d+)?-/.test(right);
  if (leftPrerelease !== rightPrerelease) return leftPrerelease ? -1 : 1;
  return 0;
}

function getHostCompatibility(ztools) {
  // A missing ztools object is the explicit browser-development preview case.
  if (!ztools) return { version: "", supported: true };
  let getAppVersion;
  try { getAppVersion = ztools.getAppVersion; } catch { return { version: "", supported: false }; }
  if (typeof getAppVersion !== "function") return { version: "", supported: false };
  let version;
  try { version = getAppVersion.call(ztools); } catch { return { version: "", supported: false }; }
  const comparison = compareVersions(version, MINIMUM_VERSION);
  return {
    version: typeof version === "string" ? version : "",
    supported: comparison !== null && comparison >= 0
  };
}

function copyDirectory(source, destination) {
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: false, errorOnExist: false });
  return directoriesMatch(source, destination);
}

function directoriesMatch(source, destination) {
  const sourceStat = fs.lstatSync(source);
  const destinationStat = fs.lstatSync(destination);
  if (sourceStat.isSymbolicLink() || destinationStat.isSymbolicLink()) return false;
  if (sourceStat.isDirectory() !== destinationStat.isDirectory()) return false;
  if (!sourceStat.isDirectory()) {
    return sourceStat.size === destinationStat.size
      && crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex")
        === crypto.createHash("sha256").update(fs.readFileSync(destination)).digest("hex");
  }
  const sourceNames = fs.readdirSync(source).sort();
  const destinationNames = fs.readdirSync(destination).sort();
  if (sourceNames.length !== destinationNames.length || sourceNames.some((name, index) => name !== destinationNames[index])) return false;
  return sourceNames.every(name => directoriesMatch(path.join(source, name), path.join(destination, name)));
}

function runtimeRoot(ztools, legacyRoot) {
  let pluginData = "";
  try { pluginData = typeof ztools?.getPath === "function" ? ztools.getPath("pluginData") : ""; } catch {}
  if (!pluginData) return { root: legacyRoot, migrated: false, modern: false };
  const root = path.join(pluginData, "runtime", "v1");
  const marker = path.join(pluginData, ".format-converter-runtime-migration-v2.json");
  let migrated = false;
  try {
    if (fs.existsSync(legacyRoot)) {
      const verified = fs.existsSync(root)
        ? directoriesMatch(legacyRoot, root)
        : copyDirectory(legacyRoot, root);
      if (!verified) return { root: legacyRoot, migrated: false, modern: false };
      fs.rmSync(legacyRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      if (fs.existsSync(legacyRoot)) return { root: legacyRoot, migrated: false, modern: false };
      try { fs.rmdirSync(path.dirname(legacyRoot)); } catch {}
      try { fs.rmdirSync(path.dirname(path.dirname(legacyRoot))); } catch {}
      migrated = true;
    }
    fs.mkdirSync(pluginData, { recursive: true });
    fs.writeFileSync(marker, JSON.stringify({ version: 2, destination: root, completedAt: new Date().toISOString() }));
  } catch {
    // Copy/verification failures retain the old runtime. If cleanup already
    // completed, keep using the verified pluginData copy even if marker write failed.
    if (fs.existsSync(legacyRoot)) return { root: legacyRoot, migrated: false, modern: false };
    if (fs.existsSync(root)) return { root, migrated: true, modern: true };
    return { root: legacyRoot, migrated: false, modern: false };
  }
  return { root, migrated, modern: true };
}

module.exports = { MINIMUM_VERSION, parseVersion, compareVersions, getHostCompatibility, copyDirectory, directoriesMatch, runtimeRoot };

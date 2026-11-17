"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const { resolveWithin } = require("./resource-store.cjs");
const { fileIdentity, acquireReclaimGate } = require("./stale-lock-gate.cjs");

function isPidAlive(pid, processApi = process) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { processApi.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}

function readDeploymentLock(lockPath, fsApi, platform) {
  try {
    const stat = fsApi.lstatSync(lockPath);
    if (!stat.isFile() || stat.isSymbolicLink() || (platform !== "win32" && (stat.mode & 0o077) !== 0) || stat.size > 4096) {
      throw new Error("Local AI deployment lock is unsafe");
    }
    const contents = fsApi.readFileSync(lockPath, "utf8");
    const record = JSON.parse(contents);
    return { pid: record.pid, identity: fileIdentity(stat, contents) };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function acquireDeploymentLock(root, fsApi = fs, processApi = process, platform = process.platform) {
  const lockPath = resolveWithin(root, "deployment.lock");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = fsApi.openSync(lockPath, "wx", 0o600);
      fsApi.writeFileSync(fd, JSON.stringify({ pid: processApi.pid, id: crypto.randomBytes(12).toString("hex") }));
      fsApi.closeSync(fd);
      return { path: lockPath, owned: true };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const observed = readDeploymentLock(lockPath, fsApi, platform);
      if (!observed) continue;
      if (isPidAlive(observed.pid, processApi)) return { path: lockPath, owned: false };
      let gate;
      try { gate = acquireReclaimGate(lockPath, observed.identity, fsApi); }
      catch (gateError) {
        if (gateError.code === "EEXIST") return { path: lockPath, owned: false };
        throw gateError;
      }
      try {
        const current = readDeploymentLock(lockPath, fsApi, platform);
        if (!current || current.identity !== observed.identity) continue;
        if (isPidAlive(current.pid, processApi)) return { path: lockPath, owned: false };
        const beforeUnlink = readDeploymentLock(lockPath, fsApi, platform);
        if (!beforeUnlink || beforeUnlink.identity !== observed.identity) continue;
        fsApi.unlinkSync(lockPath);
      } finally {
        gate.release();
      }
    }
  }
  return { path: lockPath, owned: false };
}

module.exports = { isPidAlive, acquireDeploymentLock };

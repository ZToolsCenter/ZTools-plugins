"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ensurePrivateDirectory, isSafeDirectory, resolveWithin } = require("./resource-store.cjs");
const { fileIdentity, acquireReclaimGate } = require("./stale-lock-gate.cjs");

const LEASE_DIRECTORY = "leases";

function safeOwnerId(ownerId) {
  if (typeof ownerId !== "string" || !/^[a-f0-9]{32}$/.test(ownerId)) throw new Error("Invalid local AI lease owner");
  return ownerId;
}

function leaseDirectory(root) { return resolveWithin(root, LEASE_DIRECTORY); }

function writeLease(root, ownerId, expiresAt, processId = process.pid) {
  safeOwnerId(ownerId);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw new Error("Invalid local AI lease expiry");
  ensurePrivateDirectory(root);
  const directory = leaseDirectory(root);
  ensurePrivateDirectory(directory);
  const target = resolveWithin(directory, `${ownerId}.json`);
  const temp = resolveWithin(directory, `.${ownerId}-${processId}-${Date.now()}.tmp`);
  fs.writeFileSync(temp, JSON.stringify({ ownerId, pid: processId, expiresAt }), { mode: 0o600, flag: "wx" });
  fs.renameSync(temp, target);
}

function clearLease(root, ownerId) {
  safeOwnerId(ownerId);
  if (!isSafeDirectory(root)) return false;
  const directory = leaseDirectory(root);
  if (!isSafeDirectory(directory)) return false;
  try { fs.unlinkSync(resolveWithin(directory, `${ownerId}.json`)); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

function activeLeases(root, now = Date.now()) {
  if (!isSafeDirectory(root)) return [];
  const directory = leaseDirectory(root);
  if (!isSafeDirectory(directory)) return [];
  let names;
  try { names = fs.readdirSync(directory).slice(0, 100); }
  catch { return []; }
  const active = [];
  for (const name of names) {
    if (!/^[a-f0-9]{32}\.json$/.test(name)) continue;
    const file = resolveWithin(directory, name);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096 ||
          (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) continue;
      const lease = JSON.parse(fs.readFileSync(file, "utf8"));
      if (lease.ownerId !== name.slice(0, -5) || !Number.isInteger(lease.pid) || !Number.isSafeInteger(lease.expiresAt)) continue;
      if (lease.expiresAt > now) active.push(lease);
      else fs.unlinkSync(file);
    } catch {}
  }
  return active;
}

function readManagedLock(file) {
  let descriptor;
  try {
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 4096 ||
        (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) {
      throw new Error("Local model server startup lock is unsafe");
    }
    const contents = fs.readFileSync(descriptor, "utf8");
    const owner = JSON.parse(contents);
    if (!owner || !safeOwnerId(owner.ownerId) || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || !Number.isSafeInteger(owner.createdAt)) {
      throw new Error("Local model server startup lock is invalid");
    }
    return { owner, identity: fileIdentity(stat, contents) };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function isProcessAlive(pid, processApi) {
  try { processApi.kill(pid, 0); return true; }
  catch (probeError) {
    if (probeError.code === "EPERM") return true;
    if (probeError.code === "ESRCH") return false;
    throw probeError;
  }
}

function writeManagedLock(file, ownerId, processApi) {
  const descriptor = fs.openSync(file, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, JSON.stringify({ ownerId, pid: processApi.pid, createdAt: Date.now() }));
  } finally {
    fs.closeSync(descriptor);
  }
  return { file, ownerId, acquired: true };
}

function acquireManagedServerLock(root, ownerId, processApi = process) {
  safeOwnerId(ownerId);
  ensurePrivateDirectory(root);
  const file = resolveWithin(root, "managed-server.lock");
  try {
    return writeManagedLock(file, ownerId, processApi);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const observed = readManagedLock(file);
    if (!observed) return acquireManagedServerLock(root, ownerId, processApi);
    if (isProcessAlive(observed.owner.pid, processApi)) {
      throw new Error("Local model server is already starting in another plugin instance");
    }

    let gate;
    try { gate = acquireReclaimGate(file, observed.identity); }
    catch (gateError) {
      if (gateError.code === "EEXIST") throw new Error("Local model server startup lock recovery is already in progress or unresolved");
      throw gateError;
    }
    try {
      const current = readManagedLock(file);
      if (!current) return acquireManagedServerLock(root, ownerId, processApi);
      if (current.identity !== observed.identity) {
        throw new Error("Local model server startup lock changed during stale recovery; retry startup");
      }
      if (isProcessAlive(current.owner.pid, processApi)) {
        throw new Error("Local model server is already starting in another plugin instance");
      }
      const beforeUnlink = readManagedLock(file);
      if (!beforeUnlink || beforeUnlink.identity !== observed.identity) {
        throw new Error("Local model server startup lock changed during stale recovery; retry startup");
      }
      fs.unlinkSync(file);
      try { return writeManagedLock(file, ownerId, processApi); }
      catch (acquireError) {
        if (acquireError.code === "EEXIST") throw new Error("Local model server is already starting in another plugin instance");
        throw acquireError;
      }
    } finally {
      gate.release();
    }
  }
}

function releaseManagedServerLock(lock) {
  if (!lock?.acquired) return;
  try {
    const stat = fs.lstatSync(lock.file);
    if (!stat.isFile() || stat.isSymbolicLink()) return;
    const current = JSON.parse(fs.readFileSync(lock.file, "utf8"));
    if (current.ownerId === lock.ownerId) fs.unlinkSync(lock.file);
  } catch {}
}

module.exports = { safeOwnerId, leaseDirectory, writeLease, clearLease, activeLeases, acquireManagedServerLock, releaseManagedServerLock };

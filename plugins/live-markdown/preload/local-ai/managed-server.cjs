"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { getJson, streamChat } = require("./http-transport.cjs");
const { ensurePrivateDirectory, isSafeDirectory, resolveWithin } = require("./resource-store.cjs");
const { activeLeases, acquireManagedServerLock, releaseManagedServerLock } = require("./leases.cjs");
const { readProcessCommand, isExpectedServerProcess } = require("./process-identity.cjs");

const SERVER_START_TIMEOUT_MS = 30_000;
const MODEL_LOAD_TIMEOUT_MS = 120_000;

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a local inference port"));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function readServerState(root) {
  if (!isSafeDirectory(root)) return null;
  try {
    const file = resolveWithin(root, "managed-server.json");
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== "win32" && (stat.mode & 0o077) !== 0) || stat.size > 16 * 1024) return null;
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Number.isInteger(state.port) && state.port > 0 && state.port < 65536 &&
        typeof state.token === "string" && /^[a-f0-9]{64}$/.test(state.token) &&
        typeof state.modelId === "string" && Number.isInteger(state.pid) && state.pid > 0 &&
        typeof state.ownerId === "string" && /^[a-f0-9]{32}$/.test(state.ownerId) &&
        Number.isSafeInteger(state.leaseUntil)) return state;
  } catch {}
  return null;
}

function persistServerState(root, state) {
  ensurePrivateDirectory(root);
  const file = resolveWithin(root, "managed-server.json");
  const temp = resolveWithin(root, `.server-${process.pid}-${Date.now()}.tmp`);
  fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600, flag: "wx" });
  fs.renameSync(temp, file);
}

async function isHealthy(server, options = {}) {
  try {
    const health = await getJson({
      port: server.port, pathname: "/health", token: server.token,
      timeoutMs: options.timeoutMs || 1_500
    });
    return health.status === "ok" || health.ok === true;
  } catch {
    return false;
  }
}

async function startManagedServer(root, install, modelId, options = {}) {
  const ownerId = options.ownerId || crypto.randomBytes(16).toString("hex");
  const lock = acquireManagedServerLock(root, ownerId, options.processApi || process);
  try { return await startManagedServerLocked(root, install, modelId, { ...options, ownerId }); }
  finally { releaseManagedServerLock(lock); }
}

async function startManagedServerLocked(root, install, modelId, options = {}) {
  if (options.signal?.aborted) throw new Error("Deployment cancelled");
  const existing = options.childRef?.child;
  if (existing && options.serverRef?.server?.modelId === modelId &&
      await (options.isHealthy || isHealthy)(options.serverRef.server)) return options.serverRef.server;
  if (existing) {
    if (options.canStop && !options.canStop()) throw new Error("A managed server is in use by another local AI request");
    await stopManagedServer(options.childRef, options.serverRef, 1_000);
  }

  const runtime = install.runtime;
  const model = install.model;
  if (!runtime || !model || typeof runtime.relativePath !== "string" ||
      typeof model.relativePath !== "string") throw new Error("Verified local inference resources are not installed");
  const fallbackToCpu = () => {
    options.onBackendFallback?.({ from: "metal", to: "cpu" });
    return startManagedServerLocked(root, install, modelId, { ...options, forceCpuBackend: true, forceCpuFallback: true });
  };
  const runtimeRoot = resolveWithin(root, runtime.relativePath);
  const runtimeBinary = resolveWithin(runtimeRoot, runtime.entryPoint);
  const modelPath = resolveWithin(root, model.relativePath);
  const recorded = readServerState(root);
  if (recorded) {
    const healthy = await (options.isHealthy || isHealthy)(recorded);
    let argv = [];
    try { argv = await (options.readProcessCommand || readProcessCommand)(recorded.pid, options.processIdentityOptions); }
    catch { /* A missing/unreadable process is never trusted for adoption or termination. */ }
    const sameProcess = isExpectedServerProcess(argv, recorded, runtimeBinary, modelPath);
    const sameInstall = recorded.modelId === modelId && recorded.runtimeId === runtime.id &&
      recorded.runtimeVersion === runtime.version && recorded.modelResourceId === model.id &&
      recorded.modelVersion === model.version;
    if (healthy && sameInstall && sameProcess) {
      const adopted = { ...recorded, runtimePath: runtimeBinary, modelPath, adopted: true };
      options.serverRef && (options.serverRef.server = adopted);
      options.onChildStarted?.(null, adopted);
      return adopted;
    }
    const processApi = options.processApi || process;
    const processAlive = isProcessAlive(processApi, recorded.pid);
    const recoveryCandidate = sameInstall && !healthy && (sameProcess || !processAlive);
    const recoveryLeaseOwner = recoveryCandidate ? options.startupRecoveryLeaseOwnerId : null;
    if (hasBlockingRequestLease(root, recoveryLeaseOwner)) throw new Error("A local AI request is still using the managed server; refusing recovery");
    if (recoveryCandidate && processAlive) {
      const orphan = { server: { ...recorded, runtimePath: runtimeBinary, modelPath, adopted: true } };
      const reclaimed = await stopRecordedManagedServerLocked(root, orphan, runtimeBinary, modelPath, options.reclaimGraceMs || 1_000, {
        ...options,
        ownerId: options.ownerId,
        startupRecoveryLeaseOwnerId: recoveryLeaseOwner,
        allowUnhealthy: true
      });
      if (!reclaimed) throw new Error("The unresponsive local model could not be safely recovered; refusing to replace it");
    } else if (processAlive) {
      throw new Error("A running process does not match the verified local model server; refusing to replace it");
    }
    const current = readServerState(root);
    if (current?.token === recorded.token && current.pid === recorded.pid && !isProcessAlive(processApi, recorded.pid)) {
      try { fs.unlinkSync(resolveWithin(root, "managed-server.json")); } catch {}
    }
  }
  const binaryStat = fs.lstatSync(runtimeBinary);
  const modelStat = fs.lstatSync(modelPath);
  const rootReal = fs.realpathSync(root);
  const binaryReal = fs.realpathSync(runtimeBinary);
  const modelReal = fs.realpathSync(modelPath);
  if (!binaryStat.isFile() || !modelStat.isFile() || binaryStat.isSymbolicLink() || modelStat.isSymbolicLink() ||
      !binaryReal.startsWith(`${rootReal}${path.sep}`) || !modelReal.startsWith(`${rootReal}${path.sep}`)) {
    throw new Error("Local inference executable or model is not a verified regular file");
  }
  if (process.platform !== "win32" && !(binaryStat.mode & 0o111)) throw new Error("Local inference executable is not marked executable");

  let port;
  let child;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (options.signal?.aborted) throw new Error("Deployment cancelled");
    port = await (options.findPort || findAvailablePort)();
    const token = crypto.randomBytes(32).toString("hex");
    const args = [
      "--model", modelPath,
      "--host", "127.0.0.1",
      "--port", String(port),
      "--api-key", token,
      "--ctx-size", String(options.contextTokens || 4096),
      "--parallel", "1",
      "--no-context-shift",
      "--threads", String(options.threads || Math.max(1, Math.min(4, Math.floor(require("node:os").availableParallelism?.() / 2 || 1))))
    ];
    if (runtime.backend === "cpu" || options.forceCpuBackend) args.push("--n-gpu-layers", "0");
    const childEnvironment = { ...process.env };
    delete childEnvironment.OLLAMA_HOST;
    child = (options.spawn || spawn)(runtimeBinary, args, {
      cwd: runtimeRoot,
      detached: false,
      shell: false,
      windowsHide: true,
      stdio: "ignore",
      env: childEnvironment
    });
    const server = {
      port, token, modelId, version: runtime.version, pid: child.pid,
      ownerId: options.ownerId, leaseUntil: Date.now() + 120_000,
      runtimeId: runtime.id, runtimeVersion: runtime.version,
      modelResourceId: model.id, modelVersion: model.version,
      backend: options.forceCpuBackend ? "cpu-fallback" : runtime.backend,
      runtimePath: runtimeBinary,
      modelPath
    };
    persistServerState(root, server);
    options.childRef && (options.childRef.child = child);
    options.serverRef && (options.serverRef.server = server);
    options.onChildStarted?.(child, server);
    child.once("error", () => {});
    child.once("exit", () => {
      if (options.childRef?.child === child) options.childRef.child = null;
      if (options.serverRef?.server === server) options.serverRef.server = null;
      if (isSafeDirectory(root)) {
        const current = readServerState(root);
        if (current?.pid === child.pid && current.ownerId === options.ownerId && current.token === token) {
          fs.rmSync(resolveWithin(root, "managed-server.json"), { force: true });
        }
      }
    });
      const deadline = Date.now() + (options.serverStartTimeoutMs || SERVER_START_TIMEOUT_MS);
    while (Date.now() < deadline) {
      if (options.signal?.aborted) {
        await stopManagedServer(options.childRef, options.serverRef, 1_000);
        throw new Error("Deployment cancelled");
      }
      if (child.exitCode !== null) break;
      if (await (options.isHealthy || isHealthy)(server, { timeoutMs: 1_000 })) {
          const controller = new AbortController();
          const abortProbe = () => controller.abort();
          options.signal?.addEventListener("abort", abortProbe, { once: true });
        const timer = setTimeout(() => controller.abort(), MODEL_LOAD_TIMEOUT_MS);
        try {
          const probe = await (options.healthInference || streamChat)({
            port, source: "managed", model: path.basename(modelPath),
            prompt: "Reply with READY only.", systemPrompt: "You are a local health check.",
            maxTokens: 64, contextTokens: 1024, token, signal: controller.signal, timeoutMs: MODEL_LOAD_TIMEOUT_MS
          });
          if (!probe.trim()) throw new Error("Local model health inference returned an empty response");
          return server;
        } catch (error) {
          await stopManagedServer(options.childRef, options.serverRef, 1_000);
          if (options.signal?.aborted) throw new Error("Deployment cancelled");
          if (runtime.backend === "metal" && !options.forceCpuFallback) return fallbackToCpu();
          throw error;
        } finally {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", abortProbe);
        }
      }
      await new Promise((resolve, reject) => {
        const settle = (callback) => {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", onAbort);
          callback();
        };
        const timer = setTimeout(() => settle(resolve), options.healthPollMs || 300);
        const onAbort = () => settle(() => reject(new Error("Deployment cancelled")));
        options.signal?.addEventListener("abort", onAbort, { once: true });
        if (options.signal?.aborted) onAbort();
      });
    }
    await stopManagedServer(options.childRef, options.serverRef, 1_000);
    if (runtime.backend === "metal" && !options.forceCpuFallback) return fallbackToCpu();
  }
  throw new Error("Local inference server failed to start after five port attempts");
}

async function stopManagedServer(childRef, serverRef, graceMs = 2_000, options = {}) {
  let lock;
  if (options.root && options.ownerId) {
    try { lock = acquireManagedServerLock(options.root, options.ownerId, options.processApi || process); }
    catch { return false; }
    if (!lock.acquired) return false;
    if (activeLeases(options.root).length) {
      releaseManagedServerLock(lock);
      return false;
    }
  }
  const child = childRef?.child;
  if (!child || child.exitCode !== null) {
    if (lock) releaseManagedServerLock(lock);
    return false;
  }
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try { child.kill("SIGTERM"); } catch { if (lock) releaseManagedServerLock(lock); return false; }
  const timer = new Promise((resolve) => setTimeout(resolve, graceMs));
  await Promise.race([exited, timer]);
  if (child.exitCode === null) {
    try { child.kill("SIGKILL"); } catch {}
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1_000))]);
  }
  if (childRef.child === child) childRef.child = null;
  if (serverRef) serverRef.server = null;
  if (lock) releaseManagedServerLock(lock);
  return true;
}

async function stopRecordedManagedServer(root, serverRef, runtimePath, modelPath, graceMs = 2_000, options = {}) {
  const server = serverRef?.server;
  if (!server?.adopted || !Number.isInteger(server.pid) || !runtimePath || !modelPath) return false;
  let lock;
  try { lock = acquireManagedServerLock(root, options.ownerId, options.processApi || process); }
  catch { return false; }
  if (!lock.acquired) return false;
  try {
    const stopped = await stopRecordedManagedServerLocked(root, serverRef, runtimePath, modelPath, graceMs, options);
    return stopped;
  } catch {
    return false;
  } finally {
    releaseManagedServerLock(lock);
  }
}

function stopRecordedManagedServerSync(root, server, runtimePath, modelPath, ownerId, options = {}) {
  if (!server?.adopted || !runtimePath || !modelPath) return false;
  let lock;
  try { lock = acquireManagedServerLock(root, ownerId, options.processApi || process); }
  catch { return false; }
  if (!lock.acquired) return false;
  try {
    const hasForeignLease = () => activeLeases(root).some((lease) => lease.ownerId !== ownerId);
    const current = readServerState(root);
    if (hasForeignLease() || !sameServerIdentity(current, server)) return false;
    const argv = (options.readProcessCommand || readProcessCommand)(current.pid, options.processIdentityOptions);
    if (argv && typeof argv.then === "function" || !isExpectedServerProcess(argv, current, runtimePath, modelPath)) return false;
    if (hasForeignLease() || !sameServerIdentity(readServerState(root), current)) return false;
    (options.processApi || process).kill(current.pid, "SIGTERM");
    return true;
  } catch {
    return false;
  } finally {
    releaseManagedServerLock(lock);
  }
}

async function stopRecordedManagedServerLocked(root, serverRef, runtimePath, modelPath, graceMs, options = {}) {
  const expected = serverRef?.server;
  const startupLeaseOwner = options.allowUnhealthy ? options.startupRecoveryLeaseOwnerId : null;
  if (!expected || !runtimePath || !modelPath || hasBlockingRequestLease(root, startupLeaseOwner)) return false;
  const current = readServerState(root);
  if (!sameServerIdentity(current, expected)) return false;
  const healthy = await (options.isHealthy || isHealthy)(current);
  if (!healthy && !options.allowUnhealthy) return false;
  const processApi = options.processApi || process;
  if (!await matchesManagedProcess(current, runtimePath, modelPath, options) || hasBlockingRequestLease(root, startupLeaseOwner)) return false;
  const latest = readServerState(root);
  if (!sameServerIdentity(latest, current)) return false;
  processApi.kill(current.pid, "SIGTERM");
  const delay = options.delay || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && isProcessAlive(processApi, current.pid)) await delay(80);
  if (isProcessAlive(processApi, current.pid)) {
    // PID reuse after SIGTERM must not turn the forced close into a kill of an unrelated process.
    if (hasBlockingRequestLease(root, startupLeaseOwner) || !sameServerIdentity(readServerState(root), current) ||
        !await matchesManagedProcess(current, runtimePath, modelPath, options)) return false;
    if (hasBlockingRequestLease(root, startupLeaseOwner) || !sameServerIdentity(readServerState(root), current)) return false;
    processApi.kill(current.pid, "SIGKILL");
    const killDeadline = Date.now() + 1_000;
    while (Date.now() < killDeadline && isProcessAlive(processApi, current.pid)) await delay(80);
    if (isProcessAlive(processApi, current.pid)) return false;
  }
  if (sameServerIdentity(readServerState(root), current)) fs.rmSync(resolveWithin(root, "managed-server.json"), { force: true });
  serverRef.server = null;
  return true;
}

function sameServerIdentity(left, right) {
  return Boolean(left && right && left.pid === right.pid && left.token === right.token && left.ownerId === right.ownerId && left.modelId === right.modelId &&
    left.runtimeId === right.runtimeId && left.runtimeVersion === right.runtimeVersion &&
    left.modelResourceId === right.modelResourceId && left.modelVersion === right.modelVersion && left.port === right.port);
}

async function matchesManagedProcess(server, runtimePath, modelPath, options) {
  try {
    const argv = await (options.readProcessCommand || readProcessCommand)(server.pid, options.processIdentityOptions);
    return isExpectedServerProcess(argv, server, runtimePath, modelPath);
  } catch { return false; }
}

function isProcessAlive(processApi, pid) {
  try { processApi.kill(pid, 0); return true; }
  catch (error) { if (error.code === "EPERM") return true; if (error.code === "ESRCH") return false; throw error; }
}

function hasBlockingRequestLease(root, startupLeaseOwner = null) {
  const leases = activeLeases(root);
  return startupLeaseOwner
    ? leases.length > 1 || leases.some((lease) => lease.ownerId !== startupLeaseOwner)
    : leases.length > 0;
}

module.exports = {
  SERVER_START_TIMEOUT_MS,
  MODEL_LOAD_TIMEOUT_MS,
  findAvailablePort,
  readServerState,
  persistServerState,
  isHealthy,
  startManagedServer,
  startManagedServerLocked,
  stopManagedServer,
  stopRecordedManagedServer,
  stopRecordedManagedServerSync
};

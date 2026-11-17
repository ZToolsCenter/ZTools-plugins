"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { isExpectedServerProcess, tokenizeCommandLine } = require("../../preload/local-ai/process-identity.cjs");
const { persistServerState, stopRecordedManagedServer } = require("../../preload/local-ai/managed-server.cjs");
const { writeLease } = require("../../preload/local-ai/leases.cjs");
const { createProcessExitCleanup } = require("../../preload/local-ai/process-lifecycle.cjs");

const root = path.join(__dirname, ".tmp", `local-ai-process-identity-${process.pid}`);
const ownerId = "a".repeat(32);
const token = "b".repeat(64);
const runtimePath = path.join(root, "runtime", "llama-server");
const modelPath = path.join(root, "models", "qwen model.gguf");

function server(overrides = {}) {
  return {
    port: 23456, token, modelId: "qwen-light", pid: 12345, ownerId,
    leaseUntil: Date.now() + 120_000,
    runtimeId: "runtime", runtimeVersion: "b11793", modelResourceId: "model", modelVersion: "rev",
    runtimePath, modelPath, ...overrides
  };
}

function argv(value = server()) {
  return [runtimePath, "--model", modelPath, "--port", String(value.port), "--api-key", value.token];
}

test("command-line identity requires exact runtime, model, port and private API token", () => {
  assert.equal(isExpectedServerProcess(argv(), server(), runtimePath, modelPath), true);
  assert.equal(isExpectedServerProcess(argv(), server(), runtimePath, path.join(root, "other.gguf")), false);
  assert.equal(isExpectedServerProcess(argv(server({ token: "c".repeat(64) })), server(), runtimePath, modelPath), false);
  assert.deepEqual(tokenizeCommandLine(`\"${runtimePath}\" --model \"${modelPath}\" --api-key ${token}`), [runtimePath, "--model", modelPath, "--api-key", token]);
});

test("an adopter stops only a matching healthy server after every request lease is gone", async (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const record = server();
  persistServerState(root, record);
  let alive = true;
  const signals = [];
  const processApi = {
    pid: 777,
    kill(pid, signal) {
      assert.equal(pid, record.pid);
      if (signal === 0) {
        if (!alive) { const error = new Error("gone"); error.code = "ESRCH"; throw error; }
        return true;
      }
      signals.push(signal);
      alive = false;
      return true;
    }
  };
  const serverRef = { server: { ...record, adopted: true } };
  const stopped = await stopRecordedManagedServer(root, serverRef, runtimePath, modelPath, 1, {
    ownerId: "c".repeat(32), processApi,
    isHealthy: async (value) => value.token === token,
    readProcessCommand: () => argv()
  });
  assert.equal(stopped, true);
  assert.deepEqual(signals, ["SIGTERM"]);
  assert.equal(serverRef.server, null);
});

test("an adopter refuses to stop a process with mismatched identity or an active foreign lease", async (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const record = server();
  persistServerState(root, record);
  const signals = [];
  const processApi = { pid: 777, kill: (_pid, signal) => { signals.push(signal); } };
  const serverRef = { server: { ...record, adopted: true } };
  const mismatched = await stopRecordedManagedServer(root, serverRef, runtimePath, modelPath, 1, {
    ownerId: "c".repeat(32), processApi,
    isHealthy: async () => true,
    readProcessCommand: () => argv(server({ token: "c".repeat(64) }))
  });
  assert.equal(mismatched, false);
  assert.deepEqual(signals, []);
  writeLease(root, "d".repeat(32), Date.now() + 60_000);
  const leased = await stopRecordedManagedServer(root, serverRef, runtimePath, modelPath, 1, {
    ownerId: "c".repeat(32), processApi,
    isHealthy: async () => true,
    readProcessCommand: () => argv()
  });
  assert.equal(leased, false);
  assert.deepEqual(signals, []);
});

test("the forced-kill stage rechecks persisted identity and OS process arguments", async (t) => {
  for (const drift of ["process", "state"]) {
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    const original = server();
    persistServerState(root, original);
    const signals = [];
    const processApi = {
      pid: 777,
      kill(_pid, signal) { if (signal !== 0) signals.push(signal); return true; }
    };
    let inspections = 0;
    const serverRef = { server: { ...original, adopted: true } };
    const stopped = await stopRecordedManagedServer(root, serverRef, runtimePath, modelPath, 0, {
      ownerId: "c".repeat(32), processApi,
      isHealthy: async () => true,
      readProcessCommand: () => {
        inspections++;
        if (drift === "process" && inspections > 1) return argv(server({ token: "c".repeat(64) }));
        if (drift === "state" && inspections > 1) persistServerState(root, server({ token: "c".repeat(64) }));
        return argv();
      }
    });
    assert.equal(stopped, false, `${drift} identity drift must abort forced termination`);
    assert.deepEqual(signals, ["SIGTERM"], "an unrelated or replaced process must never receive SIGKILL");
  }
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
});

test("host process exit synchronously signals only this service child without foreign leases", (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const processApi = new EventEmitter();
  const calls = [];
  const childRef = { child: { exitCode: null, kill: (signal) => calls.push(signal) } };
  const cleanup = createProcessExitCleanup(root, ownerId, childRef, processApi);
  writeLease(root, "d".repeat(32), Date.now() + 60_000);
  cleanup.attach();
  processApi.emit("exit");
  assert.deepEqual(calls, []);
  cleanup.clear();

  const owner = createProcessExitCleanup(root, ownerId, childRef, processApi);
  fs.rmSync(path.join(root, "leases", `${"d".repeat(32)}.json`), { force: true });
  owner.attach();
  assert.equal(owner.dispose(), true);
  assert.deepEqual(calls, ["SIGTERM"]);
  owner.clear();

  const exitHook = createProcessExitCleanup(root, ownerId, childRef, processApi);
  exitHook.attach();
  processApi.emit("exit");
  assert.deepEqual(calls, ["SIGTERM", "SIGTERM"]);
  exitHook.clear();
});

test("adopted server disposal synchronously signals only a proven instance with no foreign leases", (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const record = server();
  persistServerState(root, record);
  const signals = [];
  const processApi = new EventEmitter();
  processApi.pid = 777;
  processApi.kill = (_pid, signal) => { signals.push(signal); return true; };
  const adopted = { ...record, adopted: true };
  const cleanup = createProcessExitCleanup(root, "c".repeat(32), { child: null }, processApi,
    { server: adopted }, { readProcessCommand: () => argv() });
  cleanup.attach();
  const signaled = cleanup.dispose();
  assert.equal(signaled, true);
  assert.deepEqual(signals, ["SIGTERM"], "the synchronous dispose has signaled the adopted server before returning");
  writeLease(root, "d".repeat(32), Date.now() + 60_000);
  assert.equal(cleanup.dispose(), false);
  assert.deepEqual(signals, ["SIGTERM"], "a foreign lease prevents synchronous adopted-server termination");
  cleanup.clear();
});

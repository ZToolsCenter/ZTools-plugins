"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { readServerState, startManagedServer, persistServerState, stopManagedServer } = require("../../preload/local-ai/managed-server.cjs");
const { activeLeases, writeLease } = require("../../preload/local-ai/leases.cjs");

const root = path.join(__dirname, ".tmp", `local-ai-server-${process.pid}`);
const ownerId = "a".repeat(32);

function state(overrides = {}) {
  return {
    port: 12345, token: "b".repeat(64), modelId: "qwen-light", pid: process.pid,
    ownerId, leaseUntil: Date.now() + 120_000, runtimeId: "runtime", runtimeVersion: "b11793",
    modelResourceId: "model", modelVersion: "revision", ...overrides
  };
}

function install() {
  return {
    runtime: { id: "runtime", version: "b11793", relativePath: "runtime", entryPoint: "llama-server", backend: "metal" },
    model: { id: "model", version: "revision", relativePath: "model", entryPoint: "qwen.gguf" }
  };
}

function matchingCommand(server) {
  return [
    path.join(root, "runtime", "llama-server"), "--model", path.join(root, "model"),
    "--port", String(server.port), "--api-key", server.token
  ];
}

test("a new service adopts a healthy matching server and never kills its process", async (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(root, { recursive: true });
  persistServerState(root, state());
  const serverRef = { server: null };
  let spawnCalls = 0;
  const adopted = await startManagedServer(root, install(), "qwen-light", {
    ownerId: "c".repeat(32),
    childRef: { child: null },
    serverRef,
    isHealthy: async () => true,
    readProcessCommand: () => matchingCommand(state()),
    spawn: () => { spawnCalls++; throw new Error("must not spawn over an owned server"); }
  });
  assert.equal(adopted.adopted, true);
  assert.equal(serverRef.server.pid, process.pid);
  assert.equal(spawnCalls, 0);
  assert.equal(await stopManagedServer({ child: null }, serverRef), false);
  assert.equal(readServerState(root).token, "b".repeat(64));
});

test("a healthy server with different resources is left untouched and blocks replacement", async (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(root, { recursive: true });
  persistServerState(root, state());
  let killCalls = 0;
  const processApi = { pid: 99, kill: () => { killCalls++; } };
  let spawnCalls = 0;
  await assert.rejects(startManagedServer(root, install(), "different-model", {
    ownerId: "c".repeat(32), processApi, isHealthy: async () => true,
    readProcessCommand: () => matchingCommand(state()),
    spawn: () => { spawnCalls++; }
  }), /refusing to replace/);
  assert.equal(killCalls, 1);
  assert.equal(spawnCalls, 0);
  assert.equal(readServerState(root).modelId, "qwen-light");
});

test("server credentials are not read through a symlink", (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(root, { recursive: true });
  const outside = path.join(root, "outside.json");
  const linked = path.join(root, "managed-server.json");
  fs.writeFileSync(outside, JSON.stringify(state()), { mode: 0o600 });
  fs.symlinkSync(outside, linked);
  assert.equal(readServerState(root), null);
});

test("a foreign active lease blocks replacement and shutdown of the owned child", async (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const foreignOwner = "d".repeat(32);
  writeLease(root, foreignOwner, Date.now() + 60_000, 101);
  let kills = 0;
  const child = { exitCode: null, kill() { kills++; } };
  const childRef = { child };
  const serverRef = { server: { modelId: "old-model", port: 12345, token: "c".repeat(64) } };
  await assert.rejects(startManagedServer(root, install(), "new-model", {
    ownerId, childRef, serverRef,
    canStop: () => activeLeases(root).every((lease) => lease.ownerId === ownerId),
    isHealthy: async () => false
  }), /in use by another/);
  assert.equal(await stopManagedServer(childRef, serverRef, 1, { root, ownerId }), false);
  assert.equal(kills, 0);
  assert.equal(childRef.child, child);
});

test("Metal startup failure retries exactly once with CPU layers disabled", async (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtimeDirectory = path.join(root, "runtime");
  const modelDirectory = path.join(root, "model");
  fs.mkdirSync(runtimeDirectory);
  fs.mkdirSync(modelDirectory);
  const binaryPath = path.join(runtimeDirectory, "llama-server");
  const modelPath = path.join(modelDirectory, "qwen.gguf");
  fs.writeFileSync(binaryPath, "binary");
  fs.chmodSync(binaryPath, 0o700);
  fs.writeFileSync(modelPath, "model");
  const spawnArgs = [];
  const children = [];
  const startedChildren = [];
  const childRef = { child: null };
  const serverRef = { server: null };
  let inferenceCalls = 0;
  class FakeChild extends EventEmitter {
    constructor(pid) { super(); this.pid = pid; this.exitCode = null; }
    kill() { this.exitCode = 0; this.emit("exit", 0, "SIGTERM"); return true; }
  }
  const result = await startManagedServer(root, {
    runtime: { id: "runtime", version: "b11793", relativePath: "runtime", entryPoint: "llama-server", backend: "metal" },
    model: { id: "model", version: "revision", relativePath: "model/qwen.gguf", entryPoint: "qwen.gguf" }
  }, "qwen-light", {
    ownerId,
    childRef,
    serverRef,
    findPort: async () => 20000 + spawnArgs.length,
    serverStartTimeoutMs: 10,
    healthPollMs: 1,
    isHealthy: async () => true,
    onChildStarted: (child) => {
      assert.equal(childRef.child, child, "the lifecycle hook receives the exact child handle synchronously");
      startedChildren.push(child);
    },
    healthInference: async () => {
      inferenceCalls++;
      if (inferenceCalls === 1) throw new Error("Metal inference failed");
      return "READY";
    },
    spawn: (_binary, args) => {
      spawnArgs.push(args);
      const child = new FakeChild(900000 + children.length);
      children.push(child);
      return child;
    }
  });
  assert.equal(result.backend, "cpu-fallback");
  assert.equal(inferenceCalls, 2);
  assert.equal(spawnArgs.length, 2);
  assert.equal(startedChildren.length, 2, "both failed Metal and CPU retry children register cleanup at spawn time");
  assert.equal(spawnArgs[0].includes("--n-gpu-layers"), false);
  assert.equal(spawnArgs[0].includes("--parallel"), true);
  assert.equal(spawnArgs[0][spawnArgs[0].indexOf("--parallel") + 1], "1");
  assert.equal(spawnArgs[0].includes("--no-context-shift"), true);
  assert.equal(spawnArgs.at(-1).includes("--n-gpu-layers"), true);
  assert.equal(spawnArgs.at(-1)[spawnArgs.at(-1).indexOf("--n-gpu-layers") + 1], "0");
});

test("an unhealthy orphan is reclaimed only after command identity and request leases are checked", async (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, "runtime"), { recursive: true });
  fs.mkdirSync(path.join(root, "model"), { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtimePath = path.join(root, "runtime", "llama-server");
  const modelPath = path.join(root, "model", "qwen.gguf");
  fs.writeFileSync(runtimePath, "binary"); fs.chmodSync(runtimePath, 0o700);
  fs.writeFileSync(modelPath, "model");
  const old = state({ pid: 900100, runtimePath, modelPath });
  persistServerState(root, old);
  let oldAlive = true;
  const signals = [];
  const processApi = {
    pid: 900000,
    kill(pid, signal) {
      if (pid === old.pid) {
        if (signal === 0 && !oldAlive) { const error = new Error("gone"); error.code = "ESRCH"; throw error; }
        if (signal === "SIGTERM" || signal === "SIGKILL") { signals.push(signal); oldAlive = false; }
        return true;
      }
      return true;
    }
  };
  const children = [];
  class Child extends EventEmitter {
    constructor(pid) { super(); this.pid = pid; this.exitCode = null; }
    kill() { this.exitCode = 0; this.emit("exit", 0, "SIGTERM"); return true; }
  }
  const childRef = { child: null };
  const serverRef = { server: null };
  const result = await startManagedServer(root, {
    runtime: { id: "runtime", version: "b11793", relativePath: "runtime", entryPoint: "llama-server", backend: "cpu" },
    model: { id: "model", version: "revision", relativePath: "model/qwen.gguf", entryPoint: "qwen.gguf" }
  }, "qwen-light", {
    ownerId: "c".repeat(32), processApi, childRef, serverRef,
    isHealthy: async (candidate) => candidate.pid !== old.pid,
    readProcessCommand: (_pid, _options) => [runtimePath, "--model", modelPath, "--port", String(old.port), "--api-key", old.token],
    findPort: async () => 23456,
    serverStartTimeoutMs: 10,
    healthInference: async () => "READY",
    spawn: () => { const child = new Child(900101); children.push(child); return child; }
  });
  assert.deepEqual(signals, ["SIGTERM"], "verified unhealthy server receives a graceful close before replacement");
  assert.equal(result.pid, 900101);
  assert.equal(children.length, 1);
  assert.equal(readServerState(root).pid, 900101);
  await stopManagedServer(childRef, serverRef, 1);
});

test("an unhealthy matching orphan with an active request lease is never terminated", async (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const recorded = state({ pid: 900200, runtimePath: path.join(root, "runtime", "llama-server"), modelPath: path.join(root, "model", "qwen.gguf") });
  persistServerState(root, recorded);
  writeLease(root, "d".repeat(32), Date.now() + 60_000);
  const signals = [];
  await assert.rejects(startManagedServer(root, install(), "qwen-light", {
    ownerId: "c".repeat(32),
    processApi: { pid: 999, kill: (_pid, signal) => { if (signal !== 0) signals.push(signal); } },
    isHealthy: async () => false,
    readProcessCommand: () => matchingCommand(state()),
    spawn: () => { throw new Error("must not replace an active server"); }
  }), /still using the managed server/);
  assert.deepEqual(signals, []);
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { createLocalAiService } = require("../../preload/local-ai/service.cjs");
const { buildChatRequest, parseOllamaLine } = require("../../preload/local-ai/http-transport.cjs");
const { DEFAULT_MANIFEST } = require("../../preload/local-ai/manifest.cjs");
const store = require("../../preload/local-ai/resource-store.cjs");
const { startManagedServer, persistServerState } = require("../../preload/local-ai/managed-server.cjs");
const { writeLease } = require("../../preload/local-ai/leases.cjs");
const { resolveInstall } = require("../../preload/local-ai/service.cjs");

const testRoot = path.join(__dirname, ".tmp", `local-ai-${process.pid}`);

test("Ollama discovery and stream transport preserve complete generated chunks", async (t) => {
  fs.rmSync(testRoot, { recursive: true, force: true });
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const seenOptions = [];
  const service = createLocalAiService({
    dataDirectory: path.join(testRoot, "data"),
    manifest: { version: "test-only", resources: [], runtimeByPlatform: {}, modelByProfile: {} },
    httpTransport: {
      listOllamaModels: async (options) => {
        seenOptions.push(options);
        return [{ id: "qwen:latest", name: "qwen:latest" }];
      },
      streamChat: async (options) => {
        seenOptions.push(options);
        options.onChunk("你好");
        options.onChunk("！");
        return "你好！";
      }
    }
  });
  const environment = await service.inspect();
  assert.deepEqual(environment.externalModels, [{ id: "qwen:latest", name: "qwen:latest" }]);
  assert.equal(environment.plans.every((plan) => !plan.available), true);
  const chunks = [];
  const result = await service.generate({
    requestId: "ollama-success", source: "ollama", modelId: "qwen:latest", prompt: "润色"
  }, (chunk) => chunks.push(chunk));
  assert.equal(result, "你好！");
  assert.deepEqual(chunks, ["你好", "！"]);
  assert.equal(seenOptions[2].source, "ollama");
  await service.release();
});

test("Ollama stream parser rejects truncation instead of accepting partial text", () => {
  const state = { text: "", totalBytes: 0, finished: false };
  parseOllamaLine('{"message":{"content":"partial"},"done":false}', state);
  assert.equal(state.text, "partial");
  assert.throws(() => parseOllamaLine('{"done_reason":"length","done":true}', state), /truncated/);
});

test("managed and Ollama requests explicitly disable Qwen thinking", () => {
  const managed = buildChatRequest({ source: "managed", model: "Qwen3.gguf", prompt: "rewrite", maxTokens: 64 });
  assert.equal(managed.pathname, "/v1/chat/completions");
  assert.deepEqual(managed.body.chat_template_kwargs, { enable_thinking: false });
  assert.equal(managed.body.max_tokens, 64);
  const ollama = buildChatRequest({ source: "ollama", model: "qwen3", prompt: "rewrite" });
  assert.equal(ollama.pathname, "/api/chat");
  assert.equal(ollama.body.think, false);
});

test("managed schema is forwarded after bounded validation and before inference", async (t) => {
  fs.rmSync(testRoot, { recursive: true, force: true });
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const dataDirectory = path.join(testRoot, "schema-forwarding");
  store.ensurePrivateDirectory(dataDirectory);
  const runtime = DEFAULT_MANIFEST.resources.find((resource) => resource.id === DEFAULT_MANIFEST.runtimeByPlatform["darwin-arm64"]);
  const model = DEFAULT_MANIFEST.resources.find((resource) => resource.id === DEFAULT_MANIFEST.modelByProfile.light);
  const modelId = "Qwen3-0.6B-Q4_K_M.gguf";
  store.writeManagedMetadata(dataDirectory, { resources: [
    { id: runtime.id, version: runtime.version, relativePath: "resources/runtime" },
    { id: model.id, version: model.version, relativePath: "resources/model" }
  ] });
  fs.writeFileSync(path.join(dataDirectory, "active-model.json"), JSON.stringify({ schemaVersion: 1, profileId: "light", modelId }));
  const outputSchema = {
    type: "object", properties: { result: { $ref: "#/$defs/text" } }, required: ["result"], additionalProperties: false,
    $defs: { text: { type: "string", maxLength: 200 } }
  };
  let launched = 0;
  let captured;
  const service = createLocalAiService({
    dataDirectory, platform: "darwin", arch: "arm64",
    startManagedServer: async () => { launched++; return { port: 12345, token: "token" }; },
    httpTransport: {
      listOllamaModels: async () => [],
      streamChat: async (options) => { captured = options; return '{"result":"ok"}'; }
    }
  });
  assert.equal(await service.generate({ requestId: "schema-forward", source: "managed", modelId, prompt: "rewrite", outputSchema }), '{"result":"ok"}');
  assert.equal(launched, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(captured.outputSchema)), outputSchema);
  await service.release();
});

test("invalid managed schemas fail before server startup or inference", async (t) => {
  fs.rmSync(testRoot, { recursive: true, force: true });
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const tooDeep = { type: "string" };
  for (let index = 0; index < 9; index++) Object.assign(tooDeep, { anyOf: [{ ...tooDeep }] });
  const tooManyNodes = { type: "object", required: Array.from({ length: 2_048 }, (_, index) => `field${index}`) };
  const invalidSchemas = [
    { schema: { type: "string", const: "x".repeat(32 * 1024) }, reason: /32 KiB/ },
    { schema: tooDeep, reason: /16 levels/ },
    { schema: tooManyNodes, reason: /2048 JSON nodes/ },
    { schema: Object.assign(Object.create({ inherited: true }), { type: "string" }), reason: /plain objects/ },
    { schema: { type: "string", $ref: "https://example.test/schema" }, reason: /unsupported keyword|external/ },
    { schema: { type: "string", pattern: "(a+)+$" }, reason: /unsupported keyword/ }
  ];
  let launched = 0;
  let inferred = 0;
  const service = createLocalAiService({
    dataDirectory: path.join(testRoot, "invalid-schema"),
    startManagedServer: async () => { launched++; return { port: 12345, token: "token" }; },
    httpTransport: { listOllamaModels: async () => [], streamChat: async () => { inferred++; return "unexpected"; } }
  });
  for (const [index, item] of invalidSchemas.entries()) {
    await assert.rejects(service.generate({
      requestId: `invalid-schema-${index}`, source: "managed", modelId: "model.gguf", prompt: "rewrite", outputSchema: item.schema
    }), item.reason);
  }
  assert.equal(launched, 0);
  assert.equal(inferred, 0);
  await service.release();
});

test("Ollama schema requests fail clearly before model discovery and inference", async (t) => {
  fs.rmSync(testRoot, { recursive: true, force: true });
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  let discoveryCalls = 0;
  let inferenceCalls = 0;
  const service = createLocalAiService({
    dataDirectory: path.join(testRoot, "ollama-schema"),
    httpTransport: {
      listOllamaModels: async () => { discoveryCalls++; return [{ id: "qwen:latest", name: "qwen:latest" }]; },
      streamChat: async () => { inferenceCalls++; return "unexpected"; }
    }
  });
  await assert.rejects(service.generate({
    requestId: "ollama-schema", source: "ollama", modelId: "qwen:latest", prompt: "rewrite", outputSchema: { type: "object" }
  }), /only by managed/);
  assert.equal(discoveryCalls, 0);
  assert.equal(inferenceCalls, 0);
  await service.release();
});

test("deployment stays disabled without a complete trusted manifest and deploy reports failure", async (t) => {
  const dataDirectory = path.join(testRoot, "empty-manifest");
  fs.rmSync(testRoot, { recursive: true, force: true });
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const service = createLocalAiService({
    dataDirectory,
    platform: "darwin",
    arch: "arm64",
    compatibilityInfo: { osVersion: "14.0" },
    os: { freemem: () => os.freemem(), totalmem: () => os.totalmem() },
    manifest: { version: "test-only", resources: [], runtimeByPlatform: {}, modelByProfile: {} }
  });
  const environment = await service.inspect();
  assert.equal(environment.supported, false);
  assert.equal(environment.plans.some((plan) => plan.available), false);
  await service.deploy("light");
  for (let attempt = 0; attempt < 50; attempt++) {
    const status = await service.getStatus();
    if (status.phase === "error") {
      assert.match(status.error, /trusted|complete|manifest|完整|受信任/);
      const observer = createLocalAiService({
        dataDirectory,
        platform: "darwin",
        arch: "arm64",
        compatibilityInfo: { osVersion: "14.0" },
        manifest: { version: "observer", resources: [], runtimeByPlatform: {}, modelByProfile: {} }
      });
      let persistedStatus;
      for (let attempt = 0; attempt < 50; attempt++) {
        persistedStatus = await observer.getStatus();
        if (persistedStatus.phase === "error") break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.equal(persistedStatus.phase, "error");
      await observer.release();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("deployment did not report its missing-manifest failure");
});

test("resolveInstall points the model runtime path at the GGUF entry file", (t) => {
  fs.rmSync(testRoot, { recursive: true, force: true });
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const dataDirectory = path.join(testRoot, "resolve-install");
  store.ensurePrivateDirectory(dataDirectory);
  const runtime = DEFAULT_MANIFEST.resources.find((resource) => resource.id === DEFAULT_MANIFEST.runtimeByPlatform["darwin-arm64"]);
  const model = DEFAULT_MANIFEST.resources.find((resource) => resource.id === DEFAULT_MANIFEST.modelByProfile.light);
  store.writeManagedMetadata(dataDirectory, { resources: [
    { id: runtime.id, version: runtime.version, relativePath: "resources/runtime" },
    { id: model.id, version: model.version, relativePath: "resources/model" }
  ] });
  const catalog = require("../../preload/local-ai/manifest.cjs").createManifestCatalog(DEFAULT_MANIFEST, "darwin", "arm64");
  const install = resolveInstall(dataDirectory, catalog, "light");
  assert.equal(install.model.relativePath, path.join("resources/model", model.entryPoint));
  assert.equal(install.model.absolutePath, path.join(dataDirectory, install.model.relativePath));
});

test("generation cancellation reaches a slow managed-server startup before inference", async (t) => {
  fs.rmSync(testRoot, { recursive: true, force: true });
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const dataDirectory = path.join(testRoot, "cancel-startup");
  store.ensurePrivateDirectory(dataDirectory);
  const runtime = DEFAULT_MANIFEST.resources.find((resource) => resource.id === DEFAULT_MANIFEST.runtimeByPlatform["darwin-arm64"]);
  const model = DEFAULT_MANIFEST.resources.find((resource) => resource.id === DEFAULT_MANIFEST.modelByProfile.light);
  const modelId = "Qwen3-0.6B-Q4_K_M.gguf";
  store.writeManagedMetadata(dataDirectory, { resources: [
    { id: runtime.id, version: runtime.version, relativePath: "resources/runtime" },
    { id: model.id, version: model.version, relativePath: "resources/model" }
  ] });
  fs.writeFileSync(path.join(dataDirectory, "active-model.json"), JSON.stringify({ schemaVersion: 1, profileId: "light", modelId }));
  let releaseStartup;
  let startupSignal;
  let inferenceCalls = 0;
  const service = createLocalAiService({
    dataDirectory,
    platform: "darwin",
    arch: "arm64",
    compatibilityInfo: { osVersion: "14.0" },
    startManagedServer: async (_root, _install, _modelId, options) => {
      startupSignal = options.signal;
      await new Promise((resolve) => { releaseStartup = resolve; });
      return { port: 12345, token: "token" };
    },
    httpTransport: {
      listOllamaModels: async () => [],
      streamChat: async () => { inferenceCalls++; return "never"; }
    }
  });
  const generation = service.generate({ requestId: "cancel-start", source: "managed", modelId, prompt: "rewrite" });
  const cancelled = assert.rejects(generation, /cancel/i);
  for (let attempt = 0; attempt < 50 && !releaseStartup; attempt++) await new Promise((resolve) => setTimeout(resolve, 2));
  assert.ok(startupSignal);
  const cancellation = service.cancelGeneration("cancel-start");
  releaseStartup();
  await cancellation;
  await cancelled;
  assert.equal(startupSignal.aborted, true);
  assert.equal(inferenceCalls, 0);
  await service.release();
});

test("generate can recover its own startup lease but never ignores a foreign lease", async (t) => {
  fs.rmSync(testRoot, { recursive: true, force: true });
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const runtime = DEFAULT_MANIFEST.resources.find((resource) => resource.id === DEFAULT_MANIFEST.runtimeByPlatform["darwin-arm64"]);
  const model = DEFAULT_MANIFEST.resources.find((resource) => resource.id === DEFAULT_MANIFEST.modelByProfile.light);
  const modelId = "Qwen3-0.6B-Q4_K_M.gguf";
  const oldPid = 888001;

  async function runCase(name, addForeignLease) {
    const dataDirectory = path.join(testRoot, name);
    store.ensurePrivateDirectory(dataDirectory);
    const runtimeDirectory = path.join(dataDirectory, "resources/runtime");
    const modelDirectory = path.join(dataDirectory, "resources/model");
    fs.mkdirSync(path.dirname(path.join(runtimeDirectory, runtime.entryPoint)), { recursive: true });
    fs.mkdirSync(modelDirectory, { recursive: true });
    fs.writeFileSync(path.join(runtimeDirectory, runtime.entryPoint), "runtime");
    fs.chmodSync(path.join(runtimeDirectory, runtime.entryPoint), 0o700);
    fs.writeFileSync(path.join(modelDirectory, model.entryPoint), "model");
    store.writeManagedMetadata(dataDirectory, { resources: [
      { id: runtime.id, version: runtime.version, relativePath: "resources/runtime" },
      { id: model.id, version: model.version, relativePath: "resources/model" }
    ] });
    fs.writeFileSync(path.join(dataDirectory, "active-model.json"), JSON.stringify({ schemaVersion: 1, profileId: "light", modelId }));
    const install = resolveInstall(dataDirectory, require("../../preload/local-ai/manifest.cjs").createManifestCatalog(DEFAULT_MANIFEST, "darwin", "arm64"), "light");
    const oldServer = {
      port: 23456, token: "b".repeat(64), modelId, pid: oldPid,
      ownerId: "a".repeat(32), leaseUntil: Date.now() + 120_000,
      runtimeId: runtime.id, runtimeVersion: runtime.version,
      modelResourceId: model.id, modelVersion: model.version,
      runtimePath: path.join(dataDirectory, install.runtime.relativePath, runtime.entryPoint),
      modelPath: install.model.absolutePath
    };
    persistServerState(dataDirectory, oldServer);
    if (addForeignLease) writeLease(dataDirectory, "d".repeat(32), Date.now() + 60_000);

    const oldSignals = [];
    let oldAlive = true;
    const processApi = new EventEmitter();
    processApi.pid = 777001;
    processApi.kill = (pid, signal) => {
      if (pid === oldPid && signal === 0) {
        if (!oldAlive) { const error = new Error("gone"); error.code = "ESRCH"; throw error; }
        return true;
      }
      if (pid === oldPid) {
        oldSignals.push(signal);
        if (signal === "SIGTERM" || signal === "SIGKILL") oldAlive = false;
        return true;
      }
      return true;
    };
    const commandFor = (server) => [
      oldServer.runtimePath, "--model", oldServer.modelPath,
      "--port", String(server.port), "--api-key", server.token
    ];
    class FakeChild extends EventEmitter {
      constructor() { super(); this.pid = 888002; this.exitCode = null; }
      kill() { this.exitCode = 0; this.emit("exit", 0, "SIGTERM"); return true; }
    }
    const service = createLocalAiService({
      dataDirectory, platform: "darwin", arch: "arm64", compatibilityInfo: { osVersion: "14.0" },
      processApi, manifest: DEFAULT_MANIFEST,
      startManagedServer: (root, resolvedInstall, selectedModelId, launchOptions) => startManagedServer(root, resolvedInstall, selectedModelId, {
        ...launchOptions,
        processApi,
        readProcessCommand: (pid) => pid === oldPid ? commandFor(oldServer) : [],
        isHealthy: async (server) => server.pid !== oldPid,
        reclaimGraceMs: 0,
        findPort: async () => 23457,
        serverStartTimeoutMs: 100,
        healthPollMs: 1,
        healthInference: async () => "READY",
        spawn: () => new FakeChild()
      }),
      httpTransport: { listOllamaModels: async () => [], streamChat: async () => "已恢复" }
    });
    return { service, oldSignals, dataDirectory };
  }

  const ownLeaseCase = await runCase("own-startup-lease", false);
  const generated = await ownLeaseCase.service.generate({ requestId: "recover-own", source: "managed", modelId, prompt: "rewrite" });
  assert.equal(generated, "已恢复");
  assert.deepEqual(ownLeaseCase.oldSignals, ["SIGTERM"], "the service's pre-inference lease is the only lease recovery may ignore");
  await ownLeaseCase.service.release();

  const foreignLeaseCase = await runCase("foreign-startup-lease", true);
  await assert.rejects(foreignLeaseCase.service.generate({ requestId: "recover-foreign", source: "managed", modelId, prompt: "rewrite" }), /request|lease|using|恢复/i);
  assert.deepEqual(foreignLeaseCase.oldSignals, [], "a foreign lease prevents orphan termination even during startup recovery");
  fs.rmSync(path.join(foreignLeaseCase.dataDirectory, "leases", `${"d".repeat(32)}.json`), { force: true });
  await foreignLeaseCase.service.release();
});

test("local deployment compatibility is gated by the inspected system runtime floor", async (t) => {
  fs.rmSync(testRoot, { recursive: true, force: true });
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const service = createLocalAiService({
    dataDirectory: path.join(testRoot, "compatibility"),
    platform: "linux",
    arch: "x64",
    compatibilityInfo: { report: { header: { glibcVersionRuntime: "2.33" } }, glibcxxVersion: "3.4.50" },
    os: { totalmem: () => 8 * 1024 ** 3, freemem: () => 4 * 1024 ** 3 },
    manifest: DEFAULT_MANIFEST
  });
  const inspected = await service.inspect();
  assert.equal(inspected.supported, false);
  assert.match(inspected.plans[0].reason, /glibc 2\.34/);
  await service.release();
});

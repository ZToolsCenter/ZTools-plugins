import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { evaluateItem } from "./scenario-inference.mjs";

const require = createRequire(import.meta.url);
const localTransport = require("../../preload/local-ai/http-transport.cjs");

function makeInput({ modules, service, harnessTimeoutMs = 20, cancelWaitMs = 25 } = {}) {
  const record = { id: "timeout-case", calls: [], progress: [], resolvedEdit: null };
  return {
    record,
    input: {
      request: {}, snapshot: { content: "source", selection: null },
      modules: modules ?? { runPlannedAiTask: () => new Promise(() => {}) },
      service: service ?? { cancelGeneration: () => new Promise(() => {}) },
      transport: { buildChatRequest: () => ({ body: {} }) }, plan: { modelId: "local-model" }, record,
      serviceRunState: { inferenceSeen: false, lastPid: null },
      observeManagedServer: () => ({ present: false, pid: null, alive: false }), sha256: (value) => value,
      harnessTimeoutMs, cancelWaitMs
    }
  };
}

test("independent hard timeout returns after bounded cancellation without awaiting a never-settling runner", async () => {
  const schema = { type: "object", properties: { value: { type: "string" } } };
  const service = {
    generate: () => new Promise(() => {}),
    cancelGeneration: () => new Promise(() => {})
  };
  const modules = { runPlannedAiTask: (_request, _snapshot, options) => options.invoke("prompt", "system", 10, () => {}, schema) };
  const { input, record } = makeInput({ modules, service });
  input.transport = { buildChatRequest: ({ outputSchema }) => ({ body: { response_format: { schema: outputSchema, type: "json_schema" } } }) };
  const started = Date.now();
  await evaluateItem(input);
  assert.ok(Date.now() - started < 500, "timeout handling should stay bounded");
  assert.equal(record.harnessTimedOut, true);
  assert.equal(record.timeoutKind, "independent_harness_wall_cap");
  assert.equal(record.cancelStatus, "timed_out");
  assert.equal(Object.hasOwn(record, "result"), false);
});

test("late streamed output and inference result are isolated after the hard timeout", async () => {
  let resolveGeneration;
  let signalGenerationStarted;
  const generationStarted = new Promise((resolve) => { signalGenerationStarted = resolve; });
  const schema = { type: "object", properties: { value: { type: "string" } } };
  const service = {
    generate: (_request, onChunk) => {
      resolveGeneration = (value) => { onChunk("late chunk"); return value; };
      signalGenerationStarted();
      return new Promise((resolve) => { service.resolve = resolve; });
    },
    cancelGeneration: async () => {}
  };
  const modules = {
    async runPlannedAiTask(_request, _snapshot, options) {
      const raw = await options.invoke("prompt", "system", 10, () => {}, schema);
      return { proposal: { kind: "replace", from: 0, to: 1, text: raw } };
    },
    resolveAiEdit: (proposal) => proposal
  };
  const transport = {
    buildChatRequest: ({ outputSchema }) => ({ body: { response_format: { schema: outputSchema, type: "json_schema" } } })
  };
  const { input, record } = makeInput({ modules, service, harnessTimeoutMs: 20, cancelWaitMs: 20 });
  input.transport = transport;
  const evaluation = evaluateItem(input);
  await generationStarted;
  await evaluation;
  resolveGeneration("late response");
  service.resolve("late response");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(record.harnessTimedOut, true);
  assert.equal(record.calls[0].raw, null);
  assert.deepEqual(record.calls[0].chunks, []);
  assert.equal(Object.hasOwn(record, "result"), false);
  assert.equal(Object.hasOwn(record, "resolvedEdit"), true);
  assert.equal(record.resolvedEdit, null);
});

test("planned and content-call ID schemas pass through production transport unchanged without retries", async () => {
  const planningSchema = { type: "object", properties: { action: { type: "string" } }, required: ["action"] };
  const idsSchema = {
    type: "object", properties: { ids: { type: "array", items: { enum: ["fact-1", "fact-2"] }, minItems: 0, maxItems: 2 } },
    required: ["ids"], additionalProperties: false
  };
  const generated = [];
  const service = {
    async generate(request) { generated.push(request); return '{"ids":["fact-1"]}'; },
    async cancelGeneration() {}
  };
  const modules = {
    async runPlannedAiTask(_request, _snapshot, { invoke }) {
      await invoke("planning", "system", 128, () => {}, planningSchema);
      await invoke("select facts", "system", 128, () => {}, idsSchema);
      return { proposal: { kind: "replace", from: 0, to: 1, text: "summary" } };
    },
    resolveAiEdit: (proposal) => proposal
  };
  const { input, record } = makeInput({ modules, service, harnessTimeoutMs: 500, cancelWaitMs: 20 });
  input.transport = localTransport;
  await evaluateItem(input);

  assert.deepEqual(record.calls.map(({ phase }) => phase), ["planning", "generation"]);
  assert.equal(record.calls.length, 2);
  assert.equal(generated.length, 2);
  assert.deepEqual(generated.map(({ outputSchema }) => outputSchema), [planningSchema, idsSchema]);
  assert.deepEqual(record.calls.map(({ schemaHash, transport }) => transport.schemaHash === schemaHash), [true, true]);
  assert.deepEqual(record.calls.map(({ temperature }) => temperature), [0, 0]);
  assert.equal(record.result.proposal.text, "summary");
});

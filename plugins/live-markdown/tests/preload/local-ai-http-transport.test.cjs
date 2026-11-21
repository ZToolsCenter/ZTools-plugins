"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const http = require("node:http");
const { Readable } = require("node:stream");
const test = require("node:test");
const { streamChat } = require("../../preload/local-ai/http-transport.cjs");

async function captureChat(options) {
  const originalRequest = http.request;
  let requestBody = "";
  let requestPath;
  http.request = (requestOptions, callback) => {
    requestPath = requestOptions.path;
    const request = new EventEmitter();
    request.write = (chunk) => { requestBody += chunk.toString("utf8"); return true; };
    request.end = () => process.nextTick(() => {
      const response = options.source === "ollama"
        ? ['{"message":{"content":"ok"},"done":true}']
        : ['data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\n', 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'];
      callback(Object.assign(Readable.from(response), { statusCode: 200 }));
    });
    return request;
  };
  try {
    await streamChat(options);
    return { requestBody: JSON.parse(requestBody), requestPath };
  } finally {
    http.request = originalRequest;
  }
}

test("local inference requests opt out of process-global keep-alive socket reuse", async () => {
  const originalRequest = http.request;
  let requestOptions;
  http.request = (options, callback) => {
    requestOptions = options;
    const request = new EventEmitter();
    request.write = () => true;
    request.end = () => process.nextTick(() => callback(Object.assign(Readable.from([
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
    ]), { statusCode: 200 })));
    return request;
  };
  try {
    assert.equal(await streamChat({ port: 1234, source: "managed", model: "qwen.gguf", prompt: "test" }), "ok");
    assert.equal(requestOptions.agent, false);
  } finally {
    http.request = originalRequest;
  }
});

test("managed requests carry a structured output schema only when supplied", async () => {
  const schema = { type: "object", properties: { text: { type: "string", maxLength: 200 } }, required: ["text"], additionalProperties: false };
  const structured = await captureChat({ port: 1234, source: "managed", model: "qwen.gguf", prompt: "test", outputSchema: schema });
  assert.equal(structured.requestPath, "/v1/chat/completions");
  assert.deepEqual(structured.requestBody.response_format, { type: "json_object", schema });
  assert.equal(structured.requestBody.temperature, 0, "intent classification uses greedy decoding rather than creative sampling");

  const ordinary = await captureChat({ port: 1234, source: "managed", model: "qwen.gguf", prompt: "test", systemPrompt: "system", maxTokens: 96 });
  assert.equal(Object.hasOwn(ordinary.requestBody, "response_format"), false);
  assert.deepEqual(ordinary.requestBody, {
    model: "qwen.gguf", messages: [{ role: "system", content: "system" }, { role: "user", content: "test" }],
    stream: true, max_tokens: 96, chat_template_kwargs: { enable_thinking: false }
  });
});

test("Ollama transport never forwards a structured output schema", async () => {
  const captured = await captureChat({
    port: 11434, source: "ollama", model: "qwen:latest", prompt: "test",
    outputSchema: { type: "object", properties: { text: { type: "string" } } }
  });
  assert.equal(captured.requestPath, "/api/chat");
  assert.equal(Object.hasOwn(captured.requestBody, "response_format"), false);
});

"use strict";

const http = require("node:http");
const { StringDecoder } = require("node:string_decoder");

const HOST = "127.0.0.1";
const MAX_JSON_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_GENERATION_BYTES = 16 * 1024 * 1024;

function requestLocal({ port, pathname, method = "GET", body, token, signal, timeoutMs = 30_000, maxBytes = MAX_JSON_RESPONSE_BYTES }) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: HOST,
      port,
      path: pathname,
      method,
      agent: false,
      signal,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(payload ? { "content-type": "application/json", "content-length": String(payload.length) } : {})
      },
      timeout: timeoutMs
    }, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Local inference service returned HTTP ${response.statusCode}`));
        return;
      }
      const pieces = [];
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          response.destroy(new Error("Local inference response exceeded its size limit"));
          return;
        }
        pieces.push(chunk);
      });
      response.once("error", reject);
      response.once("end", () => resolve(Buffer.concat(pieces)));
    });
    request.once("timeout", () => request.destroy(new Error("Local inference request timed out")));
    request.once("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

async function getJson(options) {
  const bytes = await requestLocal(options);
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("Local inference service returned invalid JSON"); }
}

function parseSseFrame(frame, state, onChunk) {
  const data = frame.split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data || data === "[DONE]") return false;
  let event;
  try { event = JSON.parse(data); }
  catch { throw new Error("Local inference returned a malformed stream event"); }
  if (event.error) throw new Error(String(event.error.message || event.error));
  const choice = event.choices?.[0];
  if (choice?.finish_reason === "length" || event.done_reason === "length") {
    throw new Error("Local model output was truncated; reduce the input or retry with a smaller task");
  }
  const delta = choice?.delta?.content ?? event.message?.content ?? event.response;
  if (typeof delta === "string" && delta) {
    state.totalBytes += Buffer.byteLength(delta, "utf8");
    if (state.totalBytes > MAX_GENERATION_BYTES) throw new Error("Local model output exceeded its response limit");
    state.text += delta;
    onChunk?.(delta);
  }
  if (choice?.finish_reason && choice.finish_reason !== "stop") {
    throw new Error(`Local model stopped without a complete result (${choice.finish_reason})`);
  }
  if (event.done === true || event.choices?.[0]?.finish_reason === "stop") state.finished = true;
  return true;
}

function parseOllamaLine(line, state, onChunk) {
  if (!line.trim()) return;
  let event;
  try { event = JSON.parse(line); }
  catch { throw new Error("Ollama returned a malformed stream event"); }
  if (event.error) throw new Error(String(event.error));
  if (event.done_reason === "length") throw new Error("Local model output was truncated; reduce the input or retry with a smaller task");
  const delta = event.message?.content ?? event.response;
  if (typeof delta === "string" && delta) {
    state.totalBytes += Buffer.byteLength(delta, "utf8");
    if (state.totalBytes > MAX_GENERATION_BYTES) throw new Error("Local model output exceeded its response limit");
    state.text += delta;
    onChunk?.(delta);
  }
  if (event.done === true) state.finished = true;
}

function buildChatRequest({ source, model, prompt, systemPrompt, maxTokens, contextTokens, outputSchema }) {
  const messages = [
    ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
    { role: "user", content: prompt }
  ];
  const isOllama = source === "ollama";
  return {
    isOllama,
    pathname: isOllama ? "/api/chat" : "/v1/chat/completions",
    body: isOllama ? {
      model, messages, stream: true, think: false,
      options: { num_predict: maxTokens || 512, num_ctx: contextTokens || 4096 }
    } : {
      model, messages, stream: true,
      max_tokens: maxTokens || 512,
      chat_template_kwargs: { enable_thinking: false },
      ...(outputSchema === undefined ? {} : { response_format: { type: "json_object", schema: outputSchema }, temperature: 0 }),
      ...(contextTokens ? { n_ctx: contextTokens } : {})
    }
  };
}

async function streamChat({ port, source, model, prompt, systemPrompt, maxTokens, contextTokens, outputSchema, token, signal, onChunk, timeoutMs }) {
  const { isOllama, pathname, body } = buildChatRequest({ source, model, prompt, systemPrompt, maxTokens, contextTokens, outputSchema });
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    const request = http.request({
      hostname: HOST, port, path: pathname, method: "POST", agent: false, signal,
      timeout: timeoutMs || 300_000,
      headers: {
        "content-type": "application/json",
        "content-length": String(payload.length),
        ...(token ? { authorization: `Bearer ${token}` } : {})
      }
    }, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Local inference service returned HTTP ${response.statusCode}`));
        return;
      }
      const state = { text: "", totalBytes: 0, finished: false };
      let pending = "";
      const decoder = new StringDecoder("utf8");
      let incomingBytes = 0;
      (async () => {
        try {
          for await (const bytes of response) {
            incomingBytes += bytes.length;
            if (incomingBytes > MAX_GENERATION_BYTES + 1024 * 1024) throw new Error("Local inference stream exceeded its size limit");
            pending += decoder.write(bytes);
            if (Buffer.byteLength(pending, "utf8") > 1024 * 1024) throw new Error("Local inference sent an oversized stream event");
            if (isOllama) {
              let newline;
              while ((newline = pending.indexOf("\n")) !== -1) {
                parseOllamaLine(pending.slice(0, newline).replace(/\r$/, ""), state, onChunk);
                pending = pending.slice(newline + 1);
              }
            } else {
              let separator;
              while ((separator = pending.search(/\r?\n\r?\n/)) !== -1) {
                const frame = pending.slice(0, separator);
                const delimiter = pending.slice(separator).match(/^\r?\n\r?\n/)[0];
                pending = pending.slice(separator + delimiter.length);
                parseSseFrame(frame, state, onChunk);
              }
            }
          }
          pending += decoder.end();
          if (pending.trim()) {
            if (isOllama) parseOllamaLine(pending, state, onChunk);
            else parseSseFrame(pending, state, onChunk);
          }
          if (!state.finished || !state.text) throw new Error("Local model did not return a complete, non-empty response");
          resolve(state.text);
        } catch (error) {
          response.destroy();
          reject(signal?.aborted ? new Error("Generation cancelled") : error);
        }
      })();
      response.once("error", (error) => reject(signal?.aborted ? new Error("Generation cancelled") : error));
    });
    request.once("timeout", () => request.destroy(new Error("Local generation timed out")));
    request.once("error", (error) => reject(signal?.aborted ? new Error("Generation cancelled") : error));
    signal?.addEventListener("abort", () => request.destroy(new Error("Generation cancelled")), { once: true });
    request.write(payload);
    request.end();
  });
}

async function listOllamaModels(options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 1_500);
  try {
    const response = await getJson({ port: options.port || 11434, pathname: "/api/tags", signal: controller.signal, timeoutMs: options.timeoutMs || 1_500 });
    return Array.isArray(response.models) ? response.models
      .filter((model) => model && typeof model.name === "string" && typeof model.digest === "string")
      .map((model) => ({ id: model.name, name: model.name })) : [];
  } catch {
    return [];
  } finally { clearTimeout(timer); }
}

module.exports = { HOST, requestLocal, getJson, streamChat, listOllamaModels, parseSseFrame, parseOllamaLine, buildChatRequest };

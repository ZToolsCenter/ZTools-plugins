"use strict";

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_TOOLS = 500;
const MAX_PAGES = 20;
const { nodeHttpFetch } = require("./node-http-transport.cjs");

class McpProtocolError extends Error {
  constructor(message, code) { super(message); this.name = "McpProtocolError"; this.code = code; }
}

class StreamableHttpClient {
  constructor(config, options = {}) {
    this.config = config;
    this.fetchImpl = options.fetch || nodeHttpFetch;
    this.timeoutMs = Math.min(120_000, Math.max(1_000, Number(options.timeoutMs) || 20_000));
    this.sessionId = null;
    this.protocolVersion = null;
    this.nextId = 1;
    this.connected = false;
  }

  async connect(signal) {
    if (this.connected) return { protocolVersion: this.protocolVersion };
    let lastError;
    for (const version of PROTOCOL_VERSIONS) {
      try {
        const result = await this.request("initialize", {
          protocolVersion: version,
          capabilities: {},
          clientInfo: { name: "live-markdown", version: "0.1.0" }
        }, { signal, version: null });
        const negotiated = result?.protocolVersion;
        if (typeof negotiated !== "string" || !PROTOCOL_VERSIONS.includes(negotiated)) {
          throw new McpProtocolError("MCP server negotiated an unsupported protocol version");
        }
        this.protocolVersion = negotiated;
        this.connected = true;
        await this.notify("notifications/initialized", {}, signal);
        return { protocolVersion: negotiated };
      } catch (error) {
        lastError = error;
        if (!isNegotiationFailure(error)) break;
        this.sessionId = null;
      }
    }
    throw lastError || new Error("MCP initialization failed");
  }

  async listTools(signal) {
    this.assertConnected();
    const tools = [];
    const seen = new Set();
    let cursor;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = cursor ? { cursor } : {};
      const result = await this.request("tools/list", params, { signal });
      if (!Array.isArray(result?.tools)) throw new McpProtocolError("MCP tools/list response is malformed");
      for (const tool of result.tools) {
        if (!tool || typeof tool.name !== "string" || !tool.name || tool.name.length > 256) continue;
        if (seen.has(tool.name)) throw new McpProtocolError("MCP server returned duplicate tool names");
        seen.add(tool.name);
        tools.push({
          name: tool.name,
          description: typeof tool.description === "string" ? tool.description.slice(0, 8_000) : "",
          inputSchema: isPlainObject(tool.inputSchema) ? tool.inputSchema : { type: "object", properties: {} }
        });
        if (tools.length > MAX_TOOLS) throw new McpProtocolError("MCP server exceeded the 500-tool safety limit");
      }
      if (typeof result.nextCursor !== "string" || !result.nextCursor) return tools;
      if (seen.has(`cursor:${result.nextCursor}`)) throw new McpProtocolError("MCP server repeated a pagination cursor");
      seen.add(`cursor:${result.nextCursor}`);
      cursor = result.nextCursor;
    }
    throw new McpProtocolError(`MCP tools/list exceeded the ${MAX_PAGES}-page safety limit`);
  }

  async callTool(name, args, signal) {
    this.assertConnected();
    if (!isPlainObject(args)) throw new TypeError("MCP tool arguments must be an object");
    return this.request("tools/call", { name, arguments: args }, { signal });
  }

  async disconnect() {
    if (this.sessionId) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1_000);
        try {
          const response = await this.fetchImpl(this.config.url, { method: "DELETE", headers: this.headers(), redirect: "manual", signal: controller.signal });
          if (response.body?.cancel) await response.body.cancel().catch(() => {});
        } finally { clearTimeout(timer); }
      } catch {}
    }
    this.sessionId = null;
    this.protocolVersion = null;
    this.connected = false;
  }

  async notify(method, params, signal) {
    const { response } = await this.post({ jsonrpc: "2.0", method, params }, signal, this.protocolVersion);
    if (response.status !== 202 && !(response.status >= 200 && response.status < 300)) {
      throw new Error(`MCP notification failed with HTTP ${response.status}`);
    }
  }

  async request(method, params, options = {}) {
    const id = this.nextId++;
    const { response, message } = await this.post({ jsonrpc: "2.0", id, method, params }, options.signal, options.version || this.protocolVersion, id);
    if (response.status < 200 || response.status >= 300) {
      const message = response.status === 401 || response.status === 403
        ? "MCP authentication failed"
        : `MCP request failed with HTTP ${response.status}`;
      throw new McpProtocolError(message, response.status);
    }
    if (!message || message.id !== id) throw new McpProtocolError("MCP response id did not match the request");
    if (message.error) throw new McpProtocolError(message.error.message || "MCP server returned an error", message.error.code);
    if (!("result" in message)) throw new McpProtocolError("MCP response did not contain a result");
    return message.result;
  }

  async post(message, signal, version, expectedId = null) {
    if (signal?.aborted) throw signal.reason || new Error("MCP request cancelled");
    const controller = new AbortController();
    const relayAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", relayAbort, { once: true });
    if (signal?.aborted) relayAbort();
    const timer = setTimeout(() => controller.abort(new Error("MCP request timed out")), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(this.config.url, {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          ...this.headers(),
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(version ? { "MCP-Protocol-Version": version } : {})
        },
        body: JSON.stringify(message)
      });
      if (response.status >= 300 && response.status < 400) throw new McpProtocolError("MCP redirects are not followed because credentials must not cross origins", response.status);
      if (response.status === 401 || response.status === 403) throw new McpProtocolError("MCP authentication failed", response.status);
      const session = response.headers?.get?.("Mcp-Session-Id");
      if (session && session.length <= 512) this.sessionId = session;
      let parsed = null;
      if (response.status >= 200 && response.status < 300 && response.status !== 202) {
        if (expectedId !== null) parsed = await readMcpMessage(response, expectedId, (message) => this.respondToServerRequest(message, controller.signal));
        else await readBoundedBody(response);
      }
      else if (response.body?.cancel) void response.body.cancel().catch(() => {});
      return { response, message: parsed };
    } catch (error) {
      if (response?.body?.cancel) await response.body.cancel().catch(() => {});
      controller.abort(error);
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", relayAbort);
    }
  }

  headers() {
    return {
      ...(this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}),
      ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
      ...(this.protocolVersion ? { "MCP-Protocol-Version": this.protocolVersion } : {})
    };
  }

  assertConnected() {
    if (!this.connected || !this.protocolVersion) throw new Error("MCP server is not connected");
  }

  async respondToServerRequest(message, signal) {
    const response = message.method === "ping"
      ? { jsonrpc: "2.0", id: message.id, result: {} }
      : { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } };
    await this.post(response, signal, this.protocolVersion, null);
  }
}

async function readMcpMessage(response, expectedId, onServerRequest) {
  const contentType = response.headers?.get?.("content-type") || "";
  const lowerType = contentType.toLowerCase();
  if (lowerType.includes("text/event-stream")) return readMatchingSse(response, expectedId, onServerRequest);
  if (!lowerType.includes("application/json")) throw new McpProtocolError("MCP server returned an unsupported response content type");
  const body = await readBoundedBody(response);
  let message;
  try { message = JSON.parse(body); }
  catch { throw new McpProtocolError("MCP server returned invalid JSON"); }
  if (message?.jsonrpc !== "2.0") throw new McpProtocolError("MCP server returned an invalid JSON-RPC version");
  if (message?.method && message.id !== undefined) throw new McpProtocolError(`MCP server-initiated ${message.method} requests are unsupported`);
  return message;
}

async function readMatchingSse(response, expectedId, onServerRequest) {
  if (!response.body?.getReader) throw new McpProtocolError("MCP SSE response body is unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let total = 0;
  const processEvents = async () => {
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || "";
    for (const event of events) {
      const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join("\n");
      if (!data || data === "[DONE]") continue;
      let message;
      try { message = JSON.parse(data); } catch { continue; }
      if (message?.jsonrpc !== "2.0") throw new McpProtocolError("MCP SSE contained an invalid JSON-RPC message");
      if (message.method && message.id !== undefined) {
        await onServerRequest(message);
        continue;
      }
      if (message.id === expectedId) return message;
    }
    return null;
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new McpProtocolError("MCP response exceeded the 1 MiB safety limit");
      buffer += decoder.decode(value, { stream: true });
      const message = await processEvents();
      if (message) { await reader.cancel(); return message; }
    }
    buffer += decoder.decode();
    const trailing = `${buffer}\n\n`;
    buffer = trailing;
    const finalMessage = await processEvents();
    if (finalMessage) return finalMessage;
    throw new McpProtocolError("MCP SSE ended without a matching JSON-RPC response id");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function readBoundedBody(response) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new McpProtocolError("MCP response exceeded the 1 MiB safety limit");
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new McpProtocolError("MCP response exceeded the 1 MiB safety limit"); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    return Buffer.concat(chunks).toString("utf8");
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new McpProtocolError("MCP response exceeded the 1 MiB safety limit");
  return text;
}

function isNegotiationFailure(error) {
  return [400, 404, 406, -32602].includes(error?.code) || /protocol version.*(unsupported|not supported|invalid)/i.test(error?.message || "");
}
function isPlainObject(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }

module.exports = { PROTOCOL_VERSIONS, McpProtocolError, StreamableHttpClient };

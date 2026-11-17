"use strict";

const crypto = require("node:crypto");
const { StreamableHttpClient } = require("./streamable-http-client.cjs");
const { BUILTIN_SERVER_ID, BUILTIN_TOOLS, callBuiltin } = require("./builtin-tools.cjs");

const MAX_SERVERS = 50;
const MAX_TOOL_CONTENT = 20_000;
const BUILTIN_SERVER = Object.freeze({ id: BUILTIN_SERVER_ID, name: "Live Markdown 内置工具", transport: "builtin", url: "ztools://internal/mcp", enabled: true, builtIn: true });

function createMcpService(options = {}) {
  let configLoadError = null;
  let configs = loadInitialConfig(options.loadConfig, (error) => { configLoadError = error; });
  const tokens = new Map();
  const clients = new Map();
  const tools = new Map([[BUILTIN_SERVER_ID, BUILTIN_TOOLS]]);
  const statuses = new Map([[BUILTIN_SERVER_ID, { status: "connected" }]]);
  const activeRequests = new Map();
  const connecting = new Map();
  const connectControllers = new Map();
  const mutatingIds = new Set();
  let mutationTail = Promise.resolve();
  const fetchImpl = options.fetch;

  function findServer(id) {
    if (id === BUILTIN_SERVER_ID) return BUILTIN_SERVER;
    return configs.find((server) => server.id === id) || null;
  }

  function summary(server) {
    const state = statuses.get(server.id) || { status: "disconnected" };
    return {
      ...server,
      hasToken: server.builtIn ? false : Boolean(tokens.get(server.id)),
      status: state.status,
      ...(state.error ? { error: state.error } : {})
    };
  }

  function persist(next) {
    if (configLoadError) throw new Error(`Saved MCP configuration could not be read; refusing to overwrite it: ${configLoadError}`);
    if (typeof options.saveConfig !== "function") throw new Error("MCP configuration persistence is unavailable");
    options.saveConfig(next.map(({ id, name, transport, url, enabled }) => ({ id, name, transport, url, enabled })));
    configLoadError = null;
  }

  function serializeMutation(task) {
    const result = mutationTail.then(task);
    mutationTail = result.catch(() => {});
    return result;
  }

  async function disconnect(id) {
    if (id === BUILTIN_SERVER_ID) return;
    connectControllers.get(id)?.abort(new Error("MCP server configuration changed"));
    connectControllers.delete(id);
    connecting.delete(id);
    abortServerRequests(id, "MCP server disconnected");
    const client = clients.get(id);
    clients.delete(id);
    tools.delete(id);
    statuses.set(id, { status: "disconnected" });
    if (client) await client.disconnect();
  }

  function abortServerRequests(id, reason) {
    for (const [requestId, request] of activeRequests) {
      if (request.serverId === id) {
        activeRequests.delete(requestId);
        request.controller.abort(new Error(reason));
      }
    }
  }

  return Object.freeze({
    async listServers() {
      if (configLoadError) throw new Error(`Saved MCP configuration could not be read: ${configLoadError}`);
      return [summary(BUILTIN_SERVER), ...configs.map(summary)];
    },

    async upsertServer(input) {
      return serializeMutation(async () => {
        if (configLoadError) throw new Error(`Saved MCP configuration could not be read; refusing to overwrite it: ${configLoadError}`);
        const clean = validateServerInput(input);
        if (clean.id === BUILTIN_SERVER_ID) throw new Error("The built-in MCP server identity is reserved");
        const index = clean.id ? configs.findIndex((item) => item.id === clean.id) : -1;
        const existing = index >= 0 ? configs[index] : null;
        const id = existing?.id || `mcp-${crypto.randomUUID()}`;
        if (!existing && configs.length >= MAX_SERVERS) throw new Error(`At most ${MAX_SERVERS} custom MCP servers are allowed`);
        const nextServer = { id, name: clean.name, transport: "streamable-http", url: clean.url, enabled: clean.enabled ?? existing?.enabled ?? true, builtIn: false };
        const next = [...configs];
        if (existing) next[index] = nextServer; else next.push(nextServer);
        mutatingIds.add(id);
        try {
          if (existing) await disconnect(id);
          persist(next);
          configs = next;
          if (typeof input.token === "string") {
            if (!input.token) tokens.delete(id);
            else tokens.set(id, input.token);
          } else if (existing && existing.url !== nextServer.url) tokens.delete(id);
          return summary(nextServer);
        } finally { mutatingIds.delete(id); }
      });
    },

    async removeServer(id) {
      return serializeMutation(async () => {
        if (configLoadError) throw new Error(`Saved MCP configuration could not be read; refusing to overwrite it: ${configLoadError}`);
        if (id === BUILTIN_SERVER_ID) throw new Error("The built-in MCP server cannot be deleted");
        if (!configs.some((server) => server.id === id)) return;
        mutatingIds.add(id);
        try {
          await disconnect(id);
          const next = configs.filter((server) => server.id !== id);
          persist(next);
          configs = next;
          tokens.delete(id);
          statuses.delete(id);
        } finally { mutatingIds.delete(id); }
      });
    },

    async setEnabled(id, enabled) {
      return serializeMutation(async () => {
        if (configLoadError) throw new Error(`Saved MCP configuration could not be read; refusing to overwrite it: ${configLoadError}`);
        const server = findServer(id);
        if (!server) throw new Error("MCP server not found");
        if (server.builtIn) throw new Error("The built-in MCP server is always enabled");
        mutatingIds.add(id);
        try {
          if (!enabled) await disconnect(id);
          const next = configs.map((item) => item.id === id ? { ...item, enabled: Boolean(enabled) } : item);
          persist(next);
          configs = next;
          return summary(next.find((item) => item.id === id));
        } finally { mutatingIds.delete(id); }
      });
    },

    async connect(id) {
      const server = findServer(id);
      if (!server) throw new Error("MCP server not found");
      if (mutatingIds.has(id)) throw new Error("MCP server configuration is changing; retry after it finishes");
      if (!server.enabled) throw new Error("MCP server is disabled");
      if (server.builtIn) return { serverId: id, status: "connected", toolCount: BUILTIN_TOOLS.length };
      if (connecting.has(id)) return connecting.get(id);
      const controller = new AbortController();
      connectControllers.set(id, controller);
      let promise;
      promise = (async () => {
        const previous = clients.get(id);
        if (previous) await previous.disconnect();
        assertCurrentConnection(id, server, controller, connectControllers, findServer);
        statuses.set(id, { status: "connecting" });
        const client = new StreamableHttpClient({ ...server, token: tokens.get(id) || "" }, { fetch: fetchImpl, timeoutMs: options.timeoutMs });
        const connectionTimer = setTimeout(() => controller.abort(new Error("MCP connection timed out")), options.timeoutMs || 20_000);
        try {
          const connection = await client.connect(controller.signal);
          assertCurrentConnection(id, server, controller, connectControllers, findServer);
          const availableTools = await client.listTools(controller.signal);
          assertCurrentConnection(id, server, controller, connectControllers, findServer);
          clients.set(id, client);
          tools.set(id, availableTools);
          statuses.set(id, { status: "connected", protocolVersion: connection.protocolVersion });
          return { serverId: id, status: "connected", protocolVersion: connection.protocolVersion, toolCount: availableTools.length };
        } catch (error) {
          await client.disconnect();
          if (!controller.signal.aborted) statuses.set(id, { status: "error", error: safeError(error) });
          throw error;
        } finally {
          clearTimeout(connectionTimer);
          if (connectControllers.get(id) === controller) connectControllers.delete(id);
        }
      })().finally(() => { if (connecting.get(id) === promise) connecting.delete(id); });
      connecting.set(id, promise);
      return promise;
    },

    disconnect,

    async listTools(id) {
      const server = findServer(id);
      if (!server || !server.enabled) throw new Error("MCP server is missing or disabled");
      if (server.builtIn) return BUILTIN_TOOLS.map(publicTool);
      if (!clients.has(id)) throw new Error("MCP server is not connected");
      return (tools.get(id) || []).map(publicTool);
    },

    async callTool(serverId, toolName, args, requestId = crypto.randomUUID()) {
      const server = findServer(serverId);
      if (!server || !server.enabled) throw new Error("MCP server is missing or disabled");
      if (typeof toolName !== "string" || !toolName || toolName.length > 256) throw new TypeError("Invalid MCP tool name");
      const tool = (tools.get(serverId) || []).find((item) => item.name === toolName);
      if (!tool) throw new Error(`Tool ${toolName} is not available on server ${serverId}`);
      if (!isObject(args)) throw new TypeError("MCP tool arguments must be an object");
      if (Buffer.byteLength(JSON.stringify(args)) > 64_000) throw new TypeError("MCP tool arguments exceed the 64 KB safety limit");
      const key = validateRequestId(requestId);
      if (activeRequests.has(key)) throw new Error("MCP request id is already active");
      const controller = new AbortController();
      activeRequests.set(key, { serverId, controller });
      try {
        if (server.builtIn) return await callBuiltin(toolName, args, {
          workspaceSearch: options.workspaceSearch,
          fetchMarkdownSnippet: options.fetchMarkdownSnippet,
          request: options.fetchRequest,
          lookup: options.lookup,
          signal: controller.signal
        });
        const client = clients.get(serverId);
        if (!client) throw new Error("MCP server is not connected");
        const raw = await client.callTool(toolName, args, controller.signal);
        return normalizeToolResult(serverId, toolName, raw);
      } catch (error) {
        if (error?.code === 404) {
          await disconnect(serverId);
          statuses.set(serverId, { status: "error", error: "MCP session expired; reconnect and retry manually" });
        }
        throw error;
      } finally { activeRequests.delete(key); }
    },

    async cancel(requestId) {
      const key = validateRequestId(requestId);
      const request = activeRequests.get(key);
      if (!request) return;
      activeRequests.delete(key);
      request.controller.abort(new Error("MCP call cancelled"));
    },

    dispose() {
      for (const controller of connectControllers.values()) controller.abort(new Error("MCP bridge disposed"));
      connectControllers.clear();
      for (const request of activeRequests.values()) request.controller.abort(new Error("MCP bridge disposed"));
      activeRequests.clear();
      for (const client of clients.values()) void client.disconnect();
      clients.clear();
      tools.clear();
    }
  });
}

function validateServerInput(input) {
  if (!isObject(input)) throw new TypeError("MCP server configuration is required");
  const id = typeof input.id === "string" ? input.id.trim() : undefined;
  const name = String(input.name || "").trim();
  if (id && (id.length > 80 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id))) throw new TypeError("Invalid MCP server id");
  if (!name || name.length > 120) throw new TypeError("MCP server name must be 1 to 120 characters");
  if (input.transport !== "streamable-http") throw new TypeError("Only builtin and Streamable HTTP MCP servers are supported");
  let url;
  try { url = new URL(String(input.url || "")); } catch { throw new TypeError("A valid MCP URL is required"); }
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password || url.hash) throw new TypeError("MCP URL must be http(s) without embedded credentials or fragments");
  if (String(input.token || "").length > 8_192) throw new TypeError("MCP token exceeds the 8 KiB limit");
  return { id, name, url: url.toString(), enabled: typeof input.enabled === "boolean" ? input.enabled : undefined, token: input.token };
}

function loadInitialConfig(load, onError) {
  try {
    const raw = typeof load === "function" ? load() : [];
    if (!Array.isArray(raw)) {
      onError?.("saved MCP configuration is not an array");
      return [];
    }
    const result = [];
    const ids = new Set([BUILTIN_SERVER_ID]);
    for (const item of raw.slice(0, MAX_SERVERS)) {
      try {
        const clean = validateServerInput({ ...item, transport: "streamable-http", token: "" });
        const id = clean.id;
        if (!id || ids.has(id)) continue;
        ids.add(id);
        result.push({ id, name: clean.name, transport: "streamable-http", url: clean.url, enabled: item.enabled !== false, builtIn: false });
      } catch {}
    }
    return result;
  } catch (error) {
    onError?.(String(error?.message || error).slice(0, 1_000));
    return [];
  }
}

function normalizeToolResult(serverId, toolName, raw) {
  if (!isObject(raw) || !Array.isArray(raw.content)) throw new Error("MCP server returned a malformed tool result");
  if (raw.content.length > 50) throw new Error("MCP tool result exceeded the 50-block safety limit");
  const content = raw.content.map((block) => {
    if (typeof block?.text === "string" && Buffer.byteLength(block.text) > MAX_TOOL_CONTENT) throw new Error("MCP tool text exceeded the 20 KB safety limit");
    return ({
    type: typeof block?.type === "string" ? block.type.slice(0, 80) : "unknown",
    ...(typeof block?.text === "string" ? { text: block.text.slice(0, MAX_TOOL_CONTENT) } : {})
    });
  });
  let structuredContent;
  if (raw.structuredContent !== undefined) {
    let encoded;
    try { encoded = JSON.stringify(raw.structuredContent); }
    catch { throw new Error("MCP structured result could not be safely serialized"); }
    if (typeof encoded !== "string" || Buffer.byteLength(encoded) > MAX_TOOL_CONTENT) throw new Error("MCP structured result exceeded the 20 KB safety limit");
    structuredContent = JSON.parse(encoded);
  }
  return { serverId, toolName, content, ...(structuredContent === undefined ? {} : { structuredContent }), isError: raw.isError === true };
}

function publicTool(tool) {
  return { name: tool.name, description: tool.description, inputSchema: isObject(tool.inputSchema) ? tool.inputSchema : { type: "object", properties: {} } };
}
function validateRequestId(value) {
  const id = String(value || "");
  if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(id)) throw new TypeError("MCP request id must be 1 to 128 safe characters");
  return id;
}
function assertCurrentConnection(id, server, controller, controllerMap, findServer) {
  if (controller.signal.aborted || controllerMap.get(id) !== controller || findServer(id) !== server) {
    throw controller.signal.reason || new Error("MCP server configuration changed during connection");
  }
}
function safeError(error) { return String(error?.message || error).slice(0, 1_000); }
function isObject(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }

module.exports = { createMcpService, validateServerInput, normalizeToolResult, BUILTIN_SERVER, MAX_SERVERS };

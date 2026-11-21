"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createMcpService } = require("../../preload/mcp/service.cjs");
const { StreamableHttpClient } = require("../../preload/mcp/streamable-http-client.cjs");
const { nodeHttpFetch } = require("../../preload/mcp/node-http-transport.cjs");
const { fetchMarkdownSnippet, requestPinned } = require("../../preload/mcp/safe-fetch.cjs");
const { isPublicAddress } = require("../../preload/mcp/safe-net.cjs");

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/mcp`, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => { try { resolve(JSON.parse(raw)); } catch (error) { reject(error); } });
  });
}

function sendJson(res, message, headers = {}) {
  res.writeHead(200, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(message));
}

test("Streamable HTTP negotiates legacy version, carries session headers, paginates and reads SSE incrementally", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("renderer fetch must not be used"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests = [];
  let streamClosed = false;
  const endpoint = await listen(async (req, res) => {
    if (req.method === "DELETE") { requests.push({ method: "DELETE", headers: req.headers }); res.writeHead(200); res.end(); return; }
    const message = await readJson(req);
    requests.push({ message, headers: req.headers });
    if (message.method === "initialize") {
      if (message.params.protocolVersion === "2025-11-25") { res.writeHead(400); res.end(); return; }
      return sendJson(res, { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } } }, { "Mcp-Session-Id": "session-a" });
    }
    if (message.method === "notifications/initialized") { res.writeHead(202); res.end(); return; }
    if (message.method === "tools/list" && !message.params.cursor) return sendJson(res, { jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "alpha", inputSchema: { type: "object" } }], nextCursor: "page-two" } });
    if (message.method === "tools/list") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.once("close", () => { streamClosed = true; });
      res.write(`event: message\ndata: {"jsonrpc":"2.0","id":999,"result":{}}\n\nevent: message\ndata: {"jsonrpc":"2.0",\ndata: "id":${message.id},"result":{"tools":[{"name":"beta","description":"第二页"}]}}\n\n`);
      setTimeout(() => res.end(), 500);
      return;
    }
    if (message.method === "tools/call") return sendJson(res, { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "调用成功" }] } });
    res.writeHead(400); res.end();
  });
  t.after(endpoint.close);
  const client = new StreamableHttpClient({ url: endpoint.url, token: "secret" }, { timeoutMs: 3_000 });
  assert.deepEqual(await client.connect(), { protocolVersion: "2025-06-18" });
  const start = Date.now();
  assert.deepEqual((await client.listTools()).map(({ name }) => name), ["alpha", "beta"]);
  assert.ok(Date.now() - start < 400, "SSE response should settle on matching id without waiting for stream close");
  assert.equal(requests[2].headers["mcp-protocol-version"], "2025-06-18");
  assert.equal(requests[2].headers["mcp-session-id"], "session-a");
  assert.equal(requests[2].headers.authorization, "Bearer secret");
  const call = await client.callTool("beta", {}, new AbortController().signal);
  assert.equal(call.content[0].text, "调用成功");
  assert.equal(streamClosed, true, "matching SSE response cancels the still-open HTTP body");
  await client.disconnect();
  const deletion = requests.find((request) => request.method === "DELETE");
  assert.equal(deletion.headers["mcp-protocol-version"], "2025-06-18");
  assert.equal(deletion.headers["mcp-session-id"], "session-a");
});

test("SSE server ping is answered and unsupported server requests receive method-not-found", async (t) => {
  const replies = [];
  const endpoint = await listen(async (req, res) => {
    if (req.method === "DELETE") { res.writeHead(200); res.end(); return; }
    const message = await readJson(req);
    if (message.method === "initialize") return sendJson(res, { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "fixture", version: "1" } } }, { "Mcp-Session-Id": "ping-session" });
    if (message.method === "notifications/initialized") { res.writeHead(202); res.end(); return; }
    if (message.method === "tools/list") return sendJson(res, { jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "tool", inputSchema: { type: "object" } }] } });
    if (message.id === "server-ping") { replies.push(message); res.writeHead(202); res.end(); return; }
    if (message.id === "server-sampling") { replies.push(message); res.writeHead(202); res.end(); return; }
    if (message.method === "tools/call") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('event: message\ndata: {"jsonrpc":"2.0","id":"server-ping","method":"ping","params":{}}\n\n');
      res.write('event: message\ndata: {"jsonrpc":"2.0","id":"server-sampling","method":"sampling/createMessage","params":{}}\n\n');
      res.write(`event: message\ndata: {"jsonrpc":"2.0","id":${message.id},"result":{"content":[{"type":"text","text":"done"}]}}\n\n`);
      return;
    }
    res.writeHead(400); res.end();
  });
  t.after(endpoint.close);
  const client = new StreamableHttpClient({ url: endpoint.url });
  await client.connect();
  await client.listTools();
  const result = await client.callTool("tool", {}, new AbortController().signal);
  assert.equal(result.content[0].text, "done");
  assert.deepEqual(replies.map((reply) => reply.result || reply.error?.code), [{}, -32601]);
  await client.disconnect();
});

test("service keeps tokens in memory, isolates same-name tools by server, and protects builtin identity", async (t) => {
  const saved = [];
  let calls = 0;
  const endpoint = await listen(async (req, res) => {
    const message = await readJson(req);
    if (message.method === "initialize") return sendJson(res, { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "fixture", version: "1" } } });
    if (message.method === "notifications/initialized") { res.writeHead(202); res.end(); return; }
    if (message.method === "tools/list") return sendJson(res, { jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "same", description: "custom tool", inputSchema: { type: "object" } }] } });
    if (message.method === "tools/call") { calls++; return sendJson(res, { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "custom" }] } }); }
    res.writeHead(400); res.end();
  });
  t.after(endpoint.close);
  const service = createMcpService({ loadConfig: () => saved, saveConfig: (value) => { saved.splice(0, saved.length, ...value); } });
  const builtin = (await service.listServers())[0];
  assert.equal(builtin.builtIn, true);
  await assert.rejects(service.removeServer("builtin"), /cannot be deleted/);
  await assert.rejects(service.upsertServer({ id: "builtin", name: "replace", transport: "streamable-http", url: endpoint.url }), /reserved/);
  const created = await service.upsertServer({ name: "Fixture", transport: "streamable-http", url: endpoint.url, token: "do-not-store" });
  assert.equal(created.hasToken, true);
  assert.equal(JSON.stringify(saved).includes("do-not-store"), false);
  await service.connect(created.id);
  const customResult = await service.callTool(created.id, "same", {}, "custom-1");
  assert.equal(customResult.content[0].text, "custom");
  const builtinTools = await service.listTools("builtin");
  assert.equal(builtinTools.some((tool) => tool.name === "same"), false);
  await assert.rejects(service.callTool("builtin", "same", {}), /not available/);
  assert.equal(calls, 1);
  const edited = await service.upsertServer({ id: created.id, name: "Moved", transport: "streamable-http", url: `${endpoint.url}/moved` });
  assert.equal(edited.hasToken, false, "changing endpoint without a replacement token clears the old credential");
  await service.disconnect(created.id);
  await service.removeServer(created.id);
  service.dispose();
});

test("concurrent server mutations serialize and preserve both persisted configurations", async () => {
  const saved = [];
  const service = createMcpService({ loadConfig: () => saved, saveConfig: (value) => { saved.splice(0, saved.length, ...value); } });
  const inputs = ["one", "two"].map((name) => ({ name, transport: "streamable-http", url: `http://127.0.0.1/${name}` }));
  const created = await Promise.all(inputs.map((input) => service.upsertServer(input)));
  assert.equal(created.length, 2);
  assert.equal((await service.listServers()).length, 3);
  assert.equal(saved.length, 2);
  await Promise.all(created.map((server) => service.removeServer(server.id)));
  assert.equal(saved.length, 0);
  service.dispose();
});

test("401 is surfaced, tool call is never replayed on expired session, and cancel aborts late responses", async (t) => {
  let callCount = 0;
  let deny = true;
  const endpoint = await listen(async (req, res) => {
    const message = await readJson(req);
    if (deny) { res.writeHead(401); res.flushHeaders(); res.write("unauthorized"); return; }
    if (message.method === "initialize") return sendJson(res, { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "fixture", version: "1" } } });
    if (message.method === "notifications/initialized") { res.writeHead(202); res.end(); return; }
    if (message.method === "tools/list") return sendJson(res, { jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "write", inputSchema: { type: "object" } }] } });
    if (message.method === "tools/call") { callCount++; res.writeHead(404); res.end(); }
  });
  t.after(endpoint.close);
  let unauthorizedBodyCancelled = false;
  const service = createMcpService({ loadConfig: () => [], saveConfig: () => {}, fetch: async (url, init) => {
    const response = await nodeHttpFetch(url, init);
    if (response.status === 401) {
      const cancel = response.body.cancel;
      response.body.cancel = async () => { unauthorizedBodyCancelled = true; await cancel(); };
    }
    return response;
  } });
  const server = await service.upsertServer({ name: "Auth", transport: "streamable-http", url: endpoint.url });
  await assert.rejects(service.connect(server.id), /authentication/i);
  assert.equal(unauthorizedBodyCancelled, true, "401 response bodies are cancelled immediately");
  deny = false;
  await service.connect(server.id);
  await assert.rejects(service.callTool(server.id, "write", {}, "expired-1"), /404/);
  assert.equal(callCount, 1, "side-effecting call is not retried after session expiry");
  await assert.rejects(service.callTool(server.id, "write", {}, "expired-2"), /not available/);
  service.dispose();
});

test("transport timeout aborts the underlying Node HTTP request", async (t) => {
  let responseClosed = false;
  const endpoint = await listen(async (req, res) => {
    await readJson(req);
    res.once("close", () => { responseClosed = true; });
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.flushHeaders();
  });
  t.after(endpoint.close);
  const client = new StreamableHttpClient({ url: endpoint.url }, { timeoutMs: 1_000 });
  await assert.rejects(client.connect(), /abort|timeout/i);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(responseClosed, true, "timed out request closes the remote response stream");
});

test("request cancellation, timeout, result bounds and built-in tools are explicit", async (t) => {
  const endpoint = await listen(async (req, res) => {
    const message = await readJson(req);
    if (message.method === "initialize") return sendJson(res, { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "fixture", version: "1" } } });
    if (message.method === "notifications/initialized") { res.writeHead(202); res.end(); return; }
    if (message.method === "tools/list") return sendJson(res, { jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "slow", inputSchema: { type: "object" } }] } });
    if (message.method === "tools/call") setTimeout(() => { if (!res.destroyed) sendJson(res, { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "late" }] } }); }, 200);
  });
  t.after(endpoint.close);
  const service = createMcpService({ loadConfig: () => [], saveConfig: () => {}, workspaceSearch: (query) => ({ query, totalMatches: 1, results: [{ path: "note.md" }] }) });
  const server = await service.upsertServer({ name: "Slow", transport: "streamable-http", url: endpoint.url });
  await service.connect(server.id);
  const call = service.callTool(server.id, "slow", {}, "cancel-1");
  await service.cancel("cancel-1");
  await assert.rejects(call, /cancel|abort/i);
  const search = await service.callTool("builtin", "search_workspace_references", { query: "topic" }, "builtin-search");
  assert.match(search.content[0].text, /note\.md/);
  const diagram = await service.callTool("builtin", "get_diagram_template", { type: "sequence" }, "builtin-diagram");
  assert.match(diagram.content[0].text, /sequenceDiagram/);
  const oversized = { content: [{ type: "text", text: "x".repeat(20_001) }] };
  const { normalizeToolResult } = require("../../preload/mcp/service.cjs");
  assert.throws(() => normalizeToolResult(server.id, "slow", oversized), /20 KB/);
  service.dispose();
});

test("external content fetch binds a DNS-verified public address and blocks private targets", async () => {
  assert.equal(isPublicAddress("127.0.0.1"), false);
  assert.equal(isPublicAddress("::1"), false);
  assert.equal(isPublicAddress("::ffff:127.0.0.1"), false);
  assert.equal(isPublicAddress("93.184.216.34"), true);
  await assert.rejects(fetchMarkdownSnippet("http://127.0.0.1/"), /Private network/);
  let pinned;
  const markdown = await fetchMarkdownSnippet("https://example.com/article", {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async (url, address) => { pinned = { host: url.hostname, address }; return { status: 200, contentType: "text/html", body: "<h1>Hello</h1><script>secret</script><p>World</p>" }; }
  });
  assert.deepEqual(pinned, { host: "example.com", address: { address: "93.184.216.34", family: 4 } });
  assert.match(markdown, /Hello\s+World/);
  assert.doesNotMatch(markdown, /secret/);
  const truncated = await fetchMarkdownSnippet("https://example.com/long", {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async () => ({ status: 200, contentType: "text/plain", body: "a".repeat(20_001) })
  });
  assert.match(truncated, /内容已按 20,000 字符限制截断/);
});

test("pinned external HTTP rejects oversized and incomplete responses without unhandled stream errors", async (t) => {
  const endpoint = await listen((req, res) => {
    if (req.url.includes("declared")) {
      res.writeHead(200, { "content-type": "text/plain", "content-length": "1000001" });
      res.flushHeaders();
      return;
    }
    if (req.url.includes("streamed")) {
      res.writeHead(200, { "content-type": "text/plain", "transfer-encoding": "chunked" });
      res.end(Buffer.alloc(1_000_001, 97));
      return;
    }
    res.writeHead(200, { "content-type": "text/plain", "content-length": "100" });
    res.write("short");
    res.socket.destroy();
  });
  t.after(endpoint.close);
  const address = { address: "127.0.0.1", family: 4 };
  await assert.rejects(requestPinned(new URL(`${endpoint.url}?declared`), address), /1 MB safety limit/);
  await assert.rejects(requestPinned(new URL(`${endpoint.url}?streamed`), address), /1 MB safety limit/);
  await assert.rejects(requestPinned(new URL(`${endpoint.url}?incomplete`), address), /incomplete|aborted|reset|socket/i);
});

test("corrupt persisted configuration is reported and never overwritten as a side effect", async () => {
  let saveCalls = 0;
  const service = createMcpService({
    loadConfig: () => { throw new Error("invalid JSON"); },
    saveConfig: () => { saveCalls++; }
  });
  await assert.rejects(service.listServers(), /could not be read/i);
  await assert.rejects(service.upsertServer({ name: "Lost", transport: "streamable-http", url: "http://127.0.0.1/mcp" }), /refusing to overwrite/i);
  assert.equal(saveCalls, 0);
  service.dispose();
});

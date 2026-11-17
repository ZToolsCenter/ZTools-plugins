"use strict";

const http = require("node:http");

// Real HTTP fixture: the production preload client must perform the MCP handshake.
async function startMcpFixture() {
  const requests = [];
  const sessions = new Set();
  let sequence = 0;
  const server = http.createServer(async (req, res) => {
    if (req.url === "/denied") { res.writeHead(401); res.end(); return; }
    if (req.method === "DELETE") { res.writeHead(204); res.end(); return; }
    if (req.method === "GET") { res.writeHead(405); res.end(); return; }
    let raw = "";
    for await (const chunk of req) raw += chunk.toString();
    const body = JSON.parse(raw);
    requests.push({ method: body.method, params: body.params, authorization: req.headers.authorization, path: req.url });
    const reply = (result) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
    };
    if (body.method === "initialize") {
      const id = `acceptance-${++sequence}`;
      sessions.add(id);
      res.setHeader("Mcp-Session-Id", id);
      reply({ protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "Live Markdown acceptance", version: "1.0" } });
      return;
    }
    if (!sessions.has(req.headers["mcp-session-id"]) || req.headers["mcp-protocol-version"] !== "2025-11-25") {
      res.writeHead(400); res.end("Missing negotiated session or protocol"); return;
    }
    if (body.method.startsWith("notifications/")) { res.writeHead(202); res.end(); return; }
    if (body.method === "tools/list") {
      reply({ tools: [{ name: "echo_note", description: "回传输入，验证真实 MCP 请求", inputSchema: { type: "object", properties: { text: { type: "string", description: "待回传文字" } }, required: ["text"] } }] });
      return;
    }
    if (body.method === "tools/call") {
      const result = { content: [{ type: "text", text: `MCP 实际返回：${body.params.arguments.text}` }], structuredContent: { received: body.params.arguments.text }, isError: false };
      res.writeHead(200, { "content-type": "text/event-stream" });
      const event = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result })}\n\n`;
      // Deliberately split a UTF-8 event across transport writes.
      const bytes = Buffer.from(event);
      res.write(bytes.subarray(0, 19));
      res.end(bytes.subarray(19));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Unknown method" } }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/mcp`, requests,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); })
  };
}

module.exports = { startMcpFixture };

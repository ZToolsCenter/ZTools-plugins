const http = require('http');
const crypto = require('crypto');
const MAX_BODY = 2 * 1024 * 1024, MAX_PREVIEW = 64 * 1024, MAX_HISTORY = 200, MAX_HISTORY_BYTES = 4 * 1024 * 1024, MAX_HEADERS = 100, MAX_REQUESTS = 10000, MAX_CONNECTIONS = 64;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
const MAX_JSON_DEPTH = 48, MAX_JSON_NODES = 2000;

function routeToken() { return crypto.randomBytes(18).toString('base64url'); }
function hostFor() { return '127.0.0.1'; }
function hmac(body, secret, algorithm = 'sha256') {
  if (!['sha256', 'sha512'].includes(algorithm)) throw Error('不支持的 HMAC 算法');
  if (Buffer.byteLength(String(body)) > MAX_BODY || Buffer.byteLength(String(secret)) > 8192) throw Error('HMAC 输入过大');
  return crypto.createHmac(algorithm, String(secret)).update(String(body)).digest('hex');
}
function curlFor(url, platform = process.platform) {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/[^']*$/.test(url)) throw Error('仅允许不包含单引号的本地监听 URL');
  if (platform === 'win32') return `curl.exe -X POST '${url}' -H 'content-type: application/json' -d '{\"event\":\"test\"}'`;
  return `curl -X POST '${url}' -H 'content-type: application/json' -d '{"event":"test"}'`;
}
function preview(body, contentType) {
  const clipped = body.subarray(0, MAX_PREVIEW), text = clipped.toString('utf8');
  let value = text, kind = 'text';
  if (/application\/json/i.test(contentType)) {
    try {
      const parsed = JSON.parse(text);
      if (!withinJsonLimit(parsed)) return { kind: 'text', value: '[preview omitted: JSON nesting limit exceeded]', truncated: true };
      value = parsed; kind = 'json';
    } catch {}
  }
  else if (/application\/x-www-form-urlencoded/i.test(contentType)) { value = Object.fromEntries(new URLSearchParams(text)); kind = 'form'; }
  return { kind, value, truncated: body.length > MAX_PREVIEW };
}
function withinJsonLimit(root) {
  const queue = [[root, 0]]; let nodes = 0;
  while (queue.length) {
    const [value, depth] = queue.pop();
    if (++nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) return false;
    if (value && typeof value === 'object') for (const next of Object.values(value)) queue.push([next, depth + 1]);
  }
  return true;
}

class WebhookServer {
  constructor(options = {}) {
    this.options = { port: 0, token: routeToken(), requestTimeoutMs: 15000, maxRequests: MAX_REQUESTS, maxConnections: MAX_CONNECTIONS, ...options };
    this.events = []; this.historyBytes = 0; this.requestCount = 0; this.sockets = new Set();
    this.server = null; this.starting = null; this.stopping = null;
  }
  async start() {
    if (this.stopping) await this.stopping;
    if (this.starting) return this.starting;
    if (this.server?.listening) return this.address();
    // Do this before assigning starting: stop waits on starting and would otherwise self-deadlock.
    if (this.server) await this.stop();
    this.starting = (async () => {
      const server = http.createServer((request, response) => this._request(request, response));
      server.maxHeadersCount = MAX_HEADERS;
      server.requestTimeout = Math.min(60000, Math.max(1000, Number(this.options.requestTimeoutMs) || 15000));
      server.headersTimeout = server.requestTimeout;
      server.keepAliveTimeout = 5000;
      server.on('connection', (socket) => {
        if (this.sockets.size >= this.options.maxConnections) return socket.destroy();
        this.sockets.add(socket);
        socket.on('close', () => this.sockets.delete(socket));
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(this.options.port, hostFor(), () => { server.off('error', reject); resolve(); });
      });
      this.server = server;
      return this.address();
    })();
    try { return await this.starting; } finally { this.starting = null; }
  }
  address() {
    const address = this.server?.address();
    return address && typeof address === 'object' ? { host: address.address, port: address.port, path: `/${this.options.token}` } : null;
  }
  _reply(response, status, body) {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) });
    response.end(body);
  }
  _request(request, response) {
    if (this.requestCount++ >= this.options.maxRequests) return this._reply(response, 429, '{"error":"request limit reached"}');
    if (!METHODS.has(request.method)) return this._reply(response, 405, '{"error":"method not allowed"}');
    const announced = Number(request.headers['content-length']);
    if (!Number.isFinite(announced) && request.headers['content-length']) return this._reply(response, 400, '{"error":"invalid content length"}');
    if (announced < 0 || announced > MAX_BODY) return this._reply(response, 413, '{"error":"body too large"}');
    if (request.url !== `/${this.options.token}`) return this._reply(response, 404, '{"error":"unknown route"}');
    let bytes = 0, done = false; const chunks = [];
    const finish = (status, body) => { if (!done) { done = true; this._reply(response, status, body); } };
    request.on('aborted', () => finish(400, '{"error":"request aborted"}'));
    request.on('data', (chunk) => { bytes += chunk.length; if (bytes > MAX_BODY) { finish(413, '{"error":"body too large"}'); request.destroy(); } else chunks.push(chunk); });
    request.on('end', () => {
      if (done) return;
      const body = Buffer.concat(chunks);
      const event = { id: crypto.randomUUID?.() || crypto.randomBytes(8).toString('hex'), at: new Date().toISOString(), method: request.method, headers: request.headers, bytes, body: preview(body, request.headers['content-type'] || '') };
      this.events.unshift(event); this.historyBytes += Math.min(bytes, MAX_PREVIEW);
      while (this.events.length > MAX_HISTORY || this.historyBytes > MAX_HISTORY_BYTES) { const old = this.events.pop(); this.historyBytes -= Math.min(old.bytes, MAX_PREVIEW); }
      finish(202, JSON.stringify({ accepted: true, id: event.id }));
    });
    request.on('error', () => finish(400, '{"error":"request error"}'));
  }
  async stop() {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      if (this.starting) await this.starting.catch(() => {});
      const server = this.server; this.server = null;
      if (!server) return;
      const oldSockets = [...this.sockets];
      this.sockets.clear();
      await new Promise((resolve) => { for (const socket of oldSockets) socket.destroy(); if (!server.listening) return resolve(); server.close(resolve); });
    })();
    try { return await this.stopping; }
    finally { this.stopping = null; }
  }
  async restart(options = {}) { await this.stop(); this.options = { ...this.options, ...options }; return this.start(); }
  clear() { this.events = []; this.historyBytes = 0; }
}
module.exports = { WebhookServer, MAX_BODY, MAX_HISTORY, MAX_HISTORY_BYTES, MAX_PREVIEW, MAX_REQUESTS, MAX_CONNECTIONS, hostFor, hmac, curlFor, preview, routeToken };

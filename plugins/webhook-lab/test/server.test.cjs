const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const fs = require('node:fs');
const { WebhookServer, MAX_BODY, MAX_HISTORY, MAX_HISTORY_BYTES, MAX_PREVIEW, hostFor, hmac, curlFor, preview } = require('../src/core/server.cjs');
const preload = require('../src/preload/index.cjs');

function invoke(server, { path = '/safe', body = '', method = 'POST', headers = {} } = {}) {
  return new Promise((resolve) => {
    const request = new EventEmitter();
    Object.assign(request, { url: path, method, headers, destroy() { this.destroyed = true; } });
    const response = { status: 0, body: '', writeHead(status) { this.status = status; }, end(bodyText) { this.body = bodyText; resolve(this); } };
    server._request(request, response);
    process.nextTick(() => { if (body) request.emit('data', Buffer.from(body)); request.emit('end'); });
  });
}

test('bounded receiver and cleanup', async () => {
  const server = new WebhookServer({ token: 'safe' });
  const missing = await invoke(server, { path: '/bad' }); assert.equal(missing.status, 404); assert.equal(missing.body, '{"error":"unknown route"}');
  assert.equal((await invoke(server, { body: '{"ok":1}', headers: { 'content-type': 'application/json' } })).status, 202);
  let destroyed = false;
  server.sockets.add({ destroy() { destroyed = true; } }); server.server = { listening: false };
  await Promise.all([server.stop(), server.stop()]);
  assert.equal(destroyed, true);
});
test('rejects method, content length and body', async () => {
  const server = new WebhookServer({ token: 'safe' });
  assert.equal((await invoke(server, { method: 'TRACE' })).status, 405);
  assert.equal((await invoke(server, { headers: { 'content-length': String(MAX_BODY + 1) } })).status, 413);
  assert.equal((await invoke(server, { body: 'x'.repeat(MAX_BODY + 1) })).status, 413);
});
test('concurrent starts share exactly one live server and stop closes it', async () => {
  const original = http.createServer; let created = 0;
  http.createServer = () => {
    created++;
    const fake = new EventEmitter(); fake.listening = false; fake.address = () => ({ address: '127.0.0.1', port: 45678 });
    fake.listen = (_port, _host, callback) => { fake.listening = true; queueMicrotask(callback); return fake; };
    fake.close = (callback) => { fake.listening = false; queueMicrotask(callback); };
    return fake;
  };
  try {
    const server = new WebhookServer({ token: 'safe' });
    const [left, right] = await Promise.all([server.start(), server.start()]);
    assert.equal(left.port, right.port); assert.equal(created, 1);
    const live = server.server; await server.stop();
    assert.equal(live.listening, false); assert.equal(server.server, null);
  } finally { http.createServer = original; }
});
test('stop/start is linearized across a delayed close', async () => {
  const original = http.createServer; let created = 0, closeCalls = 0, finishClose;
  http.createServer = () => {
    created++;
    const fake = new EventEmitter(); fake.listening = false; fake.address = () => ({ address: '127.0.0.1', port: 45000 + created });
    fake.listen = (_port, _host, callback) => { fake.listening = true; queueMicrotask(callback); return fake; };
    fake.close = (callback) => { closeCalls++; finishClose = () => { fake.listening = false; callback(); }; };
    return fake;
  };
  try {
    const server = new WebhookServer({ token: 'safe' }); await server.start();
    const oldSocket = { destroyed: false, destroy() { this.destroyed = true; } }; server.sockets.add(oldSocket);
    const firstStop = server.stop(), secondStop = server.stop(), duringCloseStart = server.start();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(closeCalls, 1); assert.equal(created, 1); assert.equal(oldSocket.destroyed, true);
    finishClose(); await Promise.all([firstStop, secondStop, duringCloseStart]);
    assert.equal(created, 2);
    const newSocket = { destroy() {} }; server.sockets.add(newSocket);
    assert.ok(server.sockets.has(newSocket)); const lastStop = server.stop(); finishClose(); await lastStop;
  } finally { http.createServer = original; }
});
test('bridge start without a port does not restart its owner', async () => {
  const bridge = preload.bridge({});
  let stopped = false;
  const server = { listening: true, address: () => ({ address: '127.0.0.1', port: 45678 }), close: (done) => { stopped = true; done(); } };
  preload.__testSetOwner({ options: { port: 0, token: 'safe' }, server, start: WebhookServer.prototype.start, address: WebhookServer.prototype.address, stop: async () => { stopped = true; } });
  const first = await bridge.start({});
  const second = await bridge.start({});
  assert.equal(first.port, second.port);
  assert.equal(preload.__testOwner().server, server);
  await bridge.stop();
  assert.equal(stopped, true);
});
test('history honors 64 KiB previews, 4 MiB budget and clear on exit', () => {
  const server = new WebhookServer();
  server.events = Array.from({ length: MAX_HISTORY + 1 }, (_, index) => ({ bytes: MAX_PREVIEW, index }));
  server.historyBytes = server.events.length * MAX_PREVIEW;
  while (server.events.length > MAX_HISTORY || server.historyBytes > MAX_HISTORY_BYTES) { const old = server.events.pop(); server.historyBytes -= Math.min(old.bytes, MAX_PREVIEW); }
  assert.ok(server.events.length <= MAX_HISTORY);
  assert.ok(server.historyBytes <= MAX_HISTORY_BYTES);
  server.clear();
  assert.deepEqual(server.events, []); assert.equal(server.historyBytes, 0);
});
test('safe events redact header name/value and signature credentials', () => {
  preload.__testSetOwner({ events: [{ headers: [{ name: 'Authorization', value: 'Bearer x' }, { name: 'X-Signature', value: 'x' }], credential: 'x', sig: 'x', body: { signature: 'x', safe: true } }] });
  const event = preload.bridge({}).events()[0];
  assert.equal(event.headers[0].value, '[redacted]'); assert.equal(event.headers[1].value, '[redacted]');
  assert.equal(event.credential, '[redacted]'); assert.equal(event.sig, '[redacted]'); assert.equal(event.body.signature, '[redacted]');
  preload.__testSetOwner(null);
});
test('safe event copies hostile keys without prototype pollution', () => {
  preload.__testSetOwner({ events: [{ body: { value: JSON.parse('{"__proto__":{"polluted":true},"constructor":"safe","prototype":"safe"}') } }] });
  const value = preload.bridge({}).events()[0].body.value;
  assert.equal(Object.getPrototypeOf(value), null);
  assert.equal(value['[reserved-key]'].polluted, true);
  assert.equal(value['[reserved-key]#2'], 'safe');
  assert.equal(value['[reserved-key]#3'], 'safe');
  assert.equal(Object.hasOwn(value, '__proto__'), false);
  assert.equal(Object.hasOwn(value, 'constructor'), false);
  assert.equal(Object.hasOwn(value, 'prototype'), false);
  assert.equal({}.polluted, undefined);
  preload.__testSetOwner(null);
});
test('safe event copying never executes accessors', () => {
  const payload = Object.create(null);
  Object.defineProperty(payload, 'visible', { value: 'ok', enumerable: true });
  Object.defineProperty(payload, 'derived', { enumerable: true, get() { throw new Error('must not execute'); } });
  preload.__testSetOwner({ events: [{ body: { value: payload } }] });
  const value = preload.bridge({}).events()[0].body.value;
  assert.equal(Object.getPrototypeOf(value), null);
  assert.equal(value.visible, 'ok');
  assert.equal(value.derived, '[redacted]');
  preload.__testSetOwner(null);
});
test('deep JSON is bounded before preview, bridge redaction, and renderer', () => {
  const json = `${'{"x":'.repeat(5000)}{"token":"secret"}${'}'.repeat(5000)}`;
  const deepPreview = preview(Buffer.from(json), 'application/json');
  assert.deepEqual(deepPreview, { kind: 'text', value: '[preview omitted: JSON nesting limit exceeded]', truncated: true });
  let value = { token: 'secret' }; for (let index = 0; index < 5000; index++) value = { child: value };
  preload.__testSetOwner({ events: [{ body: { kind: 'json', value } }] });
  const event = preload.bridge({}).events()[0];
  let cursor = event.body.value; for (let index = 0; index < 60 && cursor && typeof cursor === 'object'; index++) cursor = cursor.child;
  assert.equal(cursor, '[truncated]');
  const source = fs.readFileSync(require.resolve('../src/main/app.js'), 'utf8');
  assert.match(source, /humanize\(JSON\.stringify\(body\.value\)\)\.slice\(0,280\)/);
  preload.__testSetOwner(null);
});
test('normal JSON stays renderable while secrets remain redacted', () => {
  preload.__testSetOwner({ events: [{ body: { kind: 'json', value: { ok: true, token: 'do-not-leak' } } }] });
  const visible = JSON.stringify(preload.bridge({}).events()[0].body.value);
  assert.match(visible, /"ok":true/); assert.doesNotMatch(visible, /do-not-leak/); assert.match(visible, /\[redacted\]/);
  preload.__testSetOwner(null);
});
test('text payload leaves receive final credential-pattern redaction', async () => {
  const server = new WebhookServer({ token: 'safe' });
  const privateKey = `-----BEGIN PRIVATE KEY-----\n${'A'.repeat(64)}\n-----END PRIVATE KEY-----`;
  await invoke(server, { body: `note=visible token=AKIA_SUPER_SECRET_VALUE_123456 Authorization: Bearer abcdefghijklmnop https://x.test/?signature=hidden\n${privateKey}`, headers: { 'content-type': 'text/plain' } });
  preload.__testSetOwner(server);
  const text = preload.bridge({}).events()[0].body.value;
  assert.match(text, /note=visible/);
  assert.match(text, /\[redacted-private-key\]/);
  assert.doesNotMatch(text, /AKIA_SUPER_SECRET_VALUE_123456|abcdefghijklmnop|signature=hidden|BEGIN PRIVATE KEY/);
  preload.__testSetOwner(null);
});
test('renderer localizes every machine redaction token and cross-platform curl is explicit', () => {
  const app = fs.readFileSync(require.resolve('../src/main/app.js'), 'utf8'); const html = fs.readFileSync(require.resolve('../src/main/index.html'), 'utf8');
  assert.equal(app.includes('innerHTML'), false); assert.match(app, /\['\[redacted-private-key\]','【私钥已脱敏】'\]/); assert.match(app, /\['\[redacted\]','【已脱敏】'\]/); assert.match(app, /\['\[preview omitted: JSON nesting limit exceeded\]','【JSON 预览已省略：嵌套层级超限】'\]/); assert.match(app, /\['\[preview omitted: redacted output exceeds 64 KiB\]','【预览已省略：脱敏后的输出超过 64 KiB】'\]/); assert.match(app, /\$\('#secret'\)\.value=''/); assert.match(html, /id="secret" type="password"/);
  assert.equal(hmac('x', 's').length, 64); assert.equal(hmac('x', 's', 'sha512').length, 128); assert.throws(() => hmac('x', 's', 'md5'));
  for (const platform of ['win32', 'darwin', 'linux']) { assert.equal(hostFor('lan', platform), '127.0.0.1'); assert.match(curlFor('http://127.0.0.1:123/a', platform), /curl/); }
  assert.match(curlFor('http://127.0.0.1:123/a', 'win32'), /curl\.exe.*'http:\/\/127\.0\.0\.1:123\/a'/);
  assert.throws(() => curlFor("http://127.0.0.1:123/a'b", 'win32'));
});

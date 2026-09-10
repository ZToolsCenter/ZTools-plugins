'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const preload = require('../src/preload/index.cjs');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));

test('manifest declarations and real native handlers stay one-to-one', async () => {
  const handlers = new Map();
  const target = { ztools: { registerTool(name, handler) { handlers.set(name, handler); } } };
  preload.attachWebhookLab(target);
  assert.deepEqual([...handlers.keys()].sort(), Object.keys(manifest.tools).sort());
  assert.deepEqual(Object.keys(manifest.tools).sort(), ['hmac', 'preview_payload']);
  assert.ok([...handlers.values()].every((handler) => typeof handler === 'function'));
  const result = await handlers.get('hmac')({ body: 'hello', secret: 'world' });
  assert.equal(result.digest, crypto.createHmac('sha256', 'world').update('hello').digest('hex'));
  assert.equal(typeof target.webhookLab.start, 'function');
});

test('top-level preload registration is synchronous', () => {
  const file = require.resolve('../src/preload/index.cjs');
  const script = `const names=[];globalThis.ztools={registerTool(name,handler){if(typeof handler!=='function')throw Error('bad handler');names.push(name)}};require(${JSON.stringify(file)});process.stdout.write(JSON.stringify(names.sort()))`;
  const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), ['hmac', 'preview_payload']);
});

test('one registration failure neither blocks the other tool nor breaks the human UI', async () => {
  const handlers = new Map();
  const target = {
    ztools: {
      registerTool(name, handler) {
        if (name === 'hmac') throw new Error('simulated host failure');
        handlers.set(name, handler);
      }
    }
  };
  assert.doesNotThrow(() => preload.attachWebhookLab(target));
  assert.equal(typeof target.webhookLab.events, 'function');
  assert.deepEqual([...handlers.keys()], ['preview_payload']);
  const result = await handlers.get('preview_payload')({ body: 'ok', contentType: 'text/plain' });
  assert.equal(result.value, 'ok');
});

test('older hosts degrade to the unchanged human bridge', () => {
  const copied = [];
  const target = { ztools: { copyText(value) { copied.push(value); } } };
  assert.doesNotThrow(() => preload.attachWebhookLab(target));
  target.webhookLab.copyText('human');
  assert.deepEqual(copied, ['human']);
  assert.equal(typeof target.webhookLab.start, 'function');
});

test('HMAC tool is bounded, strict and never echoes body or secret', () => {
  const result = preload.hmacForMcp({ body: 'payload', secret: 'top-secret', algorithm: 'sha512' });
  assert.equal(result.algorithm, 'sha512');
  assert.equal(result.digest.length, 128);
  assert.equal(result.bodyBytes, 7);
  assert.doesNotMatch(JSON.stringify(result), /payload|top-secret/);
  assert.throws(() => preload.hmacForMcp({ body: 'x', secret: 's', algorithm: 'md5' }), { code: 'INVALID_TOOL_INPUT' });
  assert.throws(() => preload.hmacForMcp({ body: 'x'.repeat(preload.MCP_BODY_BYTES + 1), secret: 's' }), { code: 'INVALID_TOOL_INPUT' });
  assert.throws(() => preload.hmacForMcp({ body: '汉'.repeat(Math.floor(preload.MCP_BODY_BYTES / 3) + 1), secret: 's' }), { code: 'INVALID_TOOL_INPUT' });
  assert.throws(() => preload.hmacForMcp({ body: 'x', secret: '密'.repeat(Math.floor(preload.MCP_SECRET_BYTES / 3) + 1) }), { code: 'INVALID_TOOL_INPUT' });
});

test('payload preview reuses parser and redaction without credential output', () => {
  const body = JSON.stringify({ ok: true, authorization: 'Bearer abcdefghijklmnop', nested: { apiKey: 'never-return-me' }, url: 'https://example.test/?token=hidden' });
  const result = preload.previewForMcp({ body, contentType: 'application/json' });
  const serialized = JSON.stringify(result);
  assert.equal(result.kind, 'json');
  assert.match(serialized, /"ok":true/);
  assert.match(serialized, /\[redacted\]/);
  assert.doesNotMatch(serialized, /abcdefghijklmnop|never-return-me|token=hidden/);
  assert.ok(Buffer.byteLength(serialized, 'utf8') <= preload.MCP_RESPONSE_BYTES);
});

test('registered payload handler sanitizes dynamic keys, reserved names and deterministic collisions', async () => {
  const handlers = new Map();
  preload.attachWebhookLab({ ztools: { registerTool(name, handler) { handlers.set(name, handler); } } });
  const githubA = `ghp_${'A'.repeat(36)}`;
  const githubB = `ghp_${'B'.repeat(36)}`;
  const labeledCredential = 'metadata_token=must-not-leak';
  const body = JSON.stringify(Object.fromEntries([
    ['visible', { ok: true }],
    [githubA, 'first'],
    [githubB, 'second'],
    ['[redacted]', 'literal'],
    [labeledCredential, 'sensitive-value'],
    ['__proto__', 'proto-value'],
    ['constructor', 'constructor-value'],
    ['prototype', 'prototype-value']
  ]));

  const result = await handlers.get('preview_payload')({ body, contentType: 'application/json' });
  const output = result.value;
  const serialized = JSON.stringify(result);
  assert.equal(result.kind, 'json');
  assert.equal(Object.getPrototypeOf(output), null);
  assert.equal(Object.getPrototypeOf(output.visible), null);
  assert.deepEqual(output.visible, Object.assign(Object.create(null), { ok: true }));
  assert.equal(output['[redacted]'], 'first');
  assert.equal(output['[redacted]#2'], 'second');
  assert.equal(output['[redacted]#3'], 'literal');
  assert.equal(output['metadata_token=[redacted]'], '[redacted]');
  assert.equal(output['[reserved-key]'], 'proto-value');
  assert.equal(output['[reserved-key]#2'], 'constructor-value');
  assert.equal(output['[reserved-key]#3'], 'prototype-value');
  assert.equal(Object.hasOwn(output, '__proto__'), false);
  assert.equal(Object.hasOwn(output, 'constructor'), false);
  assert.equal(Object.hasOwn(output, 'prototype'), false);
  assert.doesNotMatch(serialized, new RegExp(`${githubA}|${githubB}|must-not-leak|sensitive-value`));
  assert.ok(Buffer.byteLength(serialized, 'utf8') <= preload.MCP_RESPONSE_BYTES);
});

test('text and nested JSON previews redact known token prefixes and PEM private keys', () => {
  const secrets = {
    githubFine: `github_pat_${'A'.repeat(40)}`,
    githubClassic: `ghp_${'B'.repeat(36)}`,
    openAiProject: `sk-proj-${'C'.repeat(32)}`,
    openAiLegacy: `sk-${'D'.repeat(32)}`,
    awsAccess: `AKIA${'E'.repeat(16)}`,
    awsSecret: 'aws_secret_access_key=abcdefghijklmnopqrstuvwxyz0123456789ABCD',
    pem: `-----BEGIN PRIVATE KEY-----\n${'F'.repeat(64)}\n-----END PRIVATE KEY-----`
  };
  const rawValues = Object.values(secrets);
  const textResult = preload.previewForMcp({ body: `visible\n${rawValues.join('\n')}`, contentType: 'text/plain' });
  const jsonResult = preload.previewForMcp({ body: JSON.stringify({ visible: true, nested: { values: rawValues } }), contentType: 'application/json' });
  for (const serialized of [JSON.stringify(textResult), JSON.stringify(jsonResult)]) {
    assert.match(serialized, /\[redacted/);
    for (const secret of rawValues) assert.equal(serialized.includes(secret), false);
    assert.doesNotMatch(serialized, /github_pat_|ghp_|sk-proj-|\bsk-[A-Z]|AKIA[A-Z0-9]{16}|BEGIN PRIVATE KEY|abcdefghijklmnopqrstuvwxyz0123456789ABCD/);
  }
  assert.match(JSON.stringify(textResult), /\[redacted-private-key\]/);
  assert.match(JSON.stringify(jsonResult), /"visible":true/);
});

test('payload preview enforces its 64 KiB serialized response boundary', () => {
  const large = {};
  let body = '{}';
  for (let index = 0; ; index += 1) {
    large[`field_${index}`] = 'v'.repeat(64);
    const next = JSON.stringify(large);
    if (Buffer.byteLength(next) > 65_520) { delete large[`field_${index}`]; break; }
    body = next;
  }
  assert.ok(Buffer.byteLength(body) > 65_000);
  const result = preload.previewForMcp({ body, contentType: 'application/json' });
  assert.equal(result.truncated, true);
  assert.equal(result.value, '[preview omitted: redacted output exceeds 64 KiB]');
  assert.doesNotMatch(result.value, /[\u3400-\u9fff]/);
  assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= preload.MCP_RESPONSE_BYTES);
});

test('strict runtime validation rejects unknown fields, hostile prototypes and accessors', () => {
  assert.throws(() => preload.hmacForMcp({ body: 'x', secret: 's', start: true }), { code: 'INVALID_TOOL_INPUT' });
  assert.throws(() => preload.previewForMcp({ body: 'x', listener: 'start' }), { code: 'INVALID_TOOL_INPUT' });
  assert.throws(() => preload.previewForMcp(JSON.parse('{"body":"x","__proto__":{}}')), { code: 'INVALID_TOOL_INPUT' });
  assert.throws(() => preload.previewForMcp(Object.assign(Object.create({ inherited: true }), { body: 'x' })), { code: 'INVALID_TOOL_INPUT' });
  const accessor = {};
  Object.defineProperty(accessor, 'body', { enumerable: true, get() { throw new Error('must not execute'); } });
  assert.throws(() => preload.previewForMcp(accessor), { code: 'INVALID_TOOL_INPUT' });
  const symbol = { body: 'x' };
  symbol[Symbol('hidden')] = true;
  assert.throws(() => preload.previewForMcp(symbol), { code: 'INVALID_TOOL_INPUT' });
  const safeNullPrototype = Object.assign(Object.create(null), { body: 'x', secret: 's' });
  assert.equal(preload.hmacForMcp(safeNullPrototype).digest.length, 64);
  assert.throws(() => preload.previewForMcp({ body: 'x', contentType: '汉'.repeat(86) }), { code: 'INVALID_TOOL_INPUT' });
  const previousBody = Object.getOwnPropertyDescriptor(Object.prototype, 'body');
  Object.defineProperty(Object.prototype, 'body', { value: 'inherited-body', configurable: true });
  try {
    assert.throws(() => preload.hmacForMcp({ secret: 's' }), { code: 'INVALID_TOOL_INPUT' });
  } finally {
    if (previousBody) Object.defineProperty(Object.prototype, 'body', previousBody);
    else delete Object.prototype.body;
  }
});

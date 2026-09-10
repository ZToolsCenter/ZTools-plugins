import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preload = require('../preload/index.cjs');
const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));

test('manifest declarations and native registrations stay one-to-one', () => {
  const handlers = new Map();
  const target = { ztools: { registerTool(name, handler) { handlers.set(name, handler); } } };
  preload.attachShareSanitizer(target);
  assert.deepEqual([...handlers.keys()].sort(), Object.keys(manifest.tools).sort());
  assert.equal(manifest.tools.detect_text.inputSchema.properties.text.maxLength, preload.MCP_TEXT_BYTES);
  assert.equal(manifest.tools.redact_text.inputSchema.properties.text.maxLength, preload.MCP_REDACT_TEXT_BYTES);
  assert.equal(typeof target.shareSanitizer, 'object');
});

test('older hosts degrade to the unchanged human bridge', () => {
  const copied = [];
  const target = { ztools: { copyText(value) { copied.push(value); } } };
  assert.doesNotThrow(() => preload.attachShareSanitizer(target));
  target.shareSanitizer.copyText('ok');
  assert.deepEqual(copied, ['ok']);
});

test('one failed registration does not block the UI or the other tool', () => {
  const names = [];
  const target = { ztools: { registerTool(name) { if (name === 'detect_text') throw Error('unsupported'); names.push(name); } } };
  assert.doesNotThrow(() => preload.attachShareSanitizer(target));
  assert.equal(typeof target.shareSanitizer, 'object');
  assert.deepEqual(names, ['redact_text']);
});

test('detect handler never returns matched values', async () => {
  const result = await preload.detectForMcp({ text: 'mail a@b.com and token=abcdefghijklmnop' });
  assert.equal(result.counts.total, result.findings.length);
  assert.equal(result.counts.returned, result.findings.length);
  assert.equal(result.truncated, false);
  assert.ok(result.findings.length >= 2);
  assert.ok(result.findings.every((item) => Object.keys(item).sort().join(',') === 'confidence,end,start,type'));
  assert.doesNotMatch(JSON.stringify(result), /a@b\.com|abcdefghijklmnop/);
});

test('redact handler and documentation agree that whitelisted text is preserved only in output text', async () => {
  const result = await preload.redactForMcp({ text: 'safe@x.com bad@y.com', whitelist: ['safe@x.com'], replacement: '***', enabled: { email: true, jwt: false } });
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  assert.equal(result.text, 'safe@x.com ***');
  assert.equal(result.counts.total, 1);
  assert.equal(Object.hasOwn(result.findings[0], 'value'), false);
  assert.doesNotMatch(JSON.stringify(result.findings), /safe@x\.com|bad@y\.com/);
  assert.match(readme, /白名单中的值则会按设计原样保留/);
  assert.match(readme, /必须控制清理后文本的传播范围/);
});

test('strict MCP validation rejects unknown, hostile and oversized input', async () => {
  await assert.rejects(preload.detectForMcp({ text: 'x', maxInput: 2 }), { code: 'INVALID_TOOL_INPUT' });
  await assert.rejects(preload.detectForMcp({ text: 'x', enabled: { unknown: true } }), { code: 'INVALID_TOOL_INPUT' });
  await assert.rejects(preload.detectForMcp({ text: 'x', enabled: { email: 'yes' } }), { code: 'INVALID_TOOL_INPUT' });
  await assert.rejects(preload.detectForMcp(JSON.parse('{"text":"x","__proto__":{}}')), { code: 'INVALID_TOOL_INPUT' });
  await assert.rejects(preload.detectForMcp(Object.create({ text: 'inherited' })), { code: 'INVALID_TOOL_INPUT' });
  await assert.rejects(preload.detectForMcp({ text: 'x'.repeat(512 * 1024 + 1) }), { code: 'INVALID_TOOL_INPUT' });
  await assert.rejects(preload.redactForMcp({ text: 'x', replacement: 'r'.repeat(65) }), { code: 'INVALID_TOOL_INPUT' });
  await assert.rejects(preload.redactForMcp({ text: 'bad@y.com', replacement: 'bad@y.com', enabled: { email: true } }), (error) => error?.code === 'INVALID_TOOL_INPUT' && /replacement 不能包含/.test(error.message));
  await assert.rejects(preload.redactForMcp({ text: 'a@b.com/abcdefghijkl', replacement: 'Bearer ', enabled: { email: true, bearer: true, phone_cn: false, ipv4: false, win_path: false, posix_path: false, api_key: false, jwt: false, id_cn: false } }), (error) => error?.code === 'INVALID_TOOL_INPUT' && /脱敏后的文本仍包含/.test(error.message));
  await assert.rejects(preload.detectForMcp({ text: 'x', whitelist: Array.from({ length: 201 }, () => 'x') }), { code: 'INVALID_TOOL_INPUT' });
  await assert.rejects(preload.redactForMcp({ text: 'x'.repeat(448 * 1024 + 1) }), { code: 'INVALID_TOOL_INPUT' });
  await assert.rejects(preload.detectForMcp({ text: 'x', whitelist: Array.from({ length: 17 }, () => 'w'.repeat(4096)) }), { code: 'INVALID_TOOL_INPUT' });
  await assert.rejects(preload.detectForMcp({ text: String.fromCharCode(0).repeat(200 * 1024) }), { code: 'INVALID_TOOL_INPUT' });
});

test('redact handler fully cleans match 501 while bounding returned evidence', async () => {
  const secrets = Array.from({ length: 501 }, (_, index) => `person${index}@x.example`);
  const result = await preload.redactForMcp({
    text: secrets.join(' '),
    replacement: '***',
    enabled: { email: true, phone_cn: false, ipv4: false, win_path: false, posix_path: false, bearer: false, api_key: false, jwt: false, id_cn: false }
  });
  assert.equal(result.counts.total, 501);
  assert.equal(result.counts.returned, 500);
  assert.equal(result.findings.length, 500);
  assert.equal(result.truncated, true);
  assert.equal(result.text.split('***').length - 1, 501);
  assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= preload.MCP_RESPONSE_BYTES);
  for (const secret of secrets) assert.equal(result.text.includes(secret), false);
});

test('detect handler declares truncated evidence instead of implying 500 is the total', async () => {
  const result = await preload.detectForMcp({
    text: Array.from({ length: 501 }, (_, index) => `person${index}@x.example`).join(' '),
    enabled: { email: true, phone_cn: false, ipv4: false, win_path: false, posix_path: false, bearer: false, api_key: false, jwt: false, id_cn: false }
  });
  assert.equal(result.counts.total, null);
  assert.equal(result.counts.returned, 500);
  assert.equal(result.counts.totalAtLeast, 501);
  assert.equal(result.truncated, true);
});

test('redact handler rejects serialized response amplification without returning text', async () => {
  const repeatedEmail = Array.from({ length: 9000 }, () => 'a@b.co').join(' ');
  await assert.rejects(
    preload.redactForMcp({ text: repeatedEmail, replacement: 'r'.repeat(64), enabled: { email: true } }),
    (error) => error?.code === 'INVALID_TOOL_INPUT' && /工具响应超过 512 KiB 的 MCP 上限/.test(error.message)
  );
  const escapedReplacement = String.fromCharCode(0).repeat(64);
  const escapedExpansion = Array.from({ length: 2000 }, () => 'a@b.co').join(' ');
  await assert.rejects(
    preload.redactForMcp({ text: escapedExpansion, replacement: escapedReplacement, enabled: { email: true } }),
    (error) => error?.code === 'INVALID_TOOL_INPUT' && /工具响应超过 512 KiB 的 MCP 上限/.test(error.message)
  );
});

test('redact handler refuses inputs that exceed complete redaction capacity', async () => {
  const source = Array.from({ length: 10001 }, (_, index) => `p${index}@x.co`).join(' ');
  await assert.rejects(
    preload.redactForMcp({ text: source, enabled: { email: true } }),
    (error) => error?.code === 'INVALID_TOOL_INPUT' && /10,000 项完整脱敏安全上限/.test(error.message)
  );
});

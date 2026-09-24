const { test } = require('node:test');
const assert = require('node:assert/strict');
const codec = require('../codec.js');

test('exposes browser API even when Electron also exposes CommonJS', () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const context = { window: {}, module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../codec.js'), 'utf8'), context);
  assert.equal(typeof context.Base64Codec.decode, 'function');
  assert.equal(context.Base64Codec, context.module.exports);
});

test('UTF-8 round trip preserves Chinese, emoji, whitespace and BOM', () => {
  for (const value of ['Hello Base64', '你好，世界 🌏\n第二行\t  ', '\uFEFF正文', ' ']) {
    assert.equal(codec.encodeText(value), Buffer.from(value).toString('base64'));
    assert.equal(codec.decode(codec.encodeText(value)).text, value);
  }
});
test('accepts whitespace, URL-safe, missing padding and Data URLs', () => {
  assert.equal(codec.decode(' SGVs\nbG8= ').text, 'Hello');
  assert.equal(codec.decode('SGVsbG8').text, 'Hello');
  assert.equal(codec.decode(Buffer.from('😀').toString('base64url')).text, '😀');
  assert.equal(codec.decode('data:text/plain;charset=utf-8;base64,5Lit5paH').text, '中文');
});
test('rejects malformed, truncated, non-canonical and binary data', () => {
  for (const value of ['', 'A', 'SGV$sbG8=', 'SGV=sbG8', 'Zg=', 'Z===', 'Zh==', '+_==', 'data:text/plain,hello', '//79', 'AA==']) {
    assert.throws(() => codec.decode(value), undefined, value);
  }
});
test('detects image bytes even without or with misleading MIME', () => {
  const signatures = [
    ['89504e470d0a1a0a', 'image/png'], ['ffd8ffe0', 'image/jpeg'],
    ['474946383961', 'image/gif'], ['524946460000000057454250', 'image/webp'],
    ['424d0000', 'image/bmp'], ['00000100', 'image/x-icon'],
    ['000000206674797061766966', 'image/avif']
  ];
  for (const [hex, mime] of signatures) {
    const bytes = Buffer.from(hex, 'hex');
    const result = codec.decode(`data:text/plain;base64,${bytes.toString('base64')}`);
    assert.equal(result.mime, mime);
    assert.deepEqual(Buffer.from(result.bytes), bytes);
  }
  assert.equal(codec.decode(codec.encodeText('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>')).mime, 'image/svg+xml');
  assert.equal(codec.decode('data:image/png;base64,SGVsbG8=').kind, 'text');
});
test('encodes larger files without argument overflow and enforces size limit', () => {
  const bytes = new Uint8Array(100000).fill(255);
  assert.deepEqual(codec.parse(codec.encodeBytes(bytes)).bytes, bytes);
  assert.throws(() => codec.checkSize(codec.MAX_BYTES + 1), /20 MB/);
});

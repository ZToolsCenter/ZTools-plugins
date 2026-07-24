'use strict';
const assert = require('assert');
const core = require(require('path').join(__dirname, '../uuid-core.js'));
const vec = require(require('path').join(__dirname, 'uuid_vectors.json'));

// 1. Built-in selftest (KATs embedded in the plugin itself).
core.selftest();

// 2. Every python-generated codec vector, all directions.
for (const v of vec.codecs) {
  const hex = v.hex32;
  const enc = core.encodeAll(hex);
  for (const key of ['uuid', 'hex32', 'base62', 'base57', 'base58', 'base64url']) {
    assert.strictEqual(enc[key], v[key], `encode ${key} of ${v.uuid}`);
  }
  for (const c of core.CODECS) {
    assert.strictEqual(c.decode(v[c.id]), hex, `decode ${c.id} of ${v.uuid}`);
  }
}

// 3. Named generation + uid derivation vs python.
const N = core.NAMESPACES;
assert.strictEqual(core.formatUuid(core.generate(3, {namespace: N.dns, name: 'example.com'})), vec.v3_dns_example);
assert.strictEqual(core.formatUuid(core.generate(5, {namespace: N.dns, name: 'example.com'})), vec.v5_dns_example);
assert.strictEqual(core.formatUuid(core.generate(3, {namespace: N.url, name: 'https://hello'})), vec.v3_url_hello);
assert.strictEqual(core.formatUuid(core.generate(5, {namespace: N.url, name: 'https://hello'})), vec.v5_url_hello);
for (const [k, want] of Object.entries(vec.namespaces)) {
  assert.strictEqual(core.formatUuid(N[k]), want, `namespace ${k}`);
}

// 4. Hashes vs node crypto: padding boundaries (55/56/63/64) + unicode + long.
const te = new TextEncoder();
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const crypto = require('crypto');
for (const s of ['', 'abc', 'x'.repeat(1000), 'y'.repeat(63), 'z'.repeat(64), '\u4e2d\u6587\u6d4b\u8bd5\ud83c\udf89', 'a'.repeat(55), 'b'.repeat(56), 'c'.repeat(119), 'd'.repeat(120)]) {
  const m = te.encode(s);
  assert.strictEqual(hex(core.md5Bytes(m)), crypto.createHash('md5').update(m).digest('hex'), 'md5 len=' + m.length);
  assert.strictEqual(hex(core.sha1Bytes(m)), crypto.createHash('sha1').update(m).digest('hex'), 'sha1 len=' + m.length);
}

// 5. Randomized cross-codec roundtrip + detection sanity (500 uuids).
for (let i = 0; i < 500; i++) {
  const h = core.generate(4, {});
  for (const c of core.CODECS) assert.strictEqual(c.decode(c.encode(h)), h, 'rt ' + c.id);
  const hits = core.detectShort(core.encodeAll(h).base62);
  assert.strictEqual(hits[0].codec, 'base62');
  assert.strictEqual(hits[0].hex32, h);
}

// 6. v1/v6/v7 monotonic timestamps + same-ms counter behavior.
const t0 = 1752825600000;
const a = core.inspect(core.generate(7, {nowMs: t0}));
const b = core.inspect(core.generate(7, {nowMs: t0 + 5}));
assert.ok(b.timeMs - a.timeMs === 5);
const v1a = core.generate(1, {nowMs: t0});
const v1b = core.generate(1, {nowMs: t0});
assert.notStrictEqual(v1a, v1b, 'same-ms v1 must differ via counter');

console.log('ALL TESTS PASSED');

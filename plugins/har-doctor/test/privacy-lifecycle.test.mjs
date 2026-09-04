import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { analyze, classifyPii, redact, redactUrl } from '../src/core/analyze.js';

const require = createRequire(import.meta.url);
const preload = require('../src/preload/index.cjs');
const fixture = fileURLToPath(new URL('./fixtures/sample.har', import.meta.url));
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('privacy projection stably anonymizes hostnames and path identities', () => {
  const values = [
    'internal.example.com',
    'alice',
    'acme-corp',
    '18812345678',
    '11010519491231002X',
    '192.168.10.24',
    'alice@example.com',
    '1234567890abcdef1234567890abcdef',
    'tenant-omega'
  ];
  const raw = `https://internal.example.com/api/v1/users/alice/tenants/acme-corp/phones/18812345678/ids/11010519491231002X/ips/192.168.10.24/emails/alice@example.com/orders/1234567890abcdef1234567890abcdef/tenant-omega?access_token=do-not-export`;
  const clean = redactUrl(raw);
  const repeated = redactUrl(raw);
  const changedHost = redactUrl(raw.replace('internal.example.com', 'staging.internal.example.com'));
  const parsed = new URL(clean);
  assert.equal(clean, repeated);
  assert.notEqual(parsed.hostname, new URL(changedHost).hostname);
  assert.match(parsed.hostname, /^host-[a-f0-9]{32}\.invalid$/);
  assert.match(decodeURIComponent(parsed.pathname), /^\/api\/v1\/users\/\[user-/);
  assert.match(decodeURIComponent(parsed.pathname), /\/tenants\/\[tenant-/);
  assert.match(decodeURIComponent(parsed.pathname), /\/phones\/\[phone-/);
  assert.match(decodeURIComponent(parsed.pathname), /\/ids\/\[identity-/);
  assert.match(decodeURIComponent(parsed.pathname), /\/ips\/\[ip-/);
  assert.match(decodeURIComponent(parsed.pathname), /\/emails\/\[email-/);
  assert.match(decodeURIComponent(parsed.pathname), /\/orders\/\[id-/);
  assert.match(decodeURIComponent(parsed.pathname), /\/\[tenant-/);
  for (const value of values) assert.equal(clean.includes(value), false, `URL leaked ${value}`);
  const report = analyze({ log: { entries: [{ time: 1500, request: { url: raw, method: 'GET' }, response: { status: 500 } }] } });
  const exported = JSON.stringify(redact(report));
  for (const value of values) assert.equal(exported.includes(value), false, `report leaked ${value}`);
  assert.equal(exported.includes('do-not-export'), false);
});

test('privacy classifier covers query names, short aliases, tenants, compressed IPv6 and invalid bases', () => {
  const secrets = ['alice', 'bob', 'acme', '2001:db8::7', 'internal.example.com', 'alice@example.com', '18812345678', '11010519491231002X'];
  const raw = 'https://internal.example.com/u/alice/@bob/t/acme/ips/2001:db8::7?alice@example.com=value&2001%3Adb8%3A%3A7=value&safe=value&internal.example.com=value&alice=value&bob=value&acme=value';
  const clean = redactUrl(raw);
  const parsed = new URL(clean);
  for (const secret of secrets) assert.equal(clean.includes(secret), false, `URL leaked ${secret}`);
  assert.match(decodeURIComponent(parsed.pathname), /\/u\/\[user-/);
  assert.match(decodeURIComponent(parsed.pathname), /\/\[user-/);
  assert.match(decodeURIComponent(parsed.pathname), /\/t\/\[tenant-/);
  assert.match(decodeURIComponent(parsed.pathname), /\/ips\/\[ip-/);
  assert.ok([...parsed.searchParams.keys()].every((key) => /^\[query-[a-f0-9]{32}\]$/.test(key)));
  assert.equal(classifyPii('2001:db8::7'), 'ip');
  assert.equal(classifyPii('@bob'), 'user');
  assert.equal(classifyPii('acme', 't'), 'tenant');

  const invalid = redactUrl('internal.example.com/u/alice/2001:db8::7?alice@example.com=value');
  assert.equal(invalid.includes('internal.example.com'), false);
  assert.equal(invalid.includes('alice'), false);
  assert.equal(invalid.includes('2001:db8'), false);
  assert.equal(invalid.split('?')[0].split('/').length, 'internal.example.com/u/alice/2001:db8::7'.split('/').length);
});

test('method and MIME projections cannot echo hostile HAR fields, and ids remain distinct', () => {
  const left = redactUrl('https://private.example/u/alice');
  const right = redactUrl('https://private.example/u/bob');
  assert.notEqual(left, right);
  const report = analyze({ log: { entries: [{
    time: 1,
    request: { url: 'https://internal.example.com/u/alice', method: 'GET alice@example.com 2001:db8::7' },
    response: { status: 500, content: { mimeType: 'application/alice@example.com; token=do-not-export' } }
  }] } });
  const surface = JSON.stringify(redact(report));
  for (const value of ['internal.example.com', 'alice', 'alice@example.com', '2001:db8::7', 'do-not-export']) assert.equal(surface.includes(value), false, `report leaked ${value}`);
  assert.equal(report.errors[0].method, 'OTHER');
  assert.deepEqual(Object.keys(report.types), ['unknown']);
});

test('file grants close proactively once, reset on replacement, and cancel for all session exits', async () => {
  preload.__testClear();
  preload.__testSetGrantTtl(100);
  try {
    preload.__testGrant([fixture]);
    const first = preload.__testGrants()[0];
    assert.equal(preload.__testHasGrantTimer(), true);
    await wait(60);
    preload.__testGrant([fixture]);
    const replacement = preload.__testGrants()[0];
    assert.equal(first.closed, true);
    await wait(60);
    assert.doesNotThrow(() => fs.fstatSync(replacement.fd));
    await wait(70);
    assert.equal(preload.__testGrants().length, 0);
    assert.equal(preload.__testHasGrantTimer(), false);
    assert.throws(() => fs.fstatSync(replacement.fd), { code: 'EBADF' });

    preload.__testSetGrantTtl(1000);
    preload.__testGrant([fixture]);
    const consumed = preload.__testGrants()[0];
    preload.readGranted();
    assert.equal(preload.__testHasGrantTimer(), false);
    assert.throws(() => fs.fstatSync(consumed.fd), { code: 'EBADF' });

    let onPluginOut;
    const bridge = preload.bridge({ onPluginOut(listener) { onPluginOut = listener; } });
    preload.__testGrant([fixture]);
    const exited = preload.__testGrants()[0];
    onPluginOut();
    assert.equal(preload.__testGrants().length, 0);
    assert.equal(preload.__testHasGrantTimer(), false);
    assert.throws(() => fs.fstatSync(exited.fd), { code: 'EBADF' });

    let resolveDialog;
    const choosing = preload.bridge({
      onPluginOut(listener) { onPluginOut = listener; },
      showOpenDialog: () => new Promise((resolve) => { resolveDialog = resolve; })
    }).choose();
    onPluginOut();
    resolveDialog({ filePaths: [fixture] });
    await assert.rejects(choosing, { code: 'SESSION_EXPIRED' });
    assert.equal(preload.__testGrants().length, 0);
    assert.equal(preload.__testHasGrantTimer(), false);
  } finally {
    preload.__testClear();
    preload.__testResetGrantTtl();
  }
});

test('failed descriptor close revokes authorization and retries without exposing the file path', () => {
  preload.__testClear();
  let failOnce = true;
  preload.__testSetCloseSync((fd) => {
    if (failOnce) {
      failOnce = false;
      const error = new Error('simulated close failure');
      error.code = 'EIO';
      throw error;
    }
    return fs.closeSync(fd);
  });
  try {
    preload.__testGrant([fixture]);
    const record = preload.__testGrants()[0];
    preload.__testClear();
    assert.equal(preload.__testGrants().length, 0);
    assert.equal(preload.__testPendingCloses().length, 1);
    assert.deepEqual(Object.keys(preload.__testPendingCloses()[0]).sort(), ['closeFailed', 'closed', 'fd']);
    assert.equal(Object.hasOwn(preload.__testPendingCloses()[0], 'real'), false);
    assert.doesNotThrow(() => fs.fstatSync(record.fd));
    assert.throws(() => preload.readGranted(), { code: 'FILE_APPROVAL_REQUIRED' });
    preload.__testClear();
    assert.equal(preload.__testPendingCloses().length, 0);
    assert.throws(() => fs.fstatSync(record.fd), { code: 'EBADF' });
  } finally {
    preload.__testResetCloseSync();
    preload.__testRetryPendingCloses();
    preload.__testClear();
  }
});

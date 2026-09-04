import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { pathRedactionHar } from './path-redaction-fixture.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preload = require('../src/preload/index.cjs');
const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
const fixture = fileURLToPath(new URL('./fixtures/sample.har', import.meta.url));

function inlineHar(count = 3) {
  return JSON.stringify({ log: { entries: Array.from({ length: count }, (_, index) => ({
    time: 1200 + index,
    request: { url: `https://example.test/${'x'.repeat(2500)}?token=raw-secret-${index}`, method: 'GET', headers: [{ name: 'Authorization', value: 'Bearer raw-secret' }] },
    response: { status: 500, bodySize: 100, headers: [], content: { mimeType: `application/type-${index}` } }
  })) } });
}

function responsePressureHar(marker) {
  return JSON.stringify({ log: { entries: Array.from({ length: 50 }, (_, index) => ({
    time: 1200 + index,
    request: { url: `https://pressure.test/${marker}/${'x'.repeat(7000)}/${index}`, method: index === 49 ? '密'.repeat(1000) : 'GET', headers: [{ name: 'Origin', value: 'https://client.test' }] },
    response: { status: index % 2 ? 500 : 302, bodySize: 100, headers: [{ name: 'cache-control', value: 'max-age=1' }], content: { mimeType: `application/type-${index}` } }
  })) } });
}

function crossSegmentPemHar() {
  const afterToken = `github_pat_${'v'.repeat(24)}`;
  const completeBegin = encodeURIComponent('-----BEGIN PRIVATE KEY-----\nQUJD');
  const completeEnd = encodeURIComponent(`-----END PRIVATE KEY-----visible-suffix-${afterToken}`);
  const truncatedBegin = encodeURIComponent('-----BEGIN RSA PRIVATE KEY-----\nREVG');
  const completeUrl = `https://safe.test/safe%2Fboundary/${completeBegin}/COMPLETE_TAIL_A/COMPLETE_TAIL_B/${completeEnd}/normal?safe=one&safe=two`;
  const truncatedUrl = `https://safe.test/safe%2Fboundary/${truncatedBegin}/TRUNC_TAIL_A/TRUNC_TAIL_B/AFTER_TAIL?safe=one&safe=two`;
  const value = { log: { entries: [completeUrl, truncatedUrl].map((url, index) => ({ time: 1600 - index * 100, request: { url, method: 'GET', headers: [] }, response: { status: 500, bodySize: 10, headers: [], content: { mimeType: 'application/json' } } })) } };
  return { value, urls: [completeUrl, truncatedUrl], secrets: ['BEGIN PRIVATE KEY', 'BEGIN RSA PRIVATE KEY', 'END PRIVATE KEY', 'COMPLETE_TAIL_A', 'COMPLETE_TAIL_B', 'TRUNC_TAIL_A', 'TRUNC_TAIL_B', 'AFTER_TAIL', afterToken] };
}

function anonymousQueryEntries(value) {
  const query = String(value).split('?')[1] || '';
  const entries = [...new URLSearchParams(query).entries()];
  for (const [key, item] of entries) {
    assert.match(key, /^(?:\[query-[a-f0-9]{32}\]|redacted)$/);
    assert.equal(item, '[redacted]');
  }
  return entries;
}

function assertCrossSegmentMcpResult(result, fixture) {
  const report = result.reports[0];
  const serialized = JSON.stringify(result);
  assert.equal(report.metrics.entries, 2);
  assert.equal(report.totals.errors, 2);
  assert.equal(report.details.errors.length, 2);
  for (const secret of fixture.secrets) assert.equal(serialized.includes(secret), false);
  for (let index = 0; index < fixture.urls.length; index += 1) {
    const raw = new URL(fixture.urls[index]);
    const clean = new URL(report.details.errors[index].url);
    assert.equal(clean.pathname.split('/').length, raw.pathname.split('/').length);
    assert.equal(clean.pathname.split('/')[1], 'safe%2Fboundary');
    const entries = anonymousQueryEntries(clean);
    assert.equal(entries.length, 2);
    assert.equal(entries[0][0], entries[1][0]);
  }
  assert.match(decodeURIComponent(new URL(report.details.errors[0].url).pathname), /visible-suffix-/);
  assert.doesNotMatch(decodeURIComponent(new URL(report.details.errors[1].url).pathname), /AFTER_TAIL/);
}

function assertPathRedactionMcpResult(result, fixture) {
  const report = result.reports[0];
  const serialized = JSON.stringify(result);
  const surface = [...report.details.errors.map((item) => decodeURIComponent(item.url)), ...report.details.errors.map((item) => item.method)].join('\n');
  assert.equal(report.metrics.entries, fixture.cases.length);
  assert.equal(report.metrics.invalidUrls, 3);
  assert.equal(report.totals.errors, fixture.cases.length);
  assert.equal(report.totals.slow, fixture.cases.length);
  assert.equal(report.details.errors.length, fixture.cases.length);
  for (const secret of fixture.forbidden) {
    assert.equal(serialized.includes(secret), false, `MCP JSON leaked ${secret}`);
    assert.equal(surface.includes(secret), false, `MCP waterfall leaked ${secret}`);
  }
  fixture.cases.forEach((item, index) => {
    const clean = report.details.errors[index].url;
    for (const visible of item.visible) assert.equal(decodeURIComponent(clean).includes(visible), true, `${item.name} lost ${visible}`);
    for (const visible of item.methodVisible || []) assert.equal(report.details.errors[index].method.includes(visible), true, `${item.name} method lost ${visible}`);
    const rawBase = item.url.replace(/#[\s\S]*$/, '').split('?')[0];
    const cleanBase = clean.split('?')[0];
    assert.equal(cleanBase.split('/').length, rawBase.split('/').length, `${item.name} changed path topology`);
    if (item.name === 'surrogate') assert.match(cleanBase, /\/%5Bredacted%5D\//);
    if (item.valid) {
      const rawUrl = new URL(item.url);
      const cleanUrl = new URL(clean);
      assert.equal(cleanUrl.pathname.split('/').length, rawUrl.pathname.split('/').length);
      assert.equal(cleanUrl.pathname.split('/')[1], 'safe%2Fboundary');
      const entries = anonymousQueryEntries(cleanUrl);
      const expectedQueryCount = (item.url.split('?')[1] || '').split('#')[0].split('&').filter(Boolean).length;
      assert.equal(entries.length, expectedQueryCount);
      assert.equal(entries[0][0], entries[1][0]);
      assert.notEqual(entries[0][0], entries[2][0]);
      assert.equal([...cleanUrl.searchParams.keys()].some((key) => key.includes(fixture.queryToken)), false);
    } else {
      const entries = anonymousQueryEntries(clean);
      const expectedQueryCount = (item.url.split('?')[1] || '').split('#')[0].split('&').filter(Boolean).length;
      assert.equal(entries.length, expectedQueryCount);
      assert.equal(entries[0][0], entries[1][0]);
      assert.notEqual(entries[0][0], entries[2][0]);
    }
  });
}

function stableMachineError(code, message, ...forbidden) {
  return (error) => {
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    for (const value of forbidden) assert.equal(error.message.includes(String(value)), false);
    return true;
  };
}

test('manifest declarations and native registrations stay one-to-one', () => {
  const handlers = new Map();
  preload.bridge({ registerTool(name, handler) { handlers.set(name, handler); } });
  assert.deepEqual([...handlers.keys()].sort(), Object.keys(manifest.tools).sort());
  assert.equal(typeof handlers.get('analyze_inline'), 'function');
  assert.equal(typeof handlers.get('analyze_approved_files'), 'function');
});

test('one failed registration does not block the UI or the other tool', () => {
  const names = [];
  const bridge = preload.bridge({ registerTool(name) { if (name === 'analyze_inline') throw Error('unsupported'); names.push(name); } });
  assert.equal(typeof bridge.choose, 'function');
  assert.deepEqual(names, ['analyze_approved_files']);
});

test('older hosts gracefully retain the human bridge', () => {
  const bridge = preload.bridge({});
  assert.equal(typeof bridge.choose, 'function');
  assert.equal(typeof bridge.previewGranted, 'function');
});

test('inline handler returns bounded redacted details and totals', async () => {
  const result = await preload.analyzeInlineForMcp({ har: inlineHar(), detailLimit: 1 });
  const report = result.reports[0];
  assert.equal(report.totals.errors, 3);
  assert.equal(report.details.errors.length, 1);
  assert.equal(report.truncation.errors, true);
  assert.ok(Buffer.byteLength(report.details.errors[0].url, 'utf8') <= 1024);
  assert.doesNotMatch(JSON.stringify(result), /raw-secret|Authorization|Bearer/);
  assert.doesNotMatch(JSON.stringify(result), /"log"\s*:/);
});

test('inline comparison uses the shared diff and Markdown core', async () => {
  const result = await preload.analyzeInlineForMcp({ har: inlineHar(1), compareHar: inlineHar(2), detailLimit: 2 });
  assert.equal(result.diff.entries, 1);
  assert.match(result.markdown, /HAR 诊断报告/);
});

test('approved handler consumes and closes the UI file grant exactly once', async () => {
  preload.__testGrant([fixture]);
  const record = preload.__testGrants()[0];
  const result = await preload.analyzeApprovedForMcp({ detailLimit: 5 });
  assert.equal(result.reports.length, 1);
  assert.equal(preload.__testGrants().length, 0);
  assert.throws(() => fs.fstatSync(record.fd), { code: 'EBADF' });
  await assert.rejects(preload.analyzeApprovedForMcp({}), { code: 'FILE_APPROVAL_REQUIRED' });
});

test('real choose and UI preview preserve one grant for MCP before closing it exactly once', async () => {
  const handlers = new Map();
  const bridge = preload.bridge({
    showOpenDialog: async () => ({ filePaths: [fixture] }),
    registerTool(name, handler) { handlers.set(name, handler); }
  });
  assert.deepEqual(await bridge.choose(), [path.basename(fixture)]);
  const record = preload.__testGrants()[0];
  const preview = bridge.previewGranted();
  assert.equal(preview.length, 1);
  assert.equal(preload.__testGrants().length, 1);
  assert.doesNotThrow(() => fs.fstatSync(record.fd));
  const appSource = await readFile(path.join(root, 'src', 'main', 'app.js'), 'utf8');
  assert.match(appSource, /previewGranted/);
  assert.doesNotMatch(appSource, /\.readGranted/);
  const result = await handlers.get('analyze_approved_files')({ detailLimit: 5 });
  assert.equal(result.reports.length, 1);
  assert.equal(preload.__testGrants().length, 0);
  assert.throws(() => fs.fstatSync(record.fd), { code: 'EBADF' });
  await assert.rejects(handlers.get('analyze_approved_files')({}), stableMachineError('FILE_APPROVAL_REQUIRED', 'Select one or two HAR files in the HAR Doctor UI first.'));
});

test('plugin out expires a pending file chooser and cannot restore its UI or MCP grant', async () => {
  const handlers = new Map();
  let resolveDialog;
  let onPluginOut;
  const bridge = preload.bridge({
    showOpenDialog: () => new Promise((resolve) => { resolveDialog = resolve; }),
    onPluginOut(listener) { onPluginOut = listener; },
    registerTool(name, handler) { handlers.set(name, handler); }
  });
  const choosing = bridge.choose();
  onPluginOut();
  resolveDialog({ filePaths: [fixture] });
  await assert.rejects(choosing, { code: 'SESSION_EXPIRED' });
  assert.equal(preload.__testGrants().length, 0);
  await assert.rejects(handlers.get('analyze_approved_files')({}), stableMachineError('FILE_APPROVAL_REQUIRED', 'Select one or two HAR files in the HAR Doctor UI first.'));
});

test('approved handler rejects same-inode same-size rewrites even when mtime is restored', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'har-identity-rewrite-'));
  const file = path.join(directory, 'identity.har');
  const beforeText = inlineHar(1);
  const afterText = beforeText.replace('GET', 'PUT');
  assert.equal(Buffer.byteLength(beforeText), Buffer.byteLength(afterText));
  await writeFile(file, beforeText);
  preload.__testGrant([file]);
  const record = preload.__testGrants()[0];
  const original = fs.statSync(file);
  fs.writeFileSync(file, afterText);
  fs.utimesSync(file, original.atime, original.mtime);
  const changed = fs.statSync(file);
  assert.equal(changed.ino, original.ino);
  assert.equal(changed.size, original.size);
  record.mtimeMs = changed.mtimeMs;
  assert.notEqual(changed.ctimeMs, record.ctimeMs);
  await assert.rejects(preload.analyzeApprovedForMcp({}), stableMachineError('APPROVED_HAR_FAILED', 'Approved HAR analysis failed.', file));
  assert.equal(preload.__testGrants().length, 0);
  assert.throws(() => fs.fstatSync(record.fd), { code: 'EBADF' });
});

test('approved handler rejects a path replacement that diverges from the open handle', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'har-path-replacement-'));
  const file = path.join(directory, 'selected.har');
  const moved = path.join(directory, 'moved.har');
  const text = inlineHar(1);
  await writeFile(file, text);
  preload.__testGrant([file]);
  const record = preload.__testGrants()[0];
  fs.renameSync(file, moved);
  fs.writeFileSync(file, text);
  await assert.rejects(preload.analyzeApprovedForMcp({}), stableMachineError('APPROVED_HAR_FAILED', 'Approved HAR analysis failed.', file, moved));
  assert.equal(preload.__testGrants().length, 0);
  assert.throws(() => fs.fstatSync(record.fd), { code: 'EBADF' });
});

test('approved handler rejects a same-size rewrite during a bounded descriptor read', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'har-mid-read-rewrite-'));
  const file = path.join(directory, 'mid-read.har');
  const beforeText = inlineHar(3);
  const afterText = beforeText.replace('GET', 'PUT');
  assert.equal(Buffer.byteLength(beforeText), Buffer.byteLength(afterText));
  await writeFile(file, beforeText);
  preload.__testGrant([file]);
  const record = preload.__testGrants()[0];
  const original = fs.statSync(file);
  const originalRead = fs.readSync;
  let rewritten = false;
  fs.readSync = function patchedRead(fd, buffer, offset, length, position) {
    const count = originalRead.call(this, fd, buffer, offset, Math.min(length, 64), position);
    if (!rewritten) {
      rewritten = true;
      fs.writeFileSync(file, afterText);
      fs.utimesSync(file, original.atime, original.mtime);
    }
    return count;
  };
  try {
    await assert.rejects(preload.analyzeApprovedForMcp({}), stableMachineError('APPROVED_HAR_FAILED', 'Approved HAR analysis failed.', file));
  } finally {
    fs.readSync = originalRead;
  }
  assert.equal(rewritten, true);
  assert.equal(preload.__testGrants().length, 0);
  assert.throws(() => fs.fstatSync(record.fd), { code: 'EBADF' });
});

test('approved-file handler redacts prefixed tokens and PEM material from JSON and Markdown', async () => {
  const handlers = new Map();
  preload.bridge({ registerTool(name, handler) { handlers.set(name, handler); } });
  const tokens = [`github_pat_${'A'.repeat(24)}`, `ghp_${'B'.repeat(36)}`, `sk-proj-${'C'.repeat(24)}`, `sk-${'D'.repeat(24)}`, `ASIA${'E'.repeat(16)}`];
  const pem = `-----BEGIN PRIVATE KEY-----\n${'F'.repeat(64)}\n-----END PRIVATE KEY-----`;
  const truncatedMaterial = 'T'.repeat(96);
  const truncatedPem = `-----BEGIN RSA PRIVATE KEY-----\n${truncatedMaterial}`;
  const hostnameToken = `github_pat_${'h'.repeat(24)}`;
  const har = { log: { entries: [{ time: 1500, request: { url: `https://${hostnameToken}.secret.test/${tokens.map(encodeURIComponent).join('/')}/${encodeURIComponent(pem)}`, method: `POST ${tokens[3]} ${truncatedPem}`, headers: [] }, response: { status: 500, bodySize: 10, headers: [], content: { mimeType: `application/${tokens[0]}` } } }] } };
  const directory = await mkdtemp(path.join(tmpdir(), 'har-mcp-secret-'));
  const file = path.join(directory, 'secret.har');
  await writeFile(file, JSON.stringify(har));
  preload.__testGrant([file]);
  const record = preload.__testGrants()[0];
  const result = await handlers.get('analyze_approved_files')({ detailLimit: 5 });
  const serialized = JSON.stringify(result);
  for (const token of [...tokens, hostnameToken]) { assert.equal(serialized.includes(token), false); assert.equal(result.markdown.includes(token), false); }
  assert.equal(serialized.includes('BEGIN PRIVATE KEY'), false);
  assert.equal(serialized.includes('BEGIN RSA PRIVATE KEY'), false);
  assert.equal(serialized.includes('F'.repeat(64)), false);
  assert.equal(serialized.includes(truncatedMaterial), false);
  assert.match(serialized, /redacted/i);
  assert.equal(result.reports[0].metrics.entries, 1);
  assert.equal(result.reports[0].totals.domains, 1);
  assert.equal(result.reports[0].totals.types, 1);
  assert.equal(preload.__testGrants().length, 0);
  assert.throws(() => fs.fstatSync(record.fd), { code: 'EBADF' });
});

test('registered inline and approved handlers redact PEM state across raw path segments', async () => {
  const handlers = new Map();
  preload.bridge({ registerTool(name, handler) { handlers.set(name, handler); } });
  const fixtureValue = crossSegmentPemHar();
  const text = JSON.stringify(fixtureValue.value);
  const inline = await handlers.get('analyze_inline')({ har: text, detailLimit: 5 });
  assertCrossSegmentMcpResult(inline, fixtureValue);
  const directory = await mkdtemp(path.join(tmpdir(), 'har-mcp-pem-path-'));
  const file = path.join(directory, 'cross-segment.har');
  await writeFile(file, text);
  preload.__testGrant([file]);
  const record = preload.__testGrants()[0];
  const approved = await handlers.get('analyze_approved_files')({ detailLimit: 5 });
  assertCrossSegmentMcpResult(approved, fixtureValue);
  assert.equal(preload.__testGrants().length, 0);
  assert.throws(() => fs.fstatSync(record.fd), { code: 'EBADF' });
  await assert.rejects(handlers.get('analyze_approved_files')({}), { code: 'FILE_APPROVAL_REQUIRED' });
});

test('registered inline and approved handlers fail closed for adversarial PEM paths and methods', async () => {
  const handlers = new Map();
  preload.bridge({ registerTool(name, handler) { handlers.set(name, handler); } });
  const fixtureValue = pathRedactionHar();
  const text = JSON.stringify(fixtureValue.value);
  const inline = await handlers.get('analyze_inline')({ har: text, detailLimit: 20 });
  assertPathRedactionMcpResult(inline, fixtureValue);
  const directory = await mkdtemp(path.join(tmpdir(), 'har-mcp-adversarial-path-'));
  const file = path.join(directory, 'adversarial-path.har');
  await writeFile(file, text);
  preload.__testGrant([file]);
  const record = preload.__testGrants()[0];
  const approved = await handlers.get('analyze_approved_files')({ detailLimit: 20 });
  assertPathRedactionMcpResult(approved, fixtureValue);
  assert.equal(preload.__testGrants().length, 0);
  assert.throws(() => fs.fstatSync(record.fd), { code: 'EBADF' });
  await assert.rejects(handlers.get('analyze_approved_files')({}), { code: 'FILE_APPROVAL_REQUIRED' });
});

test('two maximum-detail reports stay under 512 KiB and retain full totals', async () => {
  const result = await preload.analyzeInlineForMcp({ har: responsePressureHar('left'), compareHar: responsePressureHar('right'), detailLimit: 50 });
  assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= preload.MCP_RESPONSE_BYTES);
  assert.equal(result.reports[0].totals.slow, 50);
  assert.equal(result.reports[1].totals.security, 50);
  assert.equal(result.requestedDetailLimit, 50);
  assert.equal(result.responseTruncated, false);
  assert.equal(result.detailLimit, result.requestedDetailLimit);
  assert.ok(Buffer.byteLength(result.reports[0].details.slow[0].method, 'utf8') <= 1024);
});

test('MCP handlers expose stable path-free errors for malformed HAR documents', async () => {
  await assert.rejects(
    preload.analyzeInlineForMcp({ har: '{}' }),
    stableMachineError('HAR_ANALYSIS_FAILED', 'HAR analysis failed.', 'log.entries', 'HAR 必须')
  );
  const directory = await mkdtemp(path.join(tmpdir(), 'har-malformed-approved-'));
  const file = path.join(directory, 'malformed.har');
  await writeFile(file, '{}');
  preload.__testGrant([file]);
  const record = preload.__testGrants()[0];
  await assert.rejects(
    preload.analyzeApprovedForMcp({}),
    stableMachineError('APPROVED_HAR_FAILED', 'Approved HAR analysis failed.', directory, file, 'log.entries', 'HAR 必须')
  );
  assert.equal(preload.__testGrants().length, 0);
  assert.throws(() => fs.fstatSync(record.fd), { code: 'EBADF' });
});

test('approved MCP handler maps descriptor read failures without leaking paths and revokes the grant', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'har-read-failure-'));
  const file = path.join(directory, 'failure.har');
  await writeFile(file, inlineHar(1));
  preload.__testGrant([file]);
  const record = preload.__testGrants()[0];
  const originalRead = fs.readSync;
  fs.readSync = () => { throw new Error(`EIO while reading ${file}`); };
  try {
    await assert.rejects(
      preload.analyzeApprovedForMcp({}),
      stableMachineError('APPROVED_HAR_FAILED', 'Approved HAR analysis failed.', directory, file, 'EIO')
    );
  } finally {
    fs.readSync = originalRead;
  }
  assert.equal(preload.__testGrants().length, 0);
  assert.throws(() => fs.fstatSync(record.fd), { code: 'EBADF' });
  await assert.rejects(preload.analyzeApprovedForMcp({}), { code: 'FILE_APPROVAL_REQUIRED' });
});

test('strict validation rejects paths, hostile prototypes and unsafe bounds', async () => {
  await assert.rejects(preload.analyzeApprovedForMcp({ path: fixture }), { code: 'INVALID_TOOL_INPUT' });
  await assert.rejects(preload.analyzeInlineForMcp({ har: '{}', detailLimit: 51 }), { code: 'INVALID_TOOL_INPUT' });
  await assert.rejects(preload.analyzeInlineForMcp({ har: 'x'.repeat(512 * 1024 + 1) }), { code: 'INVALID_TOOL_INPUT' });
  await assert.rejects(preload.analyzeInlineForMcp(JSON.parse('{"har":"{}","__proto__":{}}')), { code: 'INVALID_TOOL_INPUT' });
  await assert.rejects(preload.analyzeInlineForMcp(Object.assign(Object.create({ har: inlineHar(1) }), { detailLimit: 1 })), { code: 'INVALID_TOOL_INPUT' });
});

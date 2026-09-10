import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { maskSecrets, toMarkdown } from '../src/core/guard.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preload = require('../preload/index.cjs');
const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));

async function fixture(preloadSource = 'eval(1)') {
  const directory = await mkdtemp(path.join(tmpdir(), 'guard-mcp-'));
  await mkdir(path.join(directory, 'src'));
  await writeFile(path.join(directory, 'plugin.json'), JSON.stringify({ name: 'safe', version: '1', author: 'a', main: 'index.html', preload: 'preload.cjs', logo: 'logo.svg', platform: ['darwin', 'win32', 'linux'], categories: ['other'], features: [] }));
  await writeFile(path.join(directory, 'index.html'), 'ok');
  await writeFile(path.join(directory, 'preload.cjs'), preloadSource);
  await writeFile(path.join(directory, 'logo.svg'), '<svg/>');
  await writeFile(path.join(directory, 'src', 'token=abcdefghijklmnop.js'), 'ok');
  return directory;
}

function highEscapingFindings(count = 400) {
  return Array.from({ length: count }, (_, index) => `require('./item${String(index).padStart(3, '0')}-${'\\'.repeat(600)}')`).join('\n');
}

function pageMarkerIds(result, report) {
  if (report === 'markdown') return [...result.markdown.matchAll(/item(\d{3})-/g)].map((match) => Number(match[1]));
  return [...result.json.issues, ...result.json.risks].map((finding) => Number(finding.message.match(/item(\d{3})-/)?.[1]));
}

test('manifest declaration and native registration stay one-to-one', () => {
  const handlers = new Map();
  const target = { ztools: { registerTool(name, handler) { handlers.set(name, handler); } } };
  preload.attachPluginGuard(target);
  assert.deepEqual([...handlers.keys()], Object.keys(manifest.tools));
  assert.equal(typeof handlers.get('scan_approved'), 'function');
  assert.equal(manifest.tools.scan_approved.inputSchema.properties.offset.maximum, 400);
});

test('older hosts keep the UI bridge without registering tools', () => {
  const target = { ztools: {} };
  assert.doesNotThrow(() => preload.attachPluginGuard(target));
  assert.equal(typeof target.pluginGuard.choosePluginDirectory, 'function');
});

test('registration failure does not block the human UI bridge', () => {
  const target = { ztools: { registerTool() { throw Error('unsupported'); } } };
  assert.doesNotThrow(() => preload.attachPluginGuard(target));
  assert.equal(typeof target.pluginGuard.scan, 'function');
});

test('agent scan requires a live human UI grant and rejects paths', async () => {
  preload.__testClear();
  await assert.rejects(preload.scanApprovedForMcp({}), { code: 'WORKSPACE_APPROVAL_REQUIRED' });
  await assert.rejects(preload.scanApprovedForMcp({ path: '/tmp' }), { code: 'INVALID_TOOL_INPUT' });
  preload.__testGrant(await fixture(), 0);
  await assert.rejects(preload.scanApprovedForMcp({}), { code: 'WORKSPACE_APPROVAL_REQUIRED' });
});

test('real handler strips root and entries, masks values, and preserves totals', async () => {
  const directory = await fixture();
  preload.__testGrant(directory);
  const result = await preload.scanApprovedForMcp({ report: 'both', offset: 0, limit: 1 });
  assert.equal(Object.hasOwn(result.json, 'root'), false);
  assert.equal(Object.hasOwn(result.json, 'entries'), false);
  assert.equal(result.pagination.limit, 1);
  assert.ok(result.totals.findings >= 1);
  assert.match(result.markdown, /插件安全体检报告/);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(JSON.stringify(result), /abcdefghijklmnop/);
});

test('registered handler rejects a renamed-and-replaced approved directory before scanning it', async () => {
  const handlers = new Map();
  preload.attachPluginGuard({ ztools: { registerTool(name, handler) { handlers.set(name, handler); } } });
  const directory = await fixture();
  const moved = `${directory}.old`;
  preload.__testGrant(directory);
  await rename(directory, moved);
  await mkdir(directory);
  await writeFile(path.join(directory, 'plugin.json'), JSON.stringify({ name: 'replacement-must-not-scan' }));
  await assert.rejects(handlers.get('scan_approved')({}), (error) => {
    assert.equal(error.code, 'APPROVED_DIRECTORY_UNAVAILABLE');
    assert.equal(error.message, '已授权的插件目录不可用，请在界面中重新选择。');
    assert.equal(error.message.includes(directory), false);
    assert.equal(error.message.includes(moved), false);
    assert.equal(error.message.includes('replacement-must-not-scan'), false);
    return true;
  });
  await assert.rejects(handlers.get('scan_approved')({}), { code: 'WORKSPACE_APPROVAL_REQUIRED' });
});

test('human bridge applies the same directory-identity check before scanning', async () => {
  const directory = await fixture();
  const moved = `${directory}.old`;
  const target = { ztools: { showOpenDialog: async () => ({ filePaths: [directory] }) } };
  preload.attachPluginGuard(target);
  await target.pluginGuard.choosePluginDirectory();
  await rename(directory, moved);
  await mkdir(directory);
  await assert.rejects(target.pluginGuard.scan(), (error) => {
    assert.equal(error.code, 'APPROVED_DIRECTORY_UNAVAILABLE');
    assert.equal(error.message.includes(directory), false);
    return true;
  });
});

test('plugin out expires a pending directory chooser and cannot restore MCP authorization', async () => {
  const directory = await fixture();
  const handlers = new Map();
  let resolveDialog;
  let onPluginOut;
  const target = { ztools: {
    showOpenDialog: () => new Promise((resolve) => { resolveDialog = resolve; }),
    onPluginOut(listener) { onPluginOut = listener; },
    registerTool(name, handler) { handlers.set(name, handler); }
  } };
  preload.attachPluginGuard(target);
  const choosing = target.pluginGuard.choosePluginDirectory();
  onPluginOut();
  resolveDialog({ filePaths: [directory] });
  await assert.rejects(choosing, { code: 'SESSION_EXPIRED' });
  await assert.rejects(handlers.get('scan_approved')({}), { code: 'WORKSPACE_APPROVAL_REQUIRED' });
});

test('registered handler sanitizes every credential-bearing manifest, message, and file field', async () => {
  const handlers = new Map();
  preload.attachPluginGuard({ ztools: { registerTool(name, handler) { handlers.set(name, handler); } } });
  const github = `github_pat_${'A'.repeat(32)}`;
  const ghp = `ghp_${'B'.repeat(36)}`;
  const awsAccess = `AKIA${'C'.repeat(16)}`;
  const awsSecret = 'D'.repeat(40);
  const pemBody = 'E'.repeat(72);
  const truncatedPem = `-----BEGIN PRIVATE KEY-----\n${pemBody}`;
  const directory = await fixture();
  await writeFile(path.join(directory, 'plugin.json'), JSON.stringify({
    name: `${github} ${truncatedPem}`,
    description: `Bearer ${'F'.repeat(24)}`,
    version: `AWS_SECRET_ACCESS_KEY=${awsSecret}`,
    author: 'a',
    main: `${github}.html`,
    preload: 'preload.cjs',
    logo: 'logo.svg',
    platform: ['darwin', 'win32', 'linux'],
    categories: ['other'],
    features: [{ code: awsAccess, explain: truncatedPem, cmds: ['scan'] }]
  }));
  await writeFile(path.join(directory, `${ghp}.js`), `eval(1); const key = '${awsAccess}';`);
  preload.__testGrant(directory);
  const result = await handlers.get('scan_approved')({ report: 'both', limit: 200 });
  const serialized = JSON.stringify(result);
  for (const secret of [github, ghp, awsAccess, awsSecret, pemBody]) assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes('BEGIN PRIVATE KEY'), false);
  assert.equal(serialized.includes('AWS_SECRET_ACCESS_KEY'), false);
  assert.match(serialized, /redacted/i);
});

test('50,000 findings keep full totals while retaining and returning bounded evidence', async () => {
  const hitCount = 50001;
  const directory = await fixture('bridge.unapproved = 1;\n'.repeat(hitCount));
  preload.__testGrant(directory);
  const result = await preload.scanApprovedForMcp({ report: 'json', offset: 200, limit: 200 });
  assert.equal(result.totals.risks, hitCount);
  assert.equal(result.totals.findings, hitCount);
  assert.ok(result.totals.retainedFindings <= 400);
  assert.ok(result.json.issues.length + result.json.risks.length <= 200);
  assert.ok(result.pagination.returned <= 200);
  assert.equal(result.pagination.nextOffset, 400);
  assert.equal(result.pagination.hasMore, false);
});

test('registered handler paginates every retained finding across json, markdown, and both under budget', async () => {
  const handlers = new Map();
  preload.attachPluginGuard({ ztools: { registerTool(name, handler) { handlers.set(name, handler); } } });
  const directory = await fixture(highEscapingFindings());
  preload.__testGrant(directory);
  const handler = handlers.get('scan_approved');
  const sawBudgetReduction = Object.create(null);
  for (const report of ['json', 'markdown', 'both']) {
    const ids = [];
    let offset = 0;
    while (true) {
      const result = await handler({ report, offset, limit: 200 });
      assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= preload.MCP_RESPONSE_BYTES);
      assert.equal(result.totals.findings, 400);
      assert.equal(result.totals.risks, 400);
      assert.equal(result.totals.retainedFindings, 400);
      assert.equal(result.pagination.offset, offset);
      assert.equal(result.pagination.nextOffset, offset + result.pagination.returned);
      assert.equal(result.responseTruncated, result.pagination.returned < Math.min(200, Math.max(0, 400 - offset)));
      sawBudgetReduction[report] ||= result.responseTruncated;
      const pageIds = pageMarkerIds(result, report);
      assert.equal(pageIds.length, result.pagination.returned);
      assert.equal(pageIds.every(Number.isInteger), true);
      ids.push(...pageIds);
      if (!result.pagination.hasMore) {
        assert.equal(result.pagination.nextOffset, 400);
        break;
      }
      assert.ok(result.pagination.returned > 0);
      offset = result.pagination.nextOffset;
    }
    assert.equal(ids.length, 400);
    assert.equal(new Set(ids).size, 400);
    assert.deepEqual([...ids].sort((left, right) => left - right), Array.from({ length: 400 }, (_, index) => index));
    const terminal = await handler({ report, offset: 400, limit: 200 });
    assert.ok(Buffer.byteLength(JSON.stringify(terminal), 'utf8') <= preload.MCP_RESPONSE_BYTES);
    assert.equal(terminal.pagination.returned, 0);
    assert.equal(terminal.pagination.nextOffset, 400);
    assert.equal(terminal.pagination.hasMore, false);
    assert.equal(terminal.responseTruncated, false);
    assert.equal(terminal.totals.findings, 400);
  }
  assert.equal(sawBudgetReduction.both, true);
});

test('maximum report=both page stays under the serialized response budget', () => {
  const finding = { level: 'high', code: 'bounded', message: '密'.repeat(1000), file: '\\'.repeat(2000) };
  const report = { manifest: { name: 'safe', version: '1', features: [] }, manifestFeatureTotal: 0, files: 1, bytes: 1, scannedAt: 'now', issues: Array.from({ length: 400 }, () => finding), risks: [], findingTotals: { issues: 400, risks: 0, findings: 400 } };
  const result = preload.buildMcpResponse(report, { report: 'both', offset: 0, limit: 200 }, { maskSecrets, toMarkdown });
  assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= preload.MCP_RESPONSE_BYTES);
  assert.equal(result.totals.findings, 400);
  assert.equal(result.json.totals.findings, 400);
  assert.equal(result.responseTruncated, true);
  assert.equal(result.pagination.responseTruncated, true);
  assert.equal(result.json.pagination.responseTruncated, true);
  assert.equal(result.pagination.hasMore, true);
  assert.ok(result.pagination.returned < result.pagination.requestedLimit);
});

test('deleted approved directory revokes grant and returns a stable path-free error', async () => {
  const directory = await fixture();
  preload.__testGrant(directory);
  await rm(directory, { recursive: true, force: true });
  await assert.rejects(preload.scanApprovedForMcp({}), (error) => {
    assert.equal(error.code, 'APPROVED_DIRECTORY_UNAVAILABLE');
    assert.equal(error.message, '已授权的插件目录不可用，请在界面中重新选择。');
    assert.equal(error.message.includes(directory), false);
    return true;
  });
  await assert.rejects(preload.scanApprovedForMcp({}), { code: 'WORKSPACE_APPROVAL_REQUIRED' });
});

test('strict validation bounds report pagination and hostile keys', async () => {
  await assert.rejects(preload.scanApprovedForMcp({ limit: 201 }), { code: 'INVALID_TOOL_INPUT' });
  await assert.rejects(preload.scanApprovedForMcp({ offset: -1 }), { code: 'INVALID_TOOL_INPUT' });
  await assert.rejects(preload.scanApprovedForMcp({ offset: 401 }), { code: 'INVALID_TOOL_INPUT' });
  await assert.rejects(preload.scanApprovedForMcp({ report: 'html' }), { code: 'INVALID_TOOL_INPUT' });
  await assert.rejects(preload.scanApprovedForMcp(JSON.parse('{"__proto__":{}}')), { code: 'INVALID_TOOL_INPUT' });
  await assert.rejects(preload.scanApprovedForMcp(Object.create({ report: 'json' })), { code: 'INVALID_TOOL_INPUT' });
});

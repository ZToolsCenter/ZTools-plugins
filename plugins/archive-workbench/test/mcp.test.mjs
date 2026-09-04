import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rename, stat, truncate, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStoredZip } from '../src/core/archive.mjs';

const require = createRequire(import.meta.url);
const preloadPath = fileURLToPath(new URL('../preload/index.cjs', import.meta.url));
const preload = require(preloadPath);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));

async function zipFixture(entries) {
  const directory = await mkdtemp(path.join(tmpdir(), 'archive-mcp-'));
  const zipPath = path.join(directory, 'approved.zip');
  await writeFile(zipPath, createStoredZip(entries));
  return zipPath;
}

function forgedEntryNameZip(safeName, unsafeName) {
  const safeBytes = new TextEncoder().encode(safeName);
  const unsafeBytes = new TextEncoder().encode(unsafeName);
  assert.equal(unsafeBytes.length, safeBytes.length, 'forged ZIP names must have equal byte length');
  const bytes = createStoredZip([{ name: safeName, data: 'x' }]);
  const central = bytes.findIndex((_, index) => bytes[index] === 0x50 && bytes[index + 1] === 0x4b && bytes[index + 2] === 1 && bytes[index + 3] === 2);
  assert.ok(central > 0);
  bytes.set(unsafeBytes, 30);
  bytes.set(unsafeBytes, central + 46);
  return bytes;
}

function hostFor(zipPath, registerTool) {
  const outCallbacks = [];
  const ztools = {
    async showOpenDialog() { return { filePaths: [zipPath] }; },
    onPluginOut(callback) { outCallbacks.push(callback); },
    ...(registerTool ? { registerTool } : {})
  };
  const target = { ztools };
  const bridge = preload.attachArchiveWorkbench(target);
  return { target, bridge, outCallbacks };
}

function delayFirstFileCheck(filePath) {
  const fsPromises = require('node:fs/promises');
  const canonicalPath = require('node:fs').realpathSync.native(filePath);
  const originalLstat = fsPromises.lstat;
  let releaseCheck;
  let announceCheck;
  let delayed = false;
  const checkStarted = new Promise((resolve) => { announceCheck = resolve; });
  const checkGate = new Promise((resolve) => { releaseCheck = resolve; });
  fsPromises.lstat = async (...args) => {
    if (!delayed && require('node:fs').realpathSync.native(args[0]) === canonicalPath) {
      delayed = true;
      announceCheck();
      await checkGate;
    }
    return originalLstat(...args);
  };
  return {
    checkStarted,
    releaseCheck,
    restore() {
      releaseCheck();
      fsPromises.lstat = originalLstat;
    }
  };
}

test('manifest declarations and top-level native registrations stay one-to-one', () => {
  const handlers = new Map();
  const target = { ztools: { registerTool(name, handler) { handlers.set(name, handler); } } };
  preload.attachArchiveWorkbench(target);
  assert.deepEqual([...handlers.keys()].sort(), Object.keys(manifest.tools).sort());
  assert.deepEqual(Object.keys(manifest.tools).sort(), ['inspect_approved_zip', 'plan_approved_zip']);
  assert.ok([...handlers.values()].every((handler) => typeof handler === 'function'));

  const script = `const names=[];globalThis.ztools={registerTool(name,handler){if(typeof handler!=='function')throw Error('bad handler');names.push(name)}};require(${JSON.stringify(preloadPath)});process.stdout.write(JSON.stringify(names.sort()))`;
  const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), ['inspect_approved_zip', 'plan_approved_zip']);
});

test('one registration failure neither blocks the other tool nor breaks the human UI', () => {
  const handlers = new Map();
  const { target } = hostFor('/not-opened.zip', (name, handler) => {
    if (name === 'inspect_approved_zip') throw new Error('simulated host failure');
    handlers.set(name, handler);
  });
  assert.deepEqual([...handlers.keys()], ['plan_approved_zip']);
  assert.equal(typeof target.archiveWorkbench.chooseZip, 'function');
  assert.equal(typeof target.archiveWorkbench.extract, 'function');
});

test('older hosts keep the complete human bridge without MCP support', async () => {
  preload.__testClearGrants();
  const zipPath = await zipFixture([{ name: 'human.txt', data: 'ok' }]);
  const { bridge } = hostFor(zipPath);
  const zipToken = await bridge.chooseZip();
  const preview = await bridge.preview(zipToken);
  assert.equal(preview.entries[0].name, 'human.txt');
  assert.equal(typeof bridge.create, 'function');
  preload.__testClearGrants();
});

test('human preview binds its token to the originally selected ZIP identity', async () => {
  preload.__testClearGrants();
  const zipPath = await zipFixture([{ name: 'human.txt', data: 'ok' }]);
  const { bridge } = hostFor(zipPath);
  const zipToken = await bridge.chooseZip();
  await rename(zipPath, `${zipPath}.selected`);
  await writeFile(zipPath, createStoredZip([{ name: 'replacement.txt', data: 'no' }]));
  await assert.rejects(bridge.preview(zipToken), /身份已发生变化|不安全/);
  preload.__testClearGrants();
});

test('real handlers inspect and plan only the latest human-approved ZIP with pagination', async () => {
  preload.__testClearGrants();
  const firstPath = await zipFixture([{ name: 'old.txt', data: 'old' }]);
  const secondPath = await zipFixture([
    { name: 'one.txt', data: '1' },
    { name: 'nested/two.txt', data: '22' },
    { name: 'three.txt', data: '333' }
  ]);
  let selectedPath = firstPath;
  const handlers = new Map();
  const outCallbacks = [];
  const target = {
    ztools: {
      async showOpenDialog() { return { filePaths: [selectedPath] }; },
      onPluginOut(callback) { outCallbacks.push(callback); },
      registerTool(name, handler) { handlers.set(name, handler); }
    }
  };
  const bridge = preload.attachArchiveWorkbench(target);
  const oldToken = await bridge.chooseZip();
  selectedPath = secondPath;
  const currentToken = await bridge.chooseZip();
  await assert.rejects(bridge.preview(oldToken), /授权无效或已过期/);

  const inspected = await handlers.get('inspect_approved_zip')({ offset: 1, limit: 1 });
  assert.equal(inspected.entries.length, 1);
  assert.equal(inspected.entries[0].name, 'nested/two.txt');
  assert.equal(inspected.pagination.returned, 1);
  assert.equal(inspected.pagination.hasMore, true);
  assert.deepEqual(inspected.totals, { entries: 3, expandedBytes: 6, compressedBytes: 6 });
  assert.equal(inspected.conflict, null);
  assert.equal(inspected.limits.pageLimit, 200);

  const planned = await handlers.get('plan_approved_zip')({ offset: 2, limit: 1, conflict: 'skip' });
  assert.deepEqual(planned.writePlan, [{ name: 'three.txt', action: 'write-or-skip' }]);
  assert.equal(planned.conflict, 'skip');
  assert.equal(planned.totals.entries, 3);

  const serialized = JSON.stringify({ inspected, planned });
  assert.doesNotMatch(serialized, new RegExp(firstPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(serialized, new RegExp(secondPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(serialized, new RegExp(currentToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.deepEqual(Object.keys(manifest.tools).sort(), ['inspect_approved_zip', 'plan_approved_zip']);
  outCallbacks.forEach((callback) => callback());
});

test('tools require a live UI grant and onPluginOut revokes it', async () => {
  preload.__testClearGrants();
  await assert.rejects(preload.inspectApprovedZipForMcp({}), { code: 'APPROVED_ZIP_REQUIRED' });
  const zipPath = await zipFixture([{ name: 'safe.txt', data: 'safe' }]);
  const handlers = new Map();
  const { bridge, outCallbacks } = hostFor(zipPath, (name, handler) => handlers.set(name, handler));
  await bridge.chooseZip();
  assert.equal((await handlers.get('inspect_approved_zip')({})).totals.entries, 1);
  assert.equal(outCallbacks.length, 1);
  outCallbacks[0]();
  await assert.rejects(handlers.get('inspect_approved_zip')({}), { code: 'APPROVED_ZIP_REQUIRED' });
});

test('delayed ZIP dialog result cannot restore approval after plugin exit', async () => {
  preload.__testClearGrants();
  const zipPath = await zipFixture([{ name: 'late.txt', data: 'late' }]);
  let resolveDialog, onOut;
  const handlers = new Map();
  const target = { ztools: {
    showOpenDialog: () => new Promise((resolve) => { resolveDialog = resolve; }),
    onPluginOut(callback) { onOut = callback; },
    registerTool(name, handler) { handlers.set(name, handler); }
  } };
  const bridge = preload.attachArchiveWorkbench(target);
  const pending = bridge.chooseZip();
  onOut();
  resolveDialog({ filePaths: [zipPath] });
  await assert.rejects(pending, { code: 'SESSION_EXPIRED' });
  assert.equal(preload.__testActiveZipIdentity(), null);
  await assert.rejects(handlers.get('inspect_approved_zip')({}), { code: 'APPROVED_ZIP_REQUIRED' });
});

test('ZIP safety check completing after plugin exit cannot activate approval', async () => {
  preload.__testClearGrants();
  const zipPath = await zipFixture([{ name: 'late-check.txt', data: 'late' }]);
  let onOut, releaseCheck, announceCheck;
  const checkStarted = new Promise((resolve) => { announceCheck = resolve; });
  const checkGate = new Promise((resolve) => { releaseCheck = resolve; });
  const fsPromises = require('node:fs/promises');
  const originalLstat = fsPromises.lstat;
  let delayed = false;
  fsPromises.lstat = async (...args) => {
    if (!delayed && args[0] === zipPath) { delayed = true; announceCheck(); await checkGate; }
    return originalLstat(...args);
  };
  const handlers = new Map();
  const target = { ztools: {
    async showOpenDialog() { return { filePaths: [zipPath] }; },
    onPluginOut(callback) { onOut = callback; },
    registerTool(name, handler) { handlers.set(name, handler); }
  } };
  const bridge = preload.attachArchiveWorkbench(target);
  try {
    const pending = bridge.chooseZip();
    await checkStarted;
    onOut();
    releaseCheck();
    await assert.rejects(pending, { code: 'SESSION_EXPIRED' });
    assert.equal(preload.__testActiveZipIdentity(), null);
    await assert.rejects(handlers.get('inspect_approved_zip')({}), { code: 'APPROVED_ZIP_REQUIRED' });
  } finally {
    fsPromises.lstat = originalLstat;
  }
});

test('destination and source-file selectors discard delayed results after plugin exit', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'archive-selector-exit-'));
  const file = path.join(directory, 'source.txt');
  await writeFile(file, 'source');
  for (const [method, selectedPath] of [['chooseDestination', directory], ['chooseFiles', file]]) {
    preload.__testClearGrants();
    let resolveDialog, onOut;
    const target = { ztools: {
      showOpenDialog: () => new Promise((resolve) => { resolveDialog = resolve; }),
      onPluginOut(callback) { onOut = callback; }
    } };
    const bridge = preload.attachArchiveWorkbench(target);
    const pending = bridge[method]();
    onOut();
    resolveDialog({ filePaths: [selectedPath] });
    await assert.rejects(pending, { code: 'SESSION_EXPIRED' });
  }
});

test('human preview discards an authorized ZIP read that completes after plugin exit', async () => {
  preload.__testClearGrants();
  const zipPath = await zipFixture([{ name: 'late-preview.txt', data: 'late' }]);
  const { bridge, outCallbacks } = hostFor(zipPath);
  const zipToken = await bridge.chooseZip();
  const delayed = delayFirstFileCheck(zipPath);
  try {
    const pending = bridge.preview(zipToken);
    await delayed.checkStarted;
    outCallbacks[0]();
    delayed.releaseCheck();
    await assert.rejects(pending, { code: 'SESSION_EXPIRED' });
    assert.equal(preload.__testActiveZipIdentity(), null);
  } finally {
    delayed.restore();
  }
});

test('extract and create do not write after their authorized input read outlives the session', async () => {
  const zipPath = await zipFixture([{ name: 'late-extract.txt', data: 'late' }]);
  const destination = await mkdtemp(path.join(tmpdir(), 'archive-extract-exit-'));
  let openCall = 0;
  let onExtractOut;
  const extractTarget = { ztools: {
    async showOpenDialog() { return { filePaths: [openCall++ === 0 ? zipPath : destination] }; },
    onPluginOut(callback) { onExtractOut = callback; }
  } };
  preload.__testClearGrants();
  const extractBridge = preload.attachArchiveWorkbench(extractTarget);
  const zipToken = await extractBridge.chooseZip();
  const destinationToken = await extractBridge.chooseDestination();
  const delayedZip = delayFirstFileCheck(zipPath);
  try {
    const pending = extractBridge.extract(zipToken, destinationToken);
    await delayedZip.checkStarted;
    onExtractOut();
    delayedZip.releaseCheck();
    await assert.rejects(pending, { code: 'SESSION_EXPIRED' });
    await assert.rejects(readFile(path.join(destination, 'late-extract.txt')), { code: 'ENOENT' });
  } finally {
    delayedZip.restore();
  }

  const sourceDirectory = await mkdtemp(path.join(tmpdir(), 'archive-create-exit-'));
  const source = path.join(sourceDirectory, 'source.txt');
  const output = path.join(sourceDirectory, 'should-not-exist.zip');
  await writeFile(source, 'source');
  let onCreateOut;
  let saveCalls = 0;
  const createTarget = { ztools: {
    async showOpenDialog() { return { filePaths: [source] }; },
    async showSaveDialog() { saveCalls += 1; return { filePath: output }; },
    onPluginOut(callback) { onCreateOut = callback; }
  } };
  preload.__testClearGrants();
  const createBridge = preload.attachArchiveWorkbench(createTarget);
  const filesToken = await createBridge.chooseFiles();
  const delayedSource = delayFirstFileCheck(source);
  try {
    const pending = createBridge.create(filesToken);
    await delayedSource.checkStarted;
    onCreateOut();
    delayedSource.releaseCheck();
    await assert.rejects(pending, { code: 'SESSION_EXPIRED' });
    assert.equal(saveCalls, 0);
    await assert.rejects(readFile(output), { code: 'ENOENT' });
  } finally {
    delayedSource.restore();
  }
});

test('MCP cache-hit revalidation cannot return after the approved session exits', async () => {
  preload.__testClearGrants();
  const zipPath = await zipFixture([{ name: 'cached.txt', data: 'cached' }]);
  const handlers = new Map();
  const { bridge, outCallbacks } = hostFor(zipPath, (name, handler) => handlers.set(name, handler));
  await bridge.chooseZip();
  assert.equal((await handlers.get('inspect_approved_zip')({})).totals.entries, 1);

  const fsPromises = require('node:fs/promises');
  const originalLstat = fsPromises.lstat;
  const canonicalZipPath = require('node:fs').realpathSync.native(zipPath);
  let releaseCheck;
  let announceCheck;
  let delayed = false;
  const checkStarted = new Promise((resolve) => { announceCheck = resolve; });
  const checkGate = new Promise((resolve) => { releaseCheck = resolve; });
  fsPromises.lstat = async (...args) => {
    if (!delayed && require('node:fs').realpathSync.native(args[0]) === canonicalZipPath) {
      delayed = true;
      announceCheck();
      await checkGate;
    }
    return originalLstat(...args);
  };
  try {
    const pending = handlers.get('inspect_approved_zip')({});
    await checkStarted;
    outCallbacks[0]();
    releaseCheck();
    await assert.rejects(pending, { code: 'APPROVED_ZIP_REQUIRED' });
  } finally {
    releaseCheck();
    fsPromises.lstat = originalLstat;
  }
});

test('the active UI ZIP grant expires after five minutes', async () => {
  preload.__testClearGrants();
  const zipPath = await zipFixture([{ name: 'expires.txt', data: 'safe' }]);
  const handlers = new Map();
  const { bridge } = hostFor(zipPath, (name, handler) => handlers.set(name, handler));
  const originalNow = Date.now;
  try {
    Date.now = () => 0;
    await bridge.chooseZip();
  } finally {
    Date.now = originalNow;
  }
  await assert.rejects(handlers.get('inspect_approved_zip')({}), { code: 'APPROVED_ZIP_REQUIRED' });
});

test('replacing an approved ZIP at the same path revokes the grant without leaking the path', async () => {
  preload.__testClearGrants();
  const zipPath = await zipFixture([{ name: 'approved.txt', data: 'approved' }]);
  const handlers = new Map();
  const { bridge } = hostFor(zipPath, (name, handler) => handlers.set(name, handler));
  const grantToken = await bridge.chooseZip();
  assert.equal((await handlers.get('inspect_approved_zip')({})).entries[0].name, 'approved.txt');
  await rename(zipPath, `${zipPath}.replaced`);
  await writeFile(zipPath, createStoredZip([{ name: 'replacement.txt', data: 'different-size' }]));
  await assert.rejects(
    handlers.get('inspect_approved_zip')({}),
    (error) => error.code === 'APPROVED_ZIP_UNAVAILABLE'
      && !error.message.includes(zipPath)
      && !error.message.includes(grantToken)
  );
  await assert.rejects(handlers.get('inspect_approved_zip')({}), { code: 'APPROVED_ZIP_REQUIRED' });
});

test('cache revalidation detects same-inode same-size rewrites even after mtime restoration', async () => {
  preload.__testClearGrants();
  const zipPath = await zipFixture([{ name: 'safe.txt', data: 'x' }]);
  const fixedTime = new Date('2024-01-02T03:04:05.000Z');
  await utimes(zipPath, fixedTime, fixedTime);
  const original = await stat(zipPath);
  const handlers = new Map();
  const { bridge } = hostFor(zipPath, (name, handler) => handlers.set(name, handler));
  const grantToken = await bridge.chooseZip();
  const approvedIdentity = preload.__testActiveZipIdentity();
  assert.equal(Object.isFrozen(approvedIdentity), true);
  assert.equal(typeof approvedIdentity.ctimeMs, 'number');
  const first = await handlers.get('inspect_approved_zip')({});
  assert.equal(first.entries[0].name, 'safe.txt');
  const afterCache = preload.__testMcpMetrics();

  const replacement = createStoredZip([{ name: 'evil.txt', data: 'x' }]);
  assert.equal(replacement.length, original.size);
  let changed;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await writeFile(zipPath, replacement);
    await utimes(zipPath, fixedTime, fixedTime);
    changed = await stat(zipPath);
    if (changed.ctimeMs !== original.ctimeMs) break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal(changed.dev, original.dev);
  assert.equal(changed.ino, original.ino);
  assert.equal(changed.size, original.size);
  assert.equal(changed.mtimeMs, original.mtimeMs);
  assert.notEqual(changed.ctimeMs, original.ctimeMs);

  await assert.rejects(
    handlers.get('inspect_approved_zip')({}),
    (error) => error.code === 'APPROVED_ZIP_UNAVAILABLE'
      && !error.message.includes(zipPath)
      && !error.message.includes(grantToken)
  );
  assert.deepEqual(preload.__testMcpMetrics(), afterCache);
  await assert.rejects(handlers.get('inspect_approved_zip')({}), { code: 'APPROVED_ZIP_REQUIRED' });
});

test('real MCP handler rejects a forged Win32 superscript device entry', async () => {
  preload.__testClearGrants();
  const directory = await mkdtemp(path.join(tmpdir(), 'archive-mcp-device-'));
  const zipPath = path.join(directory, 'device.zip');
  await writeFile(zipPath, forgedEntryNameZip('safe0.txt', 'LPT².txt'));
  const handlers = new Map();
  const { bridge, outCallbacks } = hostFor(zipPath, (name, handler) => handlers.set(name, handler));
  await bridge.chooseZip();
  await assert.rejects(
    handlers.get('inspect_approved_zip')({}),
    (error) => error.code === 'ZIP_INSPECTION_FAILED' && !error.message.includes(zipPath)
  );
  outCallbacks.forEach((callback) => callback());
});

test('concurrent inspect and plan share one bounded read and one safety inspection', async () => {
  preload.__testClearGrants();
  const zipPath = await zipFixture(Array.from({ length: 80 }, (_, index) => ({ name: `entry-${index}.txt`, data: `value-${index}` })));
  const handlers = new Map();
  const { bridge, outCallbacks } = hostFor(zipPath, (name, handler) => handlers.set(name, handler));
  await bridge.chooseZip();
  const before = preload.__testMcpMetrics();
  const [inspected, planned] = await Promise.all([
    handlers.get('inspect_approved_zip')({ offset: 0, limit: 20 }),
    handlers.get('plan_approved_zip')({ offset: 20, limit: 20, conflict: 'error' })
  ]);
  const after = preload.__testMcpMetrics();
  assert.equal(after.reads - before.reads, 1);
  assert.equal(after.inspections - before.inspections, 1);
  assert.equal(inspected.totals.entries, 80);
  assert.equal(planned.totals.entries, 80);
  assert.equal(planned.conflict, 'error');
  await handlers.get('inspect_approved_zip')({ offset: 40, limit: 20 });
  assert.deepEqual(preload.__testMcpMetrics(), after);
  outCallbacks.forEach((callback) => callback());
});

test('MCP rejects an approved ZIP above 64 MiB without reading or leaking its path', async () => {
  preload.__testClearGrants();
  const directory = await mkdtemp(path.join(tmpdir(), 'archive-mcp-large-'));
  const zipPath = path.join(directory, 'large-approved.zip');
  await writeFile(zipPath, createStoredZip([{ name: 'small.txt', data: 'x' }]));
  await truncate(zipPath, preload.MCP_ZIP_SOURCE_MAX + 1);
  const handlers = new Map();
  const { bridge, outCallbacks } = hostFor(zipPath, (name, handler) => handlers.set(name, handler));
  await bridge.chooseZip();
  const before = preload.__testMcpMetrics();
  for (const name of ['inspect_approved_zip', 'plan_approved_zip']) {
    await assert.rejects(handlers.get(name)({}), (error) => error.code === 'MCP_ZIP_TOO_LARGE' && !error.message.includes(zipPath));
  }
  assert.deepEqual(preload.__testMcpMetrics(), before);
  outCallbacks.forEach((callback) => callback());
});

test('approved ZIP reads use the bounded handle path when the file grows after approval', async () => {
  preload.__testClearGrants();
  const zipPath = await zipFixture([{ name: 'bounded.txt', data: 'ok' }]);
  const approvedBytes = await readFile(zipPath);
  const handlers = new Map();
  const { bridge, outCallbacks } = hostFor(zipPath, (name, handler) => handlers.set(name, handler));
  await bridge.chooseZip();
  const fsPromises = require('node:fs/promises');
  const originalOpen = fsPromises.open;
  let readFileCalled = false;
  fsPromises.open = async (...args) => {
    const real = await originalOpen(...args);
    const expanded = Buffer.concat([approvedBytes, Buffer.from([0])]);
    let cursor = 0;
    return {
      stat: (...statArgs) => real.stat(...statArgs),
      async read(target, offset, length) {
        const bytesRead = Math.min(length, expanded.length - cursor);
        if (bytesRead > 0) expanded.copy(target, offset, cursor, cursor + bytesRead);
        cursor += bytesRead;
        return { bytesRead };
      },
      async readFile() { readFileCalled = true; return expanded; },
      close: () => real.close()
    };
  };
  try {
    await assert.rejects(handlers.get('inspect_approved_zip')({}), (error) => error.code === 'APPROVED_ZIP_UNAVAILABLE');
    assert.equal(readFileCalled, false);
  } finally {
    fsPromises.open = originalOpen;
    outCallbacks.forEach((callback) => callback());
  }
});

test('strict runtime validation rejects paths, tokens, hostile prototypes and invalid pages', () => {
  for (const value of [
    { path: '/tmp/a.zip' },
    { token: 'secret' },
    { grantId: 'secret' },
    { offset: -1 },
    { offset: preload.MCP_MAX_OFFSET + 1 },
    { offset: 1.5 },
    { limit: 0 },
    { limit: preload.MCP_MAX_LIMIT + 1 }
  ]) assert.throws(() => preload.validateToolInput(value), { code: 'INVALID_TOOL_INPUT' });
  assert.throws(() => preload.validateToolInput({ conflict: 'overwrite' }, true), { code: 'INVALID_TOOL_INPUT' });
  assert.throws(() => preload.validateToolInput(JSON.parse('{"__proto__":{},"limit":1}')), { code: 'INVALID_TOOL_INPUT' });
  assert.throws(() => preload.validateToolInput(Object.assign(Object.create({ inherited: true }), { limit: 1 })), { code: 'INVALID_TOOL_INPUT' });
  const accessor = {};
  Object.defineProperty(accessor, 'limit', { enumerable: true, get() { throw new Error('must not execute'); } });
  assert.throws(() => preload.validateToolInput(accessor), { code: 'INVALID_TOOL_INPUT' });
  const symbol = { limit: 1 };
  symbol[Symbol('hidden')] = true;
  assert.throws(() => preload.validateToolInput(symbol), { code: 'INVALID_TOOL_INPUT' });
  assert.deepEqual(preload.validateToolInput(Object.assign(Object.create(null), { offset: 2, limit: 3 })), { offset: 2, limit: 3 });
  const previousLimit = Object.getOwnPropertyDescriptor(Object.prototype, 'limit');
  const previousConflict = Object.getOwnPropertyDescriptor(Object.prototype, 'conflict');
  Object.defineProperties(Object.prototype, {
    limit: { value: 999, configurable: true },
    conflict: { value: 'overwrite', configurable: true }
  });
  try {
    assert.deepEqual(preload.validateToolInput({}, true), { offset: 0, limit: 100, conflict: 'rename' });
  } finally {
    if (previousLimit) Object.defineProperty(Object.prototype, 'limit', previousLimit);
    else delete Object.prototype.limit;
    if (previousConflict) Object.defineProperty(Object.prototype, 'conflict', previousConflict);
    else delete Object.prototype.conflict;
  }
});

test('maximum pages remain bounded and contain relative names only', async () => {
  preload.__testClearGrants();
  const entries = Array.from({ length: 240 }, (_, index) => ({ name: `folder_${String(index).padStart(3, '0')}/${'n'.repeat(180)}_${index}.txt`, data: 'x' }));
  const zipPath = await zipFixture(entries);
  const handlers = new Map();
  const { bridge, outCallbacks } = hostFor(zipPath, (name, handler) => handlers.set(name, handler));
  await bridge.chooseZip();
  const inspected = await handlers.get('inspect_approved_zip')({ offset: 0, limit: 200 });
  const planned = await handlers.get('plan_approved_zip')({ offset: 0, limit: 200, conflict: 'rename' });
  assert.ok(inspected.entries.length <= 200);
  assert.ok(planned.writePlan.length <= 200);
  assert.equal(inspected.totals.entries, 240);
  assert.equal(planned.totals.entries, 240);
  assert.ok(Buffer.byteLength(JSON.stringify(inspected), 'utf8') <= preload.MCP_RESPONSE_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(planned), 'utf8') <= preload.MCP_RESPONSE_BYTES);
  assert.ok(inspected.entries.every((entry) => !path.isAbsolute(entry.name)));
  assert.ok(planned.writePlan.every((entry) => !path.isAbsolute(entry.name)));
  outCallbacks.forEach((callback) => callback());
});

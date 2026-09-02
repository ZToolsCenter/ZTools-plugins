import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const preload = require('../preload/index.cjs');

test('host text and image payloads are dispatched by their declared type', async () => {
  assert.deepEqual(await preload.consumeHostEntry({ type: 'over', payload: 'a@b.com' }), { kind: 'text', text: 'a@b.com' });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  assert.deepEqual(await preload.consumeHostEntry({ type: 'img', payload: dataUrl }), { kind: 'image', dataUrl });
  await assert.rejects(preload.consumeHostEntry({ type: 'img', payload: 'plain text' }), { code: 'INVALID_TOOL_INPUT' });
});

test('host-selected file paths are read only through the preload entry callback', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'share-sanitizer-entry-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const textPath = path.join(directory, 'note.txt');
  await writeFile(textPath, 'secret@example.com');
  assert.deepEqual(
    await preload.consumeHostEntry({ type: 'files', payload: [{ path: textPath, name: 'note.txt', isFile: true, isDirectory: false }] }),
    { kind: 'text', text: 'secret@example.com' }
  );
  const imagePath = path.join(directory, 'shot.png');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await writeFile(imagePath, png);
  const image = await preload.consumeHostEntry({ type: 'files', payload: [{ path: imagePath, name: 'shot.png', isFile: true, isDirectory: false }] });
  assert.equal(image.kind, 'image');
  assert.equal(image.dataUrl, `data:image/png;base64,${png.toString('base64')}`);
  const linkPath = path.join(directory, 'link.txt');
  await symlink(textPath, linkPath);
  await assert.rejects(
    preload.consumeHostEntry({ type: 'files', payload: [{ path: linkPath, name: 'link.txt', isFile: true, isDirectory: false }] }),
    { code: 'INVALID_TOOL_INPUT' }
  );
});

test('preload owns the single host entry handler and relays sanitized data to the UI bridge', async () => {
  let hostHandler;
  const target = { ztools: { onPluginEnter(handler) { hostHandler = handler; } } };
  const bridge = preload.attachShareSanitizer(target);
  const received = new Promise((resolve) => bridge.onEntry(resolve));
  hostHandler({ type: 'over', payload: 'selected text' });
  assert.deepEqual(await received, { kind: 'text', text: 'selected text' });
  assert.equal(Object.hasOwn(bridge, 'readFile'), false);
});

test('void-return lifecycle hooks are registered once and clear each visit without re-subscribing', async () => {
  let enterHandler;
  let outHandler;
  let enterSubscriptions = 0;
  let outSubscriptions = 0;
  const target = {
    ztools: {
      onPluginEnter(handler) { enterHandler = handler; enterSubscriptions += 1; },
      onPluginOut(handler) { outHandler = handler; outSubscriptions += 1; }
    }
  };
  const bridge = preload.attachShareSanitizer(target);
  const received = [];
  bridge.onEntry((entry) => received.push(entry));
  await enterHandler({ type: 'over', payload: 'first secret' });
  await new Promise((resolve) => setImmediate(resolve));
  outHandler(false);
  assert.deepEqual(received.map((entry) => entry.kind), ['text', 'reset']);
  assert.equal(enterSubscriptions, 1);
  assert.equal(outSubscriptions, 1);
  await enterHandler({ type: 'over', payload: 'late secret' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received.map((entry) => entry.kind), ['text', 'reset', 'text']);

  outHandler(false);
  await enterHandler({ type: 'over', payload: 'fresh secret' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received.map((entry) => entry.kind), ['text', 'reset', 'text', 'reset', 'text']);
  assert.equal(enterSubscriptions, 1);
  assert.equal(outSubscriptions, 1);
});

test('exit before UI registration drops pending data with real void-return lifecycle hooks', async () => {
  let enterHandler;
  let outHandler;
  const target = {
    ztools: {
      onPluginEnter(handler) { enterHandler = handler; },
      onPluginOut(handler) { outHandler = handler; }
    }
  };
  const bridge = preload.attachShareSanitizer(target);
  await enterHandler({ type: 'over', payload: 'must not survive exit' });
  outHandler(false);
  await new Promise((resolve) => setImmediate(resolve));
  const received = [];
  bridge.onEntry((entry) => received.push(entry));
  assert.deepEqual(received, []);
});

test('plugin exit invalidates a pending entry already queued for UI delivery', async () => {
  let enterHandler;
  let outHandler;
  const bridge = preload.attachShareSanitizer({
    ztools: {
      onPluginEnter(handler) { enterHandler = handler; },
      onPluginOut(handler) { outHandler = handler; }
    }
  });
  await enterHandler({ type: 'over', payload: 'must-not-survive@example.com' });
  await new Promise((resolve) => setImmediate(resolve));
  const received = [];
  bridge.onEntry((entry) => received.push(entry));
  outHandler(false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received, [{ kind: 'reset' }]);
});

test('file identity checks reject same-size replacements and in-place changes', () => {
  const snapshot = (values = {}) => ({ isFile: () => true, dev: 1, ino: 2, size: 8, mtimeMs: 3, ctimeMs: 4, ...values });
  assert.equal(preload.fileSnapshotMatches(snapshot(), snapshot()), true);
  assert.equal(preload.fileSnapshotMatches(snapshot(), snapshot({ ino: 9 })), false);
  assert.equal(preload.fileSnapshotMatches(snapshot(), snapshot({ mtimeMs: 9 })), false);
  assert.equal(preload.fileSnapshotMatches(snapshot(), snapshot({ ctimeMs: 9 })), false);
});

test('file handle reads stop at limit plus one without unbounded allocation', async () => {
  const fakeHandle = (value) => {
    let cursor = 0;
    return { async read(target, offset, length) { const bytesRead = Math.min(length, value.length - cursor); if (bytesRead > 0) value.copy(target, offset, cursor, cursor + bytesRead); cursor += bytesRead; return { bytesRead }; } };
  };
  assert.equal((await preload.readHandleBounded(fakeHandle(Buffer.from('abc')), 3)).toString(), 'abc');
  await assert.rejects(preload.readHandleBounded(fakeHandle(Buffer.from('abcd')), 3), { code: 'INVALID_TOOL_INPUT' });
});

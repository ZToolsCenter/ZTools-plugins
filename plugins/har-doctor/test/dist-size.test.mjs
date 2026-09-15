import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { assertDistSize, directoryBytes, DIST_SIZE_LIMIT } from '../scripts/dist-size.mjs';

function fakeEntry(name, type) {
  return {
    name,
    isDirectory: () => type === 'directory',
    isFile: () => type === 'file',
    isSymbolicLink: () => type === 'symlink'
  };
}

function fakeTree() {
  const root = path.resolve('/virtual/dist');
  const nested = path.join(root, 'nested');
  const entries = new Map([
    [root, [fakeEntry('main.js', 'file'), fakeEntry('nested', 'directory')]],
    [nested, [fakeEntry('payload.bin', 'file')]]
  ]);
  const metadata = new Map([
    [path.join(root, 'main.js'), { isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false, size: 11 }],
    [nested, { isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false, size: 0 }],
    [path.join(nested, 'payload.bin'), { isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false, size: 31 }]
  ]);
  return {
    root,
    readDirectory: async (directory) => entries.get(directory) ?? [],
    inspectPath: async (entryPath) => metadata.get(entryPath)
  };
}

test('size boundary accepts exactly 14,500,000 bytes', () => {
  assert.equal(assertDistSize(DIST_SIZE_LIMIT), DIST_SIZE_LIMIT);
});

test('size boundary rejects 14,500,001 bytes', () => {
  assert.throws(() => assertDistSize(DIST_SIZE_LIMIT + 1), /exceeds the 14\.5 MB safety limit/);
});

test('directoryBytes recursively counts regular files', async () => {
  const tree = fakeTree();
  assert.equal(await directoryBytes(tree.root, tree), 42);
});

test('directoryBytes rejects a symbolic link without following it', async () => {
  const root = path.resolve('/virtual/dist');
  let inspected = false;
  await assert.rejects(
    directoryBytes(root, {
      root,
      readDirectory: async () => [fakeEntry('escape', 'symlink')],
      inspectPath: async () => {
        inspected = true;
        return { isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false, size: 1 };
      }
    }),
    /unsupported dist entry: escape/
  );
  assert.equal(inspected, false);
});

test('directoryBytes rejects a link reported by lstat after a stale file Dirent', async () => {
  const root = path.resolve('/virtual/dist');
  await assert.rejects(
    directoryBytes(root, {
      root,
      readDirectory: async () => [fakeEntry('changed', 'file')],
      inspectPath: async () => ({
        isDirectory: () => false,
        isFile: () => false,
        isSymbolicLink: () => true,
        size: 0
      })
    }),
    /unsupported dist entry: changed/
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  DIST_SIZE_LIMIT_BYTES,
  assertWithinDistSizeLimit,
  directoryBytes
} from '../scripts/dist-size.mjs';

function metadata(kind, size = 0) {
  return {
    size,
    isDirectory: () => kind === 'directory',
    isFile: () => kind === 'file',
    isSymbolicLink: () => kind === 'symlink'
  };
}

function virtualDirectory(root, tree, entries) {
  return directoryBytes(root, {
    readEntries: async (directory) => (tree.get(directory) || []).map((name) => ({ name })),
    inspectEntry: async (entryPath) => entries.get(entryPath),
    baseDirectory: root
  });
}

test('size gate allows exactly 14,500,000 bytes', () => {
  assert.equal(assertWithinDistSizeLimit(DIST_SIZE_LIMIT_BYTES), 14_500_000);
});

test('size gate rejects 14,500,001 bytes without creating a large file', () => {
  assert.throws(() => assertWithinDistSizeLimit(DIST_SIZE_LIMIT_BYTES + 1), /14\.5 MB safety limit/);
});

test('directory byte count includes nested regular files recursively', async () => {
  const root = path.resolve('/virtual/openapi-dist');
  const nested = path.join(root, 'nested');
  const tree = new Map([[root, ['root.js', 'nested']], [nested, ['child.css']]]);
  const entries = new Map([
    [path.join(root, 'root.js'), metadata('file', 17)],
    [nested, metadata('directory')],
    [path.join(nested, 'child.css'), metadata('file', 23)]
  ]);
  assert.equal(await virtualDirectory(root, tree, entries), 40);
});

test('directory byte count rejects symbolic links and other special files', async () => {
  for (const [name, kind, pattern] of [
    ['linked.js', 'symlink', /symbolic link/],
    ['socket', 'special', /special file/]
  ]) {
    const root = path.resolve(`/virtual/openapi-${kind}`);
    const entryPath = path.join(root, name);
    await assert.rejects(
      virtualDirectory(root, new Map([[root, [name]]]), new Map([[entryPath, metadata(kind)]])),
      pattern
    );
  }
});

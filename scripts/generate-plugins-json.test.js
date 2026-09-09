import assert from 'node:assert/strict';
import test from 'node:test';
import { mergePluginManifests } from './generate-plugins-json.js';

test('mergePluginManifests keeps old Release URLs for unchanged plugins', () => {
  const previous = [
    {
      name: 'unchanged',
      version: '1.0.0',
      downloadUrl: 'https://github.com/ZToolsCenter/ZTools-plugins/releases/download/v1/unchanged-1.0.0.zip',
      logo: 'data:image/png;base64,old',
      size: 10,
    },
    {
      name: 'deleted',
      version: '1.0.0',
      downloadUrl: 'https://github.com/ZToolsCenter/ZTools-plugins/releases/download/v1/deleted-1.0.0.zip',
    },
  ];
  const current = [{
    name: 'changed',
    version: '2.0.0',
    downloadUrl: 'https://github.com/ZToolsCenter/ZTools-plugins/releases/download/v2/changed-2.0.0.zip',
    size: 20,
  }];

  const merged = mergePluginManifests(current, previous, {
    changedPlugins: ['changed'],
    deletedPlugins: ['deleted'],
  });

  assert.deepEqual(merged, [current[0], previous[0]]);
});

test('mergePluginManifests supports deletion-only releases', () => {
  const previous = [
    { name: 'keep', version: '1.0.0', downloadUrl: 'https://example.test/keep.zip' },
    { name: 'remove-me', version: '1.0.0', downloadUrl: 'https://example.test/remove-me.zip' },
  ];

  const merged = mergePluginManifests([], previous, { changedPlugins: [], deletedPlugins: ['remove-me'] });

  assert.deepEqual(merged, [previous[0]]);
});

test('mergePluginManifests treats build-all as the complete repository snapshot', () => {
  const previous = [
    { name: 'keep', version: '1.0.0', downloadUrl: 'https://example.test/keep.zip' },
    { name: 'removed-from-repository', version: '1.0.0', downloadUrl: 'https://example.test/old.zip' },
  ];

  const merged = mergePluginManifests(
    [previous[0]],
    previous,
    { changedPlugins: ['keep'], deletedPlugins: [], buildAll: true },
  );

  assert.deepEqual(merged, [previous[0]]);
});

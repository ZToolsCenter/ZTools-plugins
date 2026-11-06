import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { removePluginsFromManifest, formatRemovalNotes } from './remove-plugins.js';

const previous = [
  { name: 'keep', version: '1.0.0', logo: 'data:image/png;base64,old', size: 123, downloadUrl: 'https://example.test/v1/keep-1.0.0.zip' },
  { name: 'encode-helper', title: '编码助手', version: '2.0.2', downloadUrl: 'https://example.test/v1/encode-2.0.2.zip' },
  { name: 'another', version: '1.0.0', downloadUrl: 'https://example.test/v1/another-1.0.0.zip' },
];

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ztools-removal-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'release'));
  mkdirSync(join(dir, 'plugins'));
  return dir;
}

function runScript(dir, script, env = {}) {
  return spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], {
    cwd: dir,
    encoding: 'utf-8',
    env: { ...process.env, BUILD_ALL: 'false', BUILD_PLUGINS: '', RELEASE_OPERATION: 'build', ...env },
  });
}

test('removal matches manifest names, deduplicates requests and preserves other metadata', () => {
  const result = removePluginsFromManifest(previous, ['encode-helper', 'ENCODE-HELPER', 'another']);
  assert.deepEqual(result.plugins, [previous[0]]);
  assert.equal(result.plugins[0], previous[0]);
  assert.deepEqual(result.removedPlugins, previous.slice(1));
});

test('removal requires manifest names even when source and download directory aliases exist', t => {
  const dir = workspace(t);
  mkdirSync(join(dir, 'plugins/encode/public'), { recursive: true });
  writeFileSync(join(dir, 'plugins/encode/public/plugin.json'), JSON.stringify({ name: 'encode-helper' }));
  writeFileSync(join(dir, 'release/build-info.json'), JSON.stringify({ operation: 'remove', requestedRemovals: ['encode'] }));
  writeFileSync(join(dir, 'release/plugins.previous.json'), JSON.stringify(previous));
  const result = runScript(dir, 'generate-plugins-json.js');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /请填写 plugins.json 中的 name/);
  assert.equal(existsSync(join(dir, 'release/plugins.json')), false);
  assert.deepEqual(removePluginsFromManifest(previous, ['encode-helper']).plugins, [previous[0], previous[2]]);
});

test('removal rejects an unknown target instead of partially applying a batch', () => {
  const snapshot = structuredClone(previous);
  assert.throws(() => removePluginsFromManifest(previous, ['encode-helper', 'missing']), /找不到待下架插件: missing/);
  assert.deepEqual(previous, snapshot);
});

test('removal rejects duplicate matching names in the manifest', () => {
  assert.throws(() => removePluginsFromManifest([...previous, { name: 'encode-helper' }], ['encode-helper']), /匹配有歧义/);
});

test('removal rejects missing manifests, invalid entries, empty requests and invalid names', () => {
  assert.throws(() => removePluginsFromManifest(null, ['encode-helper']), /需要最新 Release/);
  assert.throws(() => removePluginsFromManifest([null], ['encode-helper']), /无效插件条目/);
  assert.throws(() => removePluginsFromManifest(previous, []), /至少一个插件/);
  assert.throws(() => removePluginsFromManifest(previous, ['']), /无效的插件名称/);
});

test('removal notes list display names and identifiers with Markdown escaped', () => {
  const notes = formatRemovalNotes([{ name: 'encode-helper', title: '[编码]\n助手' }]);
  assert.match(notes, /## 下架的插件/);
  assert.ok(notes.includes('\\[编码\\] 助手（encode-helper）'));
});

test('remove action skips all platform builds and generates a complete manifest and removal notes', t => {
  const dir = workspace(t);
  const output = join(dir, 'detect-output');
  const detected = runScript(dir, 'detect-changes.js', {
    RELEASE_OPERATION: 'remove', BUILD_PLUGINS: 'encode-helper,\nanother encode-helper', GITHUB_OUTPUT: output,
    GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '2',
  });
  assert.equal(detected.status, 0, detected.stderr);
  const buildInfo = JSON.parse(readFileSync(join(dir, 'release/build-info.json'), 'utf-8'));
  assert.equal(buildInfo.operation, 'remove');
  assert.deepEqual(buildInfo.changedPlugins, []);
  assert.equal(buildInfo.buildAll, false);
  assert.match(buildInfo.releaseVersion, /\.12345\.2$/);
  assert.match(readFileSync(output, 'utf-8'), /has_changes=true/);

  const splitOutput = join(dir, 'split-output');
  const split = runScript(dir, 'split-build-info-by-platform.js', { GITHUB_OUTPUT: splitOutput });
  assert.equal(split.status, 0, split.stderr);
  const platforms = readFileSync(splitOutput, 'utf-8');
  for (const platform of ['linux', 'windows', 'macos']) {
    assert.ok(platforms.includes(`has_${platform}=false`));
  }

  writeFileSync(join(dir, 'release/plugins.previous.json'), JSON.stringify({ plugins: previous }));
  writeFileSync(join(dir, 'categories-mapping.json'), JSON.stringify([{ key: 'other', list: ['encode-helper', 'another'] }]));
  const generated = runScript(dir, 'generate-plugins-json.js');
  assert.equal(generated.status, 0, generated.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'release/plugins.json'), 'utf-8')), [previous[0]]);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'release/categories.json'), 'utf-8')), [{ key: 'other', list: ['keep'] }]);
  const notes = readFileSync(join(dir, 'release/removed-plugins.md'), 'utf-8');
  assert.ok(notes.includes('编码助手（encode-helper）'));
  assert.ok(notes.includes('another（another）'));
  assert.ok(!notes.includes('keep'));
});

test('remove action rejects empty inputs, build_all and unknown operations before creating build info', t => {
  const dir = workspace(t);
  for (const env of [
    { RELEASE_OPERATION: 'remove' },
    { RELEASE_OPERATION: 'remove', BUILD_ALL: 'true', BUILD_PLUGINS: 'encode-helper' },
    { RELEASE_OPERATION: 'invalid' },
  ]) {
    const result = runScript(dir, 'detect-changes.js', env);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(dir, 'release/build-info.json')), false);
  }
});

test('remove generator stops on absent or malformed history, unresolved targets and unexpected ZIPs', t => {
  const dir = workspace(t);
  const release = join(dir, 'release');
  writeFileSync(join(release, 'build-info.json'), JSON.stringify({ operation: 'remove', requestedRemovals: ['missing'] }));
  for (const manifest of [undefined, '{', JSON.stringify(previous)]) {
    if (manifest !== undefined) writeFileSync(join(release, 'plugins.previous.json'), manifest);
    const result = runScript(dir, 'generate-plugins-json.js');
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(release, 'plugins.json')), false);
  }
  writeFileSync(join(release, 'build-info.json'), JSON.stringify({ operation: 'remove', requestedRemovals: ['encode-helper'] }));
  writeFileSync(join(release, 'unexpected.zip'), 'stale');
  const result = runScript(dir, 'generate-plugins-json.js');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /不能包含构建任务或 ZIP/);
  assert.equal(existsSync(join(release, 'plugins.json')), false);
});

test('removing the last listed plugin generates an empty manifest and empty categories', t => {
  const dir = workspace(t);
  writeFileSync(join(dir, 'release/build-info.json'), JSON.stringify({ operation: 'remove', requestedRemovals: ['keep'] }));
  writeFileSync(join(dir, 'release/plugins.previous.json'), JSON.stringify([previous[0]]));
  writeFileSync(join(dir, 'categories-mapping.json'), JSON.stringify([{ key: 'other', list: ['keep'] }]));
  const generated = runScript(dir, 'generate-plugins-json.js');
  assert.equal(generated.status, 0, generated.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'release/plugins.json'), 'utf-8')), []);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'release/categories.json'), 'utf-8')), [{ key: 'other', list: [] }]);
});

test('normal manual builds still resolve plugin folders and produce build tasks', t => {
  const dir = workspace(t);
  mkdirSync(join(dir, 'plugins/keep'));
  const detected = runScript(dir, 'detect-changes.js', { BUILD_PLUGINS: 'keep' });
  assert.equal(detected.status, 0, detected.stderr);
  const buildInfo = JSON.parse(readFileSync(join(dir, 'release/build-info.json'), 'utf-8'));
  assert.equal(buildInfo.operation, 'build');
  assert.deepEqual(buildInfo.changedPlugins, ['keep']);
  assert.deepEqual(buildInfo.requestedRemovals, []);
});

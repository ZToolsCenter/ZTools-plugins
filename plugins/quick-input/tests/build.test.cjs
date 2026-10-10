'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

test('build produces a self-contained ZTools plugin with resolvable manifest and page assets', () => {
  const result = spawnSync(process.execPath, ['scripts/build.cjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const dist = path.join(root, 'dist');
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'plugin.json'), 'utf8'));
  assert.ok(manifest.name && manifest.version && manifest.features.length);
  for (const field of ['main', 'preload', 'logo']) assert.ok(fs.existsSync(path.join(dist, manifest[field])), `missing ${field}`);
  const html = fs.readFileSync(path.join(dist, manifest.main), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/gu)) {
    assert.ok(fs.existsSync(path.join(dist, match[1])), `missing page asset ${match[1]}`);
  }
  assert.deepEqual([...fs.readFileSync(path.join(dist, manifest.logo)).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const core = require(path.join(dist, 'commands.js'));
  assert.equal(typeof core.createQuickInput, 'function');
});

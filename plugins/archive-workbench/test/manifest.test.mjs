import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('root manifest exposes directly loadable source entrypoints', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.development, undefined);
  assert.equal(manifest.main, 'src/ui/index.html');
  assert.equal(manifest.preload, 'preload/index.cjs');
  assert.equal(manifest.logo, 'logo.svg');
  for (const entry of [manifest.main, manifest.preload, manifest.logo]) await access(path.join(root, entry));
  assert.match(pathToFileURL(path.join(root, manifest.main)).href, /^file:/);
});

test('repository packaging invariants keep the built dist directory eligible', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const buildScript = await readFile(path.join(root, 'scripts', 'build.mjs'), 'utf8');
  assert.equal(typeof packageJson.scripts?.build, 'string');
  assert.match(packageJson.scripts.build, /scripts\/build\.mjs/);
  assert.equal(existsSync(path.join(root, path.dirname(manifest.main), 'plugin.json')), false);
  for (const contract of ["delete m.development", "m.main='index.html'", "m.preload='preload/index.cjs'", "m.logo='logo.svg'"]) {
    assert.ok(buildScript.includes(contract), `build script must preserve ${contract}`);
  }
});

test('human-facing manifest and UI are localized to simplified Chinese', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
  const html = await readFile(path.join(root, 'src', 'ui', 'index.html'), 'utf8');
  const renderer = await readFile(path.join(root, 'src', 'ui', 'app.mjs'), 'utf8');
  assert.equal(manifest.title, '压缩包管家');
  assert.match(manifest.description, /检查 ZIP 安全性/);
  assert.match(manifest.features[0].explain, /安全的解压预案/);
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /<title>压缩包管家<\/title>/);
  for (const visibleEnglish of ['Archive Workbench', 'Choose ZIP', 'Preview safety plan', 'Write boundary', 'Copy extraction plan']) assert.equal(html.includes(visibleEnglish), false);
  for (const visibleEnglish of ['Choose a ZIP first.', 'Plan copied', 'Copy unavailable']) assert.equal(renderer.includes(visibleEnglish), false);
});

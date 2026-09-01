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

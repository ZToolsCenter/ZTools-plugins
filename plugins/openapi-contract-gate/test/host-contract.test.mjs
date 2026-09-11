import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function resolveLocalEntry(relative) {
  assert.equal(path.isAbsolute(relative), false);
  const resolved = path.resolve(root, relative);
  assert.ok(resolved.startsWith(`${root}${path.sep}`));
  assert.ok(fs.statSync(resolved).isFile(), `${relative} must be a loadable file`);
  return resolved;
}

test('host manifest directly loads source entries while dist remains a self-contained CI artifact', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(Object.hasOwn(manifest, 'development'), false);
  assert.deepEqual(
    { main: manifest.main, preload: manifest.preload, logo: manifest.logo },
    { main: 'src/main/index.html', preload: 'src/preload/index.cjs', logo: 'logo.svg' }
  );

  const main = resolveLocalEntry(manifest.main);
  resolveLocalEntry(manifest.preload);
  resolveLocalEntry(manifest.logo);
  const html = fs.readFileSync(main, 'utf8');
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /逐项核对兼容性/);
  assert.doesNotMatch(html, /Previous contract|Candidate contract|Balance the ledger/);
  for (const asset of ['./style.css', './app.js']) {
    assert.match(html, new RegExp(`(?:href|src)=["']${asset.replace('.', '\\.')}`));
    assert.ok(fs.statSync(path.resolve(path.dirname(main), asset)).isFile());
  }

  const build = fs.readFileSync(path.join(root, 'scripts', 'build.mjs'), 'utf8');
  assert.match(build, /delete m\.development/);
  assert.match(build, /m\.main='main\/index\.html'/);
  assert.match(build, /m\.preload='preload\/index\.cjs'/);
});

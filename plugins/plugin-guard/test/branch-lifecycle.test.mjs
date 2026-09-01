import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, open, lstat, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanPlugin } from '../src/core/guard.mjs';

async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'guard-branch-lifecycle-'));
  for (const [relative, source] of Object.entries(files)) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, source);
  }
  return root;
}

function validFiles(deepFiles) {
  return {
    'plugin.json': JSON.stringify({ name: 'x', version: '1', author: 'a', main: 'index.html', logo: 'logo.svg', preload: 'preload.cjs', platform: ['darwin', 'win32', 'linux'], categories: ['other'], features: [] }),
    'index.html': 'ok',
    'logo.svg': 'x',
    'preload.cjs': 'bridge.scan = () => 1',
    ...deepFiles
  };
}

function changedDirectoryInfo(info) {
  return new Proxy(info, { get(value, key) {
    if (key === 'mtimeMs' || key === 'ctimeMs') return Number(value[key]) + 1000;
    const item = Reflect.get(value, key, value);
    return typeof item === 'function' ? item.bind(value) : item;
  } });
}

test('drops a deep branch changed after collection before the first file read', async (t) => {
  const input = await fixture(validFiles({ 'deep/inside.js': 'eval(1)' }));
  t.after(() => rm(input, { recursive: true, force: true }));
  const root = await realpath(input);
  const deep = path.join(root, 'deep');
  const late = path.join(deep, 'late.js');
  const manifest = path.join(root, 'plugin.json');
  let mutated = false;
  let openedDeep = false;
  const report = await scanPlugin(root, { io: {
    lstat: async (target) => {
      const info = await lstat(target);
      return mutated && path.resolve(target) === path.resolve(deep) ? changedDirectoryInfo(info) : info;
    },
    open: async (target, flags) => {
      if (!mutated && path.resolve(target) === path.resolve(manifest)) {
        await writeFile(late, 'late');
        mutated = true;
      }
      if (path.resolve(target).startsWith(`${path.resolve(deep)}${path.sep}`)) openedDeep = true;
      return open(target, flags);
    }
  } });
  assert.equal(mutated, true);
  assert.equal(openedDeep, false);
  assert.equal(report.issues.filter((finding) => finding.code === 'directory-race' && finding.file === 'deep').length, 1);
  assert.equal(report.entries.some((entry) => entry.rel.startsWith('deep/')), false);
  assert.equal(report.risks.some((finding) => finding.file?.startsWith('deep/')), false);
  assert.equal(report.risks.some((finding) => finding.code === 'eval'), false);
});

test('invalidating a partially audited branch restores finding totals and does not read its open handle', async (t) => {
  const input = await fixture(validFiles({ 'deep/a.js': 'eval(1); require(variable)', 'deep/b.js': 'safe' }));
  t.after(() => rm(input, { recursive: true, force: true }));
  const root = await realpath(input);
  const deep = path.join(root, 'deep');
  const late = path.join(deep, 'late.js');
  const trigger = path.join(deep, 'b.js');
  let mutated = false;
  let readInvalidatedHandle = false;
  const report = await scanPlugin(root, { findingLimit: 1, io: {
    readdir: async (directory, options) => (await readdir(directory, options)).sort((left, right) => left.name.localeCompare(right.name)),
    lstat: async (target) => {
      const info = await lstat(target);
      return mutated && path.resolve(target) === path.resolve(deep) ? changedDirectoryInfo(info) : info;
    },
    open: async (target, flags) => {
      const handle = await open(target, flags);
      if (path.resolve(target) !== path.resolve(trigger)) return handle;
      await writeFile(late, 'late');
      mutated = true;
      return {
        stat: (...args) => handle.stat(...args),
        read: (...args) => { readInvalidatedHandle = true; return handle.read(...args); },
        close: () => handle.close()
      };
    }
  } });
  assert.equal(mutated, true);
  assert.equal(readInvalidatedHandle, false);
  assert.deepEqual(report.findingTotals, { issues: 1, risks: 0, findings: 1 });
  assert.equal(report.retainedFindings, 1);
  assert.equal(report.findingsTruncated, false);
  assert.equal(report.entries.some((entry) => entry.rel.startsWith('deep/')), false);
  assert.equal([...report.issues, ...report.risks].some((finding) => finding.file?.startsWith('deep/') && finding.code !== 'directory-race'), false);
});

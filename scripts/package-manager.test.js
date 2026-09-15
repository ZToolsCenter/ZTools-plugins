import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectPackageManager,
  detectPackageManagersInTree,
  getPackageManagerInvocation,
} from './package-manager.js';

async function createFixture() {
  return mkdtemp(join(tmpdir(), 'ztools-package-manager-'));
}

test('uses an explicit Bun packageManager declaration', async () => {
  const root = await createFixture();
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ packageManager: 'bun@1.3.14' }));
    const result = detectPackageManager(root);
    assert.equal(result.name, 'bun');
    assert.equal(result.version, '1.3.14');
    assert.equal(result.source, 'packageManager');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('detects Bun from bun.lock when packageManager is absent', async () => {
  const root = await createFixture();
  try {
    await writeFile(join(root, 'package.json'), '{}');
    await writeFile(join(root, 'bun.lock'), '');
    const result = detectPackageManager(root);
    assert.equal(result.name, 'bun');
    assert.deepEqual(result.lockfiles, ['bun.lock']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('supports the legacy bun.lockb filename', async () => {
  const root = await createFixture();
  try {
    await writeFile(join(root, 'package.json'), '{}');
    await writeFile(join(root, 'bun.lockb'), '');
    const result = detectPackageManager(root);
    assert.equal(result.name, 'bun');
    assert.deepEqual(result.lockfiles, ['bun.lockb']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects conflicting lockfile families without an explicit declaration', async () => {
  const root = await createFixture();
  try {
    await writeFile(join(root, 'package.json'), '{}');
    await writeFile(join(root, 'bun.lock'), '');
    await writeFile(join(root, 'package-lock.json'), '{}');
    assert.throws(() => detectPackageManager(root), /同时存在不同包管理器/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('finds Bun in nested projects used by custom build scripts', async () => {
  const root = await createFixture();
  const nested = join(root, 'upstream');
  try {
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, 'package.json'), '{}');
    await writeFile(join(nested, 'package.json'), JSON.stringify({ packageManager: 'bun@1.3.14' }));
    const names = detectPackageManagersInTree(root).map(({ name }) => name).sort();
    assert.deepEqual(names, ['bun', 'npm']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runs package managers through the Windows command shell', () => {
  assert.deepEqual(getPackageManagerInvocation('npm', ['install'], 'win32'), {
    command: 'npm',
    args: ['install'],
    shell: true,
  });
  assert.deepEqual(getPackageManagerInvocation('pnpm', ['run', 'build'], 'win32'), {
    command: 'pnpm',
    args: ['run', 'build'],
    shell: true,
  });
});

test('executes package managers directly outside Windows', () => {
  assert.deepEqual(getPackageManagerInvocation('bun', ['install'], 'linux'), {
    command: 'bun',
    args: ['install'],
    shell: false,
  });
});

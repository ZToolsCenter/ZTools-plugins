import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCKFILES = [
  { file: 'bun.lock', name: 'bun' },
  { file: 'bun.lockb', name: 'bun' },
  { file: 'pnpm-lock.yaml', name: 'pnpm' },
  { file: 'package-lock.json', name: 'npm' },
  { file: 'npm-shrinkwrap.json', name: 'npm' },
];

const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.tools',
  'dist',
  'node_modules',
  'release',
]);

function parsePackageManager(value) {
  if (typeof value !== 'string') return null;

  const match = /^([a-z][a-z0-9+.-]*)(?:@(.+))?$/.exec(value.trim());
  if (!match || !['bun', 'npm', 'pnpm'].includes(match[1])) return null;

  return {
    name: match[1],
    version: match[2] || null,
  };
}

function readPackageJson(packageJsonPath) {
  if (!existsSync(packageJsonPath)) return null;
  return JSON.parse(readFileSync(packageJsonPath, 'utf8'));
}

function findLockfiles(pluginPath) {
  return LOCKFILES.filter(({ file }) => existsSync(join(pluginPath, file)));
}

/**
 * Windows package-manager commands may be .cmd shims, which Node cannot
 * execute directly. Running them through cmd.exe also lets PATHEXT resolve the
 * appropriate shim or native executable.
 */
export function getPackageManagerInvocation(name, args, platform = process.platform) {
  return {
    command: name,
    args,
    shell: platform === 'win32',
  };
}

/**
 * Detect the package manager for one project directory.
 * An explicit packageManager field wins over lockfiles; conflicting lockfile
 * families are rejected so CI does not silently install the wrong tree.
 */
export function detectPackageManager(projectPath) {
  const packageJson = readPackageJson(join(projectPath, 'package.json'));
  const declared = parsePackageManager(packageJson?.packageManager);

  if (declared) {
    return {
      ...declared,
      source: 'packageManager',
      lockfiles: findLockfiles(projectPath).map(({ file }) => file),
    };
  }

  const lockfiles = findLockfiles(projectPath);
  const lockfileManagers = [...new Set(lockfiles.map(({ name }) => name))];

  if (lockfileManagers.length > 1) {
    throw new Error(
      `项目 ${projectPath} 同时存在不同包管理器的 lockfile (${lockfiles.map(({ file }) => file).join(', ')}), ` +
      '请在 package.json 中声明 packageManager',
    );
  }

  const name = lockfileManagers[0] || 'npm';
  return {
    name,
    version: null,
    source: lockfiles.length > 0 ? 'lockfile' : 'default',
    lockfiles: lockfiles.map(({ file }) => file),
  };
}

function hasProjectMetadata(projectPath) {
  return existsSync(join(projectPath, 'package.json')) || findLockfiles(projectPath).length > 0;
}

function collectProjectDirectories(rootPath, result = []) {
  if (hasProjectMetadata(rootPath)) result.push(rootPath);

  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIPPED_DIRECTORIES.has(entry.name)) continue;
    collectProjectDirectories(join(rootPath, entry.name), result);
  }

  return result;
}

/**
 * Detect all package managers declared by a plugin tree. This covers custom
 * build scripts that build a nested project such as plugins/goose-notes/upstream.
 */
export function detectPackageManagersInTree(pluginPath) {
  const managers = new Map();

  for (const projectPath of collectProjectDirectories(pluginPath)) {
    const manager = detectPackageManager(projectPath);
    if (!managers.has(manager.name)) managers.set(manager.name, manager);
  }

  return [...managers.values()];
}

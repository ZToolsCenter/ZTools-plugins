#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectPackageManagersInTree } from './package-manager.js';

const buildInfoPath = process.argv[2] || join('release', 'build-info.json');
if (!existsSync(buildInfoPath)) {
  throw new Error(`找不到构建信息文件: ${buildInfoPath}`);
}

const buildInfo = JSON.parse(readFileSync(buildInfoPath, 'utf8'));
const changedPlugins = Array.isArray(buildInfo.changedPlugins) ? buildInfo.changedPlugins : [];
const managers = new Map();

for (const pluginName of changedPlugins) {
  const pluginPath = join('plugins', pluginName);
  if (!existsSync(pluginPath)) {
    throw new Error(`找不到插件目录: ${pluginPath}`);
  }

  for (const manager of detectPackageManagersInTree(pluginPath)) {
    managers.set(manager.name, manager);
  }
}

const packageManagers = [...managers.keys()].sort();
const needsBun = packageManagers.includes('bun');
const outputs = [
  `needs_bun=${needsBun ? 'true' : 'false'}`,
  `package_managers=${packageManagers.join(',')}`,
];

console.log(`构建所需包管理器: ${packageManagers.join(', ') || 'none'}`);
console.log(`是否需要 Bun: ${needsBun ? '是' : '否'}`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `${outputs.join('\n')}\n`);
}

#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const RELEASE_DIR = 'release';
const BUILD_INFO_FILE = join(RELEASE_DIR, 'build-info.json');
const GROUPS = {
  linux: {
    output: join(RELEASE_DIR, 'build-info.linux.json'),
    plugins: [],
  },
  windows: {
    output: join(RELEASE_DIR, 'build-info.windows.json'),
    plugins: [],
  },
  macos: {
    output: join(RELEASE_DIR, 'build-info.macos.json'),
    plugins: [],
  },
};

if (!existsSync(BUILD_INFO_FILE)) {
  console.error('找不到 release/build-info.json，请先运行变更检测脚本');
  process.exit(1);
}

if (!existsSync(RELEASE_DIR)) {
  mkdirSync(RELEASE_DIR, { recursive: true });
}

const buildInfo = JSON.parse(readFileSync(BUILD_INFO_FILE, 'utf-8'));
const changedPlugins = Array.isArray(buildInfo.changedPlugins) ? buildInfo.changedPlugins : [];

for (const pluginName of changedPlugins) {
  const pluginInfo = getPluginInfo(pluginName);
  const group = getBuildGroup(pluginInfo.platform);
  GROUPS[group].plugins.push(pluginName);
}

for (const [groupName, group] of Object.entries(GROUPS)) {
  const groupBuildInfo = {
    ...buildInfo,
    hasChanges: group.plugins.length > 0,
    changedPlugins: group.plugins,
  };

  writeFileSync(group.output, JSON.stringify(groupBuildInfo, null, 2));
  console.log(`${groupName}: ${group.plugins.length > 0 ? group.plugins.join(', ') : '(none)'}`);
}

if (process.env.GITHUB_OUTPUT) {
  const lines = [
    `has_linux=${GROUPS.linux.plugins.length > 0 ? 'true' : 'false'}`,
    `has_windows=${GROUPS.windows.plugins.length > 0 ? 'true' : 'false'}`,
    `has_macos=${GROUPS.macos.plugins.length > 0 ? 'true' : 'false'}`,
    `linux_plugins=${GROUPS.linux.plugins.join(',')}`,
    `windows_plugins=${GROUPS.windows.plugins.join(',')}`,
    `macos_plugins=${GROUPS.macos.plugins.join(',')}`,
  ];

  appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
}

function getPluginInfo(pluginName) {
  const pluginJsonPaths = [
    join('plugins', pluginName, 'plugin.json'),
    join('plugins', pluginName, 'public', 'plugin.json'),
    join('plugins', pluginName, 'dist', 'plugin.json'),
  ];

  for (const pluginJsonPath of pluginJsonPaths) {
    if (existsSync(pluginJsonPath)) {
      return JSON.parse(readFileSync(pluginJsonPath, 'utf-8'));
    }
  }

  console.warn(`找不到插件 ${pluginName} 的 plugin.json，默认使用 linux 构建`);
  return {};
}

function getBuildGroup(platform) {
  if (Array.isArray(platform) && platform.length === 1) {
    if (platform[0] === 'win32') return 'windows';
    if (platform[0] === 'darwin') return 'macos';
  }

  return 'linux';
}

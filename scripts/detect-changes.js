#!/usr/bin/env node
import { execSync } from 'child_process';
import { readdirSync, statSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const PLUGINS_DIR = 'plugins';

// 解析命令行参数
const args = process.argv.slice(2);
const BUILD_ALL = args.includes('--all') || process.env.BUILD_ALL === 'true';

/**
 * 获取所有插件目录
 */
function getAllPlugins() {
  return readdirSync(PLUGINS_DIR)
    .filter(name => {
      const pluginPath = join(PLUGINS_DIR, name);
      return statSync(pluginPath).isDirectory();
    });
}

/**
 * 检测变动的插件
 */
function detectChangedPlugins() {
  // 如果指定了--all参数，构建所有插件
  if (BUILD_ALL) {
    console.log('检测到 --all 参数，将构建所有插件');
    return getAllPlugins();
  }

  try {
    // 获取上一次提交的hash
    const lastCommit = execSync('git rev-parse HEAD~1', { encoding: 'utf-8' }).trim();
    const currentCommit = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();

    console.log(`检测从 ${lastCommit} 到 ${currentCommit} 的变动...`);

    // 获取变动的文件
    const changedFiles = execSync(`git diff --name-only ${lastCommit} ${currentCommit}`, {
      encoding: 'utf-8'
    }).trim().split('\n').filter(Boolean);

    console.log('变动的文件:', changedFiles);

    // 提取变动的插件
    const changedPlugins = new Set();
    changedFiles.forEach(file => {
      if (file.startsWith('plugins/')) {
        const parts = file.split('/');
        if (parts.length >= 2) {
          changedPlugins.add(parts[1]);
        }
      }
    });

    return Array.from(changedPlugins);
  } catch (error) {
    console.log('无法检测git变动，可能是首次提交，构建所有插件');
    return getAllPlugins();
  }
}

/**
 * 生成release版本号
 */
function generateReleaseVersion() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');

  return `${year}.${month}.${day}.${hour}${minute}`;
}

// 主逻辑
const changedPlugins = detectChangedPlugins();

if (changedPlugins.length === 0) {
  console.log('没有检测到插件变动');

  // 写入GitHub Actions输出
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, 'has_changes=false\n', { flag: 'a' });
  }

  process.exit(0);
}

console.log(`检测到 ${changedPlugins.length} 个插件变动:`, changedPlugins);

// 生成release版本号
const releaseVersion = generateReleaseVersion();

// 输出到GitHub Actions（只输出插件名称列表）
if (process.env.GITHUB_OUTPUT) {
  const outputContent = [
    'has_changes=true',
    `release_version=${releaseVersion}`,
    `changed_plugins=${changedPlugins.join(',')}`
  ].join('\n') + '\n';

  writeFileSync(process.env.GITHUB_OUTPUT, outputContent, { flag: 'a' });
}

console.log('构建信息:');
console.log(`  - 有变动: true`);
console.log(`  - Release版本: ${releaseVersion}`);
console.log(`  - 变动插件: ${changedPlugins.join(', ')}`);

// 保存到文件供后续步骤使用
const output = {
  hasChanges: true,
  releaseVersion,
  changedPlugins: changedPlugins
};

// 确保release目录存在
const releaseDir = 'release';
if (!existsSync(releaseDir)) {
  mkdirSync(releaseDir, { recursive: true });
}

writeFileSync('release/build-info.json', JSON.stringify(output, null, 2));
console.log('构建信息已保存到 release/build-info.json');

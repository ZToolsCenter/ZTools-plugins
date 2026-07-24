#!/usr/bin/env node
import { existsSync, readdirSync, rmSync } from 'fs';
import { join, relative, resolve } from 'path';

const PLUGINS_DIR = resolve('plugins');
const DRY_RUN = process.argv.includes('--dry-run');

function findNodeModulesDirs(dir) {
  const dirs = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const entryPath = join(dir, entry.name);

    if (entry.name === 'node_modules') {
      dirs.push(entryPath);
      continue;
    }

    dirs.push(...findNodeModulesDirs(entryPath));
  }

  return dirs;
}

if (!existsSync(PLUGINS_DIR)) {
  console.error('找不到 plugins 目录');
  process.exit(1);
}

const nodeModulesDirs = findNodeModulesDirs(PLUGINS_DIR);

if (nodeModulesDirs.length === 0) {
  console.log('plugins 目录下没有需要清理的 node_modules');
  process.exit(0);
}

console.log(`检测到 ${nodeModulesDirs.length} 个 node_modules 目录:`);

for (const dir of nodeModulesDirs) {
  const displayPath = relative(process.cwd(), dir);

  if (DRY_RUN) {
    console.log(`  - ${displayPath}`);
    continue;
  }

  rmSync(dir, { recursive: true, force: true });
  console.log(`  ✓ 已删除 ${displayPath}`);
}

if (DRY_RUN) {
  console.log('\n当前为预览模式，未删除任何文件');
} else {
  console.log('\nplugins 下的 node_modules 清理完成');
}

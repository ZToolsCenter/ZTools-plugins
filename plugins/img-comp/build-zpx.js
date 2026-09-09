// 构建脚本：生成完整插件目录，并生成可安装的 Brotli ZPX
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const asar = require('@electron/asar');
const { collectRuntimePackages, ROOT } = require('./release-deps');

const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(ROOT, '.zpx-stage');
const ASAR = path.join(ROOT, '.img-comp.asar');
const ZPX = path.join(DIST, 'img-comp.zpx');
const SOURCE_FILES = [
  'plugin.json',
  'index.html',
  'index.css',
  'index.js',
  'preload.js',
  'runtime-service.js',
  'compression-worker.js',
  'compression-engine.js',
  'assets/logo.png',
  'package.json',
  'README.md',
  'LICENSE'
];
const OMIT_DIRS = new Set([
  '.git', '.github', '.circleci', 'test', 'tests', 'demo', 'examples',
  '__tests__', 'coverage', 'benchmark', 'benchmarks'
]);

/**
 * 复制发布包中的文件树，并过滤测试、源码映射和开发元数据。
 * @param {string} source 源路径
 * @param {string} target 目标路径
 */
function copyRuntimeTree(source, target) {
  const stat = fs.statSync(source);
  const base = path.basename(source);
  if (stat.isDirectory()) {
    if (OMIT_DIRS.has(base)) return;
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyRuntimeTree(path.join(source, entry), path.join(target, entry));
    }
    return;
  }
  if (!stat.isFile()) return;
  if (/\.(map|ts|d\.ts)$/i.test(base)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

/**
 * 清理并创建构建暂存目录。
 */
function resetDirectories() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.rmSync(STAGE, { recursive: true, force: true });
  for (const file of [ASAR]) {
    try { fs.unlinkSync(file); } catch {}
  }
  fs.mkdirSync(STAGE, { recursive: true });
}

/**
 * 把插件源文件复制到暂存目录。
 */
function stageSourceFiles() {
  for (const relativePath of SOURCE_FILES) {
    const source = path.join(ROOT, relativePath);
    if (!fs.existsSync(source)) throw new Error(`缺少发布文件: ${relativePath}`);
    copyRuntimeTree(source, path.join(STAGE, relativePath));
  }
}

/**
 * 把运行时依赖闭包复制到暂存目录。
 */
function stageRuntimeDependencies() {
  for (const item of collectRuntimePackages()) {
    const relativeRoot = path.relative(ROOT, item.root);
    copyRuntimeTree(item.root, path.join(STAGE, relativeRoot));
  }
}

/**
 * 构建并压缩 ZTools 插件包。
 */
async function main() {
  resetDirectories();
  stageSourceFiles();
  stageRuntimeDependencies();

  console.log('[build] asar pack ->', ASAR);
  await asar.createPackage(STAGE, ASAR);

  // dist 本身就是官方 Action 后续需要打 ZIP 的完整插件目录。
  fs.cpSync(STAGE, DIST, { recursive: true });
  console.log('[build] plugin dir ->', DIST);

  console.log('[build] brotli ->', ZPX);
  const archive = await fsp.readFile(ASAR);
  const compressed = zlib.brotliCompressSync(archive, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 }
  });
  await fsp.writeFile(ZPX, compressed);
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.rmSync(ASAR, { force: true });

  const size = fs.statSync(ZPX).size;
  console.log('  ', ZPX, '-', (size / 1024 / 1024).toFixed(2), 'MB');
  console.log('[build] OK');
}

main().catch(error => {
  console.error('BUILD FAILED:', error);
  try { fs.rmSync(STAGE, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(ASAR, { force: true }); } catch {}
  process.exit(1);
});

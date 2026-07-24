'use strict';
// 自动获取 macOS 微信 OCR 运行时文件 (wechat-ocr-mac/)。
//
// 这些文件（libwxocr.dylib / libmmmojo.dylib + 模型）归腾讯所有，不随本仓库分发。
// 它们被打包在已发布的 npm 包 @ztools-center/wechat-ocr-native 的 dist/vendor/
// 下。本脚本在 macOS native 构建（npm run build:mac）时调用，把这些文件提取到
// native/wechat-ocr-mac/，使编译出的 wechat_ocr.node 在运行时能 dlopen 到
// libwxocr.dylib / libmmmojo.dylib 并读取模型。
//
// 对称于 Windows 侧的 fetch-wco-data.cjs（从 NuGet 取 wco_data）。
//
// 行为：
//   * 幂等：wechat-ocr-mac/lib/libwxocr.dylib 已存在则直接跳过（除非 --force）。
//   * 容错：网络失败时打印清晰告警并退出码 0，不阻断构建（离线环境下仍允许先完成
//     node-gyp 编译；vendor 缺失时插件前端会提示用户下载）。
//   * 校验：提取后复检关键文件，缺则告警。
//
// 用法：node scripts/fetch-mac-vendor.cjs [--force] [--version 0.1.0]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// ── 配置 ────────────────────────────────────────────────────────────────
// 携带 macOS 微信 OCR 运行时的 npm 包。dylib 为 universal(x86_64+arm64)。
const PKG_ID = '@ztools-center/wechat-ocr-native';
const DEFAULT_VERSION = '0.1.0';

// 关键文件清单（与 preload/services.js 的 nativeStatus() 保持一致）。
const REQUIRED = [
  'lib/libwxocr.dylib',
  'lib/libmmmojo.dylib',
  'models/text_det_fp16_v1.xnet',
  'models/text_rec_fp16_v2.xnet',
  'models/charset_zh10798.txt'
];

function log(...a) { console.log('[fetch-mac-vendor]', ...a); }
function warn(...a) { console.warn('[fetch-mac-vendor] WARNING:', ...a); }

function parseArgs(argv) {
  const out = { force: false, version: DEFAULT_VERSION };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') out.force = true;
    else if (a === '--version') out.version = argv[++i] || DEFAULT_VERSION;
  }
  return out;
}

function checkReady(vendorDir) {
  const missing = REQUIRED.filter((f) => !fs.existsSync(path.join(vendorDir, f)));
  return { ready: missing.length === 0, missing };
}

// 递归复制目录（跳过 .DS_Store），保留文件权限（dylib 需可执行位）。
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
      fs.chmodSync(to, fs.statSync(from).mode);
    }
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const nativeDir = path.resolve(__dirname, '..');
  const vendorDir = path.join(nativeDir, 'wechat-ocr-mac');

  // 幂等：已存在且未强制则跳过。
  if (!opts.force && fs.existsSync(path.join(vendorDir, 'lib', 'libwxocr.dylib'))) {
    log('wechat-ocr-mac/lib/libwxocr.dylib 已存在，跳过下载。');
    return;
  }

  // npm pack 到临时目录，再解压提取 dist/vendor/wechat-ocr-mac/*。
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wco-mac-'));
  try {
    log(`从 npm 获取 ${PKG_ID}@${opts.version}（含 macOS 微信 OCR 运行时）...`);
    const spec = `${PKG_ID}@${opts.version}`;
    const packed = spawnSync('npm', ['pack', spec, '--pack-destination', tmpDir], {
      encoding: 'utf8',
      shell: false
    });
    if (packed.status !== 0) {
      throw new Error('npm pack 失败: ' + (packed.stderr || packed.stdout || '').trim());
    }
    const tgz = fs.readdirSync(tmpDir).find((f) => f.endsWith('.tgz'));
    if (!tgz) throw new Error('npm pack 未产出 tgz');

    log('解压并提取 vendor/...');
    const untar = spawnSync('tar', ['-xzf', path.join(tmpDir, tgz), '-C', tmpDir], {
      encoding: 'utf8',
      shell: false
    });
    if (untar.status !== 0) {
      throw new Error('解压失败: ' + (untar.stderr || untar.stdout || '').trim());
    }

    const srcVendor = path.join(tmpDir, 'package', 'dist', 'vendor', 'wechat-ocr-mac');
    if (!fs.existsSync(srcVendor)) {
      throw new Error('npm 包内未找到 dist/vendor/wechat-ocr-mac');
    }

    fs.rmSync(vendorDir, { recursive: true, force: true });
    copyDir(srcVendor, vendorDir);
    // 去掉 quarantine，避免 Gatekeeper 阻止 dlopen。
    spawnSync('xattr', ['-dr', 'com.apple.quarantine', vendorDir], { stdio: 'ignore' });

    const { ready, missing } = checkReady(vendorDir);
    if (!ready) {
      warn('提取完成但缺少关键文件:', missing.join(', '));
      warn('插件运行时可能不可用，请检查网络后重试 `npm run build:mac`。');
    } else {
      log('wechat-ocr-mac/ 就绪。');
    }
  } catch (e) {
    // 容错：不阻断构建。用户离线时仍能完成 node-gyp 编译。
    warn('获取 wechat-ocr-mac 失败:', e && e.message ? e.message : String(e));
    warn('原生模块仍会编译，但 macOS OCR 运行时缺失。');
    warn('联网后可重新运行 `npm run build:mac`（或 `node scripts/fetch-mac-vendor.cjs`）自动获取。');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

main();

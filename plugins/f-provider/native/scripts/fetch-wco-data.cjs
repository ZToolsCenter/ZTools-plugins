'use strict';
// 自动获取腾讯专有 OCR 运行时文件 (wco_data/)。
//
// 这些文件归腾讯所有，不随仓库分发，也不在 NuGet 包 wechatocr 的托管代码里——
// 它们被打包在该 NuGet 包的 content/wco_data/ 下（与 STranslate 项目的获取方式一致：
// 还原依赖时自动落盘）。本脚本在 native 构建（npm run build）时调用，把 wco_data/
// 提取到当前 native 目录，使原生模块 wechat_ocr.node 在运行时能找到 WeChatOCR.exe
// + Model。
//
// 行为：
//   * 幂等：wco_data/WeChatOCR.exe 已存在则直接跳过（除非 --force）。
//   * 容错：网络/解压失败时打印清晰告警并退出码 0，不阻断构建（离线环境下仍允许
//     先完成 node-gyp 编译；wco_data 缺失时插件前端会提示用户手动下载）。
//   * 校验：提取后复检关键文件，缺则告警。
//
// 用法：node scripts/fetch-wco-data.cjs [--force] [--version 1.0.4]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// ── 配置 ────────────────────────────────────────────────────────────────
// 携带 wco_data 的 NuGet 包。源同步自 STranslate (Directory.Packages.props)。
const DEFAULT_VERSION = '1.0.4';
const PKG_ID = 'wechatocr';

// 关键文件清单（与 preload/services.js 的 nativeStatus() 保持一致）。
const REQUIRED = ['WeChatOCR.exe', 'mmmojo_64.dll'];

function log(...a) { console.log('[fetch-wco-data]', ...a); }
function warn(...a) { console.warn('[fetch-wco-data] WARNING:', ...a); }

function parseArgs(argv) {
  const out = { force: false, version: DEFAULT_VERSION };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') out.force = true;
    else if (a === '--version') out.version = argv[++i] || DEFAULT_VERSION;
  }
  return out;
}

// 下载 nupkg（141MB 级），支持跟随重定向，带进度。
// 用 Web ReadableStream 的异步迭代消费 fetch 的 body（Node 18+ 的 fetch 返回的是
// Web 流，不是 Node stream，不能直接 .on('data')/.pipe()）。
async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body) throw new Error('响应无 body');

  const file = fs.createWriteStream(dest);
  let loaded = 0;
  let lastLog = 0;
  for await (const chunk of res.body) {
    loaded += chunk.length;
    const now = Date.now();
    // 每 1.5s 打印一次进度，避免刷屏。
    if (now - lastLog > 1500) {
      lastLog = now;
      const pct = total > 0 ? Math.round((loaded / total) * 100) : '?';
      const mb = (loaded / 1048576).toFixed(1);
      log(`downloading ${mb} MB (${pct}%)`);
    }
    if (!file.write(chunk)) {
      await new Promise((r) => file.once('drain', r));
    }
  }
  await new Promise((resolve, reject) => {
    file.on('error', (err) => {
      try { fs.unlinkSync(dest); } catch (_) {}
      reject(err);
    });
    file.end(() => resolve());
  });
}

// 用 PowerShell [System.IO.Compression.ZipFile] 选择性提取 zip 中 content/wco_data/*
// 到目标目录（带 [Content_Types] 等的 nupkg 直接用 Expand-Archive 会整个解压，
// 这里只取需要的子树，避免在磁盘上铺开整个包）。
function extractWcoData(zipPath, destDir) {
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead('${zipPath.replace(/'/g, "''")}')
try {
  $entries = $zip.Entries | Where-Object { $_.FullName -like 'content/wco_data/*' }
  foreach ($e in $entries) {
    # 相对路径：去掉 'content/' 前缀 -> wco_data/...
    $rel = $e.FullName.Substring('content/'.Length)
    $dest = Join-Path '${destDir.replace(/'/g, "''")}' $rel
    $dir = Split-Path -Parent $dest
    if ($dir -and !(Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $true)
  }
} finally { $zip.Dispose() }
`;
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    encoding: 'utf8',
    shell: false,
  });
  if (r.status !== 0) {
    const detail = (r.stderr || r.stdout || '').toString().trim();
    throw new Error('解压失败' + (detail ? ': ' + detail : ''));
  }
}

function checkReady(wcoDir) {
  const missing = REQUIRED.filter((f) => !fs.existsSync(path.join(wcoDir, f)));
  return { ready: missing.length === 0, missing };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const nativeDir = path.resolve(__dirname, '..');
  const wcoDir = path.join(nativeDir, 'wco_data');
  const exe = path.join(wcoDir, 'WeChatOCR.exe');

  // 幂等：已存在且未强制则跳过。
  if (!opts.force && fs.existsSync(exe)) {
    log('wco_data/WeChatOCR.exe 已存在，跳过下载。');
    return;
  }

  const url = `https://api.nuget.org/v3-flatcontainer/${PKG_ID}/${opts.version}/${PKG_ID}.${opts.version}.nupkg`;
  const tmpZip = path.join(os.tmpdir(), `wechatocr.${opts.version}.${Date.now()}.nupkg`);

  log(`从 NuGet 下载 WeChatOcr ${opts.version}（含 wco_data，~141MB）...`);
  log('URL:', url);
  try {
    await download(url, tmpZip);
    log('下载完成，正在提取 wco_data/...');

    fs.mkdirSync(wcoDir, { recursive: true });
    extractWcoData(tmpZip, nativeDir);

    const { ready, missing } = checkReady(wcoDir);
    if (!ready) {
      warn('提取完成但缺少关键文件:', missing.join(', '));
      warn('插件运行时可能不可用，请检查网络后重试 `npm run build`。');
    } else {
      log('wco_data/ 就绪。');
    }
  } catch (e) {
    // 容错：不阻断构建。用户离线时仍能完成 node-gyp 编译。
    warn('获取 wco_data 失败:', e && e.message ? e.message : String(e));
    warn('原生模块仍会编译，但 OCR 运行时缺失。');
    warn('联网后可重新运行 `npm run build`（或 `npm run fetch:wco`）自动获取，或在插件内点击「下载」。');
  } finally {
    try { fs.unlinkSync(tmpZip); } catch (_) {}
  }
}

main();

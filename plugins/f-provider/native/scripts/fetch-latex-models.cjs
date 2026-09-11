'use strict';
// 构建 LaTeX OCR 引擎模型：从 RapidAI/RapidLaTeXOCR 的 GitHub Release v0.0.0
// 拉取三个 ONNX 模型 + tokenizer.json 到 dist/latex/models/。
//
// 模型为 pix2tex (LaTeX-OCR) 的 ONNX 导出版，license 见
// https://github.com/lukas-blecher/LaTeX-OCR (MIT)。
//
// 行为：
//   * 幂等：encoder.onnx 已存在则跳过（除非 --force）。
//   * GitHub 直连慢时用 GH 代理并发竞速选最快的（与 services.js 同款机制）。
//   * 容错：网络失败时打印清晰告警并退出码 0，不阻断构建（离线环境可先
//     完成 frontend build；模型缺失时插件前端会提示用户手动下载）。
//
// 用法：node scripts/fetch-latex-models.cjs [--force]
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

const RELEASE_TAG = 'v0.0.0';
const BASE = `https://github.com/RapidAI/RapidLaTeXOCR/releases/download/${RELEASE_TAG}`;
const FILES = [
  { name: 'encoder.onnx', size: 89 },
  { name: 'decoder.onnx', size: 51 },
  { name: 'image_resizer.onnx', size: 39 },
  { name: 'tokenizer.json', size: 0 }
];

// 与 services.js 同款 GH 代理前缀，竞速选最快。
const GH_PROXY_HOSTS = [
  'https://gh-proxy.org/',
  'https://v4.gh-proxy.org/',
  'https://v6.gh-proxy.org/',
  'https://cdn.gh-proxy.org/'
];

function log(...a) { console.log('[fetch-latex-models]', ...a); }
function warn(...a) { console.warn('[fetch-latex-models] WARNING:', ...a); }

function parseArgs(argv) {
  const out = { force: false };
  for (const a of argv) if (a === '--force') out.force = true;
  return out;
}

// 并发竞速选最快的加速镜像（与 services.js _pickFastestMirror 同款）。
function pickFastestMirror(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (!/github\.com$/i.test(u.hostname) && u.hostname !== 'github.com') {
      return Promise.resolve(rawUrl);
    }
  } catch (_) { return Promise.resolve(rawUrl); }

  const TIMEOUT_MS = 8000;
  const candidates = GH_PROXY_HOSTS.map((prefix) => prefix + rawUrl);
  return new Promise((resolve) => {
    let settled = false;
    const reqs = [], timers = [];
    const finish = (url) => {
      if (settled) return;
      settled = true;
      timers.forEach((t) => clearTimeout(t));
      reqs.forEach((r) => { try { r.destroy() } catch (_) {} });
      resolve(url);
    };
    candidates.forEach((url) => {
      let parsed;
      try { parsed = new URL(url) } catch (_) { return }
      const req = https.get(parsed, () => finish(url));
      reqs.push(req);
      req.on('error', () => {});
      const timer = setTimeout(() => { try { req.destroy() } catch (_) {} }, TIMEOUT_MS);
      timers.push(timer);
    });
    Promise.all(
      reqs.map((r) =>
        new Promise((res) => {
          if (r.destroyed) return res();
          r.on('close', () => res());
          r.on('error', () => res());
        })
      )
    ).then(() => { if (!settled) finish(rawUrl) });
  });
}

// 下载文件，支持 3xx 跟随 + 进度。
function downloadFile(url, dest, label) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url) } catch (e) { reject(e); return }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(parsed, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, parsed).toString();
        downloadFile(next, dest, label).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      const total = Number(res.headers['content-length']) || 0;
      let loaded = 0, lastLog = 0;
      const file = fs.createWriteStream(dest);
      res.on('data', (chunk) => {
        loaded += chunk.length;
        const now = Date.now();
        if (now - lastLog > 1500) {
          lastLog = now;
          const pct = total > 0 ? Math.round((loaded / total) * 100) : '?';
          const mb = (loaded / 1048576).toFixed(1);
          log(`${label}: ${mb} MB (${pct}%)`);
        }
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', (err) => {
        try { fs.unlinkSync(dest) } catch (_) {}
        reject(err);
      });
    });
    req.on('error', reject);
  });
}

async function fetchOne(file, modelsDir) {
  const dest = path.join(modelsDir, file.name);
  const rawUrl = `${BASE}/${file.name}`;
  log(`下载 ${file.name}（约 ${file.size || ''}MB）...`);
  const url = await pickFastestMirror(rawUrl);
  await downloadFile(url, dest, file.name);
  const stat = fs.statSync(dest);
  log(`${file.name} 完成：${(stat.size / 1048576).toFixed(1)} MB`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  // 落盘到 dist/latex/models/（与 copy-latex.mjs 读的目录一致）
  const repoRoot = path.resolve(__dirname, '..', '..');
  const modelsDir = path.join(repoRoot, 'dist', 'latex', 'models');

  // 幂等：encoder.onnx 已存在则跳过。
  if (!opts.force && fs.existsSync(path.join(modelsDir, 'encoder.onnx'))) {
    log('models/encoder.onnx 已存在，跳过下载。');
    return;
  }

  fs.mkdirSync(modelsDir, { recursive: true });
  try {
    for (const f of FILES) {
      await fetchOne(f, modelsDir);
    }
    // 复检
    const missing = FILES.filter((f) => !fs.existsSync(path.join(modelsDir, f.name)));
    if (missing.length) {
      warn('缺少文件:', missing.map((m) => m.name).join(', '));
    } else {
      log('LaTeX OCR 模型就绪。');
    }
  } catch (e) {
    // 容错：不阻断构建。
    warn('获取 LaTeX OCR 模型失败:', e && e.message ? e.message : String(e));
    warn('联网后可重新运行 `npm run fetch:latex` 自动获取，或在插件内点击「下载」。');
  }
}

main();

/* SendGB 上传 —— ZTools preload（CommonJS，可用 Node/Electron 能力）
 *
 * 作用：
 *   1) 提供 window.services：选文件、起 Python 上传引擎、读配置、清理残留 Chrome
 *   2) 把 ztools.onPluginEnter 的启动参数（拖进来的文件）转给页面
 *
 * 兼容 ZTools(window.ztools) 与 uTools(window.utools)
 */
const { spawn, execFile, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 统一获取宿主 API（ZTools 优先，兼容 uTools）
function getAPI() {
  if (typeof window !== 'undefined') {
    return window.ztools || window.utools || null;
  }
  return null;
}

if (typeof window !== 'undefined') {
  if (!window.utools && window.ztools) {
    window.utools = window.ztools;
  } else if (!window.ztools && window.utools) {
    window.ztools = window.utools;
  }
}

const PLUGIN_DIR = __dirname;
const APP_DIR = path.join(
  process.env.LOCALAPPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : 'C:\\Temp'),
  'sendgb-uploader'
);
const PROFILE_DIR = path.join(APP_DIR, 'chrome-profile');
const BIN_DIR = path.join(APP_DIR, 'bin');
const MAX_TOTAL_BYTES = 5 * 1024 * 1024 * 1024; // sendgb 免费单次 5GB

let current = null; // 正在跑的上传子进程

function dbGet(key) {
  try {
    const api = getAPI();
    if (api && api.dbStorage) {
      const v = api.dbStorage.getItem(key);
      return v === null ? undefined : v;
    }
  } catch (e) {}
  return undefined;
}
function dbSet(key, val) {
  try {
    const api = getAPI();
    if (api && api.dbStorage) api.dbStorage.setItem(key, val);
  } catch (e) {}
}

function queryAppPath(exeName) {
  if (process.platform !== 'win32') return null;
  for (const root of ['HKLM', 'HKCU']) {
    try {
      const out = execFileSync(
        'reg',
        ['query', root + '\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\' + exeName, '/ve'],
        { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }
      );
      const lines = out.split(/\r?\n/);
      for (const line of lines) {
        const m = line.match(/REG_SZ\s+(.*)/i);
        if (m && m[1]) {
          const p = m[1].trim();
          if (fs.existsSync(p)) return p;
        }
      }
    } catch (e) {}
  }
  return null;
}

function detectBrowser() {
  const force = (process.env.SENDGB_FORCE_BROWSER || '').toLowerCase();

  const getEdge = () => {
    const edgeAppPath = queryAppPath('msedge.exe');
    if (edgeAppPath) return { name: 'Microsoft Edge (系统自带)', channel: 'msedge', path: edgeAppPath };
    const edgeList = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    ];
    for (const p of edgeList) {
      if (p && fs.existsSync(p)) return { name: 'Microsoft Edge (系统自带)', channel: 'msedge', path: p };
    }
    return null;
  };

  const getChrome = () => {
    const chromeAppPath = queryAppPath('chrome.exe');
    if (chromeAppPath) return { name: 'Google Chrome', channel: 'chrome', path: chromeAppPath };
    const chromeList = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ];
    for (const p of chromeList) {
      if (p && fs.existsSync(p)) return { name: 'Google Chrome', channel: 'chrome', path: p };
    }
    return null;
  };

  if (force === 'edge') return getEdge();
  if (force === 'chrome') return getChrome();

  return getChrome() || getEdge();
}

function getNodeBin() {
  // 1. 首选 ZTools/uTools 内置宿主执行器（配合 ELECTRON_RUN_AS_NODE=1，新电脑完全无需安装 Node.js！）
  if (process && process.execPath && fs.existsSync(process.execPath)) {
    return { bin: process.execPath, isElectron: true };
  }
  // 2. 候选系统中独立安装的 node.exe
  const candidates = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'),
    'node'
  ];
  for (const p of candidates) {
    if (p === 'node' || fs.existsSync(p)) return { bin: p, isElectron: false };
  }
  return { bin: 'node', isElectron: false };
}

function detectAria2() {
  const custom = dbGet('sendgb:aria2Path');
  if (custom && typeof custom === 'string' && fs.existsSync(custom)) {
    return custom;
  }
  // 1. 优先使用插件内置的 bin/aria2c.exe（开箱即用，新电脑无需任何安装配置）
  const bundled = path.join(PLUGIN_DIR, 'bin', 'aria2c.exe');
  if (fs.existsSync(bundled)) {
    // 关键兼容：当插件打包成 .asar 归档时，Windows 内核 CreateProcess 无法直接执行 asar 内部文件，
    // 必须解压到真实文件系统中（%LOCALAPPDATA%\sendgb-uploader\bin\aria2c.exe）
    if (PLUGIN_DIR.includes('.asar')) {
      const realExe = path.join(BIN_DIR, 'aria2c.exe');
      try {
        let needExtract = true;
        if (fs.existsSync(realExe)) {
          if (fs.statSync(realExe).size === fs.statSync(bundled).size) {
            needExtract = false;
          }
        }
        if (needExtract) {
          fs.mkdirSync(BIN_DIR, { recursive: true });
          fs.writeFileSync(realExe, fs.readFileSync(bundled));
        }
        if (fs.existsSync(realExe)) return realExe;
      } catch (e) {
        console.error('解压内置 aria2c.exe 失败:', e);
      }
    } else {
      return bundled;
    }
  }
  // 2. 候选系统全局安装的 aria2c
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('where.exe', ['aria2c'], {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1500
      });
      const lines = out.split(/\r?\n/).map((s) => s.trim());
      for (const p of lines) {
        if (p && fs.existsSync(p)) return p;
      }
    } catch (e) {}

    const list = [
      path.join(os.homedir(), 'scoop', 'shims', 'aria2c.exe'),
      'D:\\scoop\\shims\\aria2c.exe',
      'C:\\ProgramData\\chocolatey\\bin\\aria2c.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'aria2', 'aria2c.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'aria2', 'aria2c.exe')
    ];
    for (const p of list) {
      if (p && fs.existsSync(p)) return p;
    }
  } else {
    try {
      const out = execFileSync('which', ['aria2c'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500 });
      const p = out.trim();
      if (p && fs.existsSync(p)) return p;
    } catch (e) {}
  }
  return null;
}

function envReport() {
  const browser = detectBrowser();
  const runner = path.join(PLUGIN_DIR, 'bin', 'runner.js');
  const nodeInfo = getNodeBin();
  const aria2Path = detectAria2();
  const isBundled = aria2Path && (
    path.normalize(aria2Path) === path.normalize(path.join(PLUGIN_DIR, 'bin', 'aria2c.exe')) ||
    path.normalize(aria2Path) === path.normalize(path.join(BIN_DIR, 'aria2c.exe'))
  );
  return {
    engine: nodeInfo.isElectron ? 'ZTools 内置 Node 引擎 (免安装)' : '系统 Node (' + nodeInfo.bin + ')',
    browser: browser ? browser.name : '未检测到（需 Chrome 或 Edge）',
    browserPath: browser ? browser.path : null,
    browserOk: !!browser,
    aria2Ok: !!aria2Path,
    aria2Path: aria2Path,
    aria2Info: aria2Path ? (isBundled ? '插件内置 aria2c 极速引擎 (免安装，开箱即用 · 16 线程极速并发)' : `已就绪 (${aria2Path}) · 16 线程极速并发`) : '未检测到（使用内置稳定引擎）',
    profileDir: PROFILE_DIR,
    ready: !!(browser && fs.existsSync(runner))
  };
}

function pickFiles() {
  const api = getAPI();
  if (!api || !api.showOpenDialog) return [];
  const r = api.showOpenDialog({
    title: '选择要上传的文件',
    properties: ['openFile', 'multiSelections']
  });
  return Array.isArray(r) ? r : [];
}

function human(n) {
  const u = [['GB', 1073741824], ['MB', 1048576], ['KB', 1024]];
  for (const [name, div] of u) if (n >= div) return (n / div).toFixed(2) + ' ' + name;
  return n + ' B';
}

function checkUploadFiles(paths) {
  const list = (paths || []).filter((f) => f && typeof f === 'string' && fs.existsSync(f) && fs.statSync(f).isFile());
  let total = 0;
  const items = [];
  for (const f of list) {
    try {
      const size = fs.statSync(f).size;
      total += size;
      items.push({ path: f, name: path.basename(f), size, human: human(size) });
    } catch (e) {}
  }
  return {
    count: items.length,
    total,
    totalHuman: human(total),
    exceeded: total > MAX_TOTAL_BYTES,
    maxBytes: MAX_TOTAL_BYTES,
    maxHuman: '5 GB',
    items
  };
}

let powerBlockerId = null;
function startKeepAwake() {
  try {
    const electron = require('electron');
    if (electron && electron.powerSaveBlocker && powerBlockerId == null) {
      powerBlockerId = electron.powerSaveBlocker.start('prevent-app-suspension');
    }
  } catch (e) {}
}
function stopKeepAwake() {
  try {
    if (powerBlockerId != null) {
      const electron = require('electron');
      if (electron && electron.powerSaveBlocker) {
        electron.powerSaveBlocker.stop(powerBlockerId);
      }
      powerBlockerId = null;
    }
  } catch (e) {}
}

/* 起上传：onEvent(obj) 会被逐条调用，obj 形如 {t:'log'|'progress'|'done'|'error', ...} */
function upload(files, onEvent, opts = {}) {
  const browser = detectBrowser();
  if (!browser) {
    onEvent({ t: 'error', m: '未检测到可用浏览器，请安装 Google Chrome 或启用系统自带的 Microsoft Edge' });
    return false;
  }
  const list = (files || []).filter((f) => f && fs.existsSync(f) && fs.statSync(f).isFile());
  if (!list.length) {
    onEvent({ t: 'error', m: '没有可上传的文件' });
    return false;
  }
  let total = 0;
  for (const f of list) total += fs.statSync(f).size;
  if (total > MAX_TOTAL_BYTES) {
    onEvent({ t: 'error', m: `合计 ${human(total)}，超过 sendgb 免费单次 5GB 上限` });
    return false;
  }
  if (current) {
    onEvent({ t: 'error', m: '上一个上传还在进行中' });
    return false;
  }

  startKeepAwake();

  const showWin = opts && opts.showBrowser !== undefined
    ? !!opts.showBrowser
    : (dbGet('sendgb:showBrowser') !== false);
  const runner = path.join(PLUGIN_DIR, 'bin', 'runner.js');
  const nodeInfo = getNodeBin();
  const env = Object.assign({}, process.env, {
    SENDGB_PROFILE_DIR: PROFILE_DIR,
    SENDGB_SHOW_BROWSER: showWin ? '1' : '0'
  });
  if (nodeInfo.isElectron) {
    env.ELECTRON_RUN_AS_NODE = '1';
  }
  const child = spawn(nodeInfo.bin, [runner].concat(list), { env, windowsHide: true });
  current = child;

  child.on('error', (err) => {
    current = null;
    stopKeepAwake();
    onEvent({ t: 'error', m: `启动执行引擎失败 (${err.message})` });
  });

  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        onEvent(JSON.parse(line));
      } catch (e) {
        onEvent({ t: 'log', m: line });
      }
    }
  });
  child.stderr.on('data', (d) => onEvent({ t: 'log', m: '[stderr] ' + d.toString('utf8').trim().slice(0, 400) }));
  child.on('close', (code) => {
    current = null;
    stopKeepAwake();
    onEvent({ t: 'exit', code });
  });
  return true;
}

function cancel() {
  stopKeepAwake();
  if (!current) return false;
  try {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(current.pid), '/T', '/F'], () => {});
    } else {
      current.kill('SIGKILL');
    }
  } catch (e) {}
  current = null;
  return true;
}

/* 清理残留的后台浏览器进程（Chrome / Edge），避免占用 profile 单例锁 */
function killStrayBrowser(cb) {
  if (process.platform !== 'win32') return cb(0);
  const ps =
    "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' or Name='msedge.exe'\" | " +
    "Where-Object { $_.CommandLine -like '*sendgb-uploader*' -or $_.CommandLine -like '*chrome-profile*' -or $_.CommandLine -like '*browser-profile*' } | " +
    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Output 1 }";
  execFile('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true }, (err, stdout) => {
    const n = String(stdout || '').trim().split(/\s+/).filter(Boolean).length;
    if (n) {
      ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'].forEach((f) => {
        try { fs.rmSync(path.join(PROFILE_DIR, f), { force: true }); } catch (e) {}
      });
    }
    if (typeof cb === 'function') cb(n);
  });
}

function copyText(t) {
  try {
    const api = getAPI();
    if (api && api.copyText) return api.copyText(t);
  } catch (e) {}
  return false;
}

/* ---------------- 下载（纯 Node，不需要浏览器 —— 下载没有 Cloudflare 验证） ---------------- */

let currentDl = null; // 正在跑的下载子进程

function pickDir() {
  const api = getAPI();
  if (!api || !api.showOpenDialog) return null;
  const r = api.showOpenDialog({ title: '选择保存目录', properties: ['openDirectory'] });
  return Array.isArray(r) && r.length ? r[0] : null;
}

function downloadBaseDir() {
  const saved = dbGet('sendgb:downloadDir');
  if (saved && typeof saved === 'string') return saved;
  return path.join(os.homedir(), 'Downloads', 'SendGB');
}

function defaultDownloadDir(code) {
  const base = downloadBaseDir();
  return code ? path.join(base, code) : base;
}

function readClipboard() {
  try {
    const { clipboard } = require('electron');
    if (clipboard && clipboard.readText) return clipboard.readText() || '';
  } catch (e) {}
  try {
    const api = getAPI();
    if (api && api.getClipboardContent) {
      const c = api.getClipboardContent();
      return typeof c === 'string' ? c : (c && c.text) || '';
    }
  } catch (e) {}
  return '';
}

function openPath(p) {
  if (!p || typeof p !== 'string') return false;
  try {
    const api = getAPI();
    if (api && api.shellOpenPath) {
      api.shellOpenPath(p);
      return true;
    }
  } catch (e) {}
  try {
    const { shell } = require('electron');
    if (shell && shell.openPath) {
      shell.openPath(p);
      return true;
    }
  } catch (e) {}
  if (process.platform === 'win32') {
    try {
      execFile('explorer.exe', [p], () => {});
      return true;
    } catch (e) {}
  }
  return false;
}

function checkFileOrDirExists(target) {
  if (!target) return false;
  if (typeof target === 'string') {
    if (!fs.existsSync(target)) return false;
    try {
      const stat = fs.statSync(target);
      if (stat.isFile()) return true;
      if (stat.isDirectory()) {
        const files = fs.readdirSync(target);
        return files.length > 0;
      }
    } catch (e) {
      return false;
    }
    return true;
  }
  if (typeof target === 'object') {
    if (target.zip && fs.existsSync(target.zip)) return true;
    if (Array.isArray(target.files) && target.files.length) {
      const anyExist = target.files.some((f) => f && fs.existsSync(f));
      if (anyExist) return true;
    }
    if (target.dir && fs.existsSync(target.dir)) {
      try {
        const stat = fs.statSync(target.dir);
        if (stat.isFile()) return true;
        if (stat.isDirectory()) {
          const files = fs.readdirSync(target.dir);
          return files.length > 0;
        }
      } catch (e) {
        return false;
      }
      return true;
    }
  }
  return false;
}

function isSendgbLink(text) {
  const s = String(text || '').trim();
  if (/^https?:\/\/(?:www\.)?sendgb\.com\//i.test(s)) return true;
  return /^[A-Za-z0-9]{8,24}$/.test(s);
}

/* 起下载：onEvent(obj) 逐条回调，obj 形如 {t:'meta'|'log'|'progress'|'file'|'done'|'error'} */
function download(link, opts, onEvent) {
  const o = opts || {};
  const phase = o.resolveOnly ? '解析' : '下载';
  if (!isSendgbLink(link)) {
    onEvent({ t: 'error', m: '这不是一个 SendGB 链接' });
    return false;
  }
  if (currentDl && currentDl.exitCode !== null) currentDl = null; // 进程已退出但 close 还没回调
  if (currentDl) {
    onEvent({ t: 'error', m: '上一个下载还在进行中' });
    return false;
  }
  const runner = path.join(PLUGIN_DIR, 'bin', 'downloader.js');
  if (!fs.existsSync(runner)) {
    onEvent({ t: 'error', m: '缺少下载组件 bin/downloader.js，请重新安装插件' });
    return false;
  }
  const nodeInfo = getNodeBin();
  const args = [runner, link];
  if (o.resolveOnly) {
    args.push('--resolve');
  } else {
    args.push(o.destDir || defaultDownloadDir(null));
    if (o.zip) args.push('--zip');
    if (o.password) args.push('--password=' + o.password);
    const useAria2 = o.useAria2 !== undefined ? !!o.useAria2 : (dbGet('sendgb:useAria2') !== false);
    const aria2Path = useAria2 ? detectAria2() : null;
    if (aria2Path) {
      args.push('--aria2=' + aria2Path);
    } else if (!useAria2) {
      args.push('--no-aria2');
    }
  }
  const env = Object.assign({}, process.env);
  if (nodeInfo.isElectron) env.ELECTRON_RUN_AS_NODE = '1';

  const child = spawn(nodeInfo.bin, args, { env, windowsHide: true });
  currentDl = child;

  child.on('error', (err) => {
    currentDl = null;
    onEvent({ t: 'error', m: `启动下载引擎失败 (${err.message})` });
  });

  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        onEvent(JSON.parse(line));
      } catch (e) {
        onEvent({ t: 'log', m: line });
      }
    }
  });
  child.stderr.on('data', (d) => onEvent({ t: 'log', m: '[stderr] ' + d.toString('utf8').trim().slice(0, 400) }));
  child.on('close', (code) => {
    currentDl = null;
    onEvent({ t: 'exit', code, phase });
  });
  return true;
}

function cancelDownload() {
  if (!currentDl) return false;
  try {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(currentDl.pid), '/T', '/F'], () => {});
    } else {
      currentDl.kill('SIGKILL');
    }
  } catch (e) {}
  currentDl = null;
  return true;
}

/* ---------------- 启动参数转发 ---------------- */

function normalizePayload(param) {
  // 拖进来的文件：可能是 ['C:\\a.txt'] 也可能是 [{path:'C:\\a.txt', isFile:true}]
  const out = { type: param && param.type, code: param && param.code, text: '', files: [] };
  if (!param) return out;
  const p = param.payload;
  const arr = Array.isArray(p) ? p : [p];
  for (const item of arr) {
    if (!item) continue;
    if (typeof item === 'string') {
      if (fs.existsSync(item)) out.files.push(item);
      else out.text += item + ' ';
    } else if (typeof item === 'object') {
      const f = item.path || item.filePath;
      if (f) { try { if (fs.statSync(f).isFile()) out.files.push(f); } catch (e) {} }
    }
  }
  out.text = out.text.trim();
  return out;
}

const api = getAPI();
if (api && api.onPluginEnter) {
  api.onPluginEnter((param) => {
    const info = normalizePayload(param);
    if (typeof window.__onEnter === 'function') {
      try { window.__onEnter(info); } catch (e) {}
    } else {
      window.__pendingEnter = info;
    }
  });
}

window.services = {
  envReport,
  pickFiles,
  upload,
  cancel,
  killStrayBrowser,
  killStrayChrome: killStrayBrowser,
  copyText,
  profileDir: PROFILE_DIR,
  dbGet, dbSet,
  pluginDir: PLUGIN_DIR,
  human,
  /* 下载相关 */
  download,
  cancelDownload,
  pickDir,
  defaultDownloadDir,
  downloadBaseDir,
  setDownloadBaseDir: (dir) => dbSet('sendgb:downloadDir', dir),
  readClipboard,
  openPath,
  isSendgbLink,
  detectAria2,
  checkUploadFiles,
  checkFileOrDirExists,
  pathExists: checkFileOrDirExists
};

/**
 * quick-open preload
 * - 列目录、书签导入、路径校验、安全 spawn
 * 规范：可读 CommonJS，禁止打包/压缩/混淆
 */

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  resolveCommandTemplate,
  buildCommandSearchPath,
  resolveExecutablePath,
} = require('./lib/command.cjs');
const {
  parseChromiumBookmarks,
  parseSafariPlistJson,
  parseBookmarkFileContent,
} = require('./lib/bookmarks.cjs');
const {
  WEBDAV_BACKUP_FILENAME,
  buildAuthHeader,
  buildWebdavDirUrl,
  buildWebdavFileUrl,
} = require('./lib/webdav.cjs');
const {
  MAX_ICON_BYTES,
  resolveIconPageUrl,
  buildFaviconCandidateUrls,
  guessImageMime,
  bufferToImageDataUrl,
  normalizeIconDataUrl,
} = require('./lib/icon.cjs');

/**
 * @param {string} dir
 * @returns {{ ok: boolean, entries?: Array<{ name: string, path: string }>, error?: string }}
 */
function listProjectDirs(dir) {
  const root = String(dir || '').trim();
  if (!root) return { ok: false, error: '目录为空' };
  try {
    if (!fs.existsSync(root)) return { ok: false, error: '目录不存在' };
    const stat = fs.statSync(root);
    if (!stat.isDirectory()) return { ok: false, error: '路径不是目录' };
    const names = fs.readdirSync(root, { withFileTypes: true });
    const entries = names
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => ({
        name: d.name,
        path: path.join(root, d.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    return { ok: true, entries };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * @param {string} targetPath
 */
function pathExists(targetPath) {
  try {
    return fs.existsSync(String(targetPath || ''));
  } catch {
    return false;
  }
}

/**
 * @param {string} template
 * @param {string} targetPath
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
function runCommandTemplate(template, targetPath) {
  return new Promise((resolve) => {
    let resolved;
    try {
      resolved = resolveCommandTemplate(template, targetPath);
    } catch (err) {
      resolve({ ok: false, error: err?.message || String(err) });
      return;
    }

    const pathEnv = buildCommandSearchPath(os.homedir(), process.env.PATH || '');
    const command = resolveExecutablePath(resolved.command, {
      pathEnv,
      existsSync: fs.existsSync,
    });
    const env = { ...process.env, PATH: pathEnv };

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const child = spawn(command, resolved.args, {
      shell: false,
      detached: true,
      stdio: 'ignore',
      env,
    });
    child.on('error', (err) => {
      const message =
        err?.code === 'ENOENT'
          ? `找不到命令「${resolved.command}」，请改用绝对路径或 open -a AppName {path}`
          : err?.message || String(err);
      finish({ ok: false, error: message });
    });
    child.unref();
    // spawn 成功启动即视为 ok；找不到命令会走 error
    setTimeout(() => finish({ ok: true }), 80);
  });
}

function chromiumBookmarksPath(browser) {
  const home = os.homedir();
  if (browser === 'chrome') {
    return path.join(home, 'Library/Application Support/Google/Chrome/Default/Bookmarks');
  }
  if (browser === 'edge') {
    return path.join(home, 'Library/Application Support/Microsoft Edge/Default/Bookmarks');
  }
  return '';
}

function safariBookmarksPath() {
  return path.join(os.homedir(), 'Library/Safari/Bookmarks.plist');
}

/**
 * @param {'chrome'|'edge'|'safari'} browser
 */
function detectBrowserBookmarks(browser) {
  if (browser === 'safari') {
    const p = safariBookmarksPath();
    return { browser, path: p, exists: fs.existsSync(p) };
  }
  const p = chromiumBookmarksPath(browser);
  return { browser, path: p, exists: fs.existsSync(p) };
}

/**
 * @param {'chrome'|'edge'} browser
 */
function importChromiumBookmarks(browser) {
  const info = detectBrowserBookmarks(browser);
  if (!info.exists) {
    return {
      ok: false,
      error: `${browser === 'chrome' ? 'Chrome' : 'Edge'} 书签文件不存在，可能未安装或 Profile 非 Default`,
      items: [],
    };
  }
  try {
    const raw = fs.readFileSync(info.path, 'utf8');
    const items = parseChromiumBookmarks(raw, browser);
    return { ok: true, items, path: info.path };
  } catch (err) {
    return {
      ok: false,
      error: err?.code === 'EPERM' || err?.code === 'EACCES'
        ? '无权限读取书签文件，请在系统设置中授予磁盘访问权限'
        : err?.message || String(err),
      items: [],
    };
  }
}

function importSafariBookmarks() {
  const info = detectBrowserBookmarks('safari');
  if (!info.exists) {
    return { ok: false, error: 'Safari 书签文件不存在', items: [] };
  }
  try {
    const result = spawnSync('plutil', ['-convert', 'json', '-o', '-', info.path], {
      encoding: 'utf8',
      timeout: 15000,
    });
    if (result.status !== 0) {
      return {
        ok: false,
        error: result.stderr || 'plutil 转换失败，可能需要授予磁盘访问权限',
        items: [],
      };
    }
    const items = parseSafariPlistJson(result.stdout, 'safari');
    return { ok: true, items, path: info.path };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || String(err),
      items: [],
    };
  }
}

/**
 * @param {'chrome'|'edge'|'safari'} browser
 */
function importBrowserBookmarks(browser) {
  if (browser === 'safari') return importSafariBookmarks();
  if (browser === 'chrome' || browser === 'edge') return importChromiumBookmarks(browser);
  return { ok: false, error: '不支持的浏览器', items: [] };
}

/**
 * @param {string} filePath
 */
function importBookmarksFromFile(filePath) {
  const p = String(filePath || '').trim();
  if (!p) return { ok: false, error: '未选择文件', items: [] };
  try {
    if (!fs.existsSync(p)) return { ok: false, error: '文件不存在', items: [] };
    const content = fs.readFileSync(p, 'utf8');
    const items = parseBookmarkFileContent(content, path.basename(p), 'file');
    return { ok: true, items, path: p };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), items: [] };
  }
}

function getHomeDir() {
  return os.homedir();
}

const APPLICATION_SCAN_ROOTS_MAX_DEPTH = 2;
const APPLICATION_ICON_MAX_SIZE = 48;
const APPLICATION_ICON_CONCURRENCY = 8;

/**
 * @returns {string[]}
 */
function getApplicationScanRoots() {
  const home = os.homedir();
  return [
    '/Applications',
    path.join(home, 'Applications'),
    '/System/Applications',
    '/Applications/Utilities',
  ];
}

/**
 * 异步执行外部命令并返回 stdout；失败时返回 null，不阻塞事件循环。
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<string|null>}
 */
function runCaptureAsync(command, args) {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let child;
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      finish(null);
      return;
    }
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code === 0 ? stdout : null));
    setTimeout(() => finish(null), 5000);
  });
}

/**
 * 读取 .app 的 Contents/Info.plist，失败时返回 null。
 * @param {string} appPath
 * @returns {Promise<object|null>}
 */
async function readAppInfoPlist(appPath) {
  const infoPlistPath = path.join(appPath, 'Contents', 'Info.plist');
  if (!fs.existsSync(infoPlistPath)) return null;
  const stdout = await runCaptureAsync('plutil', ['-convert', 'json', '-o', '-', infoPlistPath]);
  if (!stdout) return null;
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * 将 .app 的 CFBundleIconFile（.icns）转换为小尺寸 PNG data URI；失败时返回空字符串。
 * @param {string} appPath
 * @param {object|null} info
 * @returns {Promise<string>}
 */
async function resolveApplicationIcon(appPath, info) {
  const iconFile = String(info?.CFBundleIconFile || '').trim();
  if (!iconFile) return '';
  let icnsPath = path.join(appPath, 'Contents', 'Resources', iconFile);
  if (!fs.existsSync(icnsPath) && !icnsPath.toLowerCase().endsWith('.icns')) {
    icnsPath += '.icns';
  }
  if (!fs.existsSync(icnsPath)) return '';

  const tmpFile = path.join(
    os.tmpdir(),
    `quick-open-icon-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
  );
  try {
    const stdout = await runCaptureAsync('sips', [
      '-s',
      'format',
      'png',
      icnsPath,
      '--resampleHeightWidthMax',
      String(APPLICATION_ICON_MAX_SIZE),
      '--out',
      tmpFile,
    ]);
    if (stdout === null || !fs.existsSync(tmpFile)) return '';
    const buffer = fs.readFileSync(tmpFile);
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch {
    return '';
  } finally {
    fs.promises.unlink(tmpFile).catch(() => {});
  }
}

/**
 * @param {string} appPath
 * @returns {Promise<{ name: string, appPath: string, bundleId: string, icon: string }>}
 */
async function resolveApplicationMetadata(appPath) {
  const info = await readAppInfoPlist(appPath);
  const fallbackName = path.basename(appPath, '.app');
  const name = String(info?.CFBundleDisplayName || info?.CFBundleName || fallbackName).trim();
  const bundleId = String(info?.CFBundleIdentifier || '').trim();
  const icon = await resolveApplicationIcon(appPath, info);
  return { name: name || fallbackName, appPath, bundleId, icon };
}

/**
 * 递归扫描目录寻找 .app 路径；遇到 .app 即记录并停止向内部递归。纯同步目录遍历，不涉及元数据解析。
 * @param {string} dir
 * @param {number} depth
 * @returns {string[]}
 */
function scanForApplicationPaths(dir, depth) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.name.endsWith('.app')) {
      found.push(fullPath);
      continue;
    }
    if (depth < APPLICATION_SCAN_ROOTS_MAX_DEPTH) {
      found.push(...scanForApplicationPaths(fullPath, depth + 1));
    }
  }
  return found;
}

/**
 * 以固定并发数处理数组，避免同时拉起过多子进程。
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} mapper
 * @returns {Promise<R[]>}
 */
async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/** @type {Array<{ name: string, appPath: string, bundleId: string, icon: string }>|null} */
let installedApplicationsCache = null;
/** @type {Promise<Array<{ name: string, appPath: string, bundleId: string, icon: string }>>|null} */
let installedApplicationsPromise = null;

/**
 * 扫描本机已安装应用（含图标）；按 Bundle ID 优先、应用路径次优去重，名称按 zh-CN 排序。
 * 结果在 preload 生命周期内缓存，仅返回可结构化克隆的纯对象。子进程调用均为异步、限并发，避免阻塞事件循环。
 * @returns {Promise<Array<{ name: string, appPath: string, bundleId: string, icon: string }>>}
 */
function listInstalledApplications() {
  if (installedApplicationsCache) return Promise.resolve(installedApplicationsCache);
  if (installedApplicationsPromise) return installedApplicationsPromise;

  installedApplicationsPromise = (async () => {
    const appPaths = [];
    for (const root of getApplicationScanRoots()) {
      if (!fs.existsSync(root)) continue;
      appPaths.push(...scanForApplicationPaths(root, 0));
    }

    const apps = await mapWithConcurrency(
      appPaths,
      APPLICATION_ICON_CONCURRENCY,
      resolveApplicationMetadata,
    );

    const seenBundleIds = new Set();
    const seenPaths = new Set();
    const deduped = [];
    for (const app of apps) {
      if (app.bundleId) {
        if (seenBundleIds.has(app.bundleId)) continue;
        seenBundleIds.add(app.bundleId);
      } else {
        if (seenPaths.has(app.appPath)) continue;
        seenPaths.add(app.appPath);
      }
      deduped.push(app);
    }
    deduped.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

    installedApplicationsCache = deduped;
    installedApplicationsPromise = null;
    return deduped;
  })();

  return installedApplicationsPromise;
}

/**
 * @returns {{ platform: string, platformLabel: string, release: string, arch: string, username: string }}
 */
function getSystemInfo() {
  const platform = os.platform();
  const platformLabel =
    platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform === 'linux' ? 'Linux' : platform;
  let username = '';
  try {
    username = os.userInfo().username || '';
  } catch {
    username = process.env.USER || process.env.USERNAME || '';
  }
  return {
    platform,
    platformLabel,
    release: os.release(),
    arch: os.arch(),
    username,
  };
}

/**
 * @param {string} filePath
 * @param {string} content
 * @returns {{ ok: boolean, error?: string }}
 */
function writeTextFile(filePath, content) {
  const p = String(filePath || '').trim();
  if (!p) return { ok: false, error: '未指定保存路径' };
  try {
    fs.writeFileSync(p, String(content ?? ''), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * @param {string} filePath
 * @returns {{ ok: boolean, content?: string, error?: string }}
 */
function readTextFile(filePath) {
  const p = String(filePath || '').trim();
  if (!p) return { ok: false, error: '未指定文件路径' };
  try {
    if (!fs.existsSync(p)) return { ok: false, error: '文件不存在' };
    return { ok: true, content: fs.readFileSync(p, 'utf8') };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * 读取本地图片为 data URL（用于卡片图标上传）。
 * @param {string} filePath
 * @returns {{ ok: boolean, dataUrl?: string, error?: string }}
 */
function readImageFileAsDataUrl(filePath) {
  const p = String(filePath || '').trim();
  if (!p) return { ok: false, error: '未指定图片路径' };
  try {
    if (!fs.existsSync(p)) return { ok: false, error: '文件不存在' };
    const stat = fs.statSync(p);
    if (!stat.isFile()) return { ok: false, error: '路径不是文件' };
    if (stat.size > MAX_ICON_BYTES) return { ok: false, error: '图标过大（上限 512KB）' };
    const ext = path.extname(p).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg'].includes(ext)) {
      return { ok: false, error: '仅支持 png / jpg / gif / webp / ico / svg' };
    }
    const buffer = fs.readFileSync(p);
    const dataUrl = bufferToImageDataUrl(buffer, guessImageMime(p));
    if (!normalizeIconDataUrl(dataUrl)) return { ok: false, error: '无法解析图片' };
    return { ok: true, dataUrl };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

const FAVICON_TIMEOUT_MS = 8000;

/**
 * 按候选地址依次拉取站点图标。
 * @param {string} pageUrl
 * @returns {Promise<{ ok: boolean, dataUrl?: string, error?: string }>}
 */
async function fetchFaviconAsDataUrl(pageUrl) {
  if (typeof fetch !== 'function') {
    return { ok: false, error: '当前运行环境不支持网络请求（缺少 fetch）' };
  }
  const resolved = resolveIconPageUrl({ url: pageUrl }) || String(pageUrl || '').trim();
  const candidates = buildFaviconCandidateUrls(resolved);
  if (!candidates.length) return { ok: false, error: '无效的网址，无法获取图标' };

  for (const candidate of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FAVICON_TIMEOUT_MS);
    try {
      const res = await fetch(candidate, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { Accept: 'image/*,*/*;q=0.8' },
      });
      if (!res.ok) continue;
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer.length || buffer.length > MAX_ICON_BYTES) continue;
      const headerType = String(res.headers.get('content-type') || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      const mime =
        headerType.startsWith('image/') ? headerType : guessImageMime(candidate);
      const dataUrl = bufferToImageDataUrl(buffer, mime);
      if (!normalizeIconDataUrl(dataUrl)) continue;
      return { ok: true, dataUrl };
    } catch {
      // 尝试下一候选
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: '未能从链接获取到图标' };
}

const WEBDAV_TIMEOUT_MS = 15000;

/**
 * @param {RequestInfo} url
 * @param {RequestInit} init
 */
async function webdavFetch(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBDAV_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{ url: string, username: string, password: string, path: string }} config
 * @returns {Promise<{ ok: boolean, status?: number, error?: string }>}
 */
async function webdavTestConnection(config) {
  if (typeof fetch !== 'function') {
    return { ok: false, error: '当前运行环境不支持网络请求（缺少 fetch）' };
  }
  const dirUrl = buildWebdavDirUrl(config?.url, config?.path);
  try {
    const res = await webdavFetch(dirUrl, {
      method: 'PROPFIND',
      headers: {
        Authorization: buildAuthHeader(config?.username, config?.password),
        Depth: '0',
      },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, error: '认证失败，请检查用户名或密码' };
    }
    if (res.status === 404) {
      return { ok: false, status: res.status, error: '目录不存在，可先执行一次备份自动创建' };
    }
    if (!res.ok && res.status !== 207) {
      return { ok: false, status: res.status, error: `连接失败（HTTP ${res.status}）` };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: err?.name === 'AbortError' ? '连接超时' : err?.message || String(err) };
  }
}

/**
 * 确保远程目录存在；已存在（405/409/412）视为成功。
 * @param {{ url: string, username: string, password: string, path: string }} config
 */
async function webdavEnsureDir(config) {
  const dirUrl = buildWebdavDirUrl(config?.url, config?.path);
  try {
    const res = await webdavFetch(dirUrl, {
      method: 'MKCOL',
      headers: { Authorization: buildAuthHeader(config?.username, config?.password) },
    });
    if (res.ok || [405, 409, 412].includes(res.status)) return { ok: true };
    return { ok: false, status: res.status, error: `创建目录失败（HTTP ${res.status}）` };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * @param {{ url: string, username: string, password: string, path: string }} config
 * @param {string} content
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function webdavUploadBackup(config, content) {
  if (typeof fetch !== 'function') {
    return { ok: false, error: '当前运行环境不支持网络请求（缺少 fetch）' };
  }
  const ensured = await webdavEnsureDir(config);
  if (!ensured.ok) return ensured;
  const fileUrl = buildWebdavFileUrl(config?.url, config?.path, WEBDAV_BACKUP_FILENAME);
  try {
    const res = await webdavFetch(fileUrl, {
      method: 'PUT',
      headers: {
        Authorization: buildAuthHeader(config?.username, config?.password),
        'Content-Type': 'application/json',
      },
      body: String(content ?? ''),
    });
    if (!res.ok) return { ok: false, error: `上传失败（HTTP ${res.status}）` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.name === 'AbortError' ? '上传超时' : err?.message || String(err) };
  }
}

/**
 * @param {{ url: string, username: string, password: string, path: string }} config
 * @returns {Promise<{ ok: boolean, content?: string, error?: string }>}
 */
async function webdavDownloadBackup(config) {
  if (typeof fetch !== 'function') {
    return { ok: false, error: '当前运行环境不支持网络请求（缺少 fetch）' };
  }
  const fileUrl = buildWebdavFileUrl(config?.url, config?.path, WEBDAV_BACKUP_FILENAME);
  try {
    const res = await webdavFetch(fileUrl, {
      method: 'GET',
      headers: { Authorization: buildAuthHeader(config?.username, config?.password) },
    });
    if (res.status === 404) return { ok: false, error: '远程备份文件不存在，请先执行一次备份' };
    if (!res.ok) return { ok: false, error: `下载失败（HTTP ${res.status}）` };
    return { ok: true, content: await res.text() };
  } catch (err) {
    return { ok: false, error: err?.name === 'AbortError' ? '下载超时' : err?.message || String(err) };
  }
}

window.quickOpenApi = {
  listProjectDirs,
  pathExists,
  runCommandTemplate,
  detectBrowserBookmarks,
  importBrowserBookmarks,
  importBookmarksFromFile,
  getHomeDir,
  resolveCommandTemplate,
  listInstalledApplications,
  getSystemInfo,
  writeTextFile,
  readTextFile,
  readImageFileAsDataUrl,
  fetchFaviconAsDataUrl,
  webdavTestConnection,
  webdavUploadBackup,
  webdavDownloadBackup,
};

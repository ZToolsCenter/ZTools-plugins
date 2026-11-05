const fs = require('node:fs');
const { promises: fsp } = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const VSCDB_KEY = 'history.recentlyOpenedPathsList';

// ========== 数据源 Probe 实现 ==========

// 1. WorkspaceStorage Probe
function defaultWorkspaceStorageRoot() {
  const platform = process.platform;
  if (platform === 'win32') return path.join(process.env.APPDATA || '', 'Code', 'User', 'workspaceStorage');
  if (platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage');
  return path.join(os.homedir(), '.config', 'Code', 'User', 'workspaceStorage');
}

async function readOneWorkspace(root, hash) {
  const dir = path.join(root, hash);
  try {
    const stat = await fsp.stat(dir);
    if (!stat.isDirectory()) return null;
    const wsJsonPath = path.join(dir, 'workspace.json');
    const text = await fsp.readFile(wsJsonPath, 'utf-8');
    const parsed = JSON.parse(text);
    let raw = null;
    if (parsed.folder) raw = { folderUri: parsed.folder };
    else if (parsed.workspace) raw = { workspace: { id: hash, configPath: parsed.workspace } };
    if (!raw) return null;
    return { hash, raw, mtimeMs: stat.mtimeMs };
  } catch { return null; }
}

async function readWorkspaceStorage(customRoot) {
  const root = customRoot || defaultWorkspaceStorageRoot();
  if (!fs.existsSync(root)) return null;
  const dirs = await fsp.readdir(root);
  const results = await Promise.all(dirs.map(h => readOneWorkspace(root, h)));
  return results.filter(e => e !== null).sort((a, b) => b.mtimeMs - a.mtimeMs).map(c => c.raw);
}

// 2. State.vscdb Probe
function defaultDbPath() {
  const platform = process.platform;
  if (platform === 'win32') return path.join(process.env.APPDATA || '', 'Code', 'User', 'globalStorage', 'state.vscdb');
  if (platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'state.vscdb');
  return path.join(os.homedir(), '.config', 'Code', 'User', 'globalStorage', 'state.vscdb');
}

async function readVscdb(customPath) {
  const dbPath = customPath || defaultDbPath();
  if (!fs.existsSync(dbPath)) return null;
  const buf = fs.readFileSync(dbPath);
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: (file) => path.join(path.dirname(require.resolve('sql.js')), file) });
  const db = new SQL.Database(new Uint8Array(buf));
  try {
    const stmt = db.prepare('SELECT value FROM ItemTable WHERE key = ?');
    stmt.bind([VSCDB_KEY]);
    if (!stmt.step()) { stmt.free(); return []; }
    const row = stmt.getAsObject();
    stmt.free();
    const text = typeof row.value === 'string' ? row.value : Buffer.from(row.value).toString('utf-8');
    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.entries) ? parsed.entries : [];
  } finally { db.close(); }
}

// 3. Storage.json Probe
function defaultStorageJsonPath() {
  const platform = process.platform;
  if (platform === 'win32') return path.join(process.env.APPDATA || '', 'Code', 'User', 'globalStorage', 'storage.json');
  if (platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'storage.json');
  return path.join(os.homedir(), '.config', 'Code', 'User', 'globalStorage', 'storage.json');
}

async function readStorageJson(customPath) {
  const jsonPath = customPath || defaultStorageJsonPath();
  if (!fs.existsSync(jsonPath)) return null;
  const text = fs.readFileSync(jsonPath, 'utf-8');
  const parsed = JSON.parse(text);
  const out = [];
  const bw = parsed.backupWorkspaces;
  if (bw) {
    for (const f of bw.folders || []) if (f.folderUri) out.push({ folderUri: f.folderUri });
    for (const w of bw.workspaces || []) {
      const cp = w.configURIPath || w.configPath;
      if (cp && w.id) out.push({ workspace: { id: w.id, configPath: cp } });
    }
  }
  const ws = parsed.windowsState;
  if (ws?.openedWindows) {
    for (const win of ws.openedWindows) {
      if (win.folder) out.push({ folderUri: win.folder });
      if (win.workspace) out.push({ workspace: win.workspace });
    }
  }
  return out;
}

// URI Mapping
function fileUriToPath(uri) {
  if (!uri.startsWith('file:///')) throw new Error('Not a file URI: ' + uri);
  const hostAndPath = decodeURIComponent(uri.slice(7));
  if (process.platform === 'win32') {
    const match = hostAndPath.match(/^\/([a-zA-Z]:.*)$/);
    return match ? match[1] : hostAndPath;
  }
  return hostAndPath;
}

function prettyPath(p) {
  const home = os.homedir();
  return p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

function normalizeId(p, options) {
  if (options?.isRemote) return p;
  if (process.platform === 'win32' && /^[a-z]:/.test(p)) return p[0].toUpperCase() + p.slice(1);
  return p;
}

function mapEntries(entries) {
  const out = [];
  for (const e of entries) {
    try {
      if (e.fileUri) continue;
      if (e.workspace?.configPath) {
        const uri = e.workspace.configPath;
        if (uri.startsWith('file:')) {
          const p = fileUriToPath(uri);
          out.push({ id: normalizeId(p), kind: 'workspace', title: e.label || path.basename(p).replace(/\.code-workspace$/, ''), subtitle: prettyPath(p), rawPath: p, exists: false });
        }
        continue;
      }
      if (e.folderUri) {
        const uri = e.folderUri;
        if (uri.startsWith('file:')) {
          const p = fileUriToPath(uri);
          out.push({ id: normalizeId(p), kind: 'folder', title: e.label || path.basename(p), subtitle: prettyPath(p), rawPath: p, exists: false });
        } else {
          const m = uri.match(/^[^:]+:\/\/([^\/]+)(\/.*)?$/);
          out.push({ id: normalizeId(uri, { isRemote: true }), kind: 'remote', title: e.label || m?.[1] || uri, subtitle: uri, rawPath: uri, exists: true });
        }
      }
    } catch {}
  }
  return out;
}

// Config Management
const CONFIG_KEY = 'vscode-launcher-config';
function getVSCodeConfig() {
  try {
    const config = window.ztools.dbStorage.getItem(CONFIG_KEY);
    return config ? JSON.parse(config) : { codeExecutable: '', vscdbPath: '', workspaceStorageRoot: '', storageJsonPath: '' };
  } catch { return { codeExecutable: '', vscdbPath: '', workspaceStorageRoot: '', storageJsonPath: '' }; }
}
function saveVSCodeConfig(config) { window.ztools.dbStorage.setItem(CONFIG_KEY, JSON.stringify(config)); }

// Main Loader
async function loadRecent() {
  const config = getVSCodeConfig();
  console.log('⏰ ~ loadRecent ~ config:', config)
  const allRaw = [];
  for (const [name, read] of [['workspaceStorage', () => readWorkspaceStorage(config.workspaceStorageRoot)], ['state.vscdb', () => readVscdb(config.vscdbPath)], ['storage.json', () => readStorageJson(config.storageJsonPath)]]) {
    try { const entries = await read(); if (entries) allRaw.push(...entries); } catch {}
  }
  const mapped = mapEntries(allRaw);
  const seen = new Set();
  const candidates = [];
  for (const item of mapped) { if (!seen.has(item.id)) { seen.add(item.id); candidates.push(item); } }
  return candidates.filter(item => item.kind === 'remote' || fs.existsSync(item.rawPath)).map(item => ({ ...item, exists: true }));
}

async function loadRecentDetailed() {
  const items = await loadRecent();
  return { items, diag: { probes: [{ name: 'workspaceStorage', rawCount: items.length }, { name: 'state.vscdb', rawCount: items.length }, { name: 'storage.json', rawCount: items.length }], mappedCount: items.length, finalCount: items.length, droppedNonexistent: 0 } };
}

// 打开项目
function openProject(item) {
  const { exec } = require('node:child_process');
  const config = getVSCodeConfig();
  const codePath = config.codeExecutable || 'code';
  
  let command;
  if (item.kind === 'workspace') {
    command = `"${codePath}" "${item.rawPath}"`;
  } else if (item.kind === 'remote') {
    // 解析远程连接 URI
    // 格式: vscode-remote://ssh-remote%2B192.168.50.167/opt/...
    const uri = item.rawPath;
    const match = uri.match(/^vscode-remote:\/\/([^\/]+)(\/.*)?$/);
    if (match) {
      // 解码 remote authority: ssh-remote%2B192.168.50.167 -> ssh-remote+192.168.50.167
      const remoteAuthority = decodeURIComponent(match[1]);
      const remotePath = match[2] || '';
      command = `"${codePath}" --remote "${remoteAuthority}" "${remotePath}"`;
    } else {
      // 如果格式不匹配，尝试直接使用
      command = `"${codePath}" "${item.rawPath}"`;
    }
  } else {
    command = `"${codePath}" "${item.rawPath}"`;
  }
  
  exec(command, (error) => {
    if (error) {
      console.error('Failed to open project:', error);
    }
  });
  
  return true;
}

// Window API
window.services = {
  readFile: (file) => fs.readFileSync(file, 'utf-8'),
  writeTextFile: (text) => { const p = path.join(window.ztools.getPath('downloads'), Date.now() + '.txt'); fs.writeFileSync(p, text, 'utf-8'); return p; },
  writeImageFile: (base64Url) => { const m = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url); if (!m) return; const p = path.join(window.ztools.getPath('downloads'), Date.now() + '.' + m[1]); fs.writeFileSync(p, base64Url.substring(m[0].length), 'base64'); return p; },
  vscodeRecent: { platform: process.platform, list: loadRecent, diagnose: loadRecentDetailed, openProject },
  getVSCodeConfig, saveVSCodeConfig,
};
const FuseModule = require('fuse.js');
window.Fuse = FuseModule.default || FuseModule;

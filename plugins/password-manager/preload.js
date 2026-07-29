// 密码管理器 · preload（ZTools Node 运行环境，CommonJS）
// 职责：主密码派生密钥 → AES-256-GCM 字段加密 → sql.js 本地 SQLite 落盘（密文）
// 注意：本文件禁止打包/压缩/混淆（源码随插件分发，便于审计）。

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// sql.js（纯 WASM，无 Electron 原生模块 ABI 问题）。与 preload.js 同级 vendor 目录。
const initSqlJs = require('./vendor/sql.js/sql-wasm.js');
// SheetJS（纯 JS，无原生依赖）。用于解析 .xlsx / .xls，与 CSV 共用行构建逻辑。
const XLSX = require('./vendor/xlsx/xlsx.full.min.js');

const DB_PATH = path.join(__dirname, 'passwords.db');
const VERIFY_TOKEN = 'VAULT_VERIFY::ok';
const PBKDF2_ITERS = 100000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

// ---- 模块级运行时状态（不落盘）----
let SQL = null;
let db = null;
let masterKey = null;     // 仅在内存；锁定/插件退出即清空
let readyPromise = null;

function getDeviceId() {
  try {
    if (typeof window !== 'undefined' && window.ztools && typeof window.ztools.getNativeId === 'function') {
      return window.ztools.getNativeId();
    }
  } catch (e) { /* ignore */ }
  return ''; // 无设备指纹时退化为"无机器绑定"
}

function ensureReady() {
  if (readyPromise) return readyPromise;
  readyPromise = initSqlJs({
    locateFile: (file) => path.join(__dirname, 'vendor/sql.js', file),
  }).then((SQLlib) => {
    SQL = SQLlib;
    if (fs.existsSync(DB_PATH)) {
      const buf = fs.readFileSync(DB_PATH);
      db = new SQL.Database(buf);
    } else {
      db = new SQL.Database();
    }
    db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);`);
    db.run(`CREATE TABLE IF NOT EXISTS hosts (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT UNIQUE, name TEXT);`);
    db.run(`CREATE TABLE IF NOT EXISTS fields (id INTEGER PRIMARY KEY AUTOINCREMENT, host_id INTEGER, label TEXT, data TEXT);`);
    return true;
  });
  return readyPromise;
}

function persist() {
  const bytes = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(bytes));
}

function setSetting(key, value) {
  db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
}
function getSetting(key) {
  const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  stmt.bind([key]);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row ? row.value : null;
}

// ---- 加密 ----
function deriveKey(masterPwd, deviceId, saltBuf) {
  return crypto.pbkdf2Sync(masterPwd + '::' + deviceId, saltBuf, PBKDF2_ITERS, 32, 'sha256');
}
function encryptText(key, plaintext) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}
function decryptText(key, b64) {
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.slice(0, IV_BYTES);
  const tag = buf.slice(IV_BYTES, IV_BYTES + TAG_BYTES);
  const enc = buf.slice(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

function requireUnlocked() {
  if (!masterKey) throw new Error('LOCKED');
}

// 读取系统剪贴板文本（ZTools 运行在 Electron 中，preload 可直接 require('electron').clipboard）。
// 失败则返回 ''，调用方据此决定是否自动填充搜索框。
function readClipboardText() {
  try {
    const electron = require('electron');
    if (electron && electron.clipboard && typeof electron.clipboard.readText === 'function') {
      return electron.clipboard.readText() || '';
    }
  } catch (e) { /* require('electron') 不可用或受限 */ }
  return '';
}

// ---- 表格解析（宽格式：首行表头 ip,name,字段1,字段2...；后续每行一主机）----
// 共用矩阵解析：matrix 为二维数组（每行是若干单元格字符串）。
function cellStr(c) {
  if (c == null) return '';
  if (typeof c === 'number') {
    // 避免 100.0 / 整数科学计数法等；统一按原样字符串化
    return Number.isInteger(c) ? String(c) : String(c);
  }
  return String(c).replace(/\u00a0/g, ' ').trim();
}
function rowsFromMatrix(matrix) {
  if (!matrix || !matrix.length) return [];
  const header = (matrix[0] || []).map(cellStr);
  const fieldLabels = header.slice(1).map(s => s.trim()).filter(Boolean);
  const rows = [];
  for (let i = 1; i < matrix.length; i++) {
    const cells = (matrix[i] || []).map(cellStr);
    const ip = (cells[0] || '').trim();
    if (!ip) continue;
    const fields = [];
    fieldLabels.forEach((label, idx) => {
      const value = cells[idx + 1] != null ? cells[idx + 1] : '';
      fields.push({ label, value: value.trim() });
    });
    rows.push({ ip, fields });
  }
  return rows;
}

// ---- CSV 解析 ----
function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
function parseCsv(text) {
  const lines = (text || '').trim().split(/\r?\n/);
  if (!lines.length) return [];
  const matrix = lines.map(parseCsvLine);
  return rowsFromMatrix(matrix);
}

// ---- Excel 解析（.xlsx / .xls，取第一个工作表）----
// 注：两个修复叠加，必不可少：
//   ① `cellFormula: false` — SheetJS 默认会把 `=` 开头的单元格当公式求值，
//      失败后该格值变空；密码场景不需要任何公式，必须关掉。
//   ② v-缺失 / f-存在回退 — 某些工具（脚本生成 xlsx / 某些另存路径）会把
//      `=xxx` 字符串存成公式文本（`f`），却不存 cached value（`v` 缺失），
//      此时 cellFormula:false 也救不了——`sheet_to_json` 拿不到值。
//      遍历每个 cell：若 v 缺失且 f 还在，把 `'=' + f` 写入 v/w 当字符串用，
//      同时清掉 f（避免后续误判）。
function parseExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellFormula: false });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = wb.Sheets[firstSheetName];
  if (sheet && sheet['!ref']) {
    const range = XLSX.utils.decode_range(sheet['!ref']);
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ c, r });
        const cell = sheet[addr];
        if (!cell) continue;
        const noValue = (cell.v === undefined || cell.v === null || cell.v === '');
        if (noValue && cell.f != null && cell.f !== '') {
          const txt = '=' + String(cell.f);
          cell.v = txt;
          cell.w = txt;
          cell.t = 's';
          delete cell.f;
        }
      }
    }
  }
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false });
  return rowsFromMatrix(matrix);
}

// ---- API（暴露给渲染层 window.pmApi）----
const pmApi = {
  async isInitialized() {
    await ensureReady();
    return !!getSetting('verifier');
  },

  async setup(masterPwd) {
    await ensureReady();
    if (getSetting('verifier')) throw new Error('ALREADY_INIT');
    if (!masterPwd || masterPwd.length < 1) throw new Error('EMPTY_PWD');
    const salt = crypto.randomBytes(SALT_BYTES);
    const deviceId = getDeviceId();
    const key = deriveKey(masterPwd, deviceId, salt);
    const verifier = encryptText(key, VERIFY_TOKEN);
    setSetting('salt', salt.toString('base64'));
    setSetting('verifier', verifier);
    setSetting('device', deviceId);
    persist();
    masterKey = key;
    return true;
  },

  async unlock(masterPwd) {
    await ensureReady();
    const verifier = getSetting('verifier');
    if (!verifier) throw new Error('NOT_INIT');
    const salt = Buffer.from(getSetting('salt'), 'base64');
    const device = getSetting('device') || '';
    const currentDevice = getDeviceId();
    if (device && currentDevice && currentDevice !== device) {
      throw new Error('MACHINE_MISMATCH');
    }
    const key = deriveKey(masterPwd, device, salt);
    let ok = false;
    try {
      ok = decryptText(key, verifier) === VERIFY_TOKEN;
    } catch (e) { ok = false; }
    if (!ok) throw new Error('BAD_PASSWORD');
    masterKey = key;
    return true;
  },

  async lock() {
    masterKey = null;
    return true;
  },

  // 读取系统剪贴板文本（不依赖保险库解锁）。前端用于"复制 IP 自动填充搜索框"联动。
  async getClipboardText() {
    return readClipboardText();
  },

  async addHost(ip, fields) {
    await ensureReady();
    requireUnlocked();
    if (!ip) throw new Error('EMPTY_IP');
    db.run('INSERT OR REPLACE INTO hosts (ip) VALUES (?)', [ip]);
    const stmt = db.prepare('SELECT id FROM hosts WHERE ip = ?');
    stmt.bind([ip]);
    stmt.step();
    const hostId = stmt.getAsObject().id;
    stmt.free();
    // 清旧字段后重写
    db.run('DELETE FROM fields WHERE host_id = ?', [hostId]);
    const ins = db.prepare('INSERT INTO fields (host_id, label, data) VALUES (?, ?, ?)');
    (fields || []).forEach((f) => {
      if (!f.label) return;
      ins.run([hostId, f.label, encryptText(masterKey, f.value || '')]);
    });
    ins.free();
    persist();
    return true;
  },

  async deleteHost(ip) {
    await ensureReady();
    requireUnlocked();
    const stmt = db.prepare('SELECT id FROM hosts WHERE ip = ?');
    stmt.bind([ip]);
    if (!stmt.step()) { stmt.free(); return false; }
    const hostId = stmt.getAsObject().id;
    stmt.free();
    db.run('DELETE FROM fields WHERE host_id = ?', [hostId]);
    db.run('DELETE FROM hosts WHERE ip = ?', [ip]);
    persist();
    return true;
  },

  // 仅返回元数据（ip/name/labels），label 为明文、不解密值。
  // 前端据此构建列头并分页；值经 revealHosts 按页懒解密，避免上千条一次性解密卡顿。
  async listHosts() {
    await ensureReady();
    requireUnlocked();
    const hosts = [];
    const hs = db.exec('SELECT id, ip FROM hosts ORDER BY ip');
    if (!hs.length) return hosts;
    const hostRows = hs[0].values;
    const fs2 = db.exec('SELECT host_id, label FROM fields ORDER BY id');
    const labelMap = {};
    if (fs2.length) {
      fs2[0].values.forEach(([hostId, label]) => {
        if (!labelMap[hostId]) labelMap[hostId] = [];
        labelMap[hostId].push(label);
      });
    }
    hostRows.forEach(([id, ip]) => {
      hosts.push({ ip, labels: labelMap[id] || [] });
    });
    return hosts;
  },

  // 按 IP 列表批量懒解密（一次 JOIN 查询 + 仅解密这些主机的值）。
  // 返回 { [ip]: { [label]: value } }。分页时只传当前页的 IP，解密量可控。
  async revealHosts(ips) {
    await ensureReady();
    requireUnlocked();
    const out = {};
    if (!ips || !ips.length) return out;
    const placeholders = ips.map(() => '?').join(',');
    const stmt = db.prepare(
      `SELECT h.ip, f.label, f.data FROM hosts h JOIN fields f ON f.host_id = h.id WHERE h.ip IN (${placeholders})`
    );
    stmt.bind(ips);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      if (!out[row.ip]) out[row.ip] = {};
      out[row.ip][row.label] = decryptText(masterKey, row.data);
    }
    stmt.free();
    return out;
  },

  async getStatus() {
    await ensureReady();
    requireUnlocked();
    const h = db.exec('SELECT COUNT(*) FROM hosts');
    const c = db.exec('SELECT COUNT(*) FROM fields');
    const hosts = h.length ? h[0].values[0][0] : 0;
    const creds = c.length ? c[0].values[0][0] : 0;
      return { hosts, creds };
    },

    async importHosts(rows) {
      await ensureReady();
      requireUnlocked();
      let imported = 0, skipped = 0;
      (rows || []).forEach((r) => {
        if (!r || !r.ip) { skipped++; return; }
        try {
          db.run('INSERT OR REPLACE INTO hosts (ip) VALUES (?)', [r.ip]);
          const stmt = db.prepare('SELECT id FROM hosts WHERE ip = ?');
          stmt.bind([r.ip]); stmt.step();
          const hostId = stmt.getAsObject().id; stmt.free();
          db.run('DELETE FROM fields WHERE host_id = ?', [hostId]);
          const ins = db.prepare('INSERT INTO fields (host_id, label, data) VALUES (?, ?, ?)');
          (r.fields || []).forEach((f) => {
            if (f && f.label) ins.run([hostId, f.label, encryptText(masterKey, f.value || '')]);
          });
          ins.free();
          imported++;
        } catch (e) { skipped++; }
      });
      persist(); // 批量导入仅落盘一次
      return { imported, skipped };
    },

    async importFile(filePath) {
      await ensureReady();
      requireUnlocked();
      const ext = (path.extname(filePath) || '').toLowerCase();
      let rows;
      if (ext === '.csv') {
        rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
      } else if (ext === '.xlsx' || ext === '.xls') {
        rows = parseExcel(fs.readFileSync(filePath));
      } else {
        throw new Error('UNSUPPORTED_FILE:' + (ext || 'unknown'));
      }
      const total = rows.length;
      if (!total) return { imported: 0, skipped: 0, total: 0 };
      const res = await this.importHosts(rows);
      res.total = total;
      return res;
    },

    async importCsv(filePath) {
      await ensureReady();
      requireUnlocked();
      const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
      if (!rows.length) return { imported: 0, skipped: 0, total: 0 };
      const res = await this.importHosts(rows);
      res.total = rows.length;
      return res;
    },
};

// 暴露给渲染层
if (typeof window !== 'undefined') {
  window.pmApi = pmApi;
  // 主题钩子（渲染层也会调用 isDarkColors，这里仅保底）
  if (typeof window.ztools !== 'undefined' && typeof window.ztools.onPluginEnter === 'function') {
    window.ztools.onPluginEnter((param) => { try { window.launchParam = param; } catch (e) {} });
  }
}

// Node 单测时 module.exports
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pmApi, ensureReady };
}

console.log('[password-manager] preload loaded');

/**
 * GitHub 星标管理 · preload（ZTools / uTools 的 Node 运行环境，CommonJS）
 *
 * 职责：账号簿（多账号 + 可选 Token）、调用 GitHub API 拉取星标、本地缓存、导出 JSON。
 * 页面（index.html）没有 Node，只能通过本文件挂在 window.services 上的函数通信。
 *
 * 存储键（utools/ztools dbStorage）：
 *   ghstar.accounts       [{id, user, token, label, login, avatar, createdAt}]
 *   ghstar.current        当前账号 id
 *   ghstar.cache.<id>     {fetchedAt, mode, items:[...]}
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------- 运行时兼容：ZTools 是 window.ztools，uTools 是 window.utools ----------
function ZT() {
  if (typeof window !== 'undefined') return window.ztools || window.utools || {};
  return globalThis.ztools || globalThis.utools || {};
}
function dbGet(key) {
  try { const z = ZT(); return z.dbStorage ? z.dbStorage.getItem(key) : null; } catch (e) { return null; }
}
function dbSet(key, val) {
  try { const z = ZT(); return z.dbStorage ? z.dbStorage.setItem(key, val) : null; } catch (e) { return null; }
}
function dbDel(key) {
  try { const z = ZT(); return z.dbStorage ? z.dbStorage.removeItem(key) : null; } catch (e) { return null; }
}

const K_ACCOUNTS = 'ghstar.accounts';
const K_CURRENT = 'ghstar.current';
const kCache = (id) => 'ghstar.cache.' + id;

// ---------- 账号簿 ----------
function accounts() {
  const a = dbGet(K_ACCOUNTS);
  return Array.isArray(a) ? a : [];
}
function saveAccounts(list) { dbSet(K_ACCOUNTS, list); return list; }
function maskToken(t) {
  if (!t) return '';
  return t.length <= 10 ? '****' : t.slice(0, 4) + '…' + t.slice(-4);
}
/** 对外输出时永远不带明文 token */
function publicAccount(a) {
  return {
    id: a.id, user: a.user, label: a.label || a.user,
    hasToken: !!a.token, tokenMask: maskToken(a.token),
    login: a.login || '', avatar: a.avatar || '', createdAt: a.createdAt || 0,
    scope: a.scope || 'public'
  };
}
function currentId() { return dbGet(K_CURRENT) || (accounts()[0] ? accounts()[0].id : null); }
function currentAccount() {
  const id = currentId();
  return accounts().find((a) => a.id === id) || null;
}

function addAccount({ user, token, label }) {
  user = String(user || '').trim().replace(/^@/, '');
  token = String(token || '').trim();
  if (!token) throw new Error('必须填写 GitHub Token（本插件只用 Token 模式访问 /user/starred）');
  const list = accounts();
  const dup = list.find((a) => (a.token || '') === token);
  if (dup) { dbSet(K_CURRENT, dup.id); return { accounts: list.map(publicAccount), current: dup.id, duplicated: true }; }
  const acc = {
    id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    user: user, token: token, label: String(label || '').trim() || user || '我的账号',
    createdAt: Date.now()
  };
  list.push(acc);
  saveAccounts(list);
  dbSet(K_CURRENT, acc.id);
  return { accounts: list.map(publicAccount), current: acc.id };
}

function updateAccount(id, patch) {
  const list = accounts();
  const i = list.findIndex((a) => a.id === id);
  if (i < 0) throw new Error('账号不存在');
  const p = {};
  if (patch && patch.user != null) p.user = String(patch.user).trim().replace(/^@/, '');
  if (patch && patch.label != null) p.label = String(patch.label).trim();
  if (patch && patch.token != null) {
    const t = String(patch.token).trim();
    if (!t) throw new Error('Token 不能为空');
    p.token = t;
  }
  list[i] = Object.assign({}, list[i], p);
  saveAccounts(list);
  return { accounts: list.map(publicAccount), current: currentId() };
}

function removeAccount(id) {
  const list = accounts().filter((a) => a.id !== id);
  saveAccounts(list);
  dbDel(kCache(id));
  if (currentId() === id) dbSet(K_CURRENT, list[0] ? list[0].id : null);
  return { accounts: list.map(publicAccount), current: currentId() };
}

function setCurrent(id) {
  if (!accounts().some((a) => a.id === id)) throw new Error('账号不存在');
  dbSet(K_CURRENT, id);
  return { accounts: accounts().map(publicAccount), current: id };
}

// ---------- 仓库备注（按 owner/repo 全局保存，可搜索） ----------
const K_NOTES = 'ghstar.notes';

function notes() {
  const n = dbGet(K_NOTES);
  return (n && typeof n === 'object' && !Array.isArray(n)) ? n : {};
}
function setNote(name, text) {
  name = String(name || '').trim();
  if (!name) throw new Error('缺少仓库名');
  const all = notes();
  const t = String(text == null ? '' : text).trim();
  if (!t) delete all[name];
  else all[name] = { t: t, u: Date.now() };
  dbSet(K_NOTES, all);
  return { notes: all, name: name, text: t };
}
function deleteNote(name) {
  const all = notes();
  delete all[String(name || '').trim()];
  dbSet(K_NOTES, all);
  return { notes: all };
}

// ---------- GitHub API ----------
const API = 'https://api.github.com';
const UA = 'ztools-github-stars';

async function apiGet(url, token) {
  const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': UA };
  if (token) headers.Authorization = 'token ' + token;
  let res, lastErr = '';
  for (let attempt = 1; attempt <= 3; attempt++) {         // 网络抖动重试（不改 HTTP 状态类错误）
    try {
      if (typeof fetch !== 'function') throw new Error('当前运行环境没有 fetch');
      res = await fetch(url, { headers });
      break;
    } catch (e) {
      const cause = e && e.cause ? ' · ' + (e.cause.message || e.cause.code || e.cause) : '';
      lastErr = (e && e.message ? e.message : String(e)) + cause;
      if (attempt < 3) await sleep(1200 * attempt);
    }
  }
  if (!res) {
    throw new Error('网络请求失败（已重试 3 次）：' + lastErr + '（检查网络或代理设置）');
  }
  if (res.status === 401) throw new Error('Token 无效或已过期（401），请编辑账号更新 Token');
  if (res.status === 404) throw new Error('账号或仓库不存在（404），请检查用户名');
  if (res.status === 403) {
    const remain = res.headers.get('x-ratelimit-remaining');
    if (remain === '0') {
      const ts = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
      const t = ts ? new Date(ts).toLocaleTimeString() : '稍后';
      throw new Error('触发 GitHub 配额限制（匿名每小时 60 次）。约 ' + t + ' 后恢复，或为该账号填一个 Token（每小时 5000 次）');
    }
    throw new Error('GitHub 拒绝请求（403）：' + (res.headers.get('x-ratelimit-remaining') || '未知原因'));
  }
  if (!res.ok) throw new Error('GitHub 返回 HTTP ' + res.status);
  return res.json();
}

/** 校验账号：一律用 Token 调 /user，能拿到登录名、头像，也能看到私有星标 */
async function verifyAccount(acc) {
  const me = await apiGet(API + '/user', acc.token);
  return { login: me.login, avatar: me.avatar_url || '', scope: 'with-token', name: me.name || '' };
}

function slim(r) {
  return {
    n: r.full_name,
    u: r.html_url,
    d: (r.description || '').trim(),
    l: r.language || '',
    t: r.topics || [],
    s: r.stargazers_count || 0,
    p: (r.pushed_at || '').slice(0, 10),
    a: !!r.archived
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 拉取星标：一律带 Token 走 /user/starred（包含私有星标）。
 * 温和抓取：每页 100 条，页间 250ms。
 */
async function fetchStars(id) {
  const acc = (id ? accounts().find((a) => a.id === id) : null) || currentAccount();
  if (!acc) throw new Error('还没有账号，先点「添加账号」');
  if (!acc.token) throw new Error('该账号没有 Token，请点「编辑」补上 Token');
  const info = await verifyAccount(acc);
  const url = API + '/user/starred';

  const items = [];
  for (let page = 1; page <= 30; page++) {
    const data = await apiGet(url + '?per_page=100&page=' + page + '&sort=created&direction=desc', acc.token);
    if (!Array.isArray(data)) break;
    data.forEach((r) => items.push(slim(r)));
    if (data.length < 100) break;
    await sleep(250);
  }

  // 回写 login/avatar/scope，便于界面显示「当前是谁的星标」
  const list = accounts();
  const i = list.findIndex((a) => a.id === acc.id);
  if (i >= 0) {
    list[i] = Object.assign({}, list[i], { login: info.login, avatar: info.avatar, scope: info.scope });
    saveAccounts(list);
  }

  const cache = {
    fetchedAt: Date.now(), mode: 'with-token',
    login: info.login, user: acc.user, total: items.length, items: items
  };
  dbSet(kCache(acc.id), cache);
  return {
    ok: true, account: publicAccount(list[i] || acc), fetchedAt: cache.fetchedAt,
    mode: cache.mode, total: items.length, items: items
  };
}

function getCache(id) {
  const cid = id || currentId();
  if (!cid) return null;
  return dbGet(kCache(cid)) || null;
}

/** 导出当前账号缓存为 JSON 文件，返回文件路径（写到下载目录或用户目录） */
function exportJson() {
  const acc = currentAccount();
  const c = getCache();
  if (!acc || !c) throw new Error('当前账号还没有缓存数据，先刷新一次');
  const dir = (() => {
    const dl = path.join(os.homedir(), 'Downloads');
    try { if (fs.existsSync(dl)) return dl; } catch (e) { /* ignore */ }
    return os.homedir();
  })();
  const stamp = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, 'github-stars-' + (acc.login || acc.user) + '-' + stamp + '.json');
  fs.writeFileSync(file, JSON.stringify({
    user: acc.login || acc.user, mode: c.mode, fetchedAt: new Date(c.fetchedAt).toISOString(),
    total: (c.items || []).length, notes: notes(), items: c.items || []
  }, null, 1), 'utf8');
  return { path: file, total: (c.items || []).length };
}

// ---------- 常用系统能力 ----------
function openExternal(url) {
  const z = ZT();
  if (z.shellOpenExternal) return z.shellOpenExternal(url);
  if (z.shellOpenPath) return z.shellOpenPath(url);
  return null;
}
function copy(text) {
  const z = ZT();
  if (z.copyText) return z.copyText(String(text || ''));
  if (z.clipboard && z.clipboard.writeContent) return z.clipboard.writeContent({ type: 'text', content: String(text || '') });
  return null;
}
function notify(title, body) {
  const z = ZT();
  if (z.showNotification) return z.showNotification('' + title, '' + (body || ''));
  return null;
}

// ---------- 暴露给页面 ----------
const services = {
  // 账号
  listAccounts: () => ({ accounts: accounts().map(publicAccount), current: currentId() }),
  addAccount: addAccount,
  updateAccount: updateAccount,
  removeAccount: removeAccount,
  setCurrent: setCurrent,
  getCurrent: () => { const a = currentAccount(); return a ? publicAccount(a) : null; },
  // 数据
  fetchStars: fetchStars,
  getCache: getCache,
  exportJson: exportJson,
  // 备注
  notes: notes,
  setNote: setNote,
  deleteNote: deleteNote,
  // 系统
  openExternal: openExternal,
  copy: copy,
  notify: notify
};

if (typeof window !== 'undefined') {
  // 暴露给页面：优先 contextBridge（开启上下文隔离时），否则直接挂 window（ZTools 默认）
  var exposedBridge = false;
  try {
    var z0 = ZT();
    var bridge = window.contextBridge || z0.contextBridge;
    if (bridge && typeof bridge.exposeInMainWorld === 'function') {
      bridge.exposeInMainWorld('services', services);
      exposedBridge = true;
    }
  } catch (e) { /* 走下方兜底 */ }
  if (!exposedBridge) {
    try { window.services = services; } catch (e) { /* window 不可写则放弃 */ }
  }
  // uTools 兼容：不定义会提示「window.exports 未配置」
  try {
    window.exports = {
      'ghstar': { mode: 'none', args: { enter() { if (window.ztools && window.ztools.setExpendHeight) window.ztools.setExpendHeight(640); }, leave() {} } },
      'ghstar-search': { mode: 'none', args: { enter() {}, leave() {} } }
    };
  } catch (e) { /* ignore */ }
}

module.exports = services;

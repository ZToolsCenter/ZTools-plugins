'use strict';
/*
 * 股票管家 —— ZTools 插件 preload（主窗口 / 球窗口 / 面板窗口 共用一份）
 *
 * 关键约束（ZTools 现状，见 easynote / datatimeutc 的实践）：
 *  1. 创建者持有 WindowInstance，握手时把 BrowserWindow.id 交给球；
 *     球通过宿主同插件校验的同步窗口接口自行拖动，旧宿主回退主页面转发。
 *  2. plugin.json 的 preload 只保证注入插件主窗口，新建窗口必须显式传 webPreferences.preload。
 *  3. preload 里 require('electron') 只拿得到渲染端模块（ipcRenderer），没有 ipcMain/screen，
 *     屏幕信息一律走 ztools.* API。
 *  4. 子窗口 → 主窗口：ipcRenderer.sendTo(hostId) 与 ztools.sendToParent 两条路都发，宿主按 mid 去重。
 */
const { ipcRenderer } = require('electron');
const market = require('./lib/market.js');
const storeModule = require('./lib/store.js');

const CH = 'sb:cmd';
const VERSION = '1.0.4';
const HEARTBEAT_FRESH_MS = 15000;
const BALL_PAD = 6;          // 球窗口四周留白（放光晕，别裁掉阴影）
const MENU_W = 152;
const MENU_H = 250;


function getZTools() {
  const candidates = [];
  try { if (typeof ztools !== 'undefined' && ztools) candidates.push(ztools); } catch (e) { /* ignore */ }
  try { if (typeof utools !== 'undefined' && utools) candidates.push(utools); } catch (e) { /* ignore */ }
  try { if (typeof window !== 'undefined' && window.ztools) candidates.push(window.ztools); } catch (e) { /* ignore */ }
  try { if (typeof window !== 'undefined' && window.utools) candidates.push(window.utools); } catch (e) { /* ignore */ }
  return candidates[0] || {};
}
const Z = getZTools();
const store = storeModule.createStore(Z.dbStorage);

function roleFromLocation() {
  let href = '';
  try { href = String((typeof location !== 'undefined' && (location.pathname || location.href)) || ''); } catch (e) { href = ''; }
  if (/ball\.html$/i.test(href)) return 'ball';
  if (/panel\.html$/i.test(href)) return 'panel';
  return 'main';
}
const ROLE = roleFromLocation();
const IS_HOST = ROLE === 'main';

function log() {
  try { console.log.apply(console, ['[stock-ball]'].concat(Array.prototype.slice.call(arguments))); } catch (e) { /* ignore */ }
}
function safe(fn, dflt) {
  try { return fn(); } catch (e) { return dflt; }
}
function workAreaNear(rect) {
  let d = null;
  try {
    if (rect && typeof Z.getDisplayMatching === 'function') d = Z.getDisplayMatching(rect);
    if (!d && rect && typeof Z.getDisplayNearestPoint === 'function') {
      d = Z.getDisplayNearestPoint({ x: rect.x + Math.round(rect.width / 2), y: rect.y + Math.round(rect.height / 2) });
    }
    if (!d && typeof Z.getPrimaryDisplay === 'function') d = Z.getPrimaryDisplay();
  } catch (e) { d = null; }
  const wa = (d && (d.workArea || d.bounds)) || null;
  if (wa && wa.width && wa.height) return { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
  return { x: 0, y: 0, width: 1280, height: 800 };
}

/* ------------------------------------------------------------------ */
/* 窗口间通信桥（主窗口 ⇄ 子窗口），所有窗口共用                       */
/* ------------------------------------------------------------------ */
let hostId = null;
let selfWindowId = null; // BrowserWindow.id，与 webContents.id 不同，由创建者握手告知
let lastHostMsgAt = Date.now(); // 最近一次收到主窗口消息的时刻（球的通道存活探测基准）
let greeted = false;
let midSeq = 0;
const listeners = [];
const pending = [];
const seen = new Set();

function newMid() {
  midSeq += 1;
  return Date.now().toString(36) + '-' + midSeq.toString(36) + Math.random().toString(36).slice(2, 6);
}
function toHost(msg) {
  const envelope = Object.assign({ mid: newMid() }, msg);
  let sent = false;
  if (hostId) {
    try { ipcRenderer.sendTo(hostId, CH, envelope); sent = true; } catch (e) { /* ignore */ }
  }
  try {
    if (typeof Z.sendToParent === 'function') { Z.sendToParent(CH, envelope); sent = true; }
  } catch (e) { /* ignore */ }
  if (!sent) pending.push(envelope);
  return envelope.mid;
}
function toWindow(id, msg) {
  if (!id) return false;
  try { ipcRenderer.sendTo(id, CH, msg); return true; } catch (e) { return false; }
}
function onHostMsg(fn) { if (typeof fn === 'function') listeners.push(fn); }
function dispatch(msg, senderId) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.mid) {
    if (seen.has(msg.mid)) return;
    seen.add(msg.mid);
    if (seen.size > 200) seen.delete(seen.values().next().value);
  }
  listeners.forEach((fn) => { try { fn(msg, senderId); } catch (e) { log('指令处理失败', e); } });
}

ipcRenderer.on(CH, (event, msg) => {
  const senderId = event && event.senderId;
  // 入站自愈：任何来自主窗口的消息都刷新 hostId —— 主窗口重载后 id 可能变化，
  // 陈旧 hostId 会让拖动/双击永久失联（sendToParent 渲染层并未暴露，这条路不存在）
  if (ROLE !== 'main' && senderId) { hostId = senderId; lastHostMsgAt = Date.now(); }
  if (msg && msg.t === 'hello') {
    if (senderId) hostId = senderId;
    if (ROLE === 'ball' && Number.isInteger(msg.windowId) && msg.windowId > 0) selfWindowId = msg.windowId;
    greeted = true;
    try { ipcRenderer.sendTo(senderId, CH, { t: 'hello-ack', role: ROLE }); } catch (e) { /* ignore */ }
    while (pending.length) {
      const m = pending.shift();
      try { ipcRenderer.sendTo(senderId, CH, m); } catch (e) { /* ignore */ }
    }
    return;
  }
  dispatch(msg, senderId);
});

/* ------------------------------------------------------------------ */
/* 页面可见的服务（window.services）                                   */
/* ------------------------------------------------------------------ */
const ctlHandlers = [];
function onCtl(fn) { if (typeof fn === 'function') ctlHandlers.push(fn); }
function fireCtl(payload) {
  ctlHandlers.forEach((fn) => { try { fn(payload); } catch (e) { log('ctl 处理失败', e); } });
  try {
    window.dispatchEvent(new CustomEvent('sb-ctl', { detail: payload }));
  } catch (e) { /* ignore */ }
}

function proxyOf(opts) {
  if (opts && opts.proxy) return opts.proxy;
  return store.getSettings().proxy;
}

function openExternalUrl(rawUrl) {
  if (!rawUrl) return '';
  const u = rawUrl;
  let opened = false;
  try {
    const electron = require('electron');
    if (electron && electron.shell && typeof electron.shell.openExternal === 'function') {
      electron.shell.openExternal(u);
      opened = true;
    }
  } catch (e) { /* ignore */ }
  if (!opened) {
    try {
      if (Z && typeof Z.shellOpenExternal === 'function') {
        Z.shellOpenExternal(u);
        opened = true;
      }
    } catch (e) { /* ignore */ }
  }
  if (!opened) {
    try {
      const cp = require('child_process');
      if (process.platform === 'win32') {
        cp.exec('start "" "' + u + '"');
      } else if (process.platform === 'darwin') {
        cp.exec('open "' + u + '"');
      } else {
        cp.exec('xdg-open "' + u + '"');
      }
      opened = true;
    } catch (e) { /* ignore */ }
  }
  if (!opened) {
    try { window.open(u, '_blank'); } catch (e) { /* ignore */ }
  }
  // 返回是否已在本地成功唤起：调用方据此决定要不要请主窗口兜底再开一次
  return opened ? u : '';
}

/* ---------------- 开机自动启动（跟随 ZTools 主程序） ----------------
 * 逆自当前 ZTools(app.asar) 的官方机制，与宿主右键菜单「跟随主程序同时启动运行」同键同源：
 *  1) db 键 `auto-start-plugin`：插件名数组 → 主进程启动时逐个 preloadPlugin；
 *  2) IPC `set-launch-at-login` / `get-launch-at-login`：宿主设置页「开机启动」的同一通道
 *     （背后 app.setLoginItemSettings → HKCU Run，与手动勾选完全等价）；
 *  3) 本插件补最后一环：宿主预载通常不回调 onPluginEnter → 预载后2.5秒内没等到进入
 *     动作、且名单里有本插件 → 直接打开桌面悬浮球。
 * 开关做成对称：开 = 名单 + 宿主开机启动都打开；关 = 都关。
 */
const AUTO_START_KEY = 'auto-start-plugin';

function resolveAutoStartName() {
  try {
    if (typeof Z.getAllPlugins === 'function') {
      return Promise.resolve(Z.getAllPlugins()).then((ps) => {
        if (Array.isArray(ps)) {
          const hit = ps.find((p) => p && p.name === 'stock-ball')
            || ps.find((p) => p && Array.isArray(p.cmds) && p.cmds.indexOf('股票管家') >= 0)
            || ps.find((p) => p && p.pluginName === '股票管家');
          if (hit && hit.name) return hit.name;
        }
        return 'stock-ball';
      }).catch(() => 'stock-ball');
    }
  } catch (e) { /* ignore */ }
  return Promise.resolve('stock-ball');
}

async function autoStartGetList() {
  let list = null;
  try { if (typeof Z.dbGet === 'function') list = await Z.dbGet(AUTO_START_KEY); } catch (e) { list = null; }
  if (list === null || list === undefined) {
    try { list = Z.dbStorage.getItem(AUTO_START_KEY); } catch (e) { list = null; }
  }
  return Array.isArray(list) ? list : [];
}

async function autoStartPutList(list) {
  if (typeof Z.dbPut === 'function') { await Z.dbPut(AUTO_START_KEY, list); return; }
  Z.dbStorage.setItem(AUTO_START_KEY, list);
}

async function hostLaunchSet(on) {
  try { await ipcRenderer.invoke('set-launch-at-login', !!on); return; } catch (e) { /* 无此通道 → 注册表兜底 */ }
  try {
    const cp = require('child_process');
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
    if (on) {
      cp.execFileSync('reg', ['add', key, '/v', 'ZTools', '/t', 'REG_SZ', '/d', '"' + process.execPath + '"', '/f'], { windowsHide: true });
    } else {
      cp.execFileSync('reg', ['delete', key, '/v', 'ZTools', '/f'], { windowsHide: true });
    }
  } catch (e) { /* ignore */ }
}

async function hostLaunchGet() {
  try { return await ipcRenderer.invoke('get-launch-at-login'); } catch (e) { /* ignore */ }
  try {
    const cp = require('child_process');
    cp.execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'ZTools'], { windowsHide: true });
    return true;
  } catch (e) { return false; }
}

/*
 * 预警提醒的「已提醒」时间表。
 * 放在跨窗口共享的临时缓存（store.getAlertCooldowns）而不是模块变量：
 * 主窗口 / 悬浮球 / 面板各有一份 preload 实例，再加上「持仓」和「自选行情」
 * 两条评估路径（代码集合不同，跨窗口复用判断不适用），同一条预警以前最多会弹 4 次。
 * 现在谁先提醒谁占坑，其它窗口在冷却期内一律静默。
 */
function claimAlertNotify(cdKey, coolKey, now, intervalMs) {
  const last = Number(coolKey[cdKey]) || 0;
  if (last && (now - last) < intervalMs) return false;
  coolKey[cdKey] = now;
  return true;
}

/*
 * 预警通知出口：只有主窗口（IS_HOST）有权认领冷却坑位并弹通知。
 * 旧实现每个窗口各自「读冷却表 → 认领 → 写回」：主窗口和悬浮球的刷新定时器同相，
 * 同一秒内两个窗口都读到空的冷却表、各自认领成功 → 一条预警稳定双弹（用户实测必现）。
 * 现在子窗口只做本地预检（冷却期内连消息都不发），冷却期外转发给主窗口，
 * 由主窗口单线程读写冷却表 —— 天然不重复。
 */
function fireAlertNotification(cdKey, cooldowns, now, intervalMs, title, body) {
  if (IS_HOST) {
    if (!claimAlertNotify(cdKey, cooldowns, now, intervalMs)) return;
    store.setAlertCooldowns(cooldowns);
    sendDesktopNotification(title, body);
    return;
  }
  const last = Number(cooldowns[cdKey]) || 0;
  if (last && (now - last) < intervalMs) return;
  toHost({ t: 'alert-fire', k: cdKey, intervalMs: intervalMs, title: title, body: body });
}

function sendDesktopNotification(title, body) {
  try {
    if (typeof Z !== 'undefined' && typeof Z.showNotification === 'function') {
      Z.showNotification(body ? (title + '\n' + body) : title);
      return;
    }
  } catch (e) { /* ignore */ }
  try {
    if (typeof Notification !== 'undefined') {
      if (Notification.permission === 'granted') {
        new Notification(title, { body: body || '' });
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then((p) => {
          if (p === 'granted') new Notification(title, { body: body || '' });
        });
      }
    }
  } catch (e) { /* ignore */ }
}

/* 价格显示口径：ETF/可转债/低价股是三位小数（1.057），截成两位会算错金额。
   < 10 元用 3 位，>= 10 元用 2 位（与 index.js / panel.js 的 fmtPrice 一致） */
function fmtAlertPrice(v) {
  const n = Number(v);
  if (!isFinite(n)) return '--';
  return n < 10 ? n.toFixed(3) : n.toFixed(2);
}

function isTradingTime(now) {
  if (market && typeof market.isTradingTime === 'function') {
    return market.isTradingTime(now);
  }
  const st = market && typeof market.marketStatus === 'function' ? market.marketStatus(now) : null;
  if (st && typeof st.open === 'boolean') return st.open;
  const d = now ? new Date(now) : new Date();
  const day = d.getDay();
  const hhmm = d.getHours() * 100 + d.getMinutes();
  if (day === 0 || day === 6) return false;
  return (hhmm >= 910 && hhmm <= 1130) || (hhmm >= 1300 && hhmm <= 1500);
}

function evaluateAlerts(quotesMap, options) {
  const opts = options || {};
  // 通知仅在北京时间 9:25–11:30、13:00–15:00 放行；行情获取仍可从 9:10 开始。
  if (!opts.ignoreTradingTime && !market.isAlertTime(opts.currentTime)) {
    return;
  }
  if (!quotesMap || Object.keys(quotesMap).length === 0) return;
  const alerts = store.getAlerts();
  if (!alerts || alerts.length === 0) return;

  const now = opts.currentTime || Date.now();
  // 共享冷却表：读一次，谁提醒谁写回，保证同一条件在整个冷却期内只提醒一次
  //（以前是模块级变量 → 每个窗口各一份 → 一条预警弹 2~4 次）
  const cooldowns = store.getAlertCooldowns();

  alerts.forEach((alert) => {
    if (!alert || alert.enabled === false) return;
    const code = alert.stock_code;
    const q = quotesMap[code];
    if (!q) return;

    const price = Number(q.price);
    const pct = Number(q.pct !== undefined ? q.pct : q.change_percent);
    const intervalMs = (alert.notification_interval || 5) * 60 * 1000;
    const name = alert.stock_name || q.name || code;

    // 1. 股价高于目标
    if (alert.high_price > 0 && !isNaN(price) && price >= alert.high_price) {
      fireAlertNotification(code + '_high_price', cooldowns, now, intervalMs,
        '【股价预警】' + name + '(' + code + ')',
        '突破目标高价！最新价: ¥' + fmtAlertPrice(price) + ' (目标: >=¥' + fmtAlertPrice(alert.high_price) + ')');
    }

    // 2. 股价低于目标
    if (alert.low_price > 0 && !isNaN(price) && price <= alert.low_price) {
      fireAlertNotification(code + '_low_price', cooldowns, now, intervalMs,
        '【股价预警】' + name + '(' + code + ')',
        '跌破目标低价！最新价: ¥' + fmtAlertPrice(price) + ' (目标: <=¥' + fmtAlertPrice(alert.low_price) + ')');
    }

    // 3. 涨幅高于目标
    if (alert.high_change > 0 && !isNaN(pct) && pct >= alert.high_change) {
      fireAlertNotification(code + '_high_change', cooldowns, now, intervalMs,
        '【大涨预警】' + name + '(' + code + ')',
        '今日涨幅超标！当前涨幅: +' + pct.toFixed(2) + '% (目标: >=+' + alert.high_change.toFixed(2) + '%)');
    }

    // 4. 跌幅大于目标 (low_change 通常为负数)
    if (alert.low_change < 0 && !isNaN(pct) && pct <= alert.low_change) {
      fireAlertNotification(code + '_low_change', cooldowns, now, intervalMs,
        '【大跌预警】' + name + '(' + code + ')',
        '今日跌幅超标！当前涨跌: ' + pct.toFixed(2) + '% (目标: <=' + alert.low_change.toFixed(2) + '%)');
    }
  });
}

/*
 * 跨窗口行情复用（性能）。
 * 主窗口 / 悬浮球 / 面板各有自己的刷新循环，同一份行情以前会被重复请求 2~3 次
 *（顺带还会重复弹一遍股价预警）。这里做两层协调：
 *  1) 新鲜度窗口（刷新间隔的 60%，1.2s~15s）：谁先拉到就写入「时间 + 覆盖到的代码」，
 *     其它窗口在窗口期内直接复用缓存；
 *  2) 同时刻竞争（三个窗口的定时器同相，会一起发请求）：先动手的写一个 pendingAt 标记，
 *     其它窗口先等一下（最多 1.5s）拿它的结果；若它拉失败（有兜底重试），自己再发。
 * 标记过期、或所需代码没被上一次拉取覆盖时，照旧自己发请求（悬浮球单独运行时也照样工作）。
 */
function sharedFreshMs() {
  let sec = 5;
  try {
    const s = store.getSettings() || {};
    sec = Number(s.refreshSec) || 5;
  } catch (e) { sec = 5; }
  return Math.min(15000, Math.max(1200, Math.round(sec * 1000 * 0.6)));
}

/* 等待对端在途请求的上限：覆盖单次 HTTP 尝试的 9s 超时 + 余量。
   之前固定 1500ms —— 接口稍慢（复现：2.2s）就等不到，各窗口各自再发一遍同样的请求。
   对端真挂了也最多空等 9.5s 随后自行请求（pendingAt 失活自动让行）。 */
function sharedWaitMs() { return 9500; }

function sleepMs(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function takeFreshSharedQuotes(codes) {
  const want = (codes || []).filter(Boolean);
  if (!want.length) return null;
  const st = store.getQuoteStamp();
  if (!st || !st.at || (Date.now() - st.at) > sharedFreshMs()) return null;
  const covered = st.codes || [];
  const qMap = store.getLatestQuotes() || {};
  const out = {};
  for (let i = 0; i < want.length; i++) {
    const code = want[i];
    if (covered.indexOf(code) < 0 || !qMap[code]) return null;
    out[code] = qMap[code];
  }
  return out;
}

// 拉取成功：记录「时间 + 已覆盖的代码集合」，同时清掉竞争标记。
// 必须是并集而不是覆盖：持仓与自选是两套不同的代码集合，先到的记档若被后到的
// 覆盖掉，其它窗口按自己的集合校验时永远「未覆盖」→ 跨窗口复用形同虚设，
// 三个窗口每轮各发一遍请求（性能回归测试 test-refresh-efficiency 锁死此行为）。
function markSharedQuotes(codes) {
  const list = (codes || []).filter(Boolean);
  if (!list.length) return;
  const cur = store.getQuoteStamp() || {};
  let merged = list;
  if (cur.at && (Date.now() - cur.at) < sharedFreshMs() && Array.isArray(cur.codes) && cur.codes.length) {
    merged = cur.codes.slice();
    list.forEach((c) => { if (merged.indexOf(c) < 0) merged.push(c); });
  }
  store.setQuoteStamp(Object.assign({}, cur, { at: Date.now(), codes: merged, by: ROLE, pendingAt: 0 }));
}

function markSharedFetchStart(kind) {
  try {
    const cur = store.getQuoteStamp() || {};
    const key = kind === 'I' ? 'idxPendingAt' : 'pendingAt';
    store.setQuoteStamp(Object.assign({}, cur, { [key]: Date.now() }));
  } catch (e) { /* ignore */ }
}

function markSharedFetchEnd(kind) {
  try {
    const cur = store.getQuoteStamp() || {};
    const key = kind === 'I' ? 'idxPendingAt' : 'pendingAt';
    if (cur[key]) store.setQuoteStamp(Object.assign({}, cur, { [key]: 0 }));
  } catch (e) { /* ignore */ }
}

function peerIsFetching(kind) {
  const st = store.getQuoteStamp();
  const at = st && st[kind === 'I' ? 'idxPendingAt' : 'pendingAt'];
  return !!(at && (Date.now() - at) < sharedWaitMs());
}

/*
 * 能复用就复用；发现别的窗口正在拉同一批行情，就先等它（最多 1.5s）。
 * 等不到（对端拉失败、或它拉的那批代码没盖住我需要的）就返回 null，调用方自己发请求。
 */
async function reuseOrWaitSharedQuotes(codes) {
  const fresh = takeFreshSharedQuotes(codes);
  if (fresh) return fresh;
  /*
   * 先让出一次事件循环：三个窗口的定时器同相，会在同一瞬间一起进到里，
   * 让先动手的那个窗口先把 pendingAt 写上，后面两个就不会一起发请求。
   */
  await sleepMs(0);
  const fresh2 = takeFreshSharedQuotes(codes);
  if (fresh2) return fresh2;
  if (!peerIsFetching()) return null;
  const deadline = Date.now() + sharedWaitMs();
  const waitStart = Date.now();
  while (Date.now() < deadline) {
    // 自适应轮询：先密后疏（75→150→300ms），把等待期间的共享存储读取压到最低
    //（固定75ms轮询 + 等待拉长会让读库次数反弹，复现里1.5s就产生了54次读）
    const waited = Date.now() - waitStart;
    await sleepMs(waited < 600 ? 75 : (waited < 1500 ? 150 : 300));
    const hit = takeFreshSharedQuotes(codes);
    if (hit) return hit;
    if (!peerIsFetching()) break;
  }
  return null;
}

/*
 * 非交易时段行情闸门。
 * 收盘后行情不会再变，但主窗口/球/面板仍按 refreshSec 每几秒一轮地发请求；
 * 东财非交易时段经常超时/502，一次失败链路（多代理候选×重试×9s 超时）能挂几十秒，
 * 期间还伴随同步 dbStorage 往返 —— 纯属空转，用户也觉得卡。
 * 规则：非交易时段每类数据（持仓 P / 自选 Q / 指数 I）只放行第一次拉取，
 * 成功后记档 offXAt，之后一律直接吃本地缓存；直到下一次交易时段才恢复刷新。
 * 记档有效期 = 最近一个交易日 15:00 之后，跨过收盘的旧记档自动失效。
 *（无节假日日历：节假日 isTradingTime 仍按交易时段处理 → 行为同旧版，不会更差。）
 * 逃生口：force=true（手动刷新按钮）、settings.offSessionFetchOnce === false（测试/特殊需求）。
 */
function lastTradingEnd(now) {
  const t = now || Date.now();
  const d = new Date(t);
  d.setHours(15, 0, 0, 0);
  const wd = d.getDay();
  if (wd !== 0 && wd !== 6 && t >= d.getTime()) return d.getTime();
  do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6);
  return d.getTime();
}
function offSessionGate(opts, kind) {
  if (opts && opts.force) return false;                       // 手动强制刷新放行
  let s = null;
  try { s = store.getSettings(); } catch (e) { s = null; }
  if (s && s.offSessionFetchOnce === false) return false;     // 总开关（测试用）
  if (isTradingTime(Date.now())) return false;                // 交易时段：正常刷新
  const st = store.getQuoteStamp() || {};
  const at = Number(st['off' + kind + 'At']) || 0;
  return at > 0 && at >= lastTradingEnd(Date.now());           // 本收盘时段已成功拉过 → 拦截
}
function noteSessionFetched(kind) {
  const now = Date.now();
  const st = store.getQuoteStamp() || {};
  if (isTradingTime(now)) {
    // 交易时段成功刷新：顺手清掉收盘记档，保证下一次收盘后的首次拉取会真正发出
    if (st['off' + kind + 'At']) store.setQuoteStamp(Object.assign({}, st, { ['off' + kind + 'At']: 0 }));
    return;
  }
  // 已是本收盘时段的有效记档 → 不重复写；旧记档（跨过上一个交易日15:00）必须刷新成 now，
  // 否则闸门永远判定「记档过期」→ 收盘后每次刷新都放行，闸门形同虚设
  const at = Number(st['off' + kind + 'At']) || 0;
  if (at >= lastTradingEnd(now)) return;
  store.setQuoteStamp(Object.assign({}, st, { ['off' + kind + 'At']: now }));
}

function localWatchQuotes() {
  const list = store.getWatchlist();
  const qMap = store.getLatestQuotes() || {};
  return list.map((w) => {
    const q = qMap[w.code] || {};
    return Object.assign({ code: w.code, secid: w.secid, name: w.name, watchName: w.name }, q);
  });
}

const services = {
  role: ROLE,
  isHost: IS_HOST,
  version: VERSION,
  MENU_W: MENU_W,
  MENU_H: MENU_H,
  PAD: BALL_PAD,

  settings: {
    get: () => store.getSettings(),
    patch: (p) => {
      const res = store.patchSettings(p);
      if (p && p.ballOpacity !== undefined) {
        applyBallOpacityToWindow(res.ballOpacity);
      }
      if (p && p.ballSize !== undefined) {
        applyBallSizeToWindow(res.ballSize);
      }
      if (alive(ballWin)) {
        toWindow(wcId(ballWin), { t: 'ctl', c: { t: 'settings', settings: res } });
      }
      toHost({ t: 'broadcast', c: { t: 'settings', settings: res } });
      return res;
    }
  },
  watchlist: {
    get: () => store.getWatchlist(),
    set: (list) => store.setWatchlist(list),
    getGroups: () => store.getWatchlistGroups(),
    setGroups: (groups) => store.setWatchlistGroups(groups),
    addGroup: (name) => store.addWatchlistGroup(name),
    removeGroup: (name) => store.removeWatchlistGroup(name),
    renameGroup: (oldName, newName) => store.renameWatchlistGroup(oldName, newName),
    setStockGroup: (code, groupName) => {
      const c = String(code || '').replace(/[^\d]/g, '').slice(0, 6);
      const g = String(groupName || '默认').trim() || '默认';
      const wl = store.getWatchlist();
      const item = wl.find((x) => x.code === c);
      if (item) {
        item.group = g;
        store.setWatchlist(wl);
      }
      return wl;
    },
    add: (item) => {
      const list = store.getWatchlist();
      const code = String((item && (item.code || item.secid)) || '').replace(/[^\d]/g, '').slice(0, 6);
      if (!code) return list;
      if (list.some((x) => x.code === code)) return list;
      list.push({
        code,
        // 920 开头是北交所新代码段（东财归 0 段），不能按 9 前缀误判成沪市
        secid: (item && item.secid) || (/^920/.test(code) ? '0.' : (/^[659]/.test(code) ? '1.' : '0.')) + code,
        name: (item && item.name) || code,
        group: (item && item.group) || '默认'
      });
      return store.setWatchlist(list);
    },
    remove: (code) => {
      const c = String(code || '').replace(/[^\d]/g, '').slice(0, 6);
      const res = store.setWatchlist(store.getWatchlist().filter((x) => x.code !== c));
      // 从自选里删除股票 = 同时取消它的预警提醒：
      // 否则这只股票（还在持仓里时）会被「持仓行情」那条评估路径继续提醒，
      // 用户看到的就是「自选里删了却还提醒」。这也和内置 Web 页面的删除语义保持一致。
      if (c && store.getAlerts().some((a) => a && a.stock_code === c)) {
        store.deleteAlert(c);
        toHost({ t: 'broadcast', c: { t: 'alerts' } });
        store.postCmd('alerts');
      }
      return res;
    },
    move: (code, delta) => {
      const list = store.getWatchlist();
      const i = list.findIndex((x) => x.code === String(code));
      if (i < 0) return list;
      const j = Math.min(list.length - 1, Math.max(0, i + delta));
      const [it] = list.splice(i, 1);
      list.splice(j, 0, it);
      return store.setWatchlist(list);
    },
    reorder: (fromCode, toCode) => {
      const list = store.getWatchlist();
      const fromIdx = list.findIndex((x) => x.code === String(fromCode));
      const toIdx = list.findIndex((x) => x.code === String(toCode));
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return list;
      const [it] = list.splice(fromIdx, 1);
      list.splice(toIdx, 0, it);
      return store.setWatchlist(list);
    }
  },

  quotes: Object.assign(
    async (opts) => {
      if (offSessionGate(opts, 'Q')) return localWatchQuotes(); // 非交易时段已拉过 → 吃缓存，零请求
      const list = store.getWatchlist();
      const codes = list.map((x) => x.code);
      // 别的窗口刚拉过 / 正在拉同一批行情：复用它的结果，不再重复发请求
      if (!(opts && opts.force)) {
        const shared = await reuseOrWaitSharedQuotes(codes);
        if (shared) return localWatchQuotes();
      }
      let qs = [];
      markSharedFetchStart();
      try {
        try {
          qs = await market.quotes(list.map((x) => x.secid), { proxy: proxyOf(opts) });
        } catch (e) {
          log('东财行情失败，退回腾讯：', e && e.message);
          qs = await market.quotesTencent(list.map((x) => x.secid), { proxy: proxyOf(opts) });
        }
      } finally {
        // 两次都拉失败时放开竞争标记，别让别的窗口干等
        if (!qs || !qs.length) markSharedFetchEnd();
      }
      const qMap = {};
      const res = qs.map((q, i) => {
        const item = Object.assign({}, q, { watchName: list[i] && list[i].name });
        if (item && item.code) qMap[item.code] = item;
        return item;
      });
      if (Object.keys(qMap).length > 0) {
        store.setLatestQuotes(qMap);
        evaluateAlerts(qMap);
        markSharedQuotes(codes);
        noteSessionFetched('Q');
      }
      return res;
    },
    {
      getLocal: () => localWatchQuotes()
    }
  ),
  positions: {
    // 0ms 同步获取本地持仓数据与上次行情缓存，供界面立刻展示
    getLocal: () => store.getPositionsSummary(),
    get: async (opts) => {
      if (offSessionGate(opts, 'P')) return store.getPositionsSummary(); // 非交易时段已拉过 → 吃缓存
      const codes = store.getHoldingCodes(); // 内核缓存取代码：不再整表扫流水（旧实现一轮要扫两遍）
      // 别的窗口刚拉过 / 正在拉这批持仓行情：复用它的结果，省一次网络请求
      if (codes.length > 0 && !(opts && opts.force)) {
        const shared = await reuseOrWaitSharedQuotes(codes);
        if (shared) return store.getPositionsSummary(shared);
      }
      const quotesMap = {};
      if (codes.length > 0) {
        const secids = codes.map((c) => market.toSecid(c)).filter(Boolean);
        markSharedFetchStart();
        try {
          const qs = await market.quotes(secids, { proxy: proxyOf(opts) });
          qs.forEach((q) => {
            if (q && q.code) {
              quotesMap[q.code] = q;
            }
          });
        } catch (e) {
          try {
            const qs = await market.quotesTencent(secids, { proxy: proxyOf(opts) });
            qs.forEach((q) => {
              if (q && q.code) {
                quotesMap[q.code] = q;
              }
            });
          } catch (err) { /* ignore */ }
        } finally {
          // 两次都拉失败时放开竞争标记，别让别的窗口干等
          if (Object.keys(quotesMap).length === 0) markSharedFetchEnd();
        }
        if (Object.keys(quotesMap).length > 0) {
          store.setLatestQuotes(quotesMap);
          evaluateAlerts(quotesMap);
          markSharedQuotes(codes);
          noteSessionFetched('P');
        }
      }
      return store.getPositionsSummary(quotesMap);
    },
    getClosed: async () => store.getClosedPositions()
  },

  alerts: {
    get: () => store.getAlerts(),
    save: (alert) => {
      const res = store.saveAlert(alert);
      toHost({ t: 'broadcast', c: { t: 'alerts' } });
      store.postCmd('alerts');
      return res;
    },
    delete: (code) => {
      const res = store.deleteAlert(code);
      toHost({ t: 'broadcast', c: { t: 'alerts' } });
      store.postCmd('alerts');
      return res;
    },
    evaluate: (quotesMap, opts) => evaluateAlerts(quotesMap, opts),
    isTradingTime: (now) => market.isAlertTime(now)
  },
  isTradingTime: (now) => isTradingTime(now),
  notify: (title, body) => sendDesktopNotification(title, body),

  transactions: {
    list: (code) => store.getTransactions(code),
    sellable: (code) => store.getSellable(code), // 可卖股数（含 T+1），录入弹窗卖出上限用
    add: (tx) => {
      const item = store.addTransaction(tx);
      toHost({ t: 'broadcast', c: { t: 'refresh' } });
      store.postCmd('refresh');
      return item;
    },
    delete: (id, code) => {
      const ok = store.deleteTransaction(id, code);
      toHost({ t: 'broadcast', c: { t: 'refresh' } });
      store.postCmd('refresh');
      return ok;
    }
  },

  syncFromFile: () => store.syncFromFile(),
  importFromFile: (p) => store.importFromFile(p),

  calculateFees: (tx, s) => store.calculateFees(tx, s),

  indexes: async (opts) => {
    if (offSessionGate(opts, 'I')) return store.getLatestIndexes() || []; // 非交易时段已拉过 → 吃缓存
    // 指数单独协调，不能被慢个股请求拖住，也不能提前清除个股的在途标记。
    function freshIndexes() {
      const st = store.getQuoteStamp() || {};
      if (!st.idxAt || (Date.now() - st.idxAt) >= sharedFreshMs()) return null;
      const cached = store.getLatestIndexes();
      return cached.length ? cached : null;
    }
    if (!(opts && opts.force)) {
      let hit = freshIndexes();
      if (hit) return hit;
      await sleepMs(0); // 同时启动的窗口先让先行者登记，再检查一次
      hit = freshIndexes();
      if (hit) return hit;
      if (peerIsFetching('I')) {
        const start = Date.now();
        while (Date.now() - start < sharedWaitMs()) {
          const waited = Date.now() - start;
          await sleepMs(waited < 600 ? 75 : (waited < 1500 ? 150 : 300));
          hit = freshIndexes();
          if (hit) return hit;
          if (!peerIsFetching('I')) break;
        }
      }
    }
    markSharedFetchStart('I');
    let list = [];
    try {
      list = await market.indexes({ proxy: proxyOf(opts) });
    } finally {
      if (!Array.isArray(list) || !list.length) markSharedFetchEnd('I');
    }
    if (Array.isArray(list) && list.length) {
      store.setLatestIndexes(list);
      store.setQuoteStamp(Object.assign({}, store.getQuoteStamp() || {}, { idxAt: Date.now(), idxPendingAt: 0 }));
      noteSessionFetched('I');
    }
    return list;
  },
  trend: (code, opts) => market.trend(code, { proxy: proxyOf(opts) }),
  detail: (code, opts) => market.detail(code, { proxy: proxyOf(opts) }),
  // K线（klt=5 当日分钟K / klt=101 历史日K）：用户点开图表才拉，不做非交易时段闸门
  kline: (code, opts) => market.kline(code, { proxy: proxyOf(opts), klt: opts && opts.klt, lmt: opts && opts.lmt }),
  search: (kw, opts) => market.search(kw, { proxy: proxyOf(opts) }),
  marketStatus: () => market.marketStatus(),
  host: {
    /** 拖动：phase=start|move|end，dx/dy 是相对按下点的位移（CSS 像素）；b = 按下瞬间同步读到的窗口 bounds（快速路径专用，主窗口无需再异步取） */
    drag: (phase, dx, dy, b, gesture) => toHost({ t: 'drag', phase, dx: dx || 0, dy: dy || 0, b: b || null, gesture }),
    /** 展开/收起球窗口里的右键菜单 */
    menu: (open) => toHost({ t: 'menu', open: !!open }),
    panel: (action) => toHost({ t: 'panel', action: action || 'toggle' }),
    ball: (action) => toHost({ t: 'ball', action: action || 'show' }),
    openUrl: (url) => {
      // 本窗口已成功唤起系统浏览器就不要再让主窗口开一次（面板双击自选行会双开标签页）
      if (!openExternalUrl(url)) toHost({ t: 'open-url', url });
    },
    getDataFilePath: () => store.getDataFilePath(),
    openDataFile: () => {
      const p = store.getDataFilePath();
      if (p) openExternalUrl(p);
    },
    syncFromFile: () => store.syncFromFile(),
    importFromFile: (p) => store.importFromFile(p),
    broadcast: (c) => toHost({ t: 'broadcast', c: c || { t: 'refresh' } }),
    setBallOpacity: (op) => {
      const val = normalizeBallOpacity(op);
      store.patchSettings({ ballOpacity: val });
      applyBallOpacityToWindow(val);
      toHost({ t: 'set-opacity', opacity: val });
    },
    setBallSize: (size) => {
      const val = typeof size === 'number' ? Math.min(110, Math.max(56, Math.round(size))) : 72;
      store.patchSettings({ ballSize: val });
      applyBallSizeToWindow(val);
      toHost({ t: 'set-size', ballSize: val });
    },
    openPlugin: (cmd) => {
      const c = cmd || 'stock';
      toHost({ t: 'open-plugin', cmd: c });
    },
    openMain: (cmd) => {
      const c = cmd || 'stock';
      toHost({ t: 'open-plugin', cmd: c });
    },
    /** 结束整个插件（关球 + 关面板 + 退出后台） */
    quit: () => {
      toHost({ t: 'quit' });
      setTimeout(() => { safe(() => window.close()); }, 600);
    },
    /** 写心跳（只有球窗口需要） */
    heartbeat: (extra) => store.setHeartbeat(Object.assign({ id: safe(() => Z.getWebContentsId(), null), role: ROLE }, extra || {})),
    getPos: () => store.getBallPos()
  },
  // 开机自动启动：写宿主官方名单 + 宿主开机启动 IPC（详见文件内同名说明）
  autostart: {
    isEnabled: async () => {
      const name = await resolveAutoStartName();
      const list = await autoStartGetList();
      return list.indexOf(name) >= 0;
    },
    set: async (enabled) => {
      const name = await resolveAutoStartName();
      const list = await autoStartGetList();
      const i = list.indexOf(name);
      if (enabled && i < 0) list.push(name);
      if (!enabled && i >= 0) list.splice(i, 1);
      await autoStartPutList(list);
      await hostLaunchSet(!!enabled); // 对称：开=两者都开，关=两者都关
      return list.indexOf(name) >= 0;
    },
    getHostLaunch: () => hostLaunchGet()
  },
  onCtl,
  store // 调试用
};

/* 同窗口合并（preload 层兜底）：同一服务进行中的调用直接共享同一个 Promise ——
   定时刷新、回前台、广播通知、手动按钮同拍触发时，网络与存储只跑一趟
   （复现：重叠3次触发 = 3次请求 +101次读库）。force 与普通刷新撞车时共享同一次
   网络请求，同一时刻的新鲜度足够。 */
const inflightFetch = {};
function coalesceFetch(kind, fn) {
  if (inflightFetch[kind]) return inflightFetch[kind];
  const p = Promise.resolve().then(fn).finally(() => {
    if (inflightFetch[kind] === p) inflightFetch[kind] = null;
  });
  inflightFetch[kind] = p;
  return p;
}
const _quotesFn = services.quotes;
services.quotes = Object.assign((opts) => coalesceFetch('quotes', () => _quotesFn(opts)), { getLocal: _quotesFn.getLocal });
const _positionsGet = services.positions.get;
services.positions.get = (opts) => coalesceFetch('positions', () => _positionsGet(opts));
const _indexesFn = services.indexes;
services.indexes = (opts) => coalesceFetch('indexes', () => _indexesFn(opts));

try {
  window.services = Object.assign(window.services || {}, services);
  if (window.contextBridge && window.contextBridge.exposeInMainWorld) {
    window.contextBridge.exposeInMainWorld('services', window.services);
  }
} catch (e) {
  log('暴露 services 失败', e);
}

/* ------------------------------------------------------------------ */
/* 主窗口（管家）角色                                                  */
/* ------------------------------------------------------------------ */
let ballWin = null;
let panelWin = null;
let watcher = null;
let dragState = null;
let pendingDragMove = null;   // 基准 bounds 尚未取到时，暂存最新一帧 move，取到后立即补应用
let pendingDragEnd = null;    // 同理：起手还没就绪就松手了，end 先存着，起手就绪后补算终点
let dragStartPending = false; // 异步取基准 bounds 进行中
let dragGeneration = 0;
let dragGesture = null;
let lastBallBounds = null;
let menuOpen = false;
let menuPrevBounds = null;
const greetTimers = { ball: null, panel: null };

function alive(win) {
  if (!win) return false;
  return safe(() => (typeof win.isDestroyed === 'function' ? !win.isDestroyed() : true), true);
}
function wcId(win) {
  return safe(() => (win && win.webContents && win.webContents.id) || win.id || null, null);
}
function boundsOf(win) {
  return new Promise((resolve) => {
    if (!alive(win)) return resolve(null);
    try {
      const b = win.getBounds();
      if (b && typeof b.then === 'function') {
        b.then((r) => resolve(r || null)).catch(() => resolve(null));
        return;
      }
      resolve(b || null);
    } catch (e) {
      resolve(null);
    }
  });
}
function applyBounds(win, b) {
  if (!alive(win) || !b) return;
  const next = {
    x: Math.round(b.x), y: Math.round(b.y),
    width: Math.round(b.width), height: Math.round(b.height)
  };
  safe(() => {
    const p = win.setBounds(next);
    if (p && typeof p.catch === 'function') p.catch(() => { /* ignore */ });
  });
  if (win === ballWin) lastBallBounds = Object.assign({}, lastBallBounds || {}, next);
}

function normalizeBallOpacity(op) {
  return typeof op === 'number' && Number.isFinite(op) ? Math.min(1, Math.max(0, op)) : 0.95;
}

function applyBallOpacityToWindow(op) {
  const val = normalizeBallOpacity(op);
  if (alive(ballWin)) {
    // 原生窗口始终不透明，背景淡化交给球页面，避免文字也被一起淡化。
    safe(() => { if (typeof ballWin.setOpacity === 'function') ballWin.setOpacity(1); });
    toWindow(wcId(ballWin), { t: 'ctl', c: { t: 'opacity', opacity: val } });
  }
}

function applyBallSizeToWindow(size) {
  const val = typeof size === 'number' ? Math.min(110, Math.max(56, Math.round(size))) : 72;
  if (alive(ballWin)) {
    const winSize = val + BALL_PAD * 2;
    const b = safe(() => ballWin.getBounds(), null);
    if (b) {
      safe(() => {
        if (typeof ballWin.setBounds === 'function') {
          ballWin.setBounds({ x: b.x, y: b.y, width: winSize, height: winSize });
        }
      });
      lastBallBounds = { x: b.x, y: b.y, width: winSize, height: winSize };
    }
    toWindow(wcId(ballWin), { t: 'ctl', c: { t: 'size', ballSize: val } });
    toWindow(wcId(ballWin), { t: 'ctl', c: { t: 'settings', settings: store.getSettings() } });
  }
}

function notify(body) { safe(() => Z.showNotification && Z.showNotification(body)); }
function hideSelf() {
  safe(() => { const p = Z.hideMainWindow && Z.hideMainWindow(); if (p && p.catch) p.catch(() => {}); });
}
// showMainWindow 是异步 API。等宿主显示完成再跳转，子窗口失联时也可直接调用。
async function activatePlugin(cmd) {
  closePanel();
  try {
    if (typeof Z.showMainWindow === 'function') await Z.showMainWindow();
  } catch (e) { log('显示主窗口失败', e); }
  safe(() => { if (typeof Z.setExpendHeight === 'function') Z.setExpendHeight(600); });
  try {
    let launched = false;
    // 按安装路径唤起当前实例。直接 redirect('stock') 在正式版和开发版并存时
    // 只会显示两个搜索结果，宿主仍返回 true，导致双击看似成功却没有打开面板。
    if (typeof __dirname === 'string' && __dirname && typeof ipcRenderer.invoke === 'function') {
      try {
        const result = await ipcRenderer.invoke('launch', {
          path: __dirname, type: 'plugin', featureCode: cmd || 'stock',
          name: '股票管家', cmdType: 'text', param: { type: 'text' }
        });
        launched = !!(result && result.success === true);
      } catch (e) { log('按路径打开插件失败，尝试指令跳转', e); }
    }
    if (!launched && typeof Z.redirect === 'function') {
      const result = await Z.redirect(cmd || 'stock');
      if (result === false) return false;
    }
  } catch (e) { log('打开插件失败', e); return false; }
  fireCtl({ t: 'cmd', cmd: 'switch-tab', tab: 'positions' });
  fireCtl({ t: 'refresh' });
  return true;
}
function endPlugin() {
  stopWatcher();
  safe(() => { const p = Z.outPlugin && Z.outPlugin(true); if (p && p.catch) p.catch(() => {}); });
}
function ballWindowSize(s) { return Math.round(s.ballSize) + BALL_PAD * 2; }
function defaultBallPos(size) {
  const wa = workAreaNear(null);
  return { x: Math.round(wa.x + wa.width - size - 26), y: Math.round(wa.y + wa.height * 0.42) };
}
function resolvePreloadPath() {
  try {
    const path = require('node:path');
    if (typeof __dirname !== 'undefined' && __dirname) {
      return path.join(__dirname, 'preload.js');
    }
  } catch (e) { /* ignore */ }
  return 'preload.js';
}

function childOptions(extra) {
  return Object.assign({
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    show: true,
    // Windows 下不可聚焦的透明窗口可能只收到 mouseup，收不到 mousedown。
    // 保留点击聚焦能力；悬浮球通过 showInactive 展示，避免创建时抢焦点。
    focusable: true,
    parent: null,
    // 关键：新建窗口要自己带上 preload，否则窗口里没有 window.services
    webPreferences: {
      preload: resolvePreloadPath(),
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false
    }
  }, extra || {});
}
function localUrl(rel) {
  try {
    const path = require('node:path');
    if (typeof __dirname !== 'undefined' && __dirname) {
      const p = path.join(__dirname, rel).replace(/\\/g, '/');
      return 'file:///' + (p.startsWith('/') ? p.slice(1) : p);
    }
  } catch (e) { /* ignore */ }
  try {
    if (typeof location !== 'undefined' && /^file:/i.test(location.href)) {
      return new URL(rel, location.href).href;
    }
  } catch (e) { /* ignore */ }
  return rel;
}
function greet(kind, win) {
  const id = wcId(win);
  if (!id) return;
  let n = 0;
  clearInterval(greetTimers[kind]);
  greetTimers[kind] = setInterval(() => {
    n += 1;
    if (n > 10 || !alive(win)) { clearInterval(greetTimers[kind]); return; }
    toWindow(id, { t: 'hello', windowId: win.id });
  }, 350);
}
function startWatcher() {
  if (watcher) return;
  let lastKeepaliveAt = 0;   // 上次给球推通道保活消息的时刻
  let lastRebuildAt = 0;     // 上次杀掉聋球重建的时刻（冷却防循环）
  let lastOrphanDieAt = 0;   // 上次给无句柄孤儿球发 die 的时刻
  let lastWatchAt = Date.now();
  let wakeGraceUntil = 0;
  watcher = setInterval(() => {
    const ballAlive = alive(ballWin);
    const panelAlive = alive(panelWin);
    if (!ballAlive && ballWin) { ballWin = null; menuOpen = false; }
    if (!panelAlive && panelWin) { panelWin = null; }
    try {
      const now = Date.now();
      // 休眠/进程暂停期间所有心跳都会停；恢复后的首轮先给球续心跳的机会。
      if (now - lastWatchAt > 15000) wakeGraceUntil = now + 15000;
      lastWatchAt = now;
      if (ballWin) {
        // ① 通道保活：球的上行（拖动/双击/心跳 ping）全靠 sendTo(hostId)，而 hostId
        //    只能在收到主窗口消息时刷新。主窗口隐藏后若长期不发消息，球的 hostId 一旦
        //    陈旧就再也发不出任何东西（死锁）。这里每 5s 主动推一条 —— 球收到主窗口的
        //    任何消息都会刷新 hostId（ipcRenderer.on 入站自愈），通道无需重建即恢复。
        if (now - lastKeepaliveAt >= 5000) {
          lastKeepaliveAt = now;
          toWindow(wcId(ballWin), { t: 'ping' });
        }
        // ② 聋球检测：球窗口活着但它的心跳停更（球每 5s 写一次，20s 没写 = 控制通道已死
        //    或页面卡死，且自身的 45s 自愈没走通）→ 只能杀掉按保存位置重建。
        //    心跳 id 必须与当前球句柄匹配才判定，避免已被 die 的旧球残写误伤新球。
        const hb = store.getHeartbeat();
        const hbMatches = !!(hb && hb.id && hb.role === 'ball' && String(hb.id) === String(wcId(ballWin)));
        if (hbMatches && now >= wakeGraceUntil && (now - (hb.t || 0)) >= 20000 && now - lastRebuildAt >= 12000) {
          lastRebuildAt = now;
          closeBall();
          setTimeout(() => { try { if (!alive(ballWin)) openBall(true); } catch (e) { /* ignore */ } }, 300);
        }
      } else {
        const hb = store.getHeartbeat();
        if (hb && hb.role === 'ball' && hb.id && !hb.closed && !hb.needsRestart &&
            (now - (hb.t || 0)) < HEARTBEAT_FRESH_MS && now - lastOrphanDieAt >= 5000) {
          // ③ 孤儿球认领：有球在正常写心跳，但本上下文没有它的句柄（主窗口重载/重建后，
          //    开机补偿又错过了 15s 新鲜期）。旧球的上行对着死掉的主窗口 id 全部石沉大海，
          //    拖动双击永远无响应 —— 让它自毁，随后按保存位置重建出新握手的新球。
          lastOrphanDieAt = now;
          toWindow(hb.id, { t: 'ctl', c: { t: 'die' } });
          setTimeout(() => {
            try {
              // 600ms 内用户若手动关了球（心跳 closed），尊重用户意图不再拉起
              const hb2 = store.getHeartbeat();
              if (!ballWin && !(hb2 && hb2.closed)) openBall(true);
            } catch (e) { /* ignore */ }
          }, 600);
        } else if (hb && hb.needsRestart && (now - (hb.t || 0)) < 60000) {
          // ④ 兜底自愈：球自报 needsRestart 并关闭后（临时缓存是不经过坏通道的旁路），
          //    清标志并按保存的位置重建 —— 新窗口新握手，拖动/双击通道彻底恢复
          store.setHeartbeat({ id: null, role: 'ball', needsRestart: false });
          openBall(true);
        }
      }
    } catch (e) { /* ignore */ }
  }, 1000);
}
function stopWatcher() {
  if (watcher) { clearInterval(watcher); watcher = null; }
  clearInterval(greetTimers.ball); clearInterval(greetTimers.panel);
  greetTimers.ball = null;
  greetTimers.panel = null;
}

function toast(msg) {
  try {
    if (typeof Z.showToast === 'function') Z.showToast(msg);
    else if (typeof Z.showNotification === 'function') Z.showNotification(msg);
  } catch (e) { /* ignore */ }
}

function openBall(force) {
  const s = store.getSettings();
  const size = ballWindowSize(s);
  if (alive(ballWin)) {
    showBallInactive(ballWin);
    return ballWin;
  }
  if (!force) {
    const hb = store.getHeartbeat();
    if (hb && hb.id && hb.role === 'ball' && (Date.now() - (hb.t || 0)) < HEARTBEAT_FRESH_MS) {
      log('桌面悬浮球已在运行中');
      return null;
    }
  }
  return createBall(size);
}

function showBallInactive(win) {
  safe(() => {
    if (!alive(win)) return;
    if (typeof win.showInactive === 'function') win.showInactive();
    else if (typeof win.show === 'function') win.show();
  });
}

function createBall(size) {
  const pos = store.getBallPos() || defaultBallPos(size);
  let win = null;
  try {
    win = Z.createBrowserWindow(localUrl('windows/ball.html'), childOptions({
      x: pos.x, y: pos.y, width: size, height: size, title: '股票悬浮球',
      opacity: 1, show: false
    }), () => {
      lastBallBounds = { x: pos.x, y: pos.y, width: size, height: size };
      store.setHeartbeat({ id: wcId(win), role: 'ball' });
      safe(() => { if (win && typeof win.setOpacity === 'function') win.setOpacity(1); });
      showBallInactive(win);
    });
  } catch (e) {
    log('创建悬浮球窗口失败', e);
    notify('悬浮球窗口创建失败：' + (e && e.message));
  }
  if (!win) { notify('悬浮球窗口创建失败'); return null; }
  ballWin = win;
  lastBallBounds = { x: pos.x, y: pos.y, width: size, height: size };
  greet('ball', win);
  startWatcher();
  log('球窗口已创建', pos, size);
  return win;
}

function closeBall() {
  dragGeneration += 1;
  dragGesture = null;
  dragState = pendingDragMove = pendingDragEnd = null;
  dragStartPending = false;
  clearInterval(greetTimers.ball);
  const w = ballWin;
  ballWin = null;
  menuOpen = false;
  // 清掉心跳：否则下次进入插件会以为桌上还有球
  store.setHeartbeat({ id: null, role: 'ball', closed: true });
  if (w) toWindow(wcId(w), { t: 'ctl', c: { t: 'die' } });
  if (alive(w)) safe(() => w.close());
}


function openPanel(force) {
  const s = store.getSettings();
  if (alive(panelWin) && !force) {
    safe(() => { panelWin.show && panelWin.show(); panelWin.focus && panelWin.focus(); });
    return panelWin;
  }
  const w = s.panelW, h = s.panelH;
  let x;
  let y;
  let based = lastBallBounds;
  if (!based && alive(ballWin)) based = safe(() => ballWin.getBounds(), null);
  if (based && based.width) {
    const wa = workAreaNear(based);
    x = based.x + based.width + 12;
    if (x + w > wa.x + wa.width) x = based.x - w - 12;
    if (x < wa.x) x = wa.x + 12;
    y = Math.min(Math.max(wa.y + 12, based.y), wa.y + wa.height - h - 12);
  } else {
    const wa = workAreaNear(null);
    x = Math.round(wa.x + wa.width - w - 40);
    y = Math.round(wa.y + 60);
  }
  let win = null;
  try {
    win = Z.createBrowserWindow(localUrl('windows/panel.html'), childOptions({
      x, y, width: w, height: h, title: '自选股行情', alwaysOnTop: !!s.panelOnTop, focusable: true
    }), () => { /* ready */ });
  } catch (e) {
    log('创建面板窗口失败', e);
  }
  if (!win) { notify('行情面板创建失败'); return null; }
  panelWin = win;
  greet('panel', win);
  startWatcher();
  return win;
}

function closePanel() {
  clearInterval(greetTimers.panel);
  const w = panelWin;
  panelWin = null;
  if (alive(w)) safe(() => w.close());
}

function snapBounds(b, size) {
  const wa = workAreaNear(b);
  const s = store.getSettings();
  const out = { x: b.x, y: b.y, width: size, height: size };
  if (s.snapEdge) {
    const gap = 12;
    const leftDist = out.x - wa.x;
    const rightDist = (wa.x + wa.width) - (out.x + size);
    if (leftDist < 26) out.x = wa.x + gap;
    else if (rightDist < 26) out.x = wa.x + wa.width - size - gap;
    const topDist = out.y - wa.y;
    const bottomDist = (wa.y + wa.height) - (out.y + size);
    if (topDist < 26) out.y = wa.y + gap;
    else if (bottomDist < 26) out.y = wa.y + wa.height - size - gap;
  }
  out.x = Math.min(Math.max(wa.x - 4, out.x), wa.x + wa.width - size + 4);
  out.y = Math.min(Math.max(wa.y - 4, out.y), wa.y + wa.height - size + 4);
  return out;
}

function expandMenu(open) {
  if (!alive(ballWin)) return;
  const size = ballWindowSize(store.getSettings());
  boundsOf(ballWin).then((b) => {
    if (!b) return;
    if (open) {
      if (menuOpen) return;
      menuPrevBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
      const wa = workAreaNear(b);
      const newW = b.width + MENU_W;
      const newH = Math.max(b.height, MENU_H);
      const rightSpace = (wa.x + wa.width) - (b.x + b.width);
      const side = rightSpace >= MENU_W ? 'right' : 'left';
      // 竖向：球在屏幕下半 → 窗口向上长，球贴窗口底边，视觉位置不动
      const vside = (b.y + b.height / 2) > (wa.y + wa.height / 2) ? 'bottom' : 'top';
      let nx = side === 'right' ? b.x : b.x - MENU_W;
      let ny = vside === 'bottom' ? (b.y + b.height - newH) : b.y;
      ny = Math.min(Math.max(wa.y + 4, ny), wa.y + wa.height - newH - 4);
      nx = Math.min(Math.max(wa.x + 4, nx), wa.x + wa.width - newW - 4);
      menuOpen = true;
      applyBounds(ballWin, { x: nx, y: ny, width: newW, height: newH });
      toWindow(wcId(ballWin), { t: 'ctl', c: { t: 'menu', open: true, side, vside, size, menuW: MENU_W, menuH: MENU_H } });
    } else {

      if (!menuOpen) return;
      menuOpen = false;
      const back = menuPrevBounds || { x: b.x, y: b.y, width: size, height: size };
      applyBounds(ballWin, { x: back.x, y: back.y, width: size, height: size });
      toWindow(wcId(ballWin), { t: 'ctl', c: { t: 'menu', open: false } });
    }
  });
}

/* 主窗口收到的子窗口指令 */
onHostMsg((msg, senderId) => {
  if (!msg) return;
  switch (msg.t) {
    case 'hello-ack':
      if (msg.role === 'ball') {
        clearInterval(greetTimers.ball);
        const s = store.getSettings();
        if (alive(ballWin)) {
          safe(() => { if (typeof ballWin.setOpacity === 'function') ballWin.setOpacity(1); });
          toWindow(senderId, { t: 'ctl', c: { t: 'settings', settings: s } });
        }
      }
      if (msg.role === 'panel') clearInterval(greetTimers.panel);
      break;
    case 'set-opacity': {
      const val = normalizeBallOpacity(msg.opacity);
      store.patchSettings({ ballOpacity: val });
      applyBallOpacityToWindow(val);
      return;
    }
    case 'set-size': {
      const val = typeof msg.ballSize === 'number' ? Math.min(110, Math.max(56, Math.round(msg.ballSize))) : 72;
      store.patchSettings({ ballSize: val });
      applyBallSizeToWindow(val);
      return;
    }
    case 'pong':
      break;
    case 'ping':
      // 子窗口（悬浮球）存活探测：必须应答，否则它45秒后走通道中断自愈
      toWindow(senderId, { t: 'pong' });
      return;
    case 'drag': {
      if (senderId !== wcId(ballWin)) return;
      if (msg.phase !== 'start' && msg.gesture && msg.gesture !== dragGesture) return;
      if (menuOpen) expandMenu(false);
      const applyMove = (m) => {
        // 基准 bounds 还没取到（旧实现这里是直接丢弃 → 起手位移凭空消失、拖动发滞）。
        // 位移是相对起手的绝对量，记住最新一帧即可覆盖之前全部移动，取到后立刻补上。
        if (!dragState) { pendingDragMove = m; return; }
        applyBounds(ballWin, {
          x: dragState.b.x + m.dx, y: dragState.b.y + m.dy,
          width: dragState.b.width, height: dragState.b.height
        });
      };
      const finishDrag = (m) => {
        dragGeneration += 1;
        dragGesture = null;
        dragStartPending = false;
        pendingDragMove = null;
        const size = ballWindowSize(store.getSettings());
        const base = (dragState && dragState.b) || m.b || null;
        dragState = null;
        if (base) {
          const raw = { x: base.x + m.dx, y: base.y + m.dy, width: size, height: size };
          const snapped = snapBounds(raw, size);
          applyBounds(ballWin, snapped);
          store.setBallPos({ x: snapped.x, y: snapped.y });
          return;
        }
        // 兜底：起手/位移消息全丢了，按当前位置吸附并存档，别把球的位置弄丢
        boundsOf(ballWin).then((b) => {
          if (!b) return;
          const snapped = snapBounds(b, size);
          applyBounds(ballWin, snapped);
          store.setBallPos({ x: snapped.x, y: snapped.y });
        });
      };
      if (msg.phase === 'start') {
        const generation = ++dragGeneration;
        const win = ballWin;
        dragGesture = msg.gesture || null;
        dragState = null;
        pendingDragMove = null;
        pendingDragEnd = null;
        const startDone = (b) => {
          if (generation !== dragGeneration || win !== ballWin) return;
          dragStartPending = false;
          if (b) dragState = { b };
          if (msg.mid) toWindow(senderId, { t: 'ack', for: msg.mid, ok: !!dragState });
          if (pendingDragEnd) { const m = pendingDragEnd; pendingDragEnd = null; finishDrag(m); return; } // 快拖：还没就绪就松手了，终点现在补算
          if (pendingDragMove && dragState) { applyMove(pendingDragMove); pendingDragMove = null; }
        };
        if (msg.b) startDone(msg.b);
        else {
          const b = safe(() => ballWin.getBounds(), null);
          if (b && typeof b.then === 'function') {
            // 异步代理用已知位置立即起拖；迟到的旧快照不能覆盖下一次拖动。
            if (lastBallBounds) { b.catch(() => {}); startDone(Object.assign({}, lastBallBounds)); }
            else { dragStartPending = true; b.then(startDone).catch(() => startDone(null)); }
          } else startDone(b || lastBallBounds);
        }
        return;
      }
      if (msg.phase === 'move') { applyMove(msg); return; }
      if (msg.phase === 'end') {
        // 起手还在异步进行中就松手（快速短拖）：先存着，startDone 里补算，绝不能直接丢
        if (!dragState && !msg.b && dragStartPending) { pendingDragMove = null; pendingDragEnd = msg; return; }
        pendingDragEnd = null;
        finishDrag(msg);
        return;
      }
      return;
    }
    case 'menu':
      expandMenu(!!msg.open);
      return;
    case 'panel': {
      const action = msg.action || 'toggle';
      if (action === 'show') openPanel(false);
      else if (action === 'hide') closePanel();
      else if (alive(panelWin)) closePanel();
      else openPanel(false);
      toWindow(senderId, { t: 'ack', for: msg.mid, ok: true });
      return;
    }
    case 'ball': {
      const action = msg.action || 'show';
      if (action === 'hide') { closeBall(); if (!alive(panelWin)) endPlugin(); }
      else openBall(true);
      toWindow(senderId, { t: 'ack', for: msg.mid, ok: true });
      return;
    }

    case 'open-url':
      openExternalUrl(msg.url);
      return;
    case 'alert-fire': {
      // 子窗口转发来的预警触发：主窗口统一认领冷却坑位后弹出（跨窗口绝不双弹）
      // 转发可能跨过午休/收盘边界，按实际发送时刻再次校验，静默时不占冷却坑位。
      if (!market.isAlertTime()) return;
      if (!msg.k) return;
      const cd = store.getAlertCooldowns();
      if (claimAlertNotify(String(msg.k), cd, Date.now(), Number(msg.intervalMs) || 5 * 60 * 1000)) {
        store.setAlertCooldowns(cd);
        sendDesktopNotification(String(msg.title || '股价预警'), String(msg.body || ''));
      }
      return;
    }
    case 'open-plugin':
    case 'open-main': {
      activatePlugin(msg.cmd).then((ok) => toWindow(senderId, { t: 'ack', for: msg.mid, ok }));
      return;
    }
    case 'broadcast': {
      const c = msg.c || { t: 'refresh' };
      if (alive(ballWin)) toWindow(wcId(ballWin), { t: 'ctl', c });
      if (alive(panelWin)) toWindow(wcId(panelWin), { t: 'ctl', c });
      return;
    }
    case 'quit':
      closeBall();
      closePanel();
      setTimeout(() => { if (!alive(ballWin) && !alive(panelWin)) endPlugin(); }, 250);
      return;
    default:
      return;
  }
});

if (IS_HOST) {
  function expandMainWindow(h) {
    const targetH = typeof h === 'number' ? h : 600;
    safe(() => {
      if (typeof Z.setExpendHeight === 'function') Z.setExpendHeight(targetH);
      else if (typeof window !== 'undefined' && window.utools && typeof window.utools.setExpendHeight === 'function') {
        window.utools.setExpendHeight(targetH);
      }
    });
  }

  let bootEntered = false; // 收到过「进入插件」动作（用户手动唤起）
  function enterBall(action) {
    bootEntered = true;
    expandMainWindow(600);
    openBall(false);
    fireCtl({ t: 'cmd', cmd: 'switch-tab', tab: 'positions' });
  }
  function enterPanel(action) {
    bootEntered = true;
    expandMainWindow(600);
    openBall(false);
    fireCtl({ t: 'cmd', cmd: 'switch-tab', tab: 'positions' });
  }
  try {
    window.exports = {
      'stock': { mode: 'none', args: { enter: enterPanel, leave: function () {} } },
      'stock-panel': { mode: 'none', args: { enter: enterPanel, leave: function () {} } },
      'stock-ball': { mode: 'none', args: { enter: enterBall, leave: function () {} } }
    };
  } catch (e) { log('window.exports 设置失败', e); }
  // uTools/ZTools 都建议在 onPluginEnter 里再兜一层（有些环境不调用 args.enter）
  if (typeof Z.onPluginEnter === 'function') {
    safe(() => Z.onPluginEnter((action) => {
      bootEntered = true;
      const code = (action && action.code) || 'stock';
      expandMainWindow(600);
      if (code === 'stock-ball') enterBall(action);
      else enterPanel(action);
    }));
  }
  // 开机自动启动收尾：宿主「跟随主程序同时启动运行」只做 preload、通常不回调 onPluginEnter。
  // 预载后2.5秒内没等到进入动作、且官方名单里确实有本插件 → 直接把桌面悬浮球拉起来。
  setTimeout(function () {
    if (bootEntered) return;
    Promise.resolve(resolveAutoStartName())
      .then((name) => autoStartGetList().then((list) => list.indexOf(name) >= 0))
      .then((on) => { if (on && !bootEntered) openBall(true); })
      .catch(() => { /* ignore */ });
  }, 2500);
  // 主窗口句柄补偿：主窗口重载/重建后本上下文没有球句柄，拖动会因 wcId 守卫被静默丢弃
  //（表现就是「有时候拖不动」）—— 心跳显示球还活着就让旧球自毁，并按保存位置立即重建，
  // 新窗口 = 新握手 + 新句柄，拖动与双击通道一并恢复
  startWatcher();   // 守望进程无条件启动：孤儿球可能在本上下文创建任何窗口之前就已存在
  try {
    const hb0 = store.getHeartbeat();
    if (!ballWin && hb0 && hb0.role === 'ball' && hb0.id && !hb0.needsRestart &&
        (Date.now() - (hb0.t || 0)) < HEARTBEAT_FRESH_MS) {
      toWindow(hb0.id, { t: 'ctl', c: { t: 'die' } });
      setTimeout(() => {
        try {
          const hb2 = store.getHeartbeat();
          if (!ballWin && !(hb2 && hb2.closed)) openBall(true);   // 期间用户手动关球则不再拉起
        } catch (e) { /* ignore */ }
      }, 500);
    }
  } catch (e) { /* ignore */ }
  // 主窗口页面上的按钮也能直接调用
  services.host.showBall = () => openBall(true);
  services.host.isBallAlive = () => alive(ballWin);
  services.host.ball = (action) => {
    const act = action || 'show';
    if (act === 'hide') closeBall();
    else openBall(true);
  };
  services.host.showPanel = () => openPanel(true);
  services.host.hidePanel = () => closePanel();
  services.host.endPlugin = () => endPlugin();
  services.host.getDataFilePath = () => store.getDataFilePath();
  services.host.openDataFile = () => {
    const p = store.getDataFilePath();
    if (p) openExternalUrl(p);
  };
  services.host.syncFromFile = () => store.syncFromFile();
  services.host.importFromFile = (p) => store.importFromFile(p);
  services.host.setBallOpacity = (op) => {
    const val = normalizeBallOpacity(op);
    store.patchSettings({ ballOpacity: val });
    applyBallOpacityToWindow(val);
  };
  services.host.setBallSize = (size) => {
    const val = typeof size === 'number' ? Math.min(110, Math.max(56, Math.round(size))) : 72;
    store.patchSettings({ ballSize: val });
    applyBallSizeToWindow(val);
  };
  services.host.openPlugin = activatePlugin;
  services.host.openMain = services.host.openPlugin;
  window.sbHost = services.host;
  try {
    if (window.contextBridge && window.contextBridge.exposeInMainWorld) {
      window.contextBridge.exposeInMainWorld('sbHost', window.sbHost);
    }
  } catch (e) { /* ignore */ }
} else {
  /* 子窗口角色：收主窗口指令 + 上报心跳 + 主窗口失联时自救 */
  let lastCmdSeq = 0;
  const ackWaiters = new Map();
  let hbTimer = null;
  let localDrag = null;

  // 与 ZTools createBrowserWindow 返回的同步代理使用同一接口。
  // 宿主主进程会校验调用者与窗口所属插件；只控制握手取得的本球窗口。
  // 不再经隐藏的插件主页面转发，也不依赖新版 Electron 已移除的 remote。
  function selfWindowCall(method, args) {
    if (ROLE !== 'ball' || !selfWindowId || typeof ipcRenderer.sendSync !== 'function') throw new Error('self window unavailable');
    const result = ipcRenderer.sendSync('plugin.api', 'pluginBrowserWindowMethod', { id: selfWindowId, method, args });
    if (result instanceof Error) throw result;
    return result;
  }
  function selfBounds() {
    const b = selfWindowCall('getBounds', []);
    if (!b || !['x', 'y', 'width', 'height'].every((k) => Number.isFinite(b[k])) || b.width <= 0 || b.height <= 0) {
      throw new Error('invalid self bounds');
    }
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  }
  function canMoveSelf() {
    try { selfBounds(); return true; } catch (e) { return false; }
  }
  function dragSelf(phase, dx, dy, gesture) {
    if (ROLE !== 'ball' || !selfWindowId) return false;
    try {
      if (phase === 'start') {
        // 每次手势重新读位置，系统移动窗口或前一次吸附后不会使用旧坐标。
        localDrag = { b: selfBounds(), gesture };
        return true;
      }
      if (!localDrag) return false;
      if (gesture && gesture !== localDrag.gesture) return true;
      const base = localDrag.b;
      let next = { x: Math.round(base.x + dx), y: Math.round(base.y + dy), width: base.width, height: base.height };
      if (phase === 'end') next = snapBounds(next, next.width);
      selfWindowCall('setBounds', [next]);
      if (phase === 'end') {
        store.setBallPos({ x: next.x, y: next.y });
        localDrag = null;
      }
      return true;
    } catch (e) {
      // 宿主不支持此接口或调用失败时，补发原始基准再退回已有转发路径。
      const started = localDrag;
      localDrag = null;
      if (phase !== 'start' && started) {
        toHost({ t: 'drag', phase: 'start', dx: 0, dy: 0, b: started.b, gesture: started.gesture });
      }
      return false;
    }
  }

  onHostMsg((msg) => {
    if (!msg) return;
    if (msg.t === 'ack') {
      const w = ackWaiters.get(msg.for);
      if (w) { ackWaiters.delete(msg.for); w(msg.ok !== false); }
      return;
    }
    if (msg.t === 'ping') { toHost({ t: 'pong' }); return; }
    if (msg.t === 'ctl') {
      const c = msg.c || {};
      fireCtl(c);
      if (c.t === 'die') {
        if (hbTimer) clearInterval(hbTimer);
        safe(() => window.close());
      } else if (c.t === 'ping') {
        toHost({ t: 'pong' });
      }
      return;
    }
    fireCtl(msg);
  });

  function sendWithAck(msg, ms) {
    const mid = newMid();
    return new Promise((resolve) => {
      let done = false;
      ackWaiters.set(mid, (ok) => { if (!done) { done = true; resolve(ok); } });
      toHost(Object.assign({}, msg, { mid }));
      setTimeout(() => {
        if (done) return;
        done = true;
        ackWaiters.delete(mid);
        // 超时后调用方会自行兜底，握手恢复时不能再重放同一个打开请求。
        const queued = pending.findIndex((m) => m.mid === mid);
        if (queued >= 0) pending.splice(queued, 1);
        resolve(false);
      }, ms || 700);
    });
  }

  /** 拖动起手确认；球端可立即发送位移。gesture 隔离连续的两次拖动。 */
  services.host.dragStart = (b, gesture) => {
    if (dragSelf('start', 0, 0, gesture)) return Promise.resolve(true);
    return sendWithAck({ t: 'drag', phase: 'start', b: b || null, gesture }, 400);
  };
  services.host.drag = (phase, dx, dy, b, gesture) => {
    if (dragSelf(phase, dx || 0, dy || 0, gesture)) return;
    toHost({ t: 'drag', phase, dx: dx || 0, dy: dy || 0, b: b || null, gesture });
  };

  /** 主窗口（管家）失联时，球自己也能把面板开出来 */
  async function openPanelSmart() {
    const ok = await sendWithAck({ t: 'panel', action: 'show' }, 700);
    if (!ok) {
      log('主窗口无响应，球自己开面板');
      openPanel(false);
    }
  }

  services.host.panel = (action) => {
    const act = action || 'show';
    if (act === 'show') { openPanelSmart(); return; }
    sendWithAck({ t: 'panel', action: act }, 700).then((ok) => { if (!ok) { if (alive(panelWin)) safe(() => panelWin.close()); } });
  };
  services.host.ball = (action) => {
    const act = action || 'show';
    sendWithAck({ t: 'ball', action: act }, 700).then((ok) => {
      if (ok) return;
      if (act === 'hide') safe(() => window.close());
      else if (!alive(ballWin)) { /* 自己就是球，不用开第二个 */ }
    });
  };
  services.host.setBallOpacity = (op) => {
    const val = normalizeBallOpacity(op);
    store.patchSettings({ ballOpacity: val });
    toHost({ t: 'set-opacity', opacity: val });
  };
  services.host.openPlugin = async (cmd) => {
    const c = cmd || 'stock';
    const ok = await sendWithAck({ t: 'open-plugin', cmd: c }, 700);
    if (!ok) return activatePlugin(c);
    return true;
  };
  services.host.openMain = services.host.openPlugin;
  /** 关闭自己这个窗口（先请管家，失联就直接关） */
  services.closeSelf = () => {
    sendWithAck({ t: ROLE === 'panel' ? 'panel' : 'quit', action: 'hide' }, 600).then((ok) => {
      if (alive(panelWin)) safe(() => panelWin.close());
      if (!ok || ROLE === 'ball') safe(() => window.close());
    });
  };

  if (ROLE === 'ball') {
    // 球一启动就写心跳，好让下次进入插件时知道桌上已经有球了
    store.setHeartbeat({ id: safe(() => Z.getWebContentsId(), null), role: 'ball' });
    let lastHeartbeatAt = Date.now();
    hbTimer = setInterval(() => {
      const now = Date.now();
      if (now - lastHeartbeatAt > 15000) lastHostMsgAt = now;
      lastHeartbeatAt = now;
      const cur = store.getHeartbeat();
      if (cur && cur.closed) {
        clearInterval(hbTimer);
        return;
      }
      store.setHeartbeat({ id: safe(() => Z.getWebContentsId(), null), role: 'ball' });
      // 存活探测：主窗口必须有回音（入站任意消息都会刷新 lastHostMsgAt）。
      // 45秒无回音且无法直接控制自身时，经临时缓存旁路自报 needsRestart。
      // 能自行拖动时保留球，双击另有直接唤起兜底，继续处理缓存指令。
      try { toHost({ t: 'ping' }); } catch (e) { /* ignore */ }
      if ((Date.now() - lastHostMsgAt) > 45000 && !canMoveSelf()) {
        try {
          store.setHeartbeat({ id: safe(() => Z.getWebContentsId(), null), role: 'ball', needsRestart: true });
          if (typeof Z.showNotification === 'function') Z.showNotification('悬浮球连接中断，正在自动重启…');
        } catch (e) { /* ignore */ }
        clearInterval(hbTimer);
        setTimeout(() => { try { window.close(); } catch (e) { /* ignore */ } }, 400);
        return;
      }
      const cmd = store.readCmd(lastCmdSeq);
      if (cmd) { lastCmdSeq = cmd.seq; fireCtl({ t: 'cmd', cmd: cmd.t }); }
    }, 5000);
  }
}

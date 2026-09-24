/*
 * 悬浮球拖动回归测试（真机协议级）。
 *
 * 老实现的两个卡顿来源：
 *  A. 主窗口处理 drag:start 要异步 getBounds（句柄代理，几十毫秒），
 *     这期间到达的 move 被 `if (!dragState) return` 直接丢弃 ——
 *     起手的位移凭空消失，球要等你多拖一段才动。
 *  B. 每帧 move 走「球→IPC→主窗口→setBounds」，链路长。
 *
 * 本测试搭一套真实的双窗口环境：
 *   - 主窗口 preload（index.html 角色）+ 球窗口 preload（ball.html 角色）+ 真实 ball.js
 *   - 两者之间用 FIFO 消息总线模拟 ipcRenderer.sendTo / sendToParent（含重复投递去重）
 *   - 主窗口持有的球 WindowInstance 故意把 getBounds 做成 30ms 才 resolve 的 Promise，
 *     复现「起手时基准 bounds 还没拿到」的竞态
 *
 * 断言核心：ack 之前发的位移一个像素都不能丢（老实现必挂：setBounds 里
 * 根本不会出现 ack 前那批位移对应的位置），且 end 后位置正确持久化。
 *
 *   node tests/test-ball-drag.js
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PLUGIN_DIR = path.join(__dirname, '..');
const CH = 'sb:cmd';
const HOST_WC = 11;
const BALL_WC = 12;

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; failures.push(label); console.log('  ✗ ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ==================== 1. 打补丁的依赖（绝不能碰网络/真实数据） ==================== */
const market = require(path.join(PLUGIN_DIR, 'lib', 'market.js'));
market.quotes = async (secids) => (secids || []).map((s) => ({ code: String(s).split('.').pop(), name: 'T', price: 10, pct: 0 }));
market.quotesTencent = market.quotes;
market.indexes = async () => [];
market.trend = async () => ({});
market.detail = async () => ({});
market.search = async () => [];

const storeReal = require(path.join(PLUGIN_DIR, 'lib', 'store.js'));
const storeShim = Object.assign({}, storeReal, { createStore: (db) => storeReal.createStore(db, { isolated: true }) });

/* 共享 dbStorage（两个窗口各持一个实例，背后同一张表） */
const dbMap = new Map();
dbMap.set('sb.ballPos', { x: 500, y: 300 });
dbMap.set('sb.settings', { refreshSec: 120, ballSize: 72, snapEdge: true });
function makeDbStorage() {
  return {
    getItem: (k) => (dbMap.has(k) ? dbMap.get(k) : null),
    setItem: (k, v) => dbMap.set(k, v),
    removeItem: (k) => dbMap.delete(k)
  };
}

/* ==================== 2. FIFO 消息总线（模拟 Electron 跨 webContents IPC） ==================== */
const ctxs = new Map(); // wcId -> { handlers: [fn] }
const queue = [];
let pumping = false;
function pump() {
  if (!queue.length) { pumping = false; return; }
  const job = queue.shift();
  const target = ctxs.get(job.to);
  if (target) target.handlers.slice().forEach((fn) => { try { fn({ senderId: job.from }, job.msg); } catch (e) { console.error('投递处理异常', e); } });
  setImmediate(pump);
}
function busSend(from, to, msg) {
  if (!ctxs.has(to)) throw new Error('No webContents ' + to);
  queue.push({ from, to, msg });
  if (!pumping) { pumping = true; setImmediate(pump); }
}
function peerOf(id) { return id === HOST_WC ? BALL_WC : HOST_WC; }

/* ==================== 3. 主窗口持有的「球窗口句柄」 ==================== */
const setBoundsLog = [];
let curBounds = { x: 0, y: 0, width: 84, height: 84 };
const fakeBallWin = {
  webContents: { id: BALL_WC },
  isDestroyed: () => false,
  getBounds() {
    const snapshot = Object.assign({}, curBounds);
    // 关键：模拟句柄代理的异步取值，150ms 远超任何调度抖动 ——
    // 老实现在这期间的 move 全被 if (!dragState) return 丢弃，且不会重发
    return new Promise((resolve) => setTimeout(() => resolve(snapshot), 150));
  },
  setBounds(b) { curBounds = Object.assign({}, b); setBoundsLog.push(Object.assign({}, b)); },
  setOpacity() {}, show() {}, focus() {}, close() {}
};

/* ==================== 4. preload 上下文（真 preload.js 跑在 vm 里） ==================== */
const display = { workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 };
function buildPreloadContext(pathname, selfId) {
  const entry = { handlers: [] };
  ctxs.set(selfId, entry);
  const ipc = {
    on(ch, fn) { if (ch === CH) entry.handlers.push(fn); },
    sendTo(id, ch, msg) { if (ch === CH) busSend(selfId, id, msg); },
    send() {}
  };
  const ztools = {
    dbStorage: makeDbStorage(),
    getWebContentsId: () => selfId,
    showNotification() {}, isWindows: () => true,
    getPrimaryDisplay: () => display,
    getDisplayMatching: () => display,
    getDisplayNearestPoint: () => display,
    sendToParent(ch, msg) { if (ch === CH) busSend(selfId, peerOf(selfId), msg); },
    outPlugin() {}, hideMainWindow() {}, onPluginEnter() {}, onPluginOut() {},
    createBrowserWindow(url, opts, cb) {
      curBounds = { x: opts.x, y: opts.y, width: opts.width, height: opts.height };
      setTimeout(() => { if (typeof cb === 'function') cb(); }, 0);
      return fakeBallWin;
    }
  };
  const win = {
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    contextBridge: null
  };
  const sandbox = {
    window: win, ztools, utools: ztools,
    location: { href: 'file:///plugin' + pathname, pathname, search: '' },
    process: { argv: [], platform: 'win32' },
    console,
    require(id) {
      if (id === 'electron') return { ipcRenderer: ipc };
      if (/lib[\\/]store\.js$/.test(id)) return storeShim;
      if (id.charAt(0) === '.') return require(path.resolve(PLUGIN_DIR, id));
      return require(id);
    },
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    Promise, Object, Array, Math, Date, JSON, String, Number, Boolean, Error, Map, Set, RegExp, isFinite, parseInt, parseFloat,
    TextDecoder, URL, Buffer,
    CustomEvent: class { constructor(t, o) { this.type = t; this.data = o; } }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(PLUGIN_DIR, 'preload.js'), 'utf8'), sandbox, { filename: 'preload.js' });
  return { win, sandbox };
}

/* ==================== 5. 球页面的假 DOM（严格按 ball.html 里的 id） ==================== */
function mkEl(id) {
  const listeners = {};
  const el = {
    id, hidden: false, textContent: '', _html: '',
    style: { setProperty() {}, getPropertyValue() { return ''; }, removeProperty() {} },
    _cls: new Set(),
    scrollWidth: 0, scrollHeight: 0, offsetWidth: 0, offsetHeight: 0, clientWidth: 84, clientHeight: 84,
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener() {},
    setPointerCapture() {}, releasePointerCapture() {},
    fire(t, ev) {
      const e = Object.assign({ type: t, target: el, preventDefault() {}, stopPropagation() {} }, ev || {});
      (listeners[t] || []).slice().forEach((fn) => fn(e));
      return e;
    },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); }
  };
  Object.defineProperty(el, 'className', {
    get() { return Array.from(el._cls).join(' '); },
    set(v) { el._cls = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  });
  el.classList = {
    add(c) { el._cls.add(c); },
    remove(c) { el._cls.delete(c); },
    contains(c) { return el._cls.has(c); },
    toggle(c, force) { if (force === undefined ? !el._cls.has(c) : force) el._cls.add(c); else el._cls.delete(c); }
  };
  return el;
}
function makeBallDom() {
  const html = fs.readFileSync(path.join(PLUGIN_DIR, 'windows', 'ball.html'), 'utf8');
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const registry = new Map();
  ids.forEach((id) => registry.set(id, mkEl(id)));
  const docListeners = {};
  const document = {
    readyState: 'complete',
    documentElement: mkEl('html'),
    hidden: false,
    getElementById(id) { return registry.get(id) || null; },
    addEventListener(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); },
    removeEventListener() {}
  };
  return { document, registry };
}

/* ==================== 6. 跑 ==================== */
(async () => {
  console.log('== 1. 启动双窗口（真 preload × 2）并完成握手 ==');
  const hostCtx = buildPreloadContext('/index.html', HOST_WC);
  const ballCtx = buildPreloadContext('/windows/ball.html', BALL_WC);
  await sleep(30);

  const { document, registry } = makeBallDom();
  const win = ballCtx.win;
  Object.assign(win, {
    services: ballCtx.win.services,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    devicePixelRatio: 1, innerWidth: 84, innerHeight: 84,
    requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    getComputedStyle: () => ({ getPropertyValue: () => '' })
  });
  ok(!!(win.services && win.services.host && typeof win.services.host.dragStart === 'function'),
    '球窗口 preload 暴露了带 ack 的 dragStart');

  const ballSandbox = {
    window: win, self: win, document,
    location: { href: 'file:///plugin/windows/ball.html', pathname: '/windows/ball.html', search: '' },
    navigator: { userAgent: 'node-test', language: 'zh-CN', platform: 'Win32' },
    process: { argv: [], platform: 'win32' },
    console,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval, queueMicrotask,
    Promise, Object, Array, Math, Date, JSON, String, Number, Boolean, Error, Map, Set, RegExp, isFinite, parseInt, parseFloat,
    Intl, TextDecoder, URL, Buffer,
    CustomEvent: class { constructor(t, o) { this.type = t; this.data = o; } },
    getComputedStyle: win.getComputedStyle,
    requestAnimationFrame: win.requestAnimationFrame,
    cancelAnimationFrame: win.cancelAnimationFrame,
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} }
  };
  ballSandbox.globalThis = ballSandbox;
  vm.createContext(ballSandbox);
  let bootErr = null;
  try {
    vm.runInContext(fs.readFileSync(path.join(PLUGIN_DIR, 'windows', 'ball.js'), 'utf8'), ballSandbox, { filename: 'ball.js' });
  } catch (e) { bootErr = e; }
  ok(!bootErr, 'ball.js 启动不抛异常', bootErr && (bootErr.message + '\n' + String(bootErr.stack).split('\n')[1]));

  const hostServices = hostCtx.win.services;
  ok(typeof hostServices.host.showBall === 'function', '主窗口暴露了 showBall');
  hostServices.host.showBall();
  await sleep(200); // 创建窗口 + greet/hello 握手
  ok(curBounds.x === 500 && curBounds.y === 300 && curBounds.width === 84, '球窗口按存档位置创建（500,300，84×84）', curBounds);

  const ballEl = registry.get('ball');
  ok(!!ballEl, '拿到球元素');

  console.log('== 2. 起手竞态：ack 前的位移一个都不能丢 ==');
  ballEl.fire('pointerdown', { button: 0, screenX: 100, screenY: 100, pointerId: 1 });
  ok(ballEl.classList.contains('dragging'), '按下后进入 dragging 状态');

  // 30ms 内连发 3 帧移动 —— 此时主窗口的 getBounds 还没 resolve（老实现全部丢弃）
  ballEl.fire('pointermove', { pointerId: 1, screenX: 110, screenY: 105 });
  await sleep(5);
  ballEl.fire('pointermove', { pointerId: 1, screenX: 130, screenY: 120 });
  await sleep(5);
  ballEl.fire('pointermove', { pointerId: 1, screenX: 150, screenY: 140 });
  await sleep(500); // 等 getBounds(150ms) + ack + 冲刷

  const preAckHit = setBoundsLog.some((b) => b.x === 550 && b.y === 340);
  ok(preAckHit, 'ack 前积压的位移（+50,+40）被补应用 → setBounds 出现 550,340', setBoundsLog);

  console.log('== 3. ack 后正常拖动 ==');
  ballEl.fire('pointermove', { pointerId: 1, screenX: 200, screenY: 180 });
  await sleep(80);
  const midHit = setBoundsLog.some((b) => b.x === 600 && b.y === 380);
  ok(midHit, 'ack 后的位移（+100,+80）实时应用 → setBounds 出现 600,380', setBoundsLog);

  console.log('== 4. 松手：吸附 + 位置持久化 ==');
  ballEl.fire('pointerup', { pointerId: 1, button: 0, screenX: 200, screenY: 180 });
  await sleep(120);
  ok(!ballEl.classList.contains('dragging'), '松手后 dragging 状态清除');
  const saved = dbMap.get('sb.ballPos');
  ok(saved && saved.x === 600 && saved.y === 380, '球的新位置写回了 sb.ballPos（600,380）', saved);
  const last = setBoundsLog[setBoundsLog.length - 1];
  ok(last && last.x === 600 && last.y === 380 && last.width === 84 && last.height === 84,
    'end 后窗口最终 bounds 正确（含吸附）', last);

  console.log('== 5. 拖动中不重排（needRender 补渲染路径） ==');
  const before = setBoundsLog.length;
  ballEl.fire('pointerdown', { button: 0, screenX: 300, screenY: 300, pointerId: 2 });
  ballEl.fire('pointermove', { pointerId: 2, screenX: 340, screenY: 340 });
  await sleep(80);
  ballEl.fire('pointerup', { pointerId: 2, button: 0, screenX: 340, screenY: 340 });
  await sleep(250); // 快拖：松手比 ack(150ms) 还早，终点由 startDone 补算
  ok(setBoundsLog.length > before, '第二次拖动照样生效', { before, after: setBoundsLog.length });
  const saved2 = dbMap.get('sb.ballPos');
  ok(saved2 && saved2.x === 640 && saved2.y === 420, '第二次拖动终点持久化（640,420）', saved2);

  console.log('');
  if (fail === 0) {
    console.log('✓ 悬浮球拖动回归测试全部通过（' + pass + ' 项）');
    process.exit(0);
  }
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
})().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});

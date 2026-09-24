/*
 * 慢网络刷新效率测试 —— 按评审复现的三个问题逐一锁死（test-slow-network-dedup）。
 *
 * 复现1（接口慢就重复请求）：等待其他窗口在途请求的上限曾是1500ms，
 *   接口耗时2.2s 时等不到 → 各窗口自己再发一遍同样的请求（2次相同请求+54次共享读）。
 *   修复：sharedWaitMs 1500→9500（覆盖单次9s超时）+ 轮询自适应75→300ms。
 *   断言：双窗口并发持仓查询 = 1次网络请求、共享读取有上限。
 *
 * 复现2（同窗口重叠触发不合并）：定时刷新/回前台/广播错峰触发同一路刷新，
 *   第一次还在途时第二、三次又各起一条（3次请求+101次读）。
 *   修复：页面层 refreshPending 合并（index/panel/ball）+ preload 层 coalesceFetch 兜底。
 *   断言：2.2s 在途期间错峰3次 quotes() = 1次网络请求、读取≈单条链路。
 *
 * 复现3（每轮重复计算全部流水）：取代码扫一遍、建持仓/汇总再扫、已清仓又扫。
 *   修复：交易流水内核按 (txVersion+当天) 缓存；getHoldingCodes 派生；
 *   getClosedPositions 无行情参数路径整表记忆化。
 *   断言：换行情不发脏、改流水立即失效、已清仓命中同一份缓存、代码集合随清仓更新。
 *
 *   node tests/test-slow-network-dedup.js
 */
'use strict';
const assert = require('assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const PLUGIN_DIR = path.join(__dirname, '..');

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; failures.push(label); console.log('  ✗ ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ---------------- 桩：慢接口2.2s + 共享读取计数 ---------------- */
const market = require(path.join(PLUGIN_DIR, 'lib', 'market.js'));
const calls = { quotes: 0 };
const DELAY = 2200;
function fakeQuote(secid, i) {
  const code = String(secid).split('.').pop();
  return { code, name: 'X' + code, price: 10 + i, pct: 1.23, change: 0.1, prevClose: 9.9, open: 10, high: 11, low: 9, volume: 100, amount: 1000 };
}
market.quotes = async (secids) => {
  calls.quotes++;
  await sleep(DELAY);
  return (secids || []).map(fakeQuote);
};
market.quotesTencent = market.quotes;
market.indexes = async () => [];

const storeReal = require(path.join(PLUGIN_DIR, 'lib', 'store.js'));
const storeShim = Object.assign({}, storeReal, { createStore: (db) => storeReal.createStore(db, { isolated: true }) });

/* ---------------- 双窗口 harness（共享 dbStorage，统计读取次数） ---------------- */
const dbMap = new Map();
let reads = 0; // 所有窗口的共享存储读取总数（复现里的54/101次读就是它）

dbMap.set('sb.settings', { refreshSec: 5, offSessionFetchOnce: false });
dbMap.set('sb.transactions', [
  { id: 1, stock_code: '600961', stock_name: '株冶集团', type: 1, price: 10, quantity: 600, amount: 6000, total_price: 6000, created_at: '2026-01-05T01:30:00.000Z' }
]);
dbMap.set('sb.watchlist', [
  { code: '600961', secid: '1.600961', name: '株冶集团', group: '默认' },
  { code: '300547', secid: '0.300547', name: '川环科技', group: '默认' }
]);

function buildCtx(id) {
  const src = fs.readFileSync(path.join(PLUGIN_DIR, 'preload.js'), 'utf8');
  const ipc = { on: () => {}, sendTo: () => {}, send: () => {} };
  const win = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  const ztools = {
    dbStorage: {
      getItem: (k) => { reads++; return dbMap.has(k) ? dbMap.get(k) : null; },
      setItem: (k, v) => dbMap.set(k, v),
      removeItem: (k) => dbMap.delete(k)
    },
    getWebContentsId: () => id,
    showNotification() {}, isWindows: () => true,
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }),
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }),
    sendToParent() {}, outPlugin() {}, hideMainWindow() {},
    createBrowserWindow: () => null, onPluginEnter() {}, onPluginOut() {}
  };
  const sandbox = {
    window: win, ztools, utools: ztools,
    location: { href: 'file:///plugin/windows/panel.html', pathname: '/windows/panel.html' },
    process: { argv: [] },
    console,
    require: (rid) => {
      if (rid === 'electron') return { ipcRenderer: ipc };
      if (/lib[\\/]store\.js$/.test(rid)) return storeShim;
      if (rid.charAt(0) === '.') return require(path.resolve(PLUGIN_DIR, rid));
      return require(rid);
    },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval, queueMicrotask,
    Promise, Object, Array, Math, Date, JSON, String, Number, Boolean, Error, Map, Set, RegExp, isFinite, parseInt, parseFloat,
    TextDecoder, URL, Buffer, CustomEvent: class { constructor(t, o) { this.type = t; this.data = o; } }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'preload.js' });
  return win.services;
}

(async () => {
  console.log('== 1. 复现一：接口2.2秒，两窗口并发持仓查询只允许1次请求 ==');
  const A = buildCtx(11);
  const B = buildCtx(12);
  await sleep(40);
  dbMap.delete('sb.quoteStamp');
  dbMap.delete('sb.latestQuotes');
  calls.quotes = 0;
  reads = 0;
  const t0 = Date.now();
  const [pa, pb] = await Promise.all([A.positions.get(), B.positions.get()]);
  const elapsed = Date.now() - t0;
  ok(calls.quotes === 1, '两窗口并发只发了1次请求（旧实现：等待1.5s超时→各自再发=2次）', calls);
  ok(elapsed >= DELAY, '后到的窗口确实等了对端完成（而不是放弃自请）', { elapsed });
  ok(pa.positions.length === 1 && pb.positions.length === 1, '两个窗口拿到同样的持仓数据',
    { a: pa.positions.length, b: pb.positions.length });
  ok(reads <= 70, '等待期间的共享存储读取有上限（自适应轮询，复现为54+）', { reads });

  console.log('== 2. 复现二：同窗口错峰3次重叠触发 = 1次请求（在途2.2秒期间） ==');
  const C = buildCtx(13);
  await sleep(40);
  calls.quotes = 0;
  reads = 0;
  const p1 = C.quotes();          // 触发源1：定时刷新
  await sleep(500);
  const p2 = C.quotes();          // 触发源2：回前台（500ms后，第一次还在途）
  await sleep(500);
  const p3 = C.quotes();          // 触发源3：广播通知（1000ms后，仍在途）
  const results = await Promise.all([p1, p2, p3]);
  ok(calls.quotes === 1, '错峰3次触发只发了1次请求（旧实现：3次请求+101次读）', calls);
  ok(reads <= 40, '重叠期间读取≈单条链路（旧实现≈3倍）', { reads });
  ok(results.every((r) => Array.isArray(r) && r.length === 2), '三次调用都拿到完整自选数据',
    results.map((r) => (r && r.length)));

  console.log('== 3. 复现三：流水计算缓存（换行情不脏、改流水即失效） ==');
  const db2 = new Map();
  const store = storeReal.createStore({
    getItem: (k) => (db2.has(k) ? db2.get(k) : null),
    setItem: (k, v) => db2.set(k, v),
    removeItem: (k) => db2.delete(k)
  }, { isolated: true });
  const YDAY = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  db2.set('sb.transactions', [
    { id: 1, stock_code: '600961', stock_name: '株冶集团', type: 1, price: 10, quantity: 600, amount: 6000, total_price: 6000, created_at: YDAY },
    { id: 2, stock_code: '300547', stock_name: '川环科技', type: 1, price: 20, quantity: 100, amount: 2000, total_price: 2000, created_at: YDAY },
    { id: 3, stock_code: '300547', stock_name: '川环科技', type: 2, price: 22, quantity: 100, amount: 2200, total_price: 2200, created_at: YDAY }
  ]);
  // 行情map的key是裸代码（与 store.setLatestQuotes 落库格式一致）
  const q1 = { '600961': { code: '600961', price: 10.1, pct: 1, change: 0.1, prevClose: 10 } };
  const q2 = { '600961': { code: '600961', price: 12.5, pct: 25, change: 2.5, prevClose: 10 } };
  const m1 = store.getAllPositions(q1);
  const m2 = store.getAllPositions(q2);
  ok(m1[0].current_price === 10.1 && m2[0].current_price === 12.5,
    '换行情立刻反映（内核缓存不吞行情参数）', { p1: m1[0].current_price, p2: m2[0].current_price });
  const codes1 = store.getHoldingCodes();
  ok(codes1.indexOf('600961') >= 0 && codes1.indexOf('300547') < 0,
    '代码集合：持仓在、已清仓的不在', codes1);
  const c1 = store.getClosedPositions();
  const c1b = store.getClosedPositions();
  ok(c1 === c1b, '已清仓命中同一份记忆化（同一引用=没重算）');
  ok(c1.length === 1 && c1[0].stock_code === '300547' && c1[0].profit_loss === 200,
    '已清仓数据正确', c1);
  // 改流水 → 版本号必须失效所有缓存
  store.addTransaction({ stock_code: '600961', stock_name: '株冶集团', type: 2, price: 12, quantity: 600, amount: 7200, total_price: 7200, created_at: YDAY });
  const codes2 = store.getHoldingCodes();
  ok(codes2.indexOf('600961') < 0, '清仓后代码集合立即更新（txVersion 失效）', codes2);
  const c2 = store.getClosedPositions();
  ok(c2 !== c1 && c2.length === 2, '已清仓重新计算（新引用+新内容）', c2.map((x) => x.stock_code));
  const m3 = store.getAllPositions(q2);
  ok(m3.length === 0, '全数清仓的股票不再出现在持仓行（与原实现一致：转入已清仓）', m3);

  console.log('== 4. 静态锁：三处修复的接线都在 ==');
  const pre = fs.readFileSync(path.join(PLUGIN_DIR, 'preload.js'), 'utf8');
  const idxJs = fs.readFileSync(path.join(PLUGIN_DIR, 'index.js'), 'utf8');
  const panJs = fs.readFileSync(path.join(PLUGIN_DIR, 'windows', 'panel.js'), 'utf8');
  const balJs = fs.readFileSync(path.join(PLUGIN_DIR, 'windows', 'ball.js'), 'utf8');
  const stoJs = fs.readFileSync(path.join(PLUGIN_DIR, 'lib', 'store.js'), 'utf8');

  ok(pre.includes('return 9500'), '等待窗口9.5s（覆盖单次9s超时）');
  ok(pre.includes('waited < 600 ? 75') && pre.includes('? 150 : 300'), '等待轮询自适应75→150→300ms');
  ok(pre.includes('coalesceFetch'), 'preload 层同窗口请求合并');
  ok(pre.includes('store.getHoldingCodes()'), 'positions.get 走内核取代码（不再整表扫）');
  ok(idxJs.includes('refreshPending') && panJs.includes('refreshPending') && balJs.includes('refreshPending'),
    '三个窗口页面层 refresh 合并');
  ok(idxJs.includes('lastUpdate >= 1500') && panJs.includes('lastUpdate >= 1500'),
    '回前台1.5s内不重复打一轮');
  ok(stoJs.includes('txVersion') && stoJs.includes('function getPositionsCore') && stoJs.includes('function getHoldingCodes'),
    '流水内核缓存 + 版本号失效');
  ok(stoJs.includes('closedMemo.v === txVersion'), '已清仓按流水版本记忆化');

  console.log('');
  if (fail === 0) {
    console.log('✓ 慢网络刷新效率测试全部通过（' + pass + ' 项）');
    process.exit(0);
  }
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
})().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});

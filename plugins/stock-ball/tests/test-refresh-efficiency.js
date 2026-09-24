/*
 * 刷新效率回归测试（性能优化的锁）。
 *
 * 问题（修复前的真实缺陷）：跨窗口行情记档 markSharedQuotes 是「覆盖」而不是「并集」。
 * 持仓与自选是两套代码集合：主窗口一轮里先拉持仓（记档=持仓集合）、再拉自选
 * （记档被覆盖成自选集合）→ 其它窗口再查持仓集合时永远「未覆盖」→ 跨窗口复用
 * 形同虚设，三个窗口每轮各发一遍请求（交易时段放大为持续的多余流量与预警重复评估）。
 *
 * 本测试用两个 preload 上下文共享 dbStorage：
 *   A 拉持仓、A 拉自选 → 记档必须是并集（三只代码都在）→ B 同鲜度窗口内
 *   持仓/自选都不再发请求 → 鲜度过期后必须重新拉取（不能过度缓存）。
 * 顺带静态锁住另外四项优化：隐藏窗口停链、失败重试守卫、悬浮球幂等渲染、settings 微缓存。
 *
 *   node tests/test-refresh-efficiency.js
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

/* ---------------- 桩：行情请求计数 ---------------- */
const market = require(path.join(PLUGIN_DIR, 'lib', 'market.js'));
const calls = { quotes: 0 };
function fakeQuote(secid, i) {
  const code = String(secid).split('.').pop();
  return { code, name: 'X' + code, price: 10 + i, pct: 1.23, change: 0.1, prevClose: 9.9, open: 10, high: 11, low: 9, volume: 100, amount: 1000 };
}
market.quotes = async (secids) => { calls.quotes++; return (secids || []).map(fakeQuote); };
market.quotesTencent = market.quotes;
market.indexes = async () => [];

const storeReal = require(path.join(PLUGIN_DIR, 'lib', 'store.js'));
const storeShim = Object.assign({}, storeReal, { createStore: (db) => storeReal.createStore(db, { isolated: true }) });
const webserverPath = path.join(PLUGIN_DIR, 'lib', 'webserver.js');
try { require.resolve(webserverPath); } catch (e) { /* 已随 Web 服务删除 */ }

/* 两个窗口共享的 dbStorage：refreshSec=2 → 新鲜度窗口 = 1200ms */
const dbMap = new Map();
dbMap.set('sb.settings', { refreshSec: 2, offSessionFetchOnce: false });
// 持仓代码(000001) 与自选集合(600961/300547) 必须不相交，才能暴露覆盖问题
dbMap.set('sb.transactions', [
  { id: 1, stock_code: '000001', stock_name: '持仓股', type: 1, price: 10, quantity: 100, amount: 1000, total_price: 1000, created_at: '2026-01-05T01:30:00.000Z' }
]);
dbMap.set('sb.watchlist', [
  { code: '600961', secid: '1.600961', name: '株冶集团', group: '默认' },
  { code: '300547', secid: '0.300547', name: '川环科技', group: '默认' }
]);
dbMap.delete('sb.quoteStamp');
dbMap.delete('sb.latestQuotes');

function buildCtx(id) {
  const src = fs.readFileSync(path.join(PLUGIN_DIR, 'preload.js'), 'utf8');
  const ipc = { on: () => {}, sendTo: () => {}, send: () => {} };
  const win = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  const ztools = {
    dbStorage: {
      getItem: (k) => (dbMap.has(k) ? dbMap.get(k) : null),
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
  const A = buildCtx(11);
  const B = buildCtx(12);
  await sleep(40);

  console.log('== 1. 窗口A一轮：持仓 + 自选 = 2 次请求，记档必须是并集 ==');
  calls.quotes = 0;
  const aPos = await A.positions.get();
  const aQ = await A.quotes();
  ok(calls.quotes === 2, 'A 的一轮正好2次请求（持仓1 + 自选1）', calls);
  const st = dbMap.get('sb.quoteStamp') || {};
  const codes = st.codes || [];
  ok(codes.indexOf('000001') >= 0 && codes.indexOf('600961') >= 0 && codes.indexOf('300547') >= 0,
    '记档是并集：持仓与自选的代码都在（修复前会被覆盖成只剩自选）', codes);
  ok(aPos.positions.length === 1 && aQ.length === 2, 'A 拿到的数据完整', { pos: aPos.positions.length, q: aQ.length });

  console.log('== 2. 窗口B同鲜度窗口内：两个路径都零请求（修复前持仓必重拉） ==');
  const bPos = await B.positions.get();
  ok(calls.quotes === 2, 'B 的持仓路径直接复用 A 的记档，不再发请求（修复前这里会变3）', calls);
  const bQ = await B.quotes();
  ok(calls.quotes === 2, 'B 的自选路径同样复用', calls);
  ok(bPos.positions.length === 1 && bPos.positions[0].stock_code === '000001',
    '复用返回的持仓数据正确', bPos.positions);
  ok(bQ.length === 2, '复用返回的自选数据正确', bQ.length);

  console.log('== 3. 鲜度过期必须重拉（不能过度缓存） ==');
  await sleep(1500); // 新鲜度窗口 = 2000ms * 0.6 = 1200ms
  const before = calls.quotes;
  await B.positions.get();
  ok(calls.quotes > before, '1.5秒后（>1.2s 窗口）重新发请求', { before, after: calls.quotes });

  console.log('== 4. 其余四项优化的静态锁 ==');
  const idxJs = fs.readFileSync(path.join(PLUGIN_DIR, 'index.js'), 'utf8');
  const panJs = fs.readFileSync(path.join(PLUGIN_DIR, 'windows', 'panel.js'), 'utf8');
  const balJs = fs.readFileSync(path.join(PLUGIN_DIR, 'windows', 'ball.js'), 'utf8');
  const stoJs = fs.readFileSync(path.join(PLUGIN_DIR, 'lib', 'store.js'), 'utf8');
  const preJs = fs.readFileSync(path.join(PLUGIN_DIR, 'preload.js'), 'utf8');

  ok(preJs.includes('merged') && preJs.includes('markSharedQuotes'), '记档并集逻辑在位');
  ok(idxJs.includes('visibilitychange') && panJs.includes('visibilitychange'), '主窗口/小窗：隐藏停链、回前台补拉');
  ok(idxJs.includes('if (document.hidden) return;') && panJs.includes('if (document.hidden) return;'), 'loopRefresh 隐藏时不下一轮');
  ok(idxJs.includes('if (!document.hidden) setTimeout(refresh') && panJs.includes('if (!document.hidden) setTimeout(refresh'), '失败重试不进隐藏期（防后台永续轮询）');
  ok(idxJs.includes('if (!document.hidden) updateBallBtnState()'), '悬浮球按钮状态轮询跳过隐藏期');
  ok(balJs.includes('__fitKey') && balJs.includes('function setText') && balJs.includes('function setBallClass'),
    '悬浮球幂等渲染：内容没变零 DOM、零强制布局');
  ok(stoJs.includes('settingsMemo') && stoJs.includes("key === K.settings"), 'settings 微缓存 + 写入即失效');

  console.log('');
  if (fail === 0) {
    console.log('✓ 刷新效率回归测试全部通过（' + pass + ' 项）');
    process.exit(0);
  }
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
})().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});

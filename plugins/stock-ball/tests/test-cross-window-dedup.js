/*
 * 性能回归测试：跨窗口行情复用。
 *
 * 背景：主窗口 / 悬浮球 / 面板各有独立刷新循环，同一份行情会被重复请求 2~3 次
 *（同时预警通知也会重复弹）。preload.js 现在把「最近一次成功拉取的时刻 + 覆盖的代码」
 * 写进共享的 dbStorage，其它窗口在新鲜度窗口内直接复用缓存。
 *
 * 本测试用假 ztools 起 3 个窗口上下文，并统计 lib/market.js 的真实调用次数。
 *
 *   node tests/test-cross-window-dedup.js
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PLUGIN_DIR = path.join(__dirname, '..');

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; failures.push(label); console.log('  ✗ ' + label + (extra ? '  → ' + JSON.stringify(extra) : '')); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ---------------- 打桩 lib/market.js（统计网络调用次数） ---------------- */
const marketPath = require.resolve(path.join(PLUGIN_DIR, 'lib', 'market.js'));
const market = require(marketPath);
const calls = { quotes: 0, quotesTencent: 0, indexes: 0, ticks: 0, delayMs: 0 };

function fakeQuote(code, price) {
  return { code, name: 'X' + code, price, pct: 1.23, change: price * 0.01, prevClose: price - 1, open: price, high: price, low: price, volume: 100, amount: 1000 };
}
// secid 形如 '1.600961' / '0.300547'，行情返回的 code 是 6 位纯代码
function codeOf(secid) { return String(secid).split('.').pop().replace(/[^\d]/g, ''); }
market.quotes = async (secids) => {
  calls.quotes++;
  calls.ticks++;
  if (calls.delayMs) await new Promise((r) => setTimeout(r, calls.delayMs));
  return (secids || []).map((s, i) => fakeQuote(codeOf(s), 10 + i));
};
market.quotesTencent = async (secids) => {
  calls.quotesTencent++;
  calls.ticks++;
  return (secids || []).map((s, i) => fakeQuote(codeOf(s), 10 + i));
};
market.indexes = async () => {
  calls.indexes++;
  calls.ticks++;
  return [{ code: '1.000001', name: '上证指数', price: 3000, pct: 0.5 }];
};

/* ---------------- 假 ZTools 宿主（3 个窗口共享一个 dbStorage） ---------------- */
const storeReal = require(path.join(PLUGIN_DIR, 'lib', 'store.js'));
// 测试要可重复，不能被用户本机 ~/.ztools-stock-ball.json 干扰（也不去写它）
const storeShim = Object.assign({}, storeReal, {
  createStore: (db) => storeReal.createStore(db, { isolated: true })
});

const dbMap = new Map();
let nextId = 1;

function fakeDbStorage() {
  return {
    getItem: (k) => (dbMap.has(k) ? dbMap.get(k) : null),
    setItem: (k, v) => { dbMap.set(k, v); },
    removeItem: (k) => { dbMap.delete(k); }
  };
}

function makeZTools(ctx) {
  return {
    dbStorage: fakeDbStorage(),
    getWebContentsId: () => ctx.id,
    showNotification: () => {},
    isWindows: () => true,
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }),
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }),
    sendToParent: () => {},
    outPlugin: () => {},
    hideMainWindow: () => {},
    createBrowserWindow: () => null,
    onPluginEnter: () => {},
    onPluginOut: () => {}
  };
}

function runPreload(role, url) {
  const src = fs.readFileSync(path.join(PLUGIN_DIR, 'preload.js'), 'utf8');
  const ctx = { id: ++nextId, role, listeners: {} };
  const ipc = { on: () => {}, sendTo: () => {}, send: () => {} };
  const win = { services: undefined, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  const ztools = makeZTools(ctx);
  const sandbox = {
    window: win,
    ztools,
    utools: ztools,
    location: { href: url, pathname: url.replace(/^file:\/\//, '') },
    process: { argv: [] },
    console,
    require: (id) => {
      if (id === 'electron') return { ipcRenderer: ipc };
      if (/lib[\\/]store\.js$/.test(id)) return storeShim;
      if (id.charAt(0) === '.') return require(path.resolve(PLUGIN_DIR, id));
      return require(id);
    },
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    Promise, Object, Array, Math, Date, JSON, String, Number, Boolean, Error, Map, Set, RegExp, isFinite, parseInt, parseFloat,
    TextDecoder, URL, Buffer, CustomEvent: class CustomEvent { constructor(t, o) { this.type = t; this.data = o; } }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'preload.js' });
  ctx.services = win.services;
  return ctx;
}

(async () => {
  // 只留一只持仓股 + 一只自选股，保证预置数据可预测
  dbMap.set('sb.transactions', [
    { id: 1, stock_code: '600961', stock_name: '株冶集团', type: 1, price: 10, quantity: 100, amount: 1000, total_price: 1000, created_at: '2026-01-05T01:30:00.000Z' }
  ]);
  dbMap.set('sb.watchlist', [
    { code: '600961', secid: '1.600961', name: '株冶集团', group: '默认' },
    { code: '300547', secid: '0.300547', name: '川环科技', group: '默认' }
  ]);
  dbMap.set('sb.settings', { refreshSec: 3, offSessionFetchOnce: false }); // 关掉非交易时段闸门：本测试专门验证反复拉取/过期重拉
  dbMap.delete('sb.latestQuotes');
  dbMap.delete('sb.quoteStamp');
  dbMap.delete('sb.latestIndexes');

  const main = runPreload('main', 'file:///plugin/index.html');
  const ball = runPreload('ball', 'file:///plugin/windows/ball.html');
  const panel = runPreload('panel', 'file:///plugin/windows/panel.html');
  await sleep(60);   // 等 createStore 内部的同步定时器落定

  ok(!!main.services && main.services.role === 'main', '主窗口 services.role=main');
  ok(!!ball.services && ball.services.role === 'ball', '球窗口 services.role=ball');
  ok(!!panel.services && panel.services.role === 'panel', '面板 services.role=panel');

  console.log('== 1. 三个窗口同一轮刷新：只允许 1 次网络请求 ==');
  calls.quotes = 0; calls.quotesTencent = 0; calls.indexes = 0;
  const mPos = await main.services.positions.get();
  const bPos = await ball.services.positions.get();
  const pPos = await panel.services.positions.get();
  ok(calls.ticks === 1, '三个窗口 positions.get() 只触发 1 次行情请求（之前是 3 次）', calls);
  ok(mPos.totalMarketValue === bPos.totalMarketValue && bPos.totalMarketValue === pPos.totalMarketValue,
    '复用缓存的持仓数值与首发窗口一致', { m: mPos.totalMarketValue, b: bPos.totalMarketValue, p: pPos.totalMarketValue });
  ok(bPos.positions.length === 1 && bPos.positions[0].stock_code === '600961', '球窗口拿到了正确的持仓');

  console.log('== 2. 自选股行情同样复用 ==');
  calls.ticks = 0;
  const mQ = await main.services.quotes();
  const bQ = await ball.services.quotes();
  const pQ = await panel.services.quotes();
  ok(calls.ticks === 1, '三个窗口 quotes() 只触发 1 次请求', calls);
  ok(mQ.length === 2 && bQ.length === 2 && pQ.length === 2, '三个窗口都拿到 2 条自选股', { m: mQ.length, b: bQ.length, p: pQ.length });  ok(mQ[0].code === bQ[0].code && bQ[0].code === pQ[0].code, '复用与首创返回同一批股票且顺序一致');
  ok(!!bQ[1].watchName, '复用路径也带上了自选股中文名（表格显示需要）');

  console.log('== 3. 指数行情复用 ==');
  calls.ticks = 0;
  const mI = await main.services.indexes();
  const bI = await ball.services.indexes();
  const pI = await panel.services.indexes();
  ok(calls.ticks === 1, '三个窗口 indexes() 只触发 1 次请求', calls);
  ok(mI.length === 1 && bI.length === 1 && pI.length === 1, '三个窗口都拿到指数数据');

  console.log('== 4. 新鲜度过期后必须重新拉取（不能一直吃旧缓存） ==');
  await sleep(2000);   // refreshSec=3 → 复用窗口 ≈ 1.8s，睡 2s 让它过期
  const before = calls.ticks;
  await ball.services.positions.get();
  ok(calls.ticks > before, '过期后球窗口自己重新请求行情', calls);

  console.log('== 5. force 参数绕过缓存（手动刷新按钮） ==');
  const q0 = await main.services.quotes();
  const before2 = calls.ticks;
  const q1 = await main.services.quotes({ force: true });
  ok(calls.ticks > before2, 'force=true 时一定重新请求', calls);
  ok(q1.length === q0.length, '强制刷新结果条数正常');

  console.log('== 5b. 三个窗口「同一瞬间」刷新也不能一起发请求（避免惊群） ==');
  await sleep(2200);            // 先让共享缓存过期
  calls.quotes = 0; calls.ticks = 0; calls.delayMs = 150;   // 模拟真实网络耗时
  const herd = await Promise.all([
    main.services.positions.get(),
    ball.services.positions.get(),
    panel.services.positions.get()
  ]);
  calls.delayMs = 0;
  ok(calls.ticks === 1, '同时发起时只有 1 个窗口真的发请求，其余等它的结果', calls);
  ok(herd[0].totalMarketValue === herd[2].totalMarketValue && herd[1].totalMarketValue === herd[2].totalMarketValue,
    '三个窗口拿到同一份行情', herd.map((x) => x.totalMarketValue));
  const herdQ = await Promise.all([main.services.quotes(), ball.services.quotes(), panel.services.quotes()]);
  ok(herdQ[0].length === herdQ[1].length && herdQ[1].length === herdQ[2].length, '等待协调后自选股条数一致');

  console.log('== 6. 代码覆盖不全时不复用（避免拿旧价糊弄） ==');
  dbMap.set('sb.watchlist', [
    { code: '600961', secid: '1.600961', name: '株冶集团', group: '默认' },
    { code: '300547', secid: '0.300547', name: '川环科技', group: '默认' },
    { code: '002570', secid: '0.002570', name: '贝因美', group: '默认' }
  ]);
  const before3 = calls.ticks;
  const q2 = await main.services.quotes();
  ok(calls.ticks > before3, '新增自选股（上次没覆盖）会重新请求', calls);
  ok(q2.length === 3, '重新请求后返回 3 条自选股', q2.length);

  console.log('== 7. 共享标记不落 JSON 文件（只走 dbStorage） ==');
  await sleep(30);
  ok(!!dbMap.get('sb.quoteStamp'), '标记写进了共享 dbStorage', dbMap.get('sb.quoteStamp'));

  console.log('');
  if (fail === 0) {
    console.log('✓ 跨窗口复用测试全部通过（' + pass + ' 项）');
    process.exit(0);
  } else {
    console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
})().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});

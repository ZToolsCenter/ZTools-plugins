/*
 * 非交易时段行情闸门测试。
 *
 * 用户反馈：收盘后三个窗口还在每几秒一轮地请求行情（东财收盘时段经常超时/502，
 * 一次失败链路挂几十秒，还伴随同步 dbStorage 往返，ZTools 显得卡）。
 * 期望：非交易时段只请求一次，之后全部吃缓存，直到下一次交易时段。
 *
 * preload.js 的实现：
 *  - offSessionGate(opts, kind)：非交易时段 + 本时段已成功拉过（offXAt 记档且
 *    不早于最近一个交易日 15:00）→ 直接返回缓存，零网络请求；
 *  - noteSessionFetched(kind)：非交易时段首次成功拉取后记档；交易时段成功刷新时清档；
 *  - 逃生口：force=true（手动刷新按钮）/ settings.offSessionFetchOnce === false（测试）。
 *
 * 本测试通过打桩 market.isTradingTime 控制交易/非交易状态（与真实时钟无关，
 * 任何时候跑结果都一致），并统计 market.quotes / market.indexes 的真实调用次数。
 *
 *   node tests/test-offsession-gate.js
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
  else { fail++; failures.push(label); console.log('  ✗ ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ---------------- 打桩 market.js ---------------- */
const market = require(path.join(PLUGIN_DIR, 'lib', 'market.js'));
const calls = { quotes: 0, indexes: 0 };
let trading = false; // false = 非交易时段（收盘/周末），true = 交易时段
market.isTradingTime = () => trading;
market.marketStatus = () => ({ open: trading, label: trading ? '交易中' : '休市' });

function codeOf(secid) { return String(secid).split('.').pop().replace(/[^\d]/g, ''); }
function fakeQuote(secid, i) {
  const code = codeOf(secid);
  return { code, name: 'X' + code, price: 10 + i, pct: 1.23, change: 0.1, prevClose: 10 + i - 0.1, open: 10, high: 11, low: 9, volume: 100, amount: 1000 };
}
market.quotes = async (secids) => { calls.quotes++; return (secids || []).map(fakeQuote); };
market.quotesTencent = market.quotes;
market.indexes = async () => { calls.indexes++; return [{ code: '1.000001', name: '上证指数', price: 3000, pct: 0.5 }]; };

/* ---------------- 隔离 store（绝不碰用户真实数据） ---------------- */
const storeReal = require(path.join(PLUGIN_DIR, 'lib', 'store.js'));
const storeShim = Object.assign({}, storeReal, { createStore: (db) => storeReal.createStore(db, { isolated: true }) });

const dbMap = new Map();
dbMap.set('sb.watchlist', [
  { code: '600961', secid: '1.600961', name: '株冶集团', group: '默认' },
  { code: '300547', secid: '0.300547', name: '川环科技', group: '默认' }
]);
// 持仓故意用一只「不在自选里」的股票：让 positions 的代码集合不被自选拉取覆盖，
// 这样它的网络调用次数能被独立观察（否则会走跨窗口复用，测不出闸门本身）
dbMap.set('sb.transactions', [
  { id: 1, stock_code: '000001', stock_name: '测试股', type: 1, price: 10, quantity: 100, amount: 1000, total_price: 1000, created_at: '2026-01-05T01:30:00.000Z' }
]);
// 不设 offSessionFetchOnce → 默认 true（闸门开启）

function runPreload(url) {
  const src = fs.readFileSync(path.join(PLUGIN_DIR, 'preload.js'), 'utf8');
  const ipc = { on: () => {}, sendTo: () => {}, send: () => {} };
  const win = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  const ztools = {
    dbStorage: {
      getItem: (k) => (dbMap.has(k) ? dbMap.get(k) : null),
      setItem: (k, v) => dbMap.set(k, v),
      removeItem: (k) => dbMap.delete(k)
    },
    getWebContentsId: () => 7,
    showNotification() {}, isWindows: () => true,
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }),
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }),
    sendToParent() {}, outPlugin() {}, hideMainWindow() {},
    createBrowserWindow: () => null, onPluginEnter() {}, onPluginOut() {}
  };
  const sandbox = {
    window: win, ztools, utools: ztools,
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
    TextDecoder, URL, Buffer, CustomEvent: class { constructor(t, o) { this.type = t; this.data = o; } }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'preload.js' });
  return win.services;
}

// 关掉跨窗口「新鲜度复用」：每次断言「闸门拦截」前清掉时间戳，
// 保证「没有发请求」只可能来自闸门，而不是新鲜度缓存（否则测了个寂寞）
function expireFreshness() {
  const st = Object.assign({}, dbMap.get('sb.quoteStamp') || {}, { at: 0, pendingAt: 0, idxAt: 0 });
  dbMap.set('sb.quoteStamp', st);
}
function stamp() { return Object.assign({}, dbMap.get('sb.quoteStamp') || {}); }

(async () => {
  trading = false;
  const S = runPreload('file:///plugin/windows/panel.html');
  await sleep(50);
  ok(!!S && S.role === 'panel', 'panel 上下文启动', S && S.role);

  console.log('== 1. 非交易时段：自选行情只请求一次 ==');
  const q1 = await S.quotes();
  ok(calls.quotes === 1, '第一次调用真的发了请求', calls);
  expireFreshness();
  const q2 = await S.quotes();
  ok(calls.quotes === 1, '第二次调用被闸门拦截（零请求）', calls);
  ok(q1.length === 2 && q2.length === 2 && q2[0].price !== undefined, '拦截时返回的仍是完整缓存数据', q2);
  ok(!!stamp().offQAt, '记档 offQAt 已写入', stamp());

  console.log('== 2. 非交易时段：持仓行情只请求一次 ==');
  const p1 = await S.positions.get();
  ok(calls.quotes === 2, '持仓首次拉取发了独立请求（代码集合与自选不同）', calls);
  expireFreshness();
  const p2 = await S.positions.get();
  ok(calls.quotes === 2, '持仓第二次被闸门拦截（零请求）', calls);
  ok(p1.totalMarketValue === p2.totalMarketValue && p2.positions.length === 1 && p2.positions[0].stock_code === '000001',
    '拦截时持仓缓存数据完整一致', { mv: p2.totalMarketValue, n: p2.positions.length });
  ok(!!stamp().offPAt, '持仓记档 offPAt 已写入', stamp());

  console.log('== 3. 非交易时段：指数只请求一次 ==');
  const i1 = await S.indexes();
  ok(calls.indexes === 1, '指数首次拉取发出请求', calls);
  expireFreshness();
  const i2 = await S.indexes();
  ok(calls.indexes === 1, '指数第二次被闸门拦截（零请求）', calls);
  ok(i1.length === i2.length && i2.length === 1, '拦截时指数缓存可用', i2);
  ok(!!stamp().offIAt, '指数记档 offIAt 已写入', stamp());

  console.log('== 4. force=true（手动刷新按钮）放行 ==');
  await S.quotes({ force: true });
  ok(calls.quotes === 3, '非交易时段手动强制刷新仍然发请求', calls);

  console.log('== 5. 进入交易时段：恢复刷新并清掉收盘记档 ==');
  trading = true;
  expireFreshness();
  await S.quotes();
  ok(calls.quotes === 4, '交易时段正常请求', calls);
  ok(!stamp().offQAt, '交易时段成功刷新后 offQAt 被清零（下次收盘重新记档）', stamp());

  console.log('== 6. 再次收盘：重新放行一次，然后继续拦截 ==');
  trading = false;
  expireFreshness();
  await S.quotes();
  ok(calls.quotes === 5, '新收盘时段的第一次拉取被放行', calls);
  expireFreshness();
  await S.quotes();
  ok(calls.quotes === 5, '随后继续拦截（零请求）', calls);

  console.log('== 7. 跨过收盘的旧记档自动失效 ==');
  // 模拟「记档是4天前的」：上一次交易日15:00 之后没再拉过 → 必须重新拉一次
  dbMap.set('sb.quoteStamp', Object.assign(stamp(), { offQAt: Date.now() - 4 * 24 * 3600 * 1000 }));
  expireFreshness();
  await S.quotes();
  ok(calls.quotes === 6, '旧记档失效后重新请求（不会拿几天前的收盘数据糊弄）', calls);
  expireFreshness();
  await S.quotes();
  ok(calls.quotes === 6, '拉完新数据后恢复拦截', calls);

  console.log('== 8. 总开关 offSessionFetchOnce=false 可整体关掉闸门 ==');
  dbMap.set('sb.settings', Object.assign({}, dbMap.get('sb.settings') || {}, { offSessionFetchOnce: false }));
  expireFreshness();
  await S.quotes();
  expireFreshness();
  await S.quotes();
  ok(calls.quotes === 8, '关掉闸门后非交易时段照常每轮请求', calls);

  console.log('');
  if (fail === 0) {
    console.log('✓ 非交易时段行情闸门测试全部通过（' + pass + ' 项）');
    process.exit(0);
  }
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
})().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});

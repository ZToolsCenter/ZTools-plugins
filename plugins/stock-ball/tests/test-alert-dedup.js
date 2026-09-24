/*
 * 回归测试：一条预警只能提醒一次（跨窗口 / 跨数据源去重）。
 *
 * 背景（用户反馈）：设置了一条预警，却弹了两次通知。原因有两个：
 *   1) 同一条预警会被评估两次：`quotes()`（自选行情）和 `positions.get()`（持仓）各评估一次，
 *      而这两批代码集合不同，跨窗口复用的「代码覆盖」判断因此失效 → 两个窗口各自真的发了请求；
 *   2) 通知冷却表 `alertCooldowns` 是模块级的，即每个窗口各有一份，互不知情
 *      → 每个窗口都能弹一次 → 一只既在持仓又在自选的股票就弹 2 次。
 *
 * 修复：冷却时间写进共享 dbStorage（sb.alertCooldowns），谁先提醒谁占坑，
 * 其它窗口在同一冷却期内一律静默。
 *
 *   node tests/test-alert-dedup.js
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

/* ---------------- 交易时段判定：路径测试里恒为「交易中」，专项测试再换回真实实现 ---------------- */
const market = require(path.join(PLUGIN_DIR, 'lib', 'market.js'));
const realIsTradingTime = market.isTradingTime;
market.isTradingTime = () => true;
const T0 = Date.now();
const calls = { ticks: 0 };
function codeOf(secid) { return String(secid).split('.').pop().replace(/[^\d]/g, ''); }
function fakeQuote(code, price) {
  return { code, name: 'X' + code, price, pct: 1.23, change: 0.1, prevClose: price, open: price, high: price, low: price, volume: 100, amount: 1000 };
}
market.quotes = async (secids) => { calls.ticks++; return (secids || []).map((s) => fakeQuote(codeOf(s), 10)); };
market.quotesTencent = async (secids) => { calls.ticks++; return (secids || []).map((s) => fakeQuote(codeOf(s), 10)); };
market.indexes = async () => { calls.ticks++; return []; };

/* ---------------- 假 ZTools 宿主（多窗口共享一份 dbStorage） ---------------- */
const storeReal = require(path.join(PLUGIN_DIR, 'lib', 'store.js'));
const storeShim = Object.assign({}, storeReal, {
  createStore: (db) => storeReal.createStore(db, { isolated: true })
});

const dbMap = new Map();
let nextId = 1;
const notified = [];      // 所有窗口弹出的桌面通知
let notifyWindow = null;  // 记录是哪个窗口弹的

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
    showNotification: (text) => { notified.push({ by: ctx.role, text }); notifyWindow = ctx.role; },
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
  const ctx = { id: ++nextId, role };
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
  // 一只股票 600961：既在持仓、又在自选；预警「跌破 50 元」，而行情价是 10 元 → 必触发
  dbMap.set('sb.transactions', [
    { id: 1, stock_code: '600961', stock_name: '株冶集团', type: 1, price: 10, quantity: 100, amount: 1000, total_price: 1000, created_at: '2026-01-05T01:30:00.000Z' }
  ]);
  dbMap.set('sb.watchlist', [
    { code: '600961', secid: '1.600961', name: '株冶集团', group: '默认' },
    { code: '300547', secid: '0.300547', name: '川环科技', group: '默认' }
  ]);
  dbMap.set('sb.settings', { refreshSec: 3, offSessionFetchOnce: false }); // 关掉非交易时段闸门：本测试要多轮拉取验证通知去重
  dbMap.set('sb.alerts', [{
    stock_code: '600961', stock_name: '株冶集团',
    high_price: 0, low_price: 50, high_change: 0, low_change: 0,
    notification_interval: 5, enabled: true, updated_at: T0
  }]);
  ['sb.latestQuotes', 'sb.quoteStamp', 'sb.latestIndexes', 'sb.alertCooldowns'].forEach((k) => dbMap.delete(k));

  const main = runPreload('main', 'file:///plugin/index.html');
  const ball = runPreload('ball', 'file:///plugin/windows/ball.html');
  const panel = runPreload('panel', 'file:///plugin/windows/panel.html');
  await sleep(60);   // 等 createStore 内部同步定时器落定

  console.log('== 1. 持仓行情路径触发一次预警 ==');
  notified.length = 0;
  await main.services.positions.get();
  ok(notified.length === 1, '主窗口拉持仓行情后弹出 1 条预警', notified.map((n) => n.by));
  ok(notified[0] && /株冶集团/.test(notified[0].text) && /跌破目标低价/.test(notified[0].text), '通知内容正确', notified[0] && notified[0].text);

  console.log('== 2. 该股票同时在自选行情里：不能因为换了数据源就再提醒一次 ==');
  await ball.services.quotes();
  await panel.services.quotes();
  ok(notified.length === 1, '自选行情路径（球/面板窗口）不再重复提醒', notified.map((n) => n.by));

  console.log('== 3. 其它窗口拉持仓行情也不能重复提醒 ==');
  await ball.services.positions.get();
  await panel.services.positions.get();
  ok(notified.length === 1, '球/面板的持仓行情路径静默', notified.map((n) => n.by));

  console.log('== 4. 冷却期内手动再评估：静默 ==');
  const qMap = { '600961': { code: '600961', name: '株冶集团', price: 10, pct: 0 } };
  main.services.alerts.evaluate(qMap, { currentTime: T0 + 60000, ignoreTradingTime: true });
  ball.services.alerts.evaluate(qMap, { currentTime: T0 + 60000, ignoreTradingTime: true });
  ok(notified.length === 1, '1 分钟后（冷却 5 分钟）两个窗口都静默', notified.map((n) => n.by));

  console.log('== 5. 冷却期过后允许再次提醒（只提醒一次，不是每窗口一次） ==');
  main.services.alerts.evaluate(qMap, { currentTime: T0 + 6 * 60000, ignoreTradingTime: true });
  ball.services.alerts.evaluate(qMap, { currentTime: T0 + 6 * 60000, ignoreTradingTime: true });
  panel.services.alerts.evaluate(qMap, { currentTime: T0 + 6 * 60000, ignoreTradingTime: true });
  ok(notified.length === 2, '超过 5 分钟冷却后重新提醒，且三个窗口合计只弹 1 条', notified.map((n) => n.by));

  console.log('== 6. 通知间隔按预警自身设置生效（10 分钟） ==');
  await main.services.alerts.save({ stock_code: '600961', stock_name: '株冶集团', low_price: 50, notification_interval: 10, enabled: true });
  notified.length = 0;
  // 重新保存预警（改了目标价）会重新武装它：条件成立就能立刻提醒，不用等上一个冷却期
  main.services.alerts.evaluate(qMap, { currentTime: T0 + 7 * 60000, ignoreTradingTime: true });
  ok(notified.length === 1, '重新设置预警后立刻可以提醒', notified.map((n) => n.by));
  main.services.alerts.evaluate(qMap, { currentTime: T0 + 11 * 60000, ignoreTradingTime: true });
  ball.services.alerts.evaluate(qMap, { currentTime: T0 + 11 * 60000, ignoreTradingTime: true });
  ok(notified.length === 1, '之后 10 分钟内绝不重复提醒（跨窗口合计仍只弹 1 次）', notified.map((n) => n.by));
  main.services.alerts.evaluate(qMap, { currentTime: T0 + 18 * 60000, ignoreTradingTime: true });
  ball.services.alerts.evaluate(qMap, { currentTime: T0 + 18 * 60000, ignoreTradingTime: true });
  ok(notified.length === 2, '超过 10 分钟后允许再次提醒', notified.map((n) => n.by));

  console.log('== 7. 删除预警后不再提醒（跨窗口即时生效） ==');
  main.services.alerts.delete('600961');
  notified.length = 0;
  ball.services.alerts.evaluate(qMap, { currentTime: T0 + 60 * 60000, ignoreTradingTime: true });
  panel.services.alerts.evaluate(qMap, { currentTime: T0 + 60 * 60000, ignoreTradingTime: true });
  ok(notified.length === 0, '预警删除后球/面板窗口的评估不再弹通知', notified.map((n) => n.by));
  ok(dbMap.get('sb.alerts').length === 0, '共享存储里的预警已被清空', dbMap.get('sb.alerts'));
  ok(!Object.keys(storeShim.createStore(fakeDbStorage()).getAlertCooldowns()).some((k) => k.indexOf('600961') === 0),
    '删除预警同时清掉它的冷却记录（重新设置后可立刻提醒）', Object.keys(dbMap.get('sb.alertCooldowns') || {}));

  console.log('== 8. 非交易时段静默（真实 isTradingTime，不是测试副本） ==');
  await main.services.alerts.save({ stock_code: '600961', stock_name: '株冶集团', low_price: 50, notification_interval: 5, enabled: true });
  market.isTradingTime = realIsTradingTime;
  notified.length = 0;
  const noon = new Date(2026, 8, 21, 12, 0, 0).getTime();
  const afterHours = new Date(2026, 8, 21, 20, 0, 0).getTime();
  const trading = new Date(2026, 8, 21, 10, 0, 0).getTime();
  main.services.alerts.evaluate(qMap, { currentTime: noon });
  ball.services.alerts.evaluate(qMap, { currentTime: afterHours });
  ok(notified.length === 0, '午休 / 盘后不弹通知', notified.map((n) => n.by));
  main.services.alerts.evaluate(qMap, { currentTime: trading });
  ok(notified.length === 1, '交易时段正常弹通知', notified.map((n) => n.by));
  market.isTradingTime = () => true;

  console.log('== 9. 从自选行情删掉股票 = 同时取消它的预警（否则持仓路径会继续提醒） ==');
  await main.services.alerts.save({ stock_code: '600961', stock_name: '株冶集团', low_price: 50, notification_interval: 5, enabled: true });
  main.services.watchlist.remove('600961');
  ok(!main.services.watchlist.get().some((x) => x.code === '600961'), '股票已从自选列表移除');
  ok(!main.services.alerts.get().some((a) => a.stock_code === '600961'), '它的预警记录也一并删掉了', main.services.alerts.get());
  notified.length = 0;
  await main.services.positions.get();        // 持仓行情路径仍会拉到它的行情
  await ball.services.positions.get();
  ok(notified.length === 0, '删掉之后即使还在持仓，也不会再提醒', notified.map((n) => n.by));
  ok(!Object.keys(storeShim.createStore(fakeDbStorage()).getAlertCooldowns()).some((k) => k.indexOf('600961') === 0),
    '它的冷却记录也被清掉', Object.keys(dbMap.get('sb.alertCooldowns') || {}));

  console.log('== 10. 冷却表只走共享 dbStorage，不写坏 JSON 文件 ==');
  await sleep(30);
  ok(!!dbMap.get('sb.alertCooldowns'), '冷却表写进了共享 dbStorage', Object.keys(dbMap.get('sb.alertCooldowns') || {}));
  const store = storeShim.createStore(fakeDbStorage());
  ok(typeof store.getAlertCooldowns === 'function' && typeof store.setAlertCooldowns === 'function',
    'store 暴露了共享冷却表的读写接口');

  console.log('');
  if (fail === 0) {
    console.log('✓ 预警去重测试全部通过（' + pass + ' 项）');
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

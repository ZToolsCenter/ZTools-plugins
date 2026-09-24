/*
 * 已清仓显示 + K线（当日K线/历史K线）功能测试。
 *
 * 需求：
 *  1) 持仓页要有「已清仓」股票的显示（折叠区，含清仓日期与累计盈亏）；
 *  2) 持仓 / 自选行情 / 已清仓 三处的股票都能打开 K线弹窗，
 *     分「当日K线」（当日5分钟蜡烛）与「历史K线」（日K蜡烛）两个页签。
 *
 * 数据链路：
 *  store.getClosedPositions → preload positions.getClosed → index.js renderClosed
 *  market.kline(code, {klt,lmt}) → preload services.kline → index.js loadKline → ECharts 懒加载渲染
 *
 *   node tests/test-kline-and-closed.js
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

/* ---------------- 1. market.kline：klt/lmt 参数（先打桩 httpclient 再加载 market） ---------------- */
const httpclient = require(path.join(PLUGIN_DIR, 'lib', 'httpclient.js'));
const capturedUrls = [];
let failMinute = false;
httpclient.httpGetJSON = async (url) => {
  if (failMinute && String(url).indexOf('klt=5') >= 0) throw new Error('模拟分钟K失败');
  capturedUrls.push(String(url));
  if (String(url).indexOf('push2his.eastmoney.com') >= 0) {
    return { data: { name: '株冶集团', klines: [
      '2026-09-22 09:35,10.10,10.20,10.35,10.05,50000,51000,0',
      '2026-09-22 09:40,10.20,10.15,10.30,10.10,40000,40800,0'
    ] } };
  }
  throw new Error('意外请求: ' + url);
};
const market = require(path.join(PLUGIN_DIR, 'lib', 'market.js'));

(async () => {
  console.log('== 1. market.kline 支持 klt/lmt（当日分钟K） ==');
  capturedUrls.length = 0;
  const day5 = await market.kline('600961', { klt: 5, lmt: 400 });
  ok(capturedUrls.length === 1 && capturedUrls[0].indexOf('klt=5') >= 0, '当日K线请求带 klt=5', capturedUrls);
  ok(capturedUrls[0].indexOf('lmt=400') >= 0, 'lmt 透传到请求 URL', capturedUrls[0].slice(-60));
  ok(day5.length === 2 && day5[0].date.indexOf('09:35') > 0, '分钟K日期带时间', day5[0] && day5[0].date);
  ok(day5[0].open === 10.1 && day5[0].close === 10.2 && day5[0].high === 10.35 && day5[0].low === 10.05 && day5[0].volume === 50000, 'OHLCV 映射正确', day5[0]);

  capturedUrls.length = 0;
  await market.kline('600961');
  ok(capturedUrls.length === 1 && capturedUrls[0].indexOf('klt=101') >= 0, '默认仍是历史日K klt=101', capturedUrls[0].slice(-40));

  failMinute = true;
  const missing = await market.kline('600961', { klt: 5 });
  ok(Array.isArray(missing) && missing.length === 0, '分钟K失败不走腾讯日K兜底，返回空数组', missing);
  failMinute = false;

  console.log('== 2. store.getClosedPositions：清仓日期与内容 ==');
  const storeReal = require(path.join(PLUGIN_DIR, 'lib', 'store.js'));
  const dbMap = new Map();
  const store = storeReal.createStore({
    getItem: (k) => (dbMap.has(k) ? dbMap.get(k) : null),
    setItem: (k, v) => dbMap.set(k, v),
    removeItem: (k) => dbMap.delete(k)
  }, { isolated: true });

  const YDAY = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const TODAY = new Date().toISOString();
  dbMap.set('sb.transactions', [
    // 已清仓 A：买600@10 → 今天600@12 全卖，赚 1200 (20%)
    { id: 1, stock_code: '600961', stock_name: '株冶集团', type: 1, price: 10, quantity: 600, amount: 6000, total_price: 6000, created_at: YDAY },
    { id: 2, stock_code: '600961', stock_name: '株冶集团', type: 2, price: 12, quantity: 600, amount: 7200, total_price: 7200, created_at: TODAY },
    // 已清仓 B：更早清仓
    { id: 3, stock_code: '300547', stock_name: '川环科技', type: 1, price: 20, quantity: 100, amount: 2000, total_price: 2000, created_at: '2026-06-01T01:00:00.000Z' },
    { id: 4, stock_code: '300547', stock_name: '川环科技', type: 2, price: 18, quantity: 100, amount: 1800, total_price: 1800, created_at: '2026-06-10T01:00:00.000Z' },
    // 仍在持仓：只有买
    { id: 5, stock_code: '000001', stock_name: '还在拿', type: 1, price: 5, quantity: 100, amount: 500, total_price: 500, created_at: YDAY }
  ]);

  const closed = store.getClosedPositions();
  ok(closed.length === 2, '两只已清仓、持仓中的不掺进来', closed.map((c) => c.stock_code));
  const a = closed.find((c) => c.stock_code === '600961');
  const b = closed.find((c) => c.stock_code === '300547');
  ok(!!a && a.profit_loss === 1200 && a.profit_loss_rate === 20, '清仓盈亏/收益率计算正确', a && { pl: a.profit_loss, r: a.profit_loss_rate });
  ok(!!a && a.closed_at === new Date(TODAY).toISOString().slice(0, 10), 'closed_at = 最后卖出日期', a && a.closed_at);
  ok(!!b && b.profit_loss === -200 && b.closed_at === '2026-06-10', '更早清仓的日期也对', b && { pl: b.profit_loss, at: b.closed_at });

  // index.js renderClosed 的排序：closed_at 倒序（最新清仓在上）
  const sorted = closed.slice().sort((x, y) => String(y.closed_at || '').localeCompare(String(x.closed_at || '')));
  ok(sorted[0].stock_code === '600961', '按清仓日期倒序（最新在最上）', sorted.map((s) => s.closed_at));

  console.log('== 3. preload services.kline 透传 klt/lmt（且不被非交易时段闸门拦截） ==');
  market.isTradingTime = () => false; // 假装收盘
  const storeShim = Object.assign({}, storeReal, { createStore: (db) => storeReal.createStore(db, { isolated: true }) });
  const db2 = new Map();
  db2.set('sb.watchlist', [{ code: '600961', secid: '1.600961', name: '株冶集团', group: '默认' }]);
  db2.set('sb.quoteStamp', { at: Date.now(), codes: ['600961'], offQAt: Date.now(), offPAt: Date.now(), offIAt: Date.now() }); // 三类都已记档 → 闸门全关，K线应照样请求

  const src = fs.readFileSync(path.join(PLUGIN_DIR, 'preload.js'), 'utf8');
  const ipc = { on: () => {}, sendTo: () => {}, send: () => {} };
  const win = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  const ztools = {
    dbStorage: {
      getItem: (k) => (db2.has(k) ? db2.get(k) : null),
      setItem: (k, v) => db2.set(k, v),
      removeItem: (k) => db2.delete(k)
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
    location: { href: 'file:///plugin/windows/panel.html', pathname: '/windows/panel.html' },
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
  const S = win.services;
  await sleep(30);
  ok(!!S && typeof S.kline === 'function', 'preload 暴露 services.kline');
  ok(typeof S.positions.getClosed === 'function', 'preload 暴露 positions.getClosed');

  capturedUrls.length = 0;
  const kl = await S.kline('600961', { klt: 5, lmt: 400 });
  ok(capturedUrls.length === 1 && capturedUrls[0].indexOf('klt=5') >= 0,
    '收盘时段 K线照发（点开才拉，不受非交易时段闸门限制）', capturedUrls.length);
  ok(Array.isArray(kl) && kl.length === 2, 'services.kline 返回数据', kl.length);

  console.log('== 4. 界面接线静态检查 ==');
  const idxHtml = fs.readFileSync(path.join(PLUGIN_DIR, 'index.html'), 'utf8');
  const idxJs = fs.readFileSync(path.join(PLUGIN_DIR, 'index.js'), 'utf8');
  const idxCss = fs.readFileSync(path.join(PLUGIN_DIR, 'index.css'), 'utf8');
  const stoSrc = fs.readFileSync(path.join(PLUGIN_DIR, 'lib', 'store.js'), 'utf8');

  ok(idxHtml.includes('id="kChartModal"'), 'index.html 有 K线弹窗');
  ok(idxHtml.includes('data-kline-tab="5"') && idxHtml.includes('data-kline-tab="101"'), '有 当日K线/历史K线 两个页签');
  ok(idxHtml.includes('id="kChartBox"') && idxHtml.includes('id="btnKClose"'), '有图表容器与关闭按钮');
  ok(idxHtml.includes('id="viewClosed"') && idxHtml.includes('id="closedTableHeader"') && idxHtml.includes('id="closedEmpty"'), 'index.html 有已清仓独立视图（表头+空态，与持仓页同结构）');
  ok(idxHtml.includes('id="tabClosed"') && idxHtml.includes('id="closedCountBadge"'), '顶部「已清仓」标签按钮 + 数量徽标');
  {
    const iP = idxHtml.indexOf('id="tabPositions"');
    const iC = idxHtml.indexOf('id="tabClosed"');
    const iW = idxHtml.indexOf('id="tabWatchlist"');
    ok(iP > 0 && iC > iP && iC < iW, '按钮位置正确：紧挨「我的持仓」右边、自选行情左边', { iP, iC, iW });
  }
  ok(idxHtml.includes('暂无已清仓股票'), '空态文案在视图里（与持仓页空态一致）');
  ok(!idxHtml.includes('closedModal') && !idxHtml.includes('btnClosedPos'), '不再以弹窗形式展示');
  ok(!idxHtml.includes('posBody') && !idxHtml.includes('closedWrap'), '临时侧栏结构不存在');
  ok(idxJs.includes('function openKChart') && idxJs.includes('function renderKChart'), 'index.js 有打开/渲染K线的函数');
  ok(idxJs.includes("s.src = 'echarts.min.js'"), 'echarts 懒加载指向插件根目录组件');
  ok(idxJs.includes('function renderClosed'), 'index.js 有已清仓渲染函数');
  ok(idxJs.includes("['positions', 'closed', 'watchlist', 'settings']"), 'switchTab 注册了 closed 视图');
  ok(idxJs.includes("switchTab('closed')"), '导航按钮点击切换到已清仓视图');
  ok(idxJs.includes('ovClosedPl') && idxJs.includes('ovClosedCount') && idxJs.includes('ovClosedLast'), '概览三张卡随数据更新');
  ok(idxJs.includes('closedCountBadge'), '徽标数量随数据更新');
  ok(!idxJs.includes('closedModal') && !idxJs.includes('openClosedModal'), 'index.js 无弹窗残留');
  ok(idxJs.includes('data-act="kline"'), '持仓行有📈K线按钮');
  ok(idxJs.includes('data-op="k"'), '自选行有📈K线按钮');
  ok(idxJs.includes('data-kact="k"'), '已清仓行有📈K线按钮');
  ok(idxJs.includes('positions.getClosed'), 'refresh 拉取已清仓数据');
  ok(idxJs.includes("colCssParts.push('150px')"), '持仓操作列已加宽到150px（容纳第4个按钮）');
  ok(idxJs.includes('kChartState.klt = Number(') && idxJs.includes('syncKTabs'), '页签切换事件已接线');
  ok(idxCss.includes('.kChartBox') && idxCss.includes('.closedRow'), 'K线弹窗与已清仓样式存在');
  ok(!idxCss.includes('.posBody') && !idxCss.includes('.closedWrap') && !idxCss.includes('.crEmpty'), '侧栏/弹窗样式已移除');
  ok(idxCss.includes('.closedTableHeader') && idxCss.includes('.closedRow') && idxCss.includes('.closedList'), '已清仓视图表头/行/列表样式存在（镜像持仓表样式）');
  ok(idxCss.includes('150px'), 'CSS 操作列宽度150px');
  ok(stoSrc.includes('closed_at: closedAt'), 'store 输出 closed_at 清仓日期');

  console.log('');
  if (fail === 0) {
    console.log('✓ 已清仓与K线功能测试全部通过（' + pass + ' 项）');
    process.exit(0);
  }
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
})().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});

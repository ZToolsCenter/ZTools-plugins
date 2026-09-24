/*
 * 窗口脚本「真机启动」冒烟测试。
 *
 * 背景：windows/panel.js 之前因为少了一个 `});`（HEAD 里就存在），整个脚本
 * 连语法检查都过不了 —— 面板窗口其实一直是死的。修好之后这段代码第一次真正执行，
 * 所以必须真的把它跑一遍：用假 DOM + 真实 preload services 启动，看有没有运行时异常。
 *
 * 假 DOM 刻意「严格」：getElementById 只认 HTML 里真实存在的 id，
 * 这样脚本里写错 id、或依赖某个已被删掉的元素，会像浏览器一样直接暴露出来。
 *
 *   node tests/test-window-dom-boot.js
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

/* ==================== 1. 假 DOM ==================== */
const VOID_TAGS = new Set(['input', 'br', 'img', 'hr', 'meta', 'link', 'canvas', 'source', 'col']);
const dynamicIds = [];

function makeStyle() {
  const o = {};
  o.setProperty = (k, v) => { o[k] = v; };
  o.getPropertyValue = (k) => (k in o ? o[k] : '');
  o.removeProperty = (k) => { delete o[k]; };
  return o;
}

function canvasCtx() {
  const noop = () => {};
  return new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return { width: 200, height: 100 };
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop });
      if (k === 'getImageData') return () => ({ data: [] });
      if (!(k in t)) t[k] = noop;
      return t[k];
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

class El {
  constructor(tag, id) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.id = id || '';
    this._cls = new Set();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = makeStyle();
    this.attrs = {};
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.checked = false;
    this.textContent = '';
    this._html = '';
    this._listeners = {};
    this.clientWidth = 320; this.clientHeight = 200;
    this.offsetWidth = 320; this.offsetHeight = 200;
    this.scrollTop = 0; this.scrollLeft = 0;
    this.scrollHeight = 600; this.scrollWidth = 320;
    this.width = 200; this.height = 100;
  }
  get className() { return Array.from(this._cls).join(' '); }
  set className(v) { this._cls = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  get classList() {
    const self = this;
    return {
      add() { for (const c of arguments) self._cls.add(c); },
      remove() { for (const c of arguments) self._cls.delete(c); },
      toggle(c, force) {
        const on = force === undefined ? !self._cls.has(c) : !!force;
        if (on) self._cls.add(c); else self._cls.delete(c);
        return on;
      },
      contains(c) { return self._cls.has(c); }
    };
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) {
    this._html = String(v);
    this.children = [];
    // 像浏览器一样把标签解析成子元素：否则 querySelectorAll('.row') 之类的绑定永远测不到
    parseHtml(this._html).forEach((c) => this.appendChild(c));
  }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  removeEventListener(t, fn) {
    if (!this._listeners[t]) return;
    this._listeners[t] = this._listeners[t].filter((x) => x !== fn);
  }
  listenerCount(t) { return (this._listeners[t] || []).length; }
  fire(t, ev) {
    const e = Object.assign({ type: t, target: this, preventDefault() {}, stopPropagation() {}, key: '', button: 0 }, ev || {});
    (this._listeners[t] || []).slice().forEach((fn) => fn(e));
    return e;
  }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  removeAttribute(n) { delete this.attrs[n]; }
  hasAttribute(n) { return n in this.attrs; }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  insertBefore(c) { this.children.unshift(c); c.parentNode = this; return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
  contains(el) { return el === this; }
  closest() { return this; }
  matches() { return false; }
  querySelector(sel) { return this._match(sel)[0] || null; }
  querySelectorAll(sel) { return this._match(sel); }
  _match(sel) {
    const s = String(sel || '').trim();
    const hit = (el) => {
      if (s.charAt(0) === '#') return el.id === s.slice(1);
      if (s.charAt(0) === '.') return el._cls.has(s.slice(1));
      if (s.charAt(0) === '[') return s.slice(1, -1).split('=')[0] in el.attrs;
      return el.tagName === s.toUpperCase();
    };
    const out = [];
    const walk = (el) => el.children.forEach((c) => { if (hit(c)) out.push(c); walk(c); });
    walk(this);
    return out;
  }
  getBoundingClientRect() { return { top: 0, left: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight, x: 0, y: 0 }; }
  getContext() { return canvasCtx(); }
  focus() {} blur() {} click() { this.fire('click'); } scrollIntoView() {}
}

function parseAttrs(el, raw) {
  const re = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(raw))) {
    const name = m[1];
    const val = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : ''));
    el.attrs[name] = val;
    if (name === 'class') el.className = val;
    else if (name === 'id') { el.id = val; dynamicIds.push(val); }
    else if (name.indexOf('data-') === 0) el.dataset[name.slice(5)] = val;
    else if (name === 'checked' || name === 'disabled' || name === 'hidden') el[name] = true;
    else if (name === 'value') el.value = val;
  }
  return el;
}

function parseHtml(html) {
  const root = new El('div', '');
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;
  let last = 0;
  let m;
  while ((m = re.exec(html))) {
    const text = html.slice(last, m.index);
    last = re.lastIndex;
    if (text.trim()) {
      const t = new El('#text', '');
      t.textContent = text;
      stack[stack.length - 1].appendChild(t);
    }
    if (m[0].indexOf('<!--') === 0) continue;
    if (m[1]) {
      const tag = m[1].toUpperCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === tag) { stack.length = i; break; }
      }
      continue;
    }
    const el = parseAttrs(new El(m[2], ''), m[3] || '');
    stack[stack.length - 1].appendChild(el);
    if (!m[4] && !VOID_TAGS.has(String(m[2]).toLowerCase())) stack.push(el);
  }
  const rest = html.slice(last);
  if (rest.trim()) {
    const t = new El('#text', '');
    t.textContent = rest;
    root.appendChild(t);
  }
  return root.children;
}

function makeDom(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const registry = new Map();
  ids.forEach((id) => registry.set(id, new El('div', id)));
  const documentElement = new El('html', '');
  const body = new El('body', '');

  const document = {
    readyState: 'complete',
    documentElement,
    body,
    hidden: false,
    _listeners: {},
    getElementById(id) { return registry.get(id) || null; },   // 严格：不存在就是 null
    querySelector(sel) {
      const s = String(sel || '');
      if (s.charAt(0) === '#') return registry.get(s.slice(1)) || null;
      return null;
    },
    querySelectorAll() { return []; },
    createElement(tag) { return new El(tag, ''); },
    createDocumentFragment() { return new El('fragment', ''); },
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    removeEventListener() {},
    fire(t, ev) { (this._listeners[t] || []).slice().forEach((fn) => fn(Object.assign({ type: t, preventDefault() {} }, ev || {}))); },
    get _registry() { return registry; }
  };
  return { document, documentElement, registry, ids };
}

/* ==================== 2. 真实 preload services ==================== */
const marketPath = require.resolve(path.join(PLUGIN_DIR, 'lib', 'market.js'));
const market = require(marketPath);
const calls = { quotes: 0, indexes: 0 };
function fakeQuote(secid, i) {
  const code = String(secid).split('.').pop();
  return { code, name: 'N' + code, price: 10 + i, pct: 1.5, change: 0.15, prevClose: 9.9, open: 10, high: 10.5, low: 9.8, volume: 1000, amount: 10000 };
}
market.quotes = async (secids) => { calls.quotes++; return (secids || []).map(fakeQuote); };
market.quotesTencent = market.quotes;
market.indexes = async () => { calls.indexes++; return [{ code: '1.000001', name: '上证指数', price: 3100, pct: 0.42 }]; };

const storeReal = require(path.join(PLUGIN_DIR, 'lib', 'store.js'));
const storeShim = Object.assign({}, storeReal, { createStore: (db) => storeReal.createStore(db, { isolated: true }) });

const dbMap = new Map();
dbMap.set('sb.watchlist', [
  { code: '600961', secid: '1.600961', name: '株冶集团', group: '默认' },
  { code: '300547', secid: '0.300547', name: '川环科技', group: '默认' }
]);
dbMap.set('sb.transactions', [
  { id: 1, stock_code: '600961', stock_name: '株冶集团', type: 1, price: 10, quantity: 1000, amount: 10000, total_price: 10005, created_at: '2026-01-05T01:30:00.000Z' },
  { id: 2, stock_code: '600961', stock_name: '株冶集团', type: 1, price: 11, quantity: 500, amount: 5500, total_price: 5503, created_at: '2026-02-05T01:30:00.000Z' },
  { id: 3, stock_code: '300547', stock_name: '川环科技', type: 1, price: 25, quantity: 1000, amount: 25000, total_price: 25009, created_at: '2026-03-05T01:30:00.000Z' },
  { id: 4, stock_code: '300547', stock_name: '川环科技', type: 2, price: 26.73, quantity: 100, amount: 2673, total_price: 2671.43, created_at: '2026-09-22T02:10:00.000Z' },
  { id: 5, stock_code: '300547', stock_name: '川环科技', type: 1, price: 25.94, quantity: 100, amount: 2594, total_price: 2594.22, created_at: '2026-09-22T03:10:00.000Z' }
]);
dbMap.set('sb.settings', { refreshSec: 3, ballSize: 72, opacity: 1, offSessionFetchOnce: false }); // 关掉非交易时段闸门：三个窗口各自首拉

function buildPreloadContext(url, patchDb) {
  if (patchDb) Object.keys(patchDb).forEach((k) => dbMap.set(k, patchDb[k]));
  const src = fs.readFileSync(path.join(PLUGIN_DIR, 'preload.js'), 'utf8');
  const ipc = { on() {}, sendTo() {}, send() {} };
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
    process: { argv: [] }, console,
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

/* ==================== 3. 跑窗口脚本 ==================== */
function runWindowScript(jsFile, htmlFile, services, label, extraSandbox) {
  const dom = makeDom(path.join(PLUGIN_DIR, htmlFile));
  const win = Object.assign({
    services,
    addEventListener(t, fn) { (this._l = this._l || {})[t] = (this._l[t] || []).concat(fn); },
    removeEventListener() {},
    fire(t, ev) { ((this._l || {})[t] || []).slice().forEach((fn) => fn(Object.assign({ type: t, preventDefault() {}, stopPropagation() {} }, ev || {}))); },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    devicePixelRatio: 1,
    innerWidth: 424, innerHeight: 596,
    requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    getComputedStyle: () => ({ getPropertyValue: () => '' })
  }, extraSandbox || {});
  const sandbox = {
    window: win,
    self: win,
    document: dom.document,
    location: { href: 'file:///plugin/' + htmlFile, pathname: '/' + htmlFile, search: '' },
    navigator: { userAgent: 'node-test', language: 'zh-CN', platform: 'Win32' },
    process: { argv: [] },
    console,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval, queueMicrotask,
    Promise, Object, Array, Math, Date, JSON, String, Number, Boolean, Error, Map, Set, RegExp, isFinite, parseInt, parseFloat,
    Intl, TextDecoder, URL, Buffer,
    CustomEvent: class { constructor(t, o) { this.type = t; this.data = o; } },
    getComputedStyle: win.getComputedStyle,
    requestAnimationFrame: win.requestAnimationFrame,
    cancelAnimationFrame: win.cancelAnimationFrame,
    alert() {}, confirm: () => true,
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  let err = null;
  try {
    vm.runInContext(fs.readFileSync(path.join(PLUGIN_DIR, jsFile), 'utf8'), sandbox, { filename: jsFile });
  } catch (e) { err = e; }
  return { err, dom, win, sandbox, label };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  const panelServices = buildPreloadContext('file:///plugin/windows/panel.html');
  const ballServices = buildPreloadContext('file:///plugin/windows/ball.html');
  const mainServices = buildPreloadContext('file:///plugin/index.html');
  await sleep(50);

  console.log('== 1. 面板窗口 windows/panel.js 首次真正启动 ==');
  const panel = runWindowScript('windows/panel.js', 'windows/panel.html', panelServices, 'panel');
  ok(!panel.err, 'panel.js 启动不抛异常', panel.err && (panel.err.message + '\n' + String(panel.err.stack).split('\n')[1]));
  if (panel.err) { console.log(panel.err.stack); }

  const reg = panel.dom.registry;
  const posList = reg.get('posList');
  const ovMv = reg.get('ovTotalMv');
  ok(!!posList && posList.innerHTML.indexOf('600961') >= 0, '持仓列表渲染出了持仓股票', posList && posList.innerHTML.slice(0, 120));
  ok(!!ovMv && /¥[\d,]+\.\d\d/.test(ovMv.textContent), '资产总览市值已填充', ovMv && ovMv.textContent);
  ok(reg.get('updateAt').textContent !== '', '状态栏更新时间已填充', reg.get('updateAt').textContent);

  console.log('== 2. 面板刷新一轮（走真实 preload services） ==');
  await sleep(200);
  ok(calls.quotes >= 1, '确实发出了行情请求', calls);

  const tabs = reg.get('groupTabs');
  const tabEls = tabs.querySelectorAll('.groupTab');
  ok(tabEls.length >= 2, '分组标签渲染出了「全部 + 分组」', tabEls.length);
  ok(tabEls.every((el) => el.listenerCount('click') > 0), '每个分组标签都绑了点击事件');
  ok(tabEls.length > 0 && tabEls[0].listenerCount('contextmenu') > 0, '分组标签绑了右键菜单事件');

  const tabW = reg.get('tabWatchlist');
  ok(tabW.listenerCount('click') > 0, '自选股 tab 已绑定事件');
  tabW.fire('click');   // 先切到自选页，列表才会渲染

  const listBox = reg.get('list');
  ok(listBox.innerHTML.indexOf('600961') >= 0, '自选列表渲染出了股票', listBox.innerHTML.slice(0, 80));
  const rows = listBox.querySelectorAll('.stock');
  ok(rows.length >= 2, '自选列表渲染出了多行', rows.length);
  ok(rows.length > 0 && rows[0].querySelector('.line') && rows[0].querySelector('.line').listenerCount('click') > 0, '自选行绑定了点击事件（能点开分时图）');
  ok(rows.length > 0 && rows[0].listenerCount('dragstart') > 0, '自选行绑定了拖拽排序事件');
  ok(rows.length > 0 && rows[0].querySelectorAll('button').length >= 2, '自选行内有买/组/删操作按钮');

  let tabErr = null;
  try {
    tabEls[tabEls.length - 1].fire('click');   // 切分组
    reg.get('tabPositions').fire('click');
    reg.get('tabWatchlist').fire('click');
    panel.win.fire('keydown', { key: 'Escape' });
  } catch (e) { tabErr = e; }
  ok(!tabErr, '切换 tab / 分组 / 按 Esc 不抛异常', tabErr && tabErr.message);

  console.log('== 3. 面板录入一笔交易（真实写入 store） ==');
  ok(reg.get('btnNewTxBuy').listenerCount('click') > 0, '买入按钮已绑定事件');
  ok(reg.get('btnTxSubmit').listenerCount('click') > 0, '录入弹窗确定按钮已绑定事件');
  let txErr = null;
  const before = panelServices.transactions.list('600961').length;
  try {
    reg.get('btnNewTxBuy').fire('click');
    ok(reg.get('txModal').hidden === false, '点「买入」后弹窗打开');
    reg.get('txCode').value = '600961';
    reg.get('txCode').fire('input');
    reg.get('txName').value = '株冶集团';
    reg.get('txPrice').value = '12.5';
    reg.get('txQty').value = '200';
    reg.get('btnTxSubmit').fire('click');
  } catch (e) { txErr = e; }
  ok(!txErr, '填写并提交买入不抛异常', txErr && txErr.message);
  ok(reg.get('txModal').hidden === true, '提交后弹窗自动关闭');
  const added = panelServices.transactions.list('600961');
  ok(added.length === before + 1, '这笔交易真的写进了 store', { before, after: added.length });
  const last = added[added.length - 1];
  ok(last && last.price === 12.5 && last.quantity === 200 && last.type === 1, '交易内容正确', last && { p: last.price, q: last.quantity, t: last.type });
  ok(last && last.total_price > 2500 && last.total_price < 2501, '买入总额已含手续费', last && last.total_price);

  console.log('== 4. 悬浮球窗口 windows/ball.js 启动 ==');
  const ball = runWindowScript('windows/ball.js', 'windows/ball.html', ballServices, 'ball');
  ok(!ball.err, 'ball.js 启动不抛异常', ball.err && ball.err.message);

  console.log('== 5. 主窗口 index.js 启动 ==');
  const main = runWindowScript('index.js', 'index.html', mainServices, 'main');
  ok(!main.err, 'index.js 启动不抛异常', main.err && (main.err.message + '\n' + String(main.err.stack).split('\n')[1]));

  /* ------------------------------------------------------------------
   * 6. 交易流水柱状图：详情浮层只在鼠标落到「柱子」上时显示
   * 造一只股票：2026-01-10 买 5000 股 @10（满高柱子，成本 10）
   *             2026-02-10 卖 4900 股 @9（只剩 100 股 → 柱体极矮，摊薄成本飙到 59）
   * 于是 2-10 这天的成本均价圆点在图表最高处，而它的柱子贴在最底下。
   * 修复前：鼠标悬在 2-10 的成本圆点上（根本不在柱子上）也会弹出详情。
   * ------------------------------------------------------------------ */
  console.log('== 6. 柱状图详情浮层：只有落在柱子上才显示 ==');
  const hoverServices = buildPreloadContext('file:///plugin/index.html', {
    'sb.transactions': [
      { id: 901, stock_code: '000001', stock_name: '浮层测试', type: 1, price: 10, quantity: 5000, amount: 50000, total_price: 50000, created_at: '2026-01-10T02:00:00.000Z' },
      { id: 902, stock_code: '000001', stock_name: '浮层测试', type: 2, price: 9, quantity: 4900, amount: 44100, total_price: 44100, created_at: '2026-02-10T02:00:00.000Z' }
    ]
  });
  const hv = runWindowScript('index.js', 'index.html', hoverServices, 'main-hover');
  ok(!hv.err, '浮层测试的主窗口启动不抛异常', hv.err && hv.err.message);
  await sleep(250);

  const hvReg = hv.dom.registry;
  const canvasEl = hvReg.get('dtChartCanvas');
  const tipEl = hvReg.get('dtChartTooltip');
  canvasEl.clientWidth = 700;
  canvasEl.clientHeight = 168;

  // 从持仓表点「流水」打开交易明细弹窗（图表在 40ms 后渲染）
  const hvRows = hvReg.get('posList').querySelectorAll('.posTableRow');
  const hvCard = hvRows.filter((c) => c.getAttribute('data-code') === '000001')[0];
  ok(!!hvCard, '持仓表里找到了测试股票 000001', hvRows.map((c) => c.getAttribute('data-code')).join(','));
  let dtErr = null;
  try {
    hvCard.querySelector('[data-act="detail"]').fire('click');
    await sleep(150);
  } catch (e) { dtErr = e; }
  ok(!dtErr, '打开交易明细弹窗并渲染柱状图不抛异常', dtErr && (dtErr.message + '\n' + String(dtErr.stack).split('\n')[1]));
  ok(hvReg.get('dtModal').hidden === false, '交易明细弹窗已打开');
  ok(tipEl.hidden === true, '刚打开时详情浮层是隐藏的');

  // 在指定坐标模拟鼠标移动，返回浮层是否可见
  function probe(x, y) {
    hv.win.fire('mousemove', { clientX: x, clientY: y });
    return tipEl.hidden === false;
  }
  function probeRow(htmlNeedle, x, y) {
    const shown = probe(x, y);
    return shown && String(tipEl.innerHTML).indexOf(htmlNeedle) >= 0;
  }
  function hitIntervals(y) {
    const out = [];
    let cur = null;
    for (let x = 20; x <= 652; x++) {
      if (probe(x, y)) {
        if (!cur) { cur = { from: x, to: x }; out.push(cur); }
        else cur.to = x;
      } else cur = null;
    }
    return out;
  }

  // 贴着底部扫一遍：两根柱子都应该能被命中，且各占一个连续区间（宽度 = 柱宽）
  const iv = hitIntervals(143);
  ok(iv.length === 2, '图表底部能命中 2 根柱子', JSON.stringify(iv));
  ok(iv.length === 2 && iv.every((s) => s.to - s.from + 1 >= 30 && s.to - s.from + 1 <= 45), '柱子命中区间宽度就是柱宽（约 36px）', JSON.stringify(iv));
  const c1 = iv.length > 1 ? Math.round((iv[0].from + iv[0].to) / 2) : 0;
  const c2 = iv.length > 1 ? Math.round((iv[1].from + iv[1].to) / 2) : 0;
  ok(iv.length > 1 && Math.abs((c2 - c1) - 316) <= 2, '两根柱子等分布满可绘区（间距 = step）', { c1, c2 });

  ok(probeRow('2026-01-10', c1, 100), '鼠标在 1 月那根高柱子上 → 显示当天详情');
  ok(probeRow('2026-02-10', c2, 144), '鼠标在 2 月那根矮柱子上 → 显示当天详情');

  // 全图逐像素扫描：能弹出详情的区域必须恰好等于两根柱体本身
  const cols = [];
  for (let x = 20; x <= 652; x++) {
    const ys = [];
    for (let y = 0; y <= 167; y++) if (probe(x, y)) ys.push(y);
    if (ys.length) cols.push({ x, from: ys[0], to: ys[ys.length - 1], n: ys.length });
  }
  const runs = [];
  cols.forEach((c) => {
    const last = runs[runs.length - 1];
    if (last && c.x === last.to + 1) { last.to = c.x; last.cols.push(c); }
    else runs.push({ from: c.x, to: c.x, cols: [c] });
  });
  ok(runs.length === 2, '整个图表里只有两块区域能弹出详情（就是两根柱子）', JSON.stringify(runs.map((r) => [r.from, r.to])));
  ok(runs.every((r) => r.cols.every((c) => c.from === r.cols[0].from && c.to === r.cols[0].to && c.n === r.cols[0].n)), '命中区是矩形（每列命中的 y 范围完全一致）');
  const band1 = runs[0].cols[0], band2 = runs[1].cols[0];
  ok(runs[0].from === iv[0].from && runs[0].to === iv[0].to && runs[1].from === iv[1].from && runs[1].to === iv[1].to, '命中区的 x 范围就是柱子的 x 范围', { r1: [runs[0].from, runs[0].to], r2: [runs[1].from, runs[1].to] });
  ok(band1.to - band1.from + 1 >= 120 && band2.to - band2.from + 1 <= 8, '高柱子命中范围 = 柱高 126，矮柱子命中范围 = 柱高 4', { 高: band1.to - band1.from + 1, 矮: band2.to - band2.from + 1 });
  ok(band1.to === band2.to && band1.to <= 147, '两根柱子底边对齐在基线上（146 ±1px 容差）', { b1: band1.to, b2: band2.to });
  ok(!probe(c1, band1.from - 2) && !probe(c1, band1.to + 2), '高柱子上下各超出 2px 就不显示');
  let aboveLowBar = 0;
  for (let y = 0; y <= band2.from - 2; y++) if (probe(c2, y)) aboveLowBar++;
  ok(aboveLowBar === 0, '矮柱子上方整段空白（成本均价圆点所在区域）都不显示', aboveLowBar);
  ok(!probe(Math.round((iv[0].to + iv[1].from) / 2), 100), '鼠标在两根柱子之间的空隙 → 不显示');
  const totalHit = runs.reduce((s, r) => s + r.cols.reduce((a, c) => a + c.n, 0), 0);
  ok(totalHit === runs[0].cols.length * band1.n + runs[1].cols.length * band2.n, '可弹出详情的像素数 = 两根柱子面积之和', totalHit);

  // 鼠标移出图表区域时浮层必须立刻消失（不依赖 mouseleave）
  probe(c1, 100);
  hv.win.fire('mousemove', { clientX: 900, clientY: 300 });
  ok(tipEl.hidden === true, '鼠标移出图表后浮层立刻隐藏');
  probe(c1, 100);
  hv.win.fire('mousemove', { clientX: c1, clientY: 300 });
  ok(tipEl.hidden === true, '鼠标纵向移出画布（在图表下方）浮层也隐藏');

  console.log('');
  if (fail === 0) {
    console.log('✓ 窗口启动冒烟测试全部通过（' + pass + ' 项）');
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

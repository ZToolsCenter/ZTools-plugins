/*
 * 无 UI 集成测试：用 node vm 造假的 ztools + ipcRenderer，把 preload.js 跑成
 * 「主窗口（管家）+ 球窗口 + 面板窗口」三个上下文，验证窗口创建参数、拖动、
 * 菜单展开收起、心跳去重、跨窗口通信、以及真实行情数据。
 *
 *   node tests/test-preload-vm.js
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PLUGIN_DIR = path.join(__dirname, '..');
const CH = 'sb:cmd';

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; failures.push(label); console.log('  ✗ ' + label + (extra ? '  → ' + JSON.stringify(extra) : '')); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ---------------- 假 ZTools 宿主 ---------------- */
const dbMap = new Map();
// 关掉非交易时段闸门：本测试要用真实行情多次拉取（收盘后跑也会被闸门拦掉）
dbMap.set('sb.settings', { offSessionFetchOnce: false });

/*
 * 重要：测试只能碰假 dbStorage，绝不能写用户真实的 ~/.ztools-stock-ball.json。
 * 用 isolated 包住 createStore：preload.js 里 storeModule.createStore(Z.dbStorage)
 * 会退化成「不建 fileStore」，写操作只落在本测试的 dbMap 里。
 *（之前这个测试真的把本机自选股写坏过：dbStorage 是假的，但 fileStore 指向真实文件。）
 */
const storeReal = require(path.join(PLUGIN_DIR, 'lib', 'store.js'));
const storeShim = Object.assign({}, storeReal, {
  createStore: (db) => storeReal.createStore(db, { isolated: true })
});
const contexts = [];       // { id, role, listeners: {channel: [cb]}, window }
let nextId = 100;
const created = [];        // 主窗口历史上创建过的窗口
const notifications = [];
const openedUrls = [];
let mainHidden = 0;
let outPluginCalls = 0;
let showMainWindowCalls = 0;
const expendHeightCalls = [];
const redirectCalls = [];

function findCtx(id) { return contexts.find((c) => c.id === id) || null; }

function fakeDbStorage() {
  return {
    getItem: (k) => (dbMap.has(k) ? dbMap.get(k) : null),
    setItem: (k, v) => { dbMap.set(k, v); },
    removeItem: (k) => { dbMap.delete(k); }
  };
}

function fakeWindowInstance(role, opts, url) {
  const rect = {
    x: opts.x, y: opts.y,
    width: opts.width, height: opts.height
  };
  const calls = [];
  const win = {
    id: ++nextId,
    webContents: { id: null, send() {} },
    _calls: calls,
    _rect: rect,
    _role: role,
    _destroyed: false,
    _visible: true,
    getBounds() { return Object.assign({}, rect); },
    setBounds(b) { Object.assign(rect, b); calls.push(['setBounds', Object.assign({}, b)]); },
    setPosition(x, y) { rect.x = x; rect.y = y; calls.push(['setPosition', x, y]); },
    setOpacity(o) { this._opacity = o; calls.push(['setOpacity', o]); },
    isDestroyed() { return this._destroyed; },
    close() { this._destroyed = true; calls.push(['close']); const c = findCtx(this.webContents.id); if (c) c.closed = true; },
    show() { this._visible = true; calls.push(['show']); },
    hide() { this._visible = false; calls.push(['hide']); },
    focus() { calls.push(['focus']); },
    isVisible() { return this._visible; }
  };
  win.webContents.id = win.id;
  return win;
}

function makeZTools(selfCtx) {
  const isMain = selfCtx.role === 'host';
  return {
    dbStorage: fakeDbStorage(),
    getWindowType: () => (isMain ? 'main' : 'browser'),
    getWebContentsId: () => selfCtx.id,
    isWindows: () => true,
    isMacOS: () => false,
    getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, size: { width: 1920, height: 1080 } }),
    getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
    getDisplayNearestPoint: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
    getCursorScreenPoint: () => ({ x: 10, y: 10 }),
    hideMainWindow: () => { mainHidden++; return Promise.resolve(true); },
    showMainWindow: () => { showMainWindowCalls++; return Promise.resolve(true); },
    setExpendHeight: (h) => { expendHeightCalls.push(h); },
    redirect: (label, payload) => { redirectCalls.push({ label, payload }); },
    outPlugin: () => { outPluginCalls++; return Promise.resolve(true); },
    showNotification: (b) => { notifications.push(b); },
    showToast: (b) => { notifications.push('toast:' + b); },
    shellOpenExternal: (u) => { openedUrls.push(u); return { success: true }; },
    onPluginEnter: () => {},
    sendToParent: (channel, data) => {
      // 子窗口 → 主窗口的第二条路
      const host = contexts.find((c) => c.role === 'host');
      if (!host) return;
      deliver(host, channel, { senderId: selfCtx.id }, data);
    },
    createBrowserWindow: (url, opts, cb) => {
      // 主窗口点击「行情面板」关键字时不会再创建窗口；只有主窗口会走这里
      const role = /ball\.html/.test(url) ? 'ball' : (/panel\.html/.test(url) ? 'panel' : 'other');
      const win = fakeWindowInstance(role, opts, url);
      created.push({ url, opts, win });
      // 生成子窗口上下文（相当于真的开了一个渲染进程）
      const child = spawnContext(role, url);
      win.webContents.id = child.id;
      // 渲染进程的 preload 一定跑在 createBrowserWindow 之后
      if (typeof cb === 'function') setTimeout(() => cb(), 0);
      return win;
    }
  };
}

function spawnContext(role, url) {
  const ctx = { id: ++nextId, role, listeners: {}, window: null };
  contexts.push(ctx);
  runPreload(ctx, url);
  return ctx;
}

function deliver(ctx, channel, event, msg) {
  const list = ctx.listeners[channel] || [];
  list.slice().forEach((cb) => { try { cb(event, msg); } catch (e) { console.log('  ! 监听器抛错', e && e.message); } });
}

function runPreload(ctx, url) {
  const src = fs.readFileSync(path.join(PLUGIN_DIR, 'preload.js'), 'utf8');
  const ipc = {
    on: (channel, cb) => { (ctx.listeners[channel] = ctx.listeners[channel] || []).push(cb); },
    sendTo: (targetId, channel, msg) => {
      const target = findCtx(targetId);
      if (!target) return;
      deliver(target, channel, { senderId: ctx.id }, msg);
    },
    send: () => {}
  };
  const ztools = makeZTools(ctx);
  const win = {
    services: undefined,
    sbHost: undefined,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {}
  };
  ctx.window = win;
  const sandbox = {
    window: win,
    ztools,
    utools: ztools,
    location: { href: url || 'file:///plugin/index.html', pathname: (url || '/plugin/index.html').replace(/^file:\/\//, '') },
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
    TextDecoder, URL, Buffer, CustomEvent: class CustomEvent { constructor(t, o) { this.type = t; this.detail = o && o.detail; } }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'preload.js' });
  ctx.sandbox = sandbox;
}

/* ---------------- 开跑 ---------------- */
(async () => {
  console.log('== 1. 主窗口进入「股票悬浮球」 ==');
  const host = { id: 1, role: 'host', listeners: {}, window: null };
  contexts.push(host);
  runPreload(host, 'file:///plugin/index.html');
  await sleep(30);
  ok(hiddenOrExports(host), 'window.exports 里注册了 feature');
  ok(!!host.window.exports['stock'], 'window.exports 注册了 stock');
  ok(!!host.window.exports['stock-panel'], 'window.exports 注册了 stock-panel');
  ok(!!host.window.exports['stock-ball'], 'window.exports 注册了 stock-ball');
  host.window.exports['stock-ball'].args.enter();
  await sleep(250);
  ok(created.length === 1, '创建了 1 个悬浮球窗口', created.map((c) => c.url));
  ok(mainHidden === 0, '主窗口保持展示（不消失）');
  const ballCreated = created[0] || { opts: {}, win: null };
  const o = ballCreated.opts || {};
  ['frame', 'transparent', 'alwaysOnTop', 'skipTaskbar'].forEach((k) => {
    ok(o[k] === (k === 'frame' ? false : true), '窗口选项 ' + k + '=' + o[k]);
  });
  ok(o.width === 84 && o.height === 84, '窗口尺寸 = 球 72 + 留白 12', { w: o.width, h: o.height });
  ok(o.webPreferences && o.webPreferences.preload === 'preload.js', '子窗口带上了 preload（否则没有 window.services）');
  ok(o.backgroundColor === '#00000000', '背景透明');
  ok(/ball\.html$/.test(ballCreated.url || ''), '加载的是 ball.html', ballCreated.url);

  const ballCtx = contexts.find((c) => c.role === 'ball');
  ok(!!ballCtx, '球窗口渲染上下文已建立');
  const ballSvc = ballCtx && ballCtx.window.services;
  ok(!!ballSvc && ballSvc.role === 'ball', '球窗口里 window.services.role === ball', ballSvc && ballSvc.role);
  ok(!!(ballSvc && ballSvc.host && ballSvc.host.drag), '球窗口有 host.drag');

  console.log('== 2. 握手 + 心跳 ==');
  await sleep(500);  // 等 greet 定时器
  const hb = dbMap.get('sb.heartbeat');
  ok(!!hb && hb.id === (ballCtx && ballCtx.id), '球写了心跳（带自己的 webContents id）', hb);

  console.log('== 3. 拖动球（子窗口 → 管家 setBounds） ==');
  const ballWin = created[0].win;
  ballWin.setBounds({ x: 1000, y: 400, width: 84, height: 84 });
  ballWin._calls.length = 0;
  ballSvc.host.drag('start', 0, 0);
  await sleep(30);
  ballSvc.host.drag('move', 60, -40);
  await sleep(30);
  const moved = ballWin._calls.filter((c) => c[0] === 'setBounds').pop();
  ok(!!moved && moved[1].x === 1060 && moved[1].y === 400 - 40, '位移正确跟随鼠标 (1000,400)+(60,-40)', moved && moved[1]);
  ballSvc.host.drag('end', 60, -40);
  await sleep(60);
  const pos = dbMap.get('sb.ballPos');
  ok(!!pos && pos.x === 1060, '拖动结束保存了球位置', pos);

  console.log('== 4. 贴边吸附（拖到屏幕最右侧） ==');
  ballWin.setBounds({ x: 1000, y: 400, width: 84, height: 84 });
  ballSvc.host.drag('start', 0, 0);
  await sleep(20);
  ballSvc.host.drag('end', 851, 0);   // 1060+851 = 1911 → 贴右边
  await sleep(60);
  const snapped = dbMap.get('sb.ballPos');
  ok(!!snapped && snapped.x === 1920 - 84 - 12, '贴右边吸附 x = 屏宽 - 球 - 12', snapped);

  console.log('== 5. 右键菜单：窗口被撑大 + 球视觉位置不动 ==');
  ballWin.setBounds({ x: 1000, y: 500, width: 84, height: 84 });
  ballWin._calls.length = 0;
  let menuCtl = null;
  ballSvc.onCtl((c) => { if (c.t === 'menu') menuCtl = c; });
  ballSvc.host.menu(true);
  await sleep(80);
  const expand = ballWin._calls.filter((c) => c[0] === 'setBounds').pop();
  ok(!!expand && expand[1].width === 84 + 152, '窗口横向变宽 = 球窗 + 菜单宽', expand && expand[1]);
  ok(!!menuCtl && menuCtl.open === true, '球收到了 menu 指令（带 side/vside）', menuCtl);
  ok(!!menuCtl && (menuCtl.side === 'right' || menuCtl.side === 'left'), '菜单方向已判定', menuCtl && menuCtl.side);
  const ballBottomBefore = 500 + 84;
  const newBottom = expand[1].y + expand[1].height;
  ok(newBottom === ballBottomBefore, '展开后球贴着窗口边（视觉位置不动）', { before: ballBottomBefore, after: newBottom });
  ballSvc.host.menu(false);
  await sleep(80);
  const collapse = ballWin._calls.filter((c) => c[0] === 'setBounds').pop();
  ok(!!collapse && collapse[1].width === 84 && collapse[1].height === 84, '收起菜单后窗口回到 84×84', collapse && collapse[1]);

  console.log('== 6. 真实行情（球窗口自己拉数据） ==');
  try {
    const qs = await ballSvc.quotes();
    ok(qs.length === 3, '拉到 3 条自选股行情', qs.map((q) => q.code));
    ok(qs.some((q) => q.price !== null), '至少一只有价格', qs.map((q) => q.price));
    ok(qs[0].watchName || qs[0].name, '带上了自选里的名字', qs[0].watchName || qs[0].name);
    const ix = await ballSvc.indexes();
    ok(ix.length >= 3, '拉到大盘指数', ix.map((i) => i.name));
    const t = await ballSvc.trend('600961');
    ok(t.items.length > 30, '拉到分时数据', t.items.length);
  } catch (e) {
    ok(false, '真实行情请求', e && e.message);
  }

  console.log('== 7. 自选股增删改（存 dbStorage） ==');
  const wl = ballSvc.watchlist.add({ code: '601318', name: '中国平安' });
  ok(wl.length === 4 && wl[3].code === '601318', '添加自选股', wl.map((x) => x.code));
  ok(ballSvc.watchlist.add({ code: '601318' }).length === 4, '重复添加不会加两条');
  ballSvc.watchlist.move('601318', -1);
  ok(ballSvc.watchlist.get()[2].code === '601318', '上移生效');
  ballSvc.watchlist.remove('601318');
  ok(ballSvc.watchlist.get().length === 3, '删除生效');
  const s0 = ballSvc.settings.get();
  ballSvc.settings.patch({ ballSize: 80, refreshSec: 10 });
  ok(ballSvc.settings.get().ballSize === 80, '设置持久化生效');
  ballSvc.settings.patch({ ballSize: s0.ballSize, refreshSec: s0.refreshSec });

  console.log('== 7.5. 悬浮球透明度实时调节 ==');
  ok(typeof ballSvc.host.setBallOpacity === 'function', '球/子窗口有 host.setBallOpacity');
  ok(typeof host.window.services.host.setBallOpacity === 'function', '主窗口有 host.setBallOpacity');
  let opacityCtl = null;
  ballSvc.onCtl((c) => { if (c.t === 'opacity') opacityCtl = c; });
  host.window.services.host.setBallOpacity(0.75);
  await sleep(60);
  ok(ballSvc.settings.get().ballOpacity === 0.75, 'settings 中 ballOpacity 更新为 0.75');
  ok(ballWin._opacity === 0.75, '窗口 win.setOpacity(0.75) 被调用');
  ok(!!opacityCtl && opacityCtl.opacity === 0.75, '球收到 IPC 传递的 opacity 改变通知', opacityCtl);

  console.log('== 7.6. 悬浮球大小实时调节 ==');
  ok(typeof ballSvc.host.setBallSize === 'function', '球/子窗口有 host.setBallSize');
  ok(typeof host.window.services.host.setBallSize === 'function', '主窗口有 host.setBallSize');
  let sizeCtl = null;
  ballSvc.onCtl((c) => { if (c.t === 'size') sizeCtl = c; });
  host.window.services.host.setBallSize(80);
  await sleep(60);
  ok(ballSvc.settings.get().ballSize === 80, 'settings 中 ballSize 更新为 80');
  const resized = ballWin._calls.filter((c) => c[0] === 'setBounds').pop();
  ok(!!resized && resized[1].width === 80 + 12 && resized[1].height === 80 + 12, '窗口 setBounds 变更为 92×92', resized && resized[1]);
  ok(!!sizeCtl && sizeCtl.ballSize === 80, '球收到 size 指令通知', sizeCtl);
  host.window.services.host.setBallSize(72);

  console.log('== 7.7. 球窗口调用 openPlugin 激活主窗口 ==');
  ok(typeof ballSvc.host.openPlugin === 'function', '球窗口有 host.openPlugin');
  let tabSwitched = null;
  host.window.services.onCtl((c) => { if (c && c.cmd === 'switch-tab') tabSwitched = c; });
  const redirectsBefore = redirectCalls.length;
  const showBefore = showMainWindowCalls;
  ballSvc.host.openPlugin('stock');
  await sleep(100);
  ok(showMainWindowCalls > showBefore, 'ZTools showMainWindow 被调用');
  ok(redirectCalls.length > redirectsBefore, 'ZTools redirect 被调用');
  const lastRedirect = redirectCalls[redirectCalls.length - 1];
  ok(lastRedirect && lastRedirect.label === 'stock', 'redirect 的目标是 stock', lastRedirect);
  ok(lastRedirect && lastRedirect.payload === undefined, 'redirect 没有传入空字符串 payload（避免误入子输入框模式）', lastRedirect);
  ok(!!tabSwitched && tabSwitched.tab === 'positions', '主窗口收到 switch-tab positions 指令', tabSwitched);

  console.log('== 8. 面板窗口（球点一下就能开） ==');
  ok(typeof ballSvc.host.panel === 'function', '球有 host.panel');
  const before = created.length;
  ballSvc.host.panel('show');
  await sleep(400);
  ok(created.length === before + 1, '面板窗口被创建', created.map((c) => c.url));
  const panelCreated = created[created.length - 1];
  ok(/panel\.html$/.test(panelCreated.url), '加载的是 panel.html', panelCreated.url);
  ok(panelCreated.opts.width === 424 && panelCreated.opts.height === 596, '面板尺寸 424×596', panelCreated.opts);
  ok(panelCreated.opts.alwaysOnTop === true, '面板默认置顶');
  const panelCtx = contexts.find((c) => c.role === 'panel');
  ok(!!panelCtx, '面板渲染上下文已建立');
  const pSvc = panelCtx && panelCtx.window.services;
  ok(!!pSvc && pSvc.role === 'panel', '面板里 window.services.role === panel', pSvc && pSvc.role);
  ok(!!(pSvc && pSvc.search), '面板有 search（添加自选股要用）');
  try {
    const rows = await pSvc.search('川环');
    ok(rows.length > 0 && rows[0].secid === '0.300547', '面板能搜股票', rows.slice(0, 2));
    const d = await pSvc.detail(rows[0].code);
    ok(!!d.name, '面板能取个股详情', d.name);
  } catch (e) {
    ok(false, '面板数据请求', e && e.message);
  }

  console.log('== 9. 面板请求隐藏球 / 关闭面板 ==');
  const ballWin2 = created[0].win;
  pSvc.host.ball('hide');
  await sleep(600);
  ok(ballWin2._destroyed === true, '球窗口被关掉');
  const hb2 = dbMap.get('sb.heartbeat');
  ok(!!hb2 && hb2.id === null, '心跳已清空（下次进入才会重开球）', hb2);

  console.log('== 10. 新会话进入：不会再开第二个球 ==');
  const created0 = created.length;
  const host2 = { id: 900, role: 'host', listeners: {}, window: null };
  contexts.push(host2);
  runPreload(host2, 'file:///plugin/index.html');
  await sleep(20);
  // 先让球重新跑起来（模拟「球已在桌面上」）
  dbMap.set('sb.heartbeat', { id: 555, t: Date.now(), role: 'ball' });
  host2.window.exports['stock-ball'].args.enter();
  await sleep(1400);
  ok(created.length === created0, '有心跳时不再重复创建球窗口', created.length - created0);
  ok(!notifications.some((n) => /已经在桌面/.test(n)), '进入插件时不弹「已经在桌面上」打扰提示', notifications);

  console.log('== 11. 退出插件 ==');
  host2.window.sbHost.endPlugin();
  await sleep(50);
  ok(outPluginCalls > 0, 'outPlugin 被调用（后台进程收尾）');

  console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (failures.length) { console.log('失败清单：'); failures.forEach((f) => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})();

function hiddenOrExports(host) {
  return !!(host.window && host.window.exports && host.window.exports['stock-ball']);
}

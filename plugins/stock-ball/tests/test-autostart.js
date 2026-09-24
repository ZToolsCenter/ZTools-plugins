/*
 * 开机自动启动测试。
 *
 * 机制（逆自当前 ZTools app.asar，与宿主右键菜单「跟随主程序同时启动运行」同源）：
 *  1) db 键 `auto-start-plugin` = 插件名数组，宿主启动时逐个 preloadPlugin；
 *  2) IPC `set-launch-at-login` / `get-launch-at-login` = 宿主设置页「开机启动」同一通道；
 *  3) 本插件预载后2.5秒内没等到 onPluginEnter 且名单里有自己 → 自动打开桌面悬浮球。
 *
 * 断言重点：
 *  - 名单增删只动自己的名字，别的插件的自启动项必须原样保留；
 *  - 插件名解析走 getAllPlugins（能认出非 stock-ball 的变体名）；
 *  - 开/关对称地同步宿主开机启动 IPC；
 *  - 界面接线（设置行、填充、保存）与开机拉球启发式都在位。
 *
 *   node tests/test-autostart.js
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

/* ---------------- 1. 行为：起一个 panel 角色的 preload 上下文 ---------------- */
const AUTO_KEY = 'auto-start-plugin';
const dbStore = new Map();
dbStore.set(AUTO_KEY, ['other-plugin']);           // 名单里已有别的插件 → 增删不能碰它
const invokes = [];
let launchOn = false;

function buildCtx() {
  const src = fs.readFileSync(path.join(PLUGIN_DIR, 'preload.js'), 'utf8');
  const ipc = {
    on: () => {}, sendTo: () => {}, send: () => {},
    invoke: async (ch, val) => {
      invokes.push([ch, val]);
      if (ch === 'get-launch-at-login') return launchOn;
      if (ch === 'set-launch-at-login') { launchOn = !!val; return; }
      throw new Error('未知通道 ' + ch);
    }
  };
  const win = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  const ztools = {
    dbStorage: {
      getItem: (k) => (dbStore.has(k) ? dbStore.get(k) : null),
      setItem: (k, v) => dbStore.set(k, v),
      removeItem: (k) => dbStore.delete(k)
    },
    // 变体名场景：宿主注册的名字不是 stock-ball，靠 cmds 里的关键词认出来
    dbGet: (k) => dbStore.get(k),
    dbPut: (k, v) => { dbStore.set(k, v); },
    getAllPlugins: () => [
      { name: 'clipboard', cmds: ['剪贴板'] },
      { name: 'ztools-stock-ball', cmds: ['股票管家', '看盘', '持仓'] }
    ],
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
    process: { argv: [], platform: 'win32', execPath: 'D:\\Program Files\\ZTools\\ZTools.exe' },
    console,
    require: (id) => {
      if (id === 'electron') return { ipcRenderer: ipc };
      if (/lib[\\/]store\.js$/.test(id)) {
        const storeReal = require(path.join(PLUGIN_DIR, 'lib', 'store.js'));
        return Object.assign({}, storeReal, { createStore: (db) => storeReal.createStore(db, { isolated: true }) });
      }
      if (id.charAt(0) === '.') return require(path.resolve(PLUGIN_DIR, id));
      return require(id);
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
  console.log('== 1. 服务暴露与初始状态 ==');
  const S = buildCtx();
  await sleep(30);
  ok(!!S && typeof S.autostart === 'function' || (S && S.autostart && typeof S.autostart.set === 'function'), 'preload 暴露 services.autostart');
  const init = await S.autostart.isEnabled();
  ok(init === false, '初始未开启（名单里只有别人的插件）', { init, list: dbStore.get(AUTO_KEY) });

  console.log('== 2. 开启：写名单 + 名称解析 + 打开宿主开机启动 ==');
  const on = await S.autostart.set(true);
  const list1 = dbStore.get(AUTO_KEY);
  ok(on === true, 'set(true) 后 isEnabled=true');
  ok(list1.indexOf('ztools-stock-ball') >= 0, '按 getAllPlugins 解析出的变体名写入名单', list1);
  ok(list1.indexOf('other-plugin') >= 0, '别人的自启动项原样保留', list1);
  ok(list1.length === 2, '名单长度正确（1个原有 + 1个本插件）', list1);
  ok(invokes.some((x) => x[0] === 'set-launch-at-login' && x[1] === true), '调用了宿主 set-launch-at-login(true)', invokes);
  ok(launchOn === true, '宿主开机启动状态已为开');

  console.log('== 3. 再读状态（跨调用一致性） ==');
  ok((await S.autostart.isEnabled()) === true, 'isEnabled 读回 true');
  ok((await S.autostart.getHostLaunch()) === true, 'get-host-launch 读回 true');

  console.log('== 4. 关闭：对称移除 ==');
  const off = await S.autostart.set(false);
  const list2 = dbStore.get(AUTO_KEY);
  ok(off === false, 'set(false) 后 isEnabled=false');
  ok(list2.indexOf('ztools-stock-ball') < 0, '本插件已从名单移除', list2);
  ok(list2.indexOf('other-plugin') >= 0, '别人的自启动项依然保留', list2);
  ok(invokes.some((x) => x[0] === 'set-launch-at-login' && x[1] === false), '对称调用 set-launch-at-login(false)', invokes.slice(-2));
  ok(launchOn === false, '宿主开机启动状态已为关');

  console.log('== 5. 重复开启幂等 ==');
  await S.autostart.set(true);
  await S.autostart.set(true);
  ok(dbStore.get(AUTO_KEY).filter((n) => n === 'ztools-stock-ball').length === 1, '重复开启不产生重复项', dbStore.get(AUTO_KEY));
  await S.autostart.set(false);

  console.log('== 6. 界面与启发式接线静态检查 ==');
  const html = fs.readFileSync(path.join(PLUGIN_DIR, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(PLUGIN_DIR, 'index.js'), 'utf8');
  const pre = fs.readFileSync(path.join(PLUGIN_DIR, 'preload.js'), 'utf8');
  const css = fs.readFileSync(path.join(PLUGIN_DIR, 'index.css'), 'utf8');

  ok(html.includes('id="setBootAutoStart"'), '设置页有「开机自动启动」开关');
  ok(html.includes('随 ZTools 启动并自动打开悬浮球'), '开关带行为说明文案');
  ok(html.includes('开机自动启动已生效'), '保存提示文案覆盖开机自动启动');
  ok(js.includes("S.autostart.isEnabled"), 'fillSettings 异步填充开关状态');
  ok(js.includes("S.autostart.set("), 'saveSettings 写入开机自动启动');
  ok((js.match(/setBootAutoStart/g) || []).length >= 2, 'index.js 至少两处接线（填充+保存）');
  ok(pre.includes("AUTO_START_KEY = 'auto-start-plugin'"), 'preload 使用宿主官方名单键');
  ok(pre.includes("invoke('set-launch-at-login'"), 'preload 调用宿主官方开机启动 IPC');
  ok(pre.includes('bootEntered') && pre.includes('openBall(true)'), '开机预载2.5秒无进入动作 → 自动打开悬浮球');
  ok(pre.includes('resolveAutoStartName'), '插件名解析（兼容宿主注册的变体名）');
  ok(css.includes('input[type="checkbox"]') && css.includes('.row2'), '设置行复用现有 checkbox 样式');

  console.log('');
  if (fail === 0) {
    console.log('✓ 开机自动启动测试全部通过（' + pass + ' 项）');
    process.exit(0);
  }
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
})().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});

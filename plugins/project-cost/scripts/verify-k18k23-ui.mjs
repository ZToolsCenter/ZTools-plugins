/**
 * K18（v1.9.x）重做 —— **UI 层**自动化自验：撤销 → 重做 → 撤销 + ⇧⌘Z。
 *
 * 与 `verify-k18k23.mjs` 的分工：
 *   那个套件测的是**逻辑层**（直接调 store.undo() / store.redo()），界面上一个按钮都没点过。
 *   本套件补的是**用户真正走的那条路** —— 点 `[data-undo-btn]` / `[data-redo-btn]`、
 *   按 ⇧⌘Z，然后看账本有没有真的跟着变。只测逻辑层会漏掉一整类缺陷：
 *   按钮 disabled 绑错、title 步数不刷新、键盘监听被 `inField` 拦掉、点完视图不重渲染
 *   （canUndo/canRedo 是纯函数，靠 `void book.value` 借 book 变化触发重算 —— 少写一个
 *   `void` 就会「状态变了但按钮还是灰的」）。
 *
 * 覆盖：
 *   ① 基线：清库重启后撤销 / 重做按钮都是灰的，title 是「没有可…的操作」；
 *   ② 造动作（改首条费用项备注）→ 撤销按钮由灰变亮，title 出现「可撤销 1 步」；
 *   ③ 点撤销 → 账本回到动作前，重做按钮变亮且「可重做 1 步」；
 *   ④ 点重做 → 账本回到动作后，重做按钮重新变灰；
 *   ⑤ 再点撤销 → 又回退（**撤销 → 重做 → 再撤销** 完整三段）；
 *   ⑥ 键盘 ⇧⌘Z（CDP Input.dispatchKeyEvent，Meta+Shift）→ 等价于点重做按钮；
 *      反向 ⌘Z（仅 Meta）→ 等价于点撤销按钮；
 *   ⑦ 分岔语义：撤销后再做一个**新的**动作 → 重做栈清空，重做按钮变回灰色；
 *   ⑧ 步数文案随栈深变化（可撤销 N 步 / 可重做 N 步，逐个数字断言）；
 *   ⑨ 付款页 PayView 的同一对按钮与列表页同态、点了同样生效；
 *   ⑩ 抽屉 ItemSheet 的同一对按钮（.drawer [data-undo-btn]）点了同样生效；
 *   ⑪ 收尾：全部撤销回基线 + 三条红线（金额链五项 / 预算键 13 / round-trip 88 行 0 坏行）。
 *
 * 用法：node scripts/verify-all.mjs k18k23ui
 *       （或 npx esbuild … && node /tmp/k18k23-ui.mjs；**前置：dist/ 已构建**）
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import { pickPort, listenServer } from './free-port.mjs';
/* node 侧红线复核要用真账本，故把 store / core / export / parse 一起带上。
   fake-ls 必须**第一个** import：它给 node 装 localStorage，后被导入的模块才读得到。 */
import './fake-ls.mjs';
import * as store from '../src/lib/store.js';
import { calc, sumBudget } from '../src/lib/core.js';
import { HEADS, payRows } from '../src/lib/export.js';
import { parseDelimited, mapRow, isHeaderRow, alignByHeader } from '../src/lib/parse.js';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/**
 * 端口：全仓 UI 套件原来各占一对写死的号（静态服 82xx / CDP 92xx，本套件是 8258 / 9248）。
 * 并发跑多个 UI 套件时会撞车 → `srv.listen()` 的回调永不触发 → 挂到看门狗超时 →
 * 一条断言都不产出 → 汇总器把「0 通过 0 失败」画成 ✓（假通过）。
 *
 * 现在 8258 / 9248 只是**首选值**：被别的并发套件占了就由 scripts/free-port.mjs 自动退让
 * 到 OS 分配的空闲端口。下面的 `once('error')` / 启动段 try-catch 仍是第二道防线
 * （真起不来时产出一条 FAIL，而不是静默挂死）。
 */
const SRV_PORT_PREF = 8258;
const PORT_PREF = 9248;
/** 运行期真实端口：必须等 startServer / pickPort 返回后才有值，顶层不能提前拼 URL */
let SRV_PORT = SRV_PORT_PREF;
let PORT = PORT_PREF;
let URL = '';
const DIST = path.resolve('dist');
/** 主数据落盘键（与 src/lib/store.js 的 KEY 同值；这里字面写死，改了键名会被本套件抓到） */
const LS_KEY = 'ztools_project_cost_v1';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
function startServer(preferred) {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const fp = path.join(DIST, p);
    if (!fp.startsWith(DIST) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
      res.writeHead(404); res.end('404'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
  });
  /* 首选号被占就退让到 OS 分配的空闲端口（listenServer 内部一次 bind 到位，没有探测竞态）。
     两次都失败必须显式抛错：EADDRINUSE 时 listen 的回调**永远不会触发**，套件会挂到看门狗
     超时，然后被汇总器记成「0 通过 0 失败」，看起来像通过。 */
  return listenServer(srv, preferred).catch((e) => {
    throw new Error(`静态服务器端口 ${preferred} 绑定失败（${e?.code}）——多半被另一个并发跑的 UI 套件占了，单独重跑本套件即可`);
  });
}
/* URL 必须等拿到真实端口之后再拼（见下方启动段）——顶层拼会拿到首选值而不是实际端口。 */

/* ---------------- 断言框架 ---------------- */
const out = [];
const failures = [];
let pass = 0;
let fail = 0;
function record(okFlag, label, actual, expected) {
  if (okFlag) { pass += 1; out.push(`PASS ${label}: ${actual}`); } else {
    fail += 1;
    const msg = `${label}: ${actual}${expected === undefined ? '' : ` (期望 ${expected})`}`;
    out.push(`FAIL ${msg}`);
    failures.push(msg);
  }
  return okFlag;
}
const eq = (label, actual, expected) => record(String(actual) === String(expected), label, actual, expected);
const is = (label, actual) => record(!!actual, label, actual, 'truthy');
const not = (label, actual) => record(!actual, label, actual, 'falsy');
const near = (label, actual, expected, tol = 0.005) =>
  record(Math.abs((+actual || 0) - (+expected || 0)) <= tol, label, actual, expected);
const section = (t) => out.push(`\n== ${t} ==`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wsGet = async (u) => (await fetch(u)).json();
setTimeout(() => { console.error('WATCHDOG: 超时强制退出'); process.exit(2); }, 240000).unref();

let _seq = 1;
const _pending = new Map();
const _events = [];
function attachCdp(ws) {
  ws.onopen = () => { ws._open?.(); };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (typeof m.id === 'number' && _pending.has(m.id)) {
      const { resolve } = _pending.get(m.id);
      _pending.delete(m.id);
      resolve(m.result);
    }
    if (m.method) for (const h of _events) if (h.method === m.method) h.cb(m.params);
  };
  ws.onerror = (e) => { console.error('ws error', e.message); };
}
function cdp(ws, method, params = {}) {
  const id = _seq++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => { _pending.set(id, { resolve }); });
}
function onEvent(method, cb) { _events.push({ method, cb }); }

const HELPERS = `
window.__qa = {
  txt(sel) {
    const el = document.querySelector(sel);
    return el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';
  },
  clickSel(sel) { const el = document.querySelector(sel); if (!el) return false; el.click(); return true; },
  clickExact(text, scope) {
    const root = scope ? document.querySelector(scope) : document;
    if (!root) return false;
    const els = [...root.querySelectorAll('button, .btn, .link')];
    const hit = els.find((e) => (e.textContent || '').replace(/\\s+/g, '').trim() === text.replace(/\\s+/g, ''));
    if (hit) { hit.click(); return true; }
    return false;
  },
  setInput(sel, val) {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.value = String(val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },
  /** 撤销 / 重做按钮状态。scope 传 '.drawer' 时读抽屉里那一对。 */
  undoBtn(scope) {
    const root = scope ? document.querySelector(scope) : document;
    if (!root) return null;
    const st = (el) => (el ? {
      disabled: !!el.disabled,
      title: el.getAttribute('title') || '',
      text: (el.textContent || '').trim(),
    } : null);
    return { undo: st(root.querySelector('[data-undo-btn]')), redo: st(root.querySelector('[data-redo-btn]')) };
  },
  /** 列表首行备注（可观测的账本量：改备注 → 这里立刻跟着变） */
  firstItemTitle() {
    const t = document.querySelector('.item .l1 .title');
    return t ? t.textContent.trim() : '';
  },
  /** 抽屉里已作废的付款行数（可观测量：点「作废」→ 0 变 1） */
  voidedCount() { return document.querySelectorAll('.drawer .mrow.payrow.voided').length; },
  payRows() { return document.querySelectorAll('.drawer .mrow.payrow').length; },
  drawerOpen() { return !!document.querySelector('.drawer'); },
  closeDrawer() {
    const b = document.querySelector('.drawer-head button');
    if (!b) return false;
    b.click();
    return true;
  },
  /** 焦点移出输入框：App.onKey 对 input/textarea/select 直接 return，不抢原生撤销 */
  blurActive() {
    const a = document.activeElement;
    if (a && typeof a.blur === 'function') a.blur();
    return (document.activeElement && document.activeElement.tagName) || 'BODY';
  },
  kpi(key) {
    const el = document.querySelector('[data-kpi="' + key + '"] .v');
    return el ? el.textContent.trim() : '';
  },
};
true;
`;

/* Chrome 的 --user-data-dir 同样要按进程区分：同一个 profile 目录被两个 Chrome 实例同时
   持有时，后起的那个会被 profile 单例锁拦下并附到先起的实例上（自己的 --remote-debugging-port
   被忽略），两个套件于是抢同一个浏览器 —— 并发跑同一个套件就是这么塌的。 */
const userData = path.join(os.tmpdir(), `ztchrome-qa18k23ui-${process.pid}`);
/* 启动段单独 try：端口被抢占 / Chrome 起不来时也要产出一条 FAIL，
   绝不能让汇总器看到「0 通过 0 失败」——那会被当成通过。 */
let srv = null;
let chrome = null;
try {
  // Chrome 的 --remote-debugging-port 不接受 0，只能先探测出一个确定空闲的号再传给它
  PORT = await pickPort(PORT_PREF);
  srv = await startServer(SRV_PORT_PREF);
  SRV_PORT = srv.address()?.port || SRV_PORT_PREF;
  URL = `http://127.0.0.1:${SRV_PORT}/`;
  chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--window-size=800,676', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userData}`, 'about:blank',
  ], { stdio: 'ignore' });
} catch (e) {
  fail += 1;
  out.push(`FAIL 套件启动失败（静态服务器 / Chrome）：${e.message}`);
  console.log(out.join('\n'));
  console.log(`\n=== 通过 0 / 失败 1 / 合计 1 ===`);
  try { chrome?.kill('SIGKILL'); } catch (_) { /* 忽略 */ }
  try { srv?.close(); } catch (_) { /* 忽略 */ }
  process.exit(1);
}

const errors = [];
let exitCode = 0;
try {
  let ver;
  for (let i = 0; i < 40; i += 1) {
    try { ver = await wsGet(`http://127.0.0.1:${PORT}/json/version`); if (ver?.webSocketDebuggerUrl) break; } catch (_) { /* 等待 */ }
    await sleep(250);
  }
  if (!ver?.webSocketDebuggerUrl) throw new Error('Chrome 调试端口未就绪');
  let list;
  for (let i = 0; i < 40; i += 1) {
    try { list = await wsGet(`http://127.0.0.1:${PORT}/json/list`); if (Array.isArray(list) && list.length) break; } catch (_) { /* 等待 */ }
    await sleep(250);
  }
  const pageTarget = (list || []).find((t) => t.type === 'page') || list?.[0];
  if (!pageTarget?.webSocketDebuggerUrl) throw new Error('未找到页面级 target');

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws._open = resolve;
    ws.onerror = () => reject(new Error('ws 连接失败'));
    attachCdp(ws);
  });
  onEvent('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') errors.push('console: ' + (p.args || []).map((a) => a.value || a.description).join(' '));
  });
  onEvent('Runtime.exceptionThrown', (p) => {
    errors.push('exception: ' + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || '?'));
  });
  await cdp(ws, 'Runtime.enable');
  await cdp(ws, 'Page.enable');
  await cdp(ws, 'Emulation.enable');
  await cdp(ws, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 618, deviceScaleFactor: 1, mobile: false });
  await cdp(ws, 'Page.navigate', { url: URL });

  const evalJs = async (expr) => {
    const r = await cdp(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r?.exceptionDetails) throw new Error('eval 异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r?.result?.value;
  };
  const waitFor = async (expr, ms = 9000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await evalJs(expr)) return true;
      await sleep(150);
    }
    return false;
  };
  const goTab = async (i) => {
    await evalJs(`document.querySelectorAll('.rail-item')[${i}].click()`);
    await sleep(380);
  };
  /**
   * CDP 真键盘事件。modifiers 是位掩码：Alt=1 / Ctrl=2 / Meta=4 / Shift=8。
   * ⇧⌘Z = Meta(4) + Shift(8) = 12；⌘Z = 4。
   * 必须走 Input.dispatchKeyEvent（而不是在页面里 new KeyboardEvent）：后者是**合成**事件，
   * metaKey/shiftKey 得手写，且绕过了浏览器真实的按键分发 —— 那样测不出「监听器根本没接上」。
   */
  const sendCombo = async (modifiers) => {
    await evalJs('__qa.blurActive()');
    const args = { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 6, modifiers };
    await cdp(ws, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...args });
    await cdp(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', ...args });
    await sleep(560);
  };
  const SHIFT_CMD = 12; // ⇧⌘Z
  const CMD = 4;        // ⌘Z

  const btnState = async (scope) => evalJs(scope ? `__qa.undoBtn(${JSON.stringify(scope)})` : '__qa.undoBtn()');
  /** 从 title 里抠出「可撤销 N 步」/「可重做 N 步」的 N；按钮是灰的（title 为「没有可…的操作」）时为 0 */
  const stepsOf = (title, kind) => {
    const m = String(title || '').match(new RegExp(`可${kind}\\s*(\\d+)\\s*步`));
    return m ? Number(m[1]) : 0;
  };
  const undoStepsOf = (s) => stepsOf(s?.undo?.title, '撤销');
  const redoStepsOf = (s) => stepsOf(s?.redo?.title, '重做');

  /** 打开列表首条 → 编辑 → 改备注 → 保存 → 关抽屉 */
  const editFirstRemark = async (val) => {
    await evalJs("document.querySelector('.item').click()");
    await sleep(460);
    await evalJs("__qa.clickExact('编辑','.drawer')");
    await sleep(380);
    const okSet = await evalJs(`(() => {
      const el = document.querySelector('.drawer input[placeholder="如 客厅瓷砖"]');
      if (!el) return false;
      el.value = ${JSON.stringify(val)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!okSet) throw new Error('抽屉编辑态里没找到备注输入框（placeholder="如 客厅瓷砖"）');
    await sleep(240);
    await evalJs("__qa.clickExact('保存','.drawer')");
    await sleep(560);
    await evalJs('__qa.closeDrawer()');
    await sleep(380);
    return okSet;
  };
  /** 抽屉里点第一个「作废」（toggleVoid）—— 与改备注不同型的第二个动作，用于分岔场景 */
  const voidFirstPayment = async () => {
    await evalJs("document.querySelector('.item').click()");
    await sleep(460);
    const before = await evalJs('__qa.voidedCount()');
    const clicked = await evalJs("__qa.clickSel('.drawer .mrow.payrow .void-btn')");
    await sleep(560);
    const after = await evalJs('__qa.voidedCount()');
    return { before, after, clicked };
  };
  const clickUndo = async () => { await evalJs("__qa.clickSel('[data-undo-btn]')"); await sleep(560); };
  const clickRedo = async () => { await evalJs("__qa.clickSel('[data-redo-btn]')"); await sleep(560); };

  await waitFor("!!document.querySelector('.app')");
  await evalJs('localStorage.clear(), true');
  await cdp(ws, 'Page.reload');
  is('清空本地数据后应用重启', await waitFor("!!document.querySelector('.app') && !!document.querySelector('.rail')"));
  await evalJs(HELPERS);
  await evalJs('window.confirm = () => true; true');

  /* ---------------- ① 基线 ---------------- */
  section('① 基线：清库重启后两个按钮都是灰的');
  await goTab(1); // 费用列表
  await waitFor("!!document.querySelector('.item')");
  const s0 = await btnState();
  is('列表页存在 [data-undo-btn] 与 [data-redo-btn]', !!(s0 && s0.undo && s0.redo));
  eq('基线撤销按钮 disabled', s0.undo.disabled, true);
  eq('基线重做按钮 disabled', s0.redo.disabled, true);
  eq('基线撤销按钮 title', s0.undo.title, '没有可撤销的操作');
  eq('基线重做按钮 title', s0.redo.title, '没有可重做的操作');
  eq('基线可撤销 0 步', undoStepsOf(s0), 0);
  eq('基线可重做 0 步', redoStepsOf(s0), 0);
  const baseTitle = await evalJs('__qa.firstItemTitle()');
  is(`基线首行备注已取到（「${baseTitle}」）`, !!baseTitle);

  /* ---------------- ② 造动作 → 撤销按钮由灰变亮 ---------------- */
  section('② 造一个可撤销动作：改首条费用项备注');
  const V1 = `K18UI-动作1-${Date.now() % 100000}`;
  await editFirstRemark(V1);
  const t1 = await evalJs('__qa.firstItemTitle()');
  eq('动作后首行备注已变更', t1, V1);
  const s1 = await btnState();
  eq('动作后撤销按钮 enabled（灰 → 亮）', s1.undo.disabled, false);
  eq('动作后重做按钮仍 disabled（还没撤销过）', s1.redo.disabled, true);
  eq('动作后可撤销 1 步', undoStepsOf(s1), 1);
  eq('动作后可重做 0 步', redoStepsOf(s1), 0);
  is(`撤销按钮 title = 「${s1.undo.title}」`, s1.undo.title === `撤销上一步（⌘Z）· 可撤销 1 步`);
  eq('重做按钮 title', s1.redo.title, '没有可重做的操作');

  /* ---------------- ③ 点撤销 → 回到动作前 ---------------- */
  section('③ 点 [data-undo-btn]：账本回到动作前');
  await clickUndo();
  const t2 = await evalJs('__qa.firstItemTitle()');
  eq('点撤销后首行备注回到动作前', t2, baseTitle);
  not('点撤销后不再是动作后的值', t2 === V1);
  const s2 = await btnState();
  eq('撤销后重做按钮 enabled', s2.redo.disabled, false);
  eq('撤销后可重做 1 步', redoStepsOf(s2), 1);
  eq('撤销后可撤销 0 步（栈已见底）', undoStepsOf(s2), 0);
  is(`重做按钮 title = 「${s2.redo.title}」`, s2.redo.title === `重做上一步（⇧⌘Z）· 可重做 1 步`);

  /* ---------------- ④ 点重做 → 回到动作后 ---------------- */
  section('④ 点 [data-redo-btn]：账本又回到动作后');
  await clickRedo();
  const t3 = await evalJs('__qa.firstItemTitle()');
  eq('点重做后首行备注回到动作后', t3, V1);
  const s3 = await btnState();
  eq('重做后重做按钮重新 disabled（重做栈已空）', s3.redo.disabled, true);
  eq('重做后仍可撤销 1 步（redo 后仍能 undo）', undoStepsOf(s3), 1);
  eq('重做后可重做 0 步', redoStepsOf(s3), 0);

  /* ---------------- ⑤ 再点撤销 → 又回退（撤销→重做→撤销） ---------------- */
  section('⑤ 再点 [data-undo-btn]：撤销 → 重做 → 再撤销 三段闭环');
  await clickUndo();
  const t4 = await evalJs('__qa.firstItemTitle()');
  eq('第二次撤销后首行备注又回到动作前', t4, baseTitle);
  const s4 = await btnState();
  eq('第二次撤销后可重做 1 步', redoStepsOf(s4), 1);
  eq('第二次撤销后撤销按钮 disabled', s4.undo.disabled, true);
  is('三段状态序列 = 改前 → 改后 → 改前 → 改后 → 改前',
    [baseTitle, V1, baseTitle, V1, baseTitle].join('|') === [baseTitle, t1, t2, t3, t4].join('|'));

  /* ---------------- ⑥ 键盘 ⇧⌘Z / ⌘Z ---------------- */
  section('⑥ 键盘 ⇧⌘Z（Meta+Shift）= 重做，⌘Z（Meta）= 撤销');
  await sendCombo(SHIFT_CMD);
  const t5 = await evalJs('__qa.firstItemTitle()');
  eq('⇧⌘Z 后首行备注 = 动作后（等价于点重做）', t5, V1);
  const s5 = await btnState();
  eq('⇧⌘Z 后重做按钮 disabled（与点按钮同态）', s5.redo.disabled, true);
  eq('⇧⌘Z 后可撤销 1 步', undoStepsOf(s5), 1);
  await sendCombo(CMD);
  const t6 = await evalJs('__qa.firstItemTitle()');
  eq('⌘Z 后首行备注 = 动作前（等价于点撤销）', t6, baseTitle);
  const s6 = await btnState();
  eq('⌘Z 后可重做 1 步', redoStepsOf(s6), 1);
  eq('⌘Z 后撤销按钮 disabled', s6.undo.disabled, true);

  /* ---------------- ⑦ 分岔语义：撤销后开新岔 → 重做栈清空 ---------------- */
  section('⑦ 分岔：撤销后再做一个新动作（作废一笔付款）→ 重做栈清空');
  const s7a = await btnState();
  eq('分岔前可重做 1 步', redoStepsOf(s7a), 1);
  eq('分岔前重做按钮 enabled', s7a.redo.disabled, false);
  const vd = await voidFirstPayment();
  is(`抽屉里点到了「作废」按钮（付款行 ${await evalJs('__qa.payRows()')} 条）`, vd.clicked);
  eq('作废前已作废行数 = 0', vd.before, 0);
  eq('作废后已作废行数 = 1（动作确实落库）', vd.after, 1);
  const s7 = await btnState();
  eq('开岔后重做按钮变回 disabled（重做栈已清空）', s7.redo.disabled, true);
  eq('开岔后重做 title 回到「没有可重做的操作」', s7.redo.title, '没有可重做的操作');
  eq('开岔后可重做 0 步', redoStepsOf(s7), 0);
  eq('开岔后撤销按钮 enabled（新动作本身可撤）', s7.undo.disabled, false);
  // 反证：此时再按 ⇧⌘Z 不应有任何反应（旧「未来」已作废）
  await evalJs('__qa.closeDrawer()');
  await sleep(360);
  await sendCombo(SHIFT_CMD);
  const t7 = await evalJs('__qa.firstItemTitle()');
  eq('开岔后 ⇧⌘Z 无反应（备注仍是动作前）', t7, baseTitle);
  eq('开岔后 ⇧⌘Z 仍是 0 步可重做', redoStepsOf(await btnState()), 0);
  // 分岔动作本身可撤销 → 撤销它，回到干净基线
  await clickUndo();
  await evalJs("document.querySelector('.item').click()");
  await sleep(480);
  eq('撤销分岔动作后已作废行数回到 0', await evalJs('__qa.voidedCount()'), 0);
  await evalJs('__qa.closeDrawer()');
  await sleep(360);
  const t8 = await evalJs('__qa.firstItemTitle()');
  eq('撤销分岔动作后备注仍是动作前（两步栈都退干净）', t8, baseTitle);

  /* ---------------- ⑧ 步数文案随栈深变化 ---------------- */
  section('⑧ 「可撤销 N 步 / 可重做 N 步」随栈深变化');
  const V2 = `K18UI-动作2-${Date.now() % 100000}`;
  await editFirstRemark(V2);
  const d1 = await btnState();
  eq('第 1 个动作后：可撤销 1 步', undoStepsOf(d1), 1);
  const V3 = `K18UI-动作3-${Date.now() % 100000}`;
  await editFirstRemark(V3);
  const d2 = await btnState();
  eq('第 2 个动作后：可撤销 2 步（步数递增）', undoStepsOf(d2), 2);
  eq('第 2 个动作后：可重做 0 步', redoStepsOf(d2), 0);
  await clickUndo();
  const d3 = await btnState();
  eq('撤销一次后：可撤销 1 步（步数递减）', undoStepsOf(d3), 1);
  eq('撤销一次后：可重做 1 步', redoStepsOf(d3), 1);
  await clickUndo();
  const d4 = await btnState();
  eq('撤销两次后：可撤销 0 步', undoStepsOf(d4), 0);
  eq('撤销两次后：可重做 2 步', redoStepsOf(d4), 2);
  await clickRedo();
  const d5 = await btnState();
  eq('重做一次后：可撤销 1 步', undoStepsOf(d5), 1);
  eq('重做一次后：可重做 1 步', redoStepsOf(d5), 1);
  await clickRedo();
  const d6 = await btnState();
  eq('重做两次后：可撤销 2 步', undoStepsOf(d6), 2);
  eq('重做两次后：可重做 0 步', redoStepsOf(d6), 0);
  eq('重做两次后备注回到 V3', await evalJs('__qa.firstItemTitle()'), V3);

  /* ---------------- ⑨ 付款页 PayView 的同一对按钮 ---------------- */
  section('⑨ 付款页 PayView 的同一对按钮：同态且点了同样生效');
  await goTab(2); // 付款页
  await waitFor("!!document.querySelector('.item')");
  const p1 = await btnState();
  is('付款页也有一对 [data-undo-btn] / [data-redo-btn]', !!(p1 && p1.undo && p1.redo));
  eq('付款页撤销按钮 enabled（与列表页同态）', p1.undo.disabled, false);
  eq('付款页可撤销步数与列表页一致 = 2', undoStepsOf(p1), 2);
  await clickUndo();
  const p2 = await btnState();
  eq('在付款页点撤销后步数减一 = 1', undoStepsOf(p2), 1);
  eq('在付款页点撤销后可重做 1 步', redoStepsOf(p2), 1);
  await goTab(1);
  await waitFor("!!document.querySelector('.item')");
  eq('付款页的撤销确实作用到同一份账本（备注回到 V2）', await evalJs('__qa.firstItemTitle()'), V2);
  await clickRedo(); // 恢复成 V3，与下一节衔接

  /* ---------------- ⑩ 抽屉 ItemSheet 的同一对按钮 ---------------- */
  section('⑩ 抽屉 .drawer 里的同一对按钮：点了同样生效');
  await goTab(1);
  await waitFor("!!document.querySelector('.item')");
  eq('衔接：备注已是 V3', await evalJs('__qa.firstItemTitle()'), V3);
  await evalJs("document.querySelector('.item').click()");
  await sleep(480);
  is('抽屉已打开', await evalJs('__qa.drawerOpen()'));
  const w1 = await btnState('.drawer');
  is('抽屉里也有一对按钮', !!(w1 && w1.undo && w1.redo));
  eq('抽屉撤销按钮 enabled', w1.undo.disabled, false);
  eq('抽屉可撤销步数与列表页一致 = 2', undoStepsOf(w1), 2);
  await evalJs("__qa.clickSel('.drawer [data-undo-btn]')");
  await sleep(580);
  const w2 = await btnState('.drawer');
  eq('在抽屉里点撤销后步数减一 = 1', undoStepsOf(w2), 1);
  eq('在抽屉里点撤销后可重做 1 步', redoStepsOf(w2), 1);
  await evalJs('__qa.closeDrawer()');
  await sleep(380);
  eq('抽屉里的撤销同样作用到账本（备注回到 V2）', await evalJs('__qa.firstItemTitle()'), V2);

  /* ---------------- ⑪ 收尾：全部撤销回基线 + 三条红线 ---------------- */
  section('⑪ 收尾：一路撤销回基线，再复核三条红线');
  let guard = 0;
  while (guard < 12) {
    if (await evalJs("(document.querySelector('[data-undo-btn]')||{}).disabled")) break;
    await clickUndo();
    guard += 1;
  }
  is(`撤销到底（点了 ${guard} 次）`, guard < 12);
  eq('全部撤销后首行备注回到基线', await evalJs('__qa.firstItemTitle()'), baseTitle);
  const sEnd = await btnState();
  eq('全部撤销后撤销按钮 disabled', sEnd.undo.disabled, true);
  eq('全部撤销后可撤销 0 步', undoStepsOf(sEnd), 0);

  // 红线（UI 侧）：概览页四张 KPI 的**渲染值**逐字核对
  await goTab(0); // 概览
  await waitFor("!!document.querySelector('[data-kpi=\"payable\"]')");
  eq('红线① 概览 KPI 累计应付 = ¥246,055.97', await evalJs("__qa.kpi('payable')"), '¥246,055.97');
  eq('红线① 概览 KPI 已支付 = ¥188,529.11', await evalJs("__qa.kpi('paid')"), '¥188,529.11');
  eq('红线① 概览 KPI 待支付 = ¥57,526.86', await evalJs("__qa.kpi('due')"), '¥57,526.86');
  eq('红线① 概览 KPI 项目总预算 = ¥234,688.00', await evalJs("__qa.kpi('budget')"), '¥234,688.00');

  // 红线（数据侧）：把界面此刻的账本搬到 node 里用真函数复核，避免只信渲染值
  const dump = await evalJs(`localStorage.getItem(${JSON.stringify(LS_KEY)})`);
  is('能从 localStorage 取回主数据键', !!dump);
  localStorage.clear();
  localStorage.setItem(LS_KEY, dump);
  store.boot();
  const bk = store.book.value;
  const c = calc(bk);
  near('红线① 应付 246055.97', c.payable, 246055.97);
  near('红线① 已付 188529.11', c.paid, 188529.11);
  near('红线① 待付 57526.86', c.remain, 57526.86);
  near('红线① 预算 234688.00', c.totalBudget, 234688);
  near('红线① 结余 −11367.97', c.balance, -11367.97);
  eq('红线② 预算键 13 个', Object.keys(bk.budget).length, 13);
  near('红线② sumBudget = 234688', sumBudget(bk), 234688);
  eq('红线③ 费用项 71 / 明细 384 / 付款 88',
    [bk.projects.length, c.detailCount, c.payCount].join(','), '71,384,88');

  // 红线③ round-trip：付款表导出 → 按表头对齐回读，88 行 0 坏行
  const csvCell = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = payRows(bk);
  eq('红线③ 付款表导出 88 行', rows.length, 88);
  const text = `${HEADS.pay.join(',')}\n${rows.map((r) => r.map(csvCell).join(',')).join('\n')}`;
  const grid = parseDelimited(text);
  is('红线③ 首行被识别为表头行', isHeaderRow('pay', grid[0]));
  const back = grid.slice(1).map((cells) => mapRow('pay', alignByHeader('pay', grid[0], cells)));
  eq('红线③ 付款表回读 88 行 0 坏行', back.filter((r) => !r.error).length, 88);

  eq('全程无 JS 报错', errors.length, 0);
  if (errors.length) out.push('   报错明细：\n   ' + errors.slice(0, 8).join('\n   '));
} catch (e) {
  fail += 1;
  failures.push('套件异常: ' + e.message);
  out.push(`FAIL 套件异常: ${String((e && e.message) || e)}`);
  exitCode = 1;
} finally {
  try { chrome.kill('SIGKILL'); } catch (_) { /* 忽略 */ }
  try { srv.close(); } catch (_) { /* 忽略 */ }
}

/* 兜底：一条断言都没产出 = 套件根本没跑起来（端口抢占 / Chrome 未就绪 / dist 未构建），
   必须算失败 —— 否则汇总器会把它显示成「通过 0 / 失败 0」，看起来像绿。 */
if (pass === 0 && fail === 0) {
  fail += 1;
  out.push(`FAIL 套件一条断言都没产出 —— 绝不能算通过（常见原因：端口 ${SRV_PORT} 被并发套件抢占 / Chrome 未就绪 / dist 未构建）`);
}
console.log(out.join('\n'));
console.log(`\n=== 通过 ${pass} / 失败 ${fail} / 合计 ${pass + fail} ===`);
if (failures.length) {
  console.log('\n失败清单：');
  failures.forEach((f) => console.log(` - ${f}`));
}
if (fail) exitCode = 1;
process.exit(exitCode);

/**
 * H 版式回归：headless Chrome + CDP 冒烟
 *  - 应用启动无 JS 报错 / 无 console error
 *  - 左轨 .rail 宽度 = 62px
 *  - .main 不裁剪（overflow hidden）
 *  - 6 个 tab 逐一渲染，每个视图都有 .pane 且 overflow-y 为 auto/scroll（可滚动容器存在）
 *  - 切换 tab 过程中无异常
 * 前置：python3 -m http.server 8123 --directory dist 已就绪
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import { pickPort, listenServer } from './free-port.mjs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/**
 * 端口：**只是首选值**，不是写死的固定端口。并发跑多个 UI 套件时若首选号已被占，
 * 由 scripts/free-port.mjs 自动退让到 OS 分配的空闲端口 —— 端口撞车会让
 * `srv.listen()` 的回调永不触发，套件挂到看门狗超时后一条断言都不产出，
 * 汇总器会把「0 通过 0 失败」画成 ✓（假通过）。
 */
const SRV_PORT_PREF = 8231;
const PORT_PREF = 9223;
/** 运行期真实端口：必须等 startServer / pickPort 返回后才有值，顶层不能提前拼 URL */
let SRV_PORT = SRV_PORT_PREF;
let PORT = PORT_PREF;
let URL = '';
const DIST = path.resolve('dist');

// 内置静态服务器（self-contained，不依赖外部后台进程）
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
function startServer(preferred) {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const fp = path.join(DIST, p);
    if (!fp.startsWith(DIST) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
  });
  /* 首选号被占就退让到 OS 分配的空闲端口（listenServer 内部一次 bind 到位，没有探测竞态）。
     两次都失败必须显式抛错：不给 error 兜底的话 listen 的回调**永远不触发**，套件会挂到
     看门狗超时，最后被汇总器记成「0 通过 0 失败」——那会被当成通过。 */
  return listenServer(srv, preferred).catch((e) => {
    throw new Error(`静态服务器端口 ${preferred} 绑定失败（${e?.code}）——多半被另一个并发跑的 UI 套件占了，单独重跑本套件即可`);
  });
}
/* URL 必须等拿到真实端口之后再拼（见下方启动段）——顶层拼会拿到首选值而不是实际端口。 */
const out = [];
const ok = (label, actual, expected) => {
  const pass = String(actual) === String(expected) || (expected === 'truthy' && !!actual);
  out.push(`${pass ? 'PASS' : 'FAIL'} ${label}: ${actual}${pass ? '' : ` (期望 ${expected})`}`);
  return pass;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wsGet = async (u) => (await fetch(u)).json();
// 看门狗：最多 60s，避免任何 await 挂起导致进程僵死
setTimeout(() => { console.error('WATCHDOG: 超时强制退出'); process.exit(2); }, 60000).unref();

// CDP 客户端：属性式 onmessage（node 全局 WebSocket 的 addEventListener 不可靠）
let _seq = 1;
const _pending = new Map();
const _events = []; // {method, cb}
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

/* Chrome 的 --user-data-dir 同样要按进程区分：同一个 profile 目录被两个 Chrome 实例同时
   持有时，后起的那个会被 profile 单例锁拦下并附到先起的实例上（自己的 --remote-debugging-port
   被忽略），两个套件于是抢同一个浏览器 —— 并发跑同一个套件就是这么塌的。 */
const userData = path.join(os.tmpdir(), `ztchrome-h-${process.pid}`);
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
  console.error('static server on', SRV_PORT);
  chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--window-size=800,676', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userData}`, 'about:blank',
  ], { stdio: 'ignore' });
  console.error('chrome spawned, waiting for port...');
} catch (e) {
  out.push(`FAIL 套件启动失败（静态服务器 / Chrome）：${e.message}`);
  console.log(out.join('\n'));
  console.log('\n=== 通过 0 / 失败 1 / 合计 1 ===');
  try { chrome?.kill('SIGKILL'); } catch (_) { /* 忽略 */ }
  try { srv?.close(); } catch (_) { /* 忽略 */ }
  process.exit(1);
}

const errors = [];
let exitCode = 0;
try {
  // 等调试端口
  let ver;
  for (let i = 0; i < 40; i++) {
    try { ver = await wsGet(`http://127.0.0.1:${PORT}/json/version`); if (ver?.webSocketDebuggerUrl) break; } catch (_) {}
    await sleep(250);
  }
  if (!ver?.webSocketDebuggerUrl) throw new Error('Chrome 调试端口未就绪');
  console.error('version ok');

  // 取页面级 target 的 ws（不能用浏览器级 ws 直接调 Runtime）
  let list;
  for (let i = 0; i < 40; i++) {
    try { list = await wsGet(`http://127.0.0.1:${PORT}/json/list`); if (Array.isArray(list) && list.length) break; } catch (_) {}
    await sleep(250);
  }
  const pageTarget = (list || []).find((t) => t.type === 'page') || list?.[0];
  if (!pageTarget?.webSocketDebuggerUrl) throw new Error('未找到页面级 target');
  console.error('list ok, targets:', (list || []).length, 'page ws:', pageTarget.webSocketDebuggerUrl);

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws._open = resolve;
    ws.onerror = () => reject(new Error('ws 连接失败'));
    attachCdp(ws);
  });
  console.error('ws open');
  onEvent('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') errors.push('console: ' + (p.args || []).map((a) => a.value || a.description).join(' ')); });
  onEvent('Runtime.exceptionThrown', (p) => { errors.push('exception: ' + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || '?')); });
  await cdp(ws, 'Runtime.enable');
  console.error('runtime enabled');
  await cdp(ws, 'Page.enable');
  console.error('page enabled');
  await cdp(ws, 'Page.navigate', { url: URL });
  console.error('navigated');

  // 等 .app 渲染
  let booted = false;
  for (let i = 0; i < 40; i++) {
    const r = await cdp(ws, 'Runtime.evaluate', { expression: "!!document.querySelector('.app') && !!document.querySelector('.rail')", returnByValue: true });
    if (r.result?.value) { booted = true; break; }
    await sleep(250);
  }
  ok('应用启动（.app + .rail 渲染）', booted, true);

  // 左轨宽度
  const rail = await cdp(ws, 'Runtime.evaluate', { expression: "getComputedStyle(document.querySelector('.rail')).width", returnByValue: true });
  ok('左轨宽度 = 62px', rail.result?.value, '62px');

  // .main overflow
  const mainOv = await cdp(ws, 'Runtime.evaluate', { expression: "getComputedStyle(document.querySelector('.main')).overflow", returnByValue: true });
  ok('.main overflow = hidden', mainOv.result?.value, 'hidden');

  // 6 个 tab 逐一渲染：检查真正的滚动层 .content / .list-scroll
  const itemsCount = await cdp(ws, 'Runtime.evaluate', { expression: "document.querySelectorAll('.rail-item').length", returnByValue: true });
  ok('rail-item 数量 ≥ 6', itemsCount.result?.value >= 6, true);
  const n = Math.min(6, itemsCount.result?.value || 0);
  let anyScrollable = false;
  for (let i = 0; i < n; i++) {
    await cdp(ws, 'Runtime.evaluate', { expression: `document.querySelectorAll('.rail-item')[${i}].click()`, returnByValue: true });
    await sleep(350);
    const r = await cdp(ws, 'Runtime.evaluate', {
      expression: "(()=>{const el=document.querySelector('.list-scroll')||document.querySelector('.content'); if(!el) return {has:false}; const cs=getComputedStyle(el); return {has:true, oy:cs.overflowY, mh:cs.minHeight, sh:el.scrollHeight, ch:el.clientHeight};})()",
      returnByValue: true,
    });
    const v = r.result?.value || {};
    const scrollLayer = v.oy === 'auto' || v.oy === 'scroll';
    ok(`tab#${i} 滚动层存在且 overflow-y:auto`, v.has && scrollLayer, true);
    ok(`tab#${i} 滚动层 min-height:0（关键修复）`, v.has ? (v.mh === '0px' || v.mh === '0') : 'n/a', v.has ? 'truthy' : 'n/a');
    if (v.has && v.sh > v.ch) anyScrollable = true;
  }
  // 在「明细」页（71 行）验证内容确实溢出并可滚动
  ok('存在可滚动页面（内容溢出）', anyScrollable, true);
  ok('切换 6 个 tab 无 JS 报错', errors.length === 0, true);
  if (errors.length) out.push('   报错明细：\n   ' + errors.slice(0, 10).join('\n   '));
} catch (e) {
  out.push(`FAIL 流程异常: ${String(e && e.message || e)}`);
  exitCode = 1;
} finally {
  try { chrome.kill('SIGKILL'); } catch (_) {}
  try { srv?.close(); } catch (_) {}
}

/* 兜底：一条断言都没产出 = 套件根本没跑起来（端口抢占 / Chrome 未就绪 / dist 未构建），
   必须算失败 —— 否则汇总器会把它显示成「通过 0 / 失败 0」，看起来像绿。 */
if (out.length === 0) {
  out.push('FAIL 套件一条断言都没产出 —— 绝不能算通过（常见原因：端口被并发套件抢占 / Chrome 未就绪 / dist 未构建）');
}
const fails = out.filter((l) => l.startsWith('FAIL'));
console.log(out.join('\n'));
console.log(`\n=== ${fails.length ? `${fails.length} 项失败` : '全部通过'} ===`);
if (fails.length) exitCode = 1;
process.exit(exitCode);

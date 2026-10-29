/**
 * K14②（v1.8.2）第三档「大字」密度 —— 独立回归
 *
 * 背景：挑剔客户投诉紧凑档字号 <12px 看不清。但把紧凑档抬到 12px 会让单行
 * 35.92px → 约 38.4px，v1.7 B3「首屏 10+ 条 / 单行 ≤38px」随即失效。
 * 用户裁决：**紧凑档一个字都不改，另开第三档「大字」**（三行布局、所有文字 ≥12px）。
 *
 * 因此本套件有两条同样重要的职责，缺一不可：
 *   ① 证明新档位真的可用（三态循环、持久化、字号达标、栅格没塌）；
 *   ② **替 v1.7 B3 站岗** —— 证明紧凑档的行高与首屏条数一个像素都没变。
 *   只验证 ① 是很容易自欺的：改坏紧凑档同样能让 ① 全绿。
 *
 * 覆盖：
 *   ① 逻辑层：DENSITIES 三档、默认仍是 compact、normDensity 接受 large 且仍拒绝非法值；
 *   ② 默认态：localStorage 键与 DOM 的 data-density 都是 compact；
 *   ③ 密度直达菜单（K22）：chip → 三档菜单（当前高亮 + 说明常驻可见）→ 点选直达，每态文案与属性一致；
 *   ④ B3 站岗：紧凑档行高 ≈35.92px、首屏 ≥10 条，且 `.l2` 仍是 10px（反向钉：紧凑档未被改动）；
 *   ⑤ 大字档：行内**所有**直接含文字的元素 font-size ≥ 12px（遍历全部行，含 .hit / .subline）；
 *   ⑥ 取舍可见：大字档行高 > 紧凑档，首屏条数相应变少（这是用户已知并接受的代价）；
 *   ⑦ 持久化：切到大字后重载页面仍是大字。
 *
 * 用法：npx esbuild scripts/verify-k14b.mjs --bundle --platform=node --format=esm \
 *         --define:process.env.NODE_ENV='"development"' --outfile=/tmp/k14b.mjs && node /tmp/k14b.mjs
 * 前置：dist/ 已构建（npx vite build）。
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import { pickPort, listenServer } from './free-port.mjs';
import { DENSITIES, DENSITY_DEFAULT, DENSITY_KEY, normDensity } from '../src/lib/prefs.js';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/**
 * 端口：**只是首选值**，不是写死的固定端口。并发跑多个 UI 套件时若首选号已被占，
 * 由 scripts/free-port.mjs 自动退让到 OS 分配的空闲端口 —— 端口撞车会让
 * `srv.listen()` 的回调永不触发，套件挂到看门狗超时后一条断言都不产出，
 * 汇总器会把「0 通过 0 失败」画成 ✓（假通过）。
 */
const SRV_PORT_PREF = 8246;
const PORT_PREF = 9236;
/** 运行期真实端口：必须等 startServer / pickPort 返回后才有值，顶层不能提前拼 URL */
let SRV_PORT = SRV_PORT_PREF;
let PORT = PORT_PREF;
let URL = '';
const DIST = path.resolve('dist');

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
     两次都失败必须显式抛错：不给 error 兜底的话 listen 的回调**永远不触发**，套件会挂到
     看门狗超时，最后被汇总器记成「0 通过 0 失败」——那会被当成通过。 */
  return listenServer(srv, preferred).catch((e) => {
    throw new Error(`静态服务器端口 ${preferred} 绑定失败（${e?.code}）——多半被另一个并发跑的 UI 套件占了，单独重跑本套件即可`);
  });
}
/* URL 必须等拿到真实端口之后再拼（见下方启动段）——顶层拼会拿到首选值而不是实际端口。 */

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
const section = (t) => out.push(`\n== ${t} ==`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wsGet = async (u) => (await fetch(u)).json();
setTimeout(() => { console.error('WATCHDOG: 超时强制退出'); process.exit(2); }, 180000).unref();

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
  rect(sel) { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { height: r.height, top: r.top, bottom: r.bottom }; },
  clickSel(sel) { const el = document.querySelector(sel); if (!el) return false; el.click(); return true; },
  setInput(sel, val) {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.value = String(val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },
  /** 密度 chip 当前文案与容器属性 */
  densityState() {
    const chip = document.querySelector('[data-density-toggle]');
    const list = document.querySelector('.list[data-density]');
    return {
      chip: chip ? chip.textContent.replace(/\\s+/g, ' ').trim() : '',
      attr: list ? list.getAttribute('data-density') : '',
      ls: (() => { try { return localStorage.getItem('${DENSITY_KEY}'); } catch (_) { return null; } })(),
      chipAttr: chip ? (chip.getAttribute('data-density-current') || '') : '',
    };
  },
  /** 行高 + 首屏条数（容器 clientHeight ÷ 行高） */
  rowMetrics() {
    const row = document.querySelector('.item');
    if (!row) return null;
    const h = row.getBoundingClientRect().height;
    const sc = document.querySelector('.list-scroll') || document.querySelector('.list');
    const scH = sc ? sc.clientHeight : 0;
    return { h, scH, fit: h > 0 ? Math.floor(scH / h) : 0 };
  },
  /**
   * 遍历**所有** .item 行里「直接含非空白文字」的元素，返回最小 font-size 及元凶。
   * 用 querySelectorAll('*') 覆盖而非逐个手写类名 —— 手写会漏掉将来新增的元素。
   * 只统计「直接含文字」的元素：容器元素自身没有文字节点，跳过它们，
   * 否则会把 .l2 这种父级（继承值）也算进来，导致误判。
   */
  minFontInRows() {
    let min = Infinity, who = '', samples = [];
    for (const row of document.querySelectorAll('.item')) {
      for (const el of row.querySelectorAll('*')) {
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!own) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        const cls = (el.className || el.tagName || '').toString();
        if (fs < min) { min = fs; who = cls; }
        samples.push({ cls, fs });
      }
    }
    const uniq = [...new Map(samples.map((s) => [s.cls + '@' + s.fs, s])).values()];
    return { min: min === Infinity ? null : min, who, count: samples.length, kinds: uniq.length };
  },
  /** 某一类元素在所有行里的最大 font-size（用于反向钉「紧凑档仍是 10px」） */
  fontOf(sel) {
    const els = [...document.querySelectorAll(sel)];
    if (!els.length) return null;
    return Math.max(...els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
  },
  /**
   * 通用：某选择器命中的**整棵子树**里「直接含文字」元素的最小 font-size。
   * 图表 / 抽屉这类非 .item 场景用它 —— 逐个手写类名会漏掉将来新增的元素
   * （本次就补上了图例 .legend 与柱底标签 .ml 两个漏网之鱼）。
   * @returns {{min:number, who:string, n:number}|null} 一个都没命中时返回 null
   */
  minFontDeep(sel) {
    const roots = [...document.querySelectorAll(sel)];
    if (!roots.length) return null;
    let min = Infinity, who = '', n = 0;
    for (const root of roots) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        const own = [...el.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim());
        if (!own) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        n += 1;
        if (fs < min) { min = fs; who = (el.className || el.tagName || '').toString(); }
      }
    }
    return n ? { min, who, n } : null;
  },
  /**
   * 环形图：SVG <text> 的字号写在 font-size **属性**上（不是 CSS 规则），
   * 故单独读属性；万一哪天改成 CSS 兜底到 computed。
   */
  donutMin() {
    const els = [...document.querySelectorAll('.donut-wrap svg text')];
    if (!els.length) return null;
    let min = Infinity, who = '';
    for (const e of els) {
      const raw = e.getAttribute('font-size');
      const fs = raw ? parseFloat(raw) : parseFloat(getComputedStyle(e).fontSize);
      if (fs < min) { min = fs; who = (e.textContent || '').trim().slice(0, 10); }
    }
    return { min, who, n: els.length };
  },
  /** 元素自身挂的 data-density（K16：抽屉/图表各自直读全局信号） */
  densityAttr(sel) {
    const el = document.querySelector(sel);
    return el ? (el.getAttribute('data-density') || '') : '';
  },
  /** 关抽屉：抽屉头第一个按钮（实测可用的关闭出口） */
  closeDrawer() {
    const b = document.querySelector('.drawer-head button');
    if (!b) return false;
    b.click();
    return true;
  },
  txt(sel) { const el = document.querySelector(sel); return el ? el.textContent.replace(/\\s+/g, ' ').trim() : ''; },
};
true;
`;

/* ============================================================ ① 逻辑层 */
section('① 逻辑层：三档合法值 / 默认仍是紧凑 / 非法值仍回落');
eq('DENSITIES 三档且顺序为 紧凑→舒适→大字', DENSITIES.join(','), 'compact,comfort,large');
eq('DENSITY_DEFAULT 仍是 compact（v1.7 B3 口径不变）', DENSITY_DEFAULT, 'compact');
eq('DENSITY_KEY 未改名（老用户的偏好不丢）', DENSITY_KEY, 'ztools_rc_density');
eq('normDensity(compact) = compact', normDensity('compact'), 'compact');
eq('normDensity(comfort) = comfort', normDensity('comfort'), 'comfort');
eq('normDensity(large) = large（新档被接受）', normDensity('large'), 'large');
eq('normDensity(huge) 仍回落 compact（非法值不因新增档而松动）', normDensity('huge'), 'compact');
eq('normDensity(undefined) 仍回落 compact', normDensity(undefined), 'compact');
eq('normDensity(null) 仍回落 compact', normDensity(null), 'compact');
eq('DENSITIES 含默认档（否则 toggleDensity 的取模会跳档）', DENSITIES.includes(DENSITY_DEFAULT), true);

/* ============================================================ 浏览器段 */
/* Chrome 的 --user-data-dir 同样要按进程区分：同一个 profile 目录被两个 Chrome 实例同时
   持有时，后起的那个会被 profile 单例锁拦下并附到先起的实例上（自己的 --remote-debugging-port
   被忽略），两个套件于是抢同一个浏览器 —— 并发跑同一个套件就是这么塌的。 */
const userData = path.join(os.tmpdir(), `ztchrome-qa14b-${process.pid}`);
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
  failures.push('套件启动失败: ' + e.message);
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
  // 钉死 CSS 视口 800×618：headless 窗口边框会吃掉高度，容器被压扁后首屏行数失真
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
    await sleep(360);
  };
  const clickDensity = async () => { await evalJs("__qa.clickSel('[data-density-toggle]')"); await sleep(320); };
  /** K22：直达菜单选档 —— 打开 chip 菜单后点对应选项（替代旧三态循环的盲点）。
   *  幂等：菜单已开着就只点选项（否则再点 chip 会把菜单关掉，正好静默失败）。 */
  const pickDensity = async (v) => {
    const opened = await evalJs("!!document.querySelector('[data-density-menu]')");
    if (!opened) { await evalJs("__qa.clickSel('[data-density-toggle]')"); await sleep(240); }
    await evalJs(`__qa.clickSel('[data-density-opt="${v}"]')`);
    await sleep(320);
  };

  await waitFor("!!document.querySelector('.app')");
  await evalJs('localStorage.clear(), true');
  await cdp(ws, 'Page.reload');
  is('清空本地数据后应用重启', await waitFor("!!document.querySelector('.app') && !!document.querySelector('.rail')"));
  await evalJs(HELPERS);
  await evalJs('window.confirm = () => true; true');

  /* ---------------- ② 默认态 ---------------- */
  section('② 默认态：仍是紧凑（B3 口径不变）');
  await goTab(1); // 费用列表
  await waitFor("!!document.querySelector('.item')");
  const d0 = await evalJs('__qa.densityState()');
  eq('默认 chip 文案 = 密度·紧凑', d0.chip, '密度·紧凑');
  eq('默认容器 data-density = compact', d0.attr, 'compact');
  eq('默认 chip 的 data-density-current = compact', d0.chipAttr, 'compact');
  // 惰性写入：没手动切过就不落库，靠「读不到 → 回落默认」得到紧凑。
  // 钉住这一点，可防止有人为了"让 localStorage 看起来完整"而在启动时 eager 写入，
  // 那会把「用户从未表达过偏好」和「用户明确选了紧凑」混为一谈（换机器 / 清缓存后语义不同）。
  eq('默认未落库（localStorage 无该键，靠缺失回落紧凑）', d0.ls, null);

  /* ---------------- ③ 密度直达菜单（K22：不再三态盲点循环） ---------------- */
  section('③ 密度直达菜单：点击 chip 弹三档、说明常驻、点选直达');
  await clickDensity(); // 打开菜单
  eq('点击 chip 后菜单出现', await evalJs("!!document.querySelector('[data-density-menu]')"), true);
  eq('菜单有且仅有三个选项（三态直达）',
    await evalJs("document.querySelectorAll('[data-density-opt]').length"), 3);
  eq('当前档（紧凑）高亮',
    await evalJs("(document.querySelector('[data-density-opt].on') || {}).getAttribute ? document.querySelector('[data-density-opt].on').getAttribute('data-density-opt') : ''"), 'compact');
  // K22 核心：说明作为**可见副标题**常驻菜单（不再只藏在悬停 title 里）
  const menuText = await evalJs("document.querySelector('[data-density-menu]').textContent");
  is('说明副标题常驻：紧凑档 35.92px 可见', menuText.includes('35.92px'), menuText.slice(0, 80));
  is('说明副标题常驻：舒适档约 57px 可见', menuText.includes('57px'));
  is('说明副标题常驻：大字档 ≥12px 可见', menuText.includes('≥12px'));

  await pickDensity('comfort');
  const d1 = await evalJs('__qa.densityState()');
  eq('点选「舒适」→ 直达舒适（文案）', d1.chip, '密度·舒适');
  eq('点选「舒适」→ 直达舒适（属性）', d1.attr, 'comfort');
  eq('点选「舒适」→ localStorage 已落 comfort', d1.ls, 'comfort');
  eq('点选后菜单收起', await evalJs("!!document.querySelector('[data-density-menu]')"), false);

  await pickDensity('large');
  const d2 = await evalJs('__qa.densityState()');
  eq('点选「大字」→ 直达大字（文案）', d2.chip, '密度·大字');
  eq('点选「大字」→ 直达大字（属性）', d2.attr, 'large');
  eq('点选「大字」→ localStorage 已落 large', d2.ls, 'large');

  await pickDensity('compact');
  const d3 = await evalJs('__qa.densityState()');
  eq('点选「紧凑」→ 回到紧凑（三档闭合）', d3.attr, 'compact');
  eq('点选「紧凑」→ 文案回到密度·紧凑', d3.chip, '密度·紧凑');

  /* ---------------- ④ B3 站岗：紧凑档一个像素都没变 ---------------- */
  section('④ B3 站岗：紧凑档行高 / 首屏条数 / 字号均未被改动');
  const mc = await evalJs('__qa.rowMetrics()');
  is('紧凑单行高度 ≈ 35.92px（32..40 区间）', mc.h >= 32 && mc.h <= 40, mc.h.toFixed(2));
  is(`紧凑首屏 ≥ 10 条（容器 ${mc.scH} ÷ 行高 ${mc.h.toFixed(2)} = ${mc.fit}）`, mc.fit >= 10, mc.fit);
  // 反向钉：紧凑档的小字号**故意保留** —— 若哪天被"顺手统一"，B3 就破了
  eq('紧凑档 .l2 仍是 10px（未被大字档污染）', await evalJs("__qa.fontOf('.item .l2')"), 10);
  eq('紧凑档 .subline 仍是 9.5px', await evalJs("__qa.fontOf('.item .subline')"), 9.5);
  eq('紧凑档 .title 仍是 12.5px', await evalJs("__qa.fontOf('.item .title')"), 12.5);

  /* ---------------- ⑤ 大字档：所有文字 ≥12px ---------------- */
  section('⑤ 大字档：行内所有含文字元素 ≥ 12px');
  await pickDensity('large'); // 紧凑 → 大字（K22 直达菜单，不再两击循环）
  const dl = await evalJs('__qa.densityState()');
  eq('已切到大字档', dl.attr, 'large');
  // 先在**未筛选**的全表上扫：71 行里才有「部分付」行，.subline 才会存在
  // （.subline 只在 status==='part' 时渲染）。先搜索会把它筛掉，导致静默漏检。
  const ml = await evalJs('__qa.minFontInRows()');
  is(`大字档扫描到 ${ml.count} 个含文字元素（${ml.kinds} 种）`, ml.count > 0);
  is(`大字档最小字号 ${ml.min}px ≥ 12px（最小者是 .${ml.who}）`, ml.min !== null && ml.min >= 12, ml.min);
  // 逐类钉死，防止"最小值的元凶恰好被隐藏"这种自欺
  eq('大字档 .title ≥ 12px', await evalJs("__qa.fontOf('.item .title')") >= 12, true);
  eq('大字档 .no ≥ 12px', await evalJs("__qa.fontOf('.item .no')") >= 12, true);
  eq('大字档 .amount ≥ 12px', await evalJs("__qa.fontOf('.item .amount')") >= 12, true);
  eq('大字档 .l2 ≥ 12px', await evalJs("__qa.fontOf('.item .l2')") >= 12, true);
  eq('大字档 .tag ≥ 12px', await evalJs("__qa.fontOf('.item .tag')") >= 12, true);
  eq('大字档 .badge ≥ 12px', await evalJs("__qa.fontOf('.item .badge')") >= 12, true);
  const subFs = await evalJs("__qa.fontOf('.item .subline')");
  is('未筛选全表里存在「部分付」行（.subline 才能真正被检查）', subFs !== null, subFs);
  eq('大字档 .subline ≥ 12px', subFs >= 12, true);

  // .hit 命中胶囊只在搜索后才渲染，单独搜一次钉它。
  // 搜索框是 [data-search]（不是 .toolbar input）—— 选择器写错会让 .hit 静默地不被覆盖。
  await evalJs("__qa.setInput('[data-search]', '砂子')");
  await sleep(420);
  eq('搜索确实产生了命中胶囊（否则 .hit 字号检查是空跑）',
    (await evalJs("document.querySelectorAll('.item .hit').length")) > 0, true);
  eq('大字档 .hit ≥ 12px', await evalJs("__qa.fontOf('.item .hit')") >= 12, true);
  // 栅格没塌：大字档仍是有内容的三行结构，行高必须明显大于紧凑档
  is(`大字档行高 ${mc.h ? (await evalJs('__qa.rowMetrics()')).h.toFixed(2) : '?'}px > 紧凑档 ${mc.h.toFixed(2)}px`,
    (await evalJs('__qa.rowMetrics()')).h > mc.h);
  // 复选框避让位不能被 padding 简写冲掉（.item.has-sel 的 padding-left: 32px）
  const padLeft = await evalJs("getComputedStyle(document.querySelector('.item.has-sel') || document.querySelector('.item')).paddingLeft");
  eq('大字档仍保留 R5 复选框避让位 32px（padding 简写未覆盖它）', padLeft, '32px');

  /* ---------------- ⑥ 取舍可见 ---------------- */
  section('⑥ 取舍可见：大字档拿条数换可读性（用户已知并接受）');
  const mlMetrics = await evalJs('__qa.rowMetrics()');
  is(`大字档首屏条数 ${mlMetrics.fit} < 紧凑档 ${mc.fit}（代价如实呈现）`, mlMetrics.fit < mc.fit, mlMetrics.fit);

  /* ---------------- ⑥bis K16 大字档全场景覆盖（付款页 / 抽屉 / 图表） ----------------
     评审①的原话是「大字档只改了列表行」—— 故这里逐场景钉死：
     付款页列表、抽屉明细行、环形图文字、柱顶/柱底数值在大字档下都 ≥12px。

     ⚠️ 只在大字档下断言 ≥12 是自欺：把阈值放宽同样能绿。故**两种密度各量一遍**，
     成对输出「紧凑 9.5px → 大字 12px」这种对照 —— 只有同时看到紧凑档原地不动、
     大字档确实抬起来了，才能证明这次改动「既没漏场景，也没顺手改坏紧凑档」。 */
  section('⑥bis K16 全场景实测对照：付款页 / 抽屉 / 图表（紧凑 vs 大字，成对输出）');
  // ⑤ 留下的搜索词（'砂子'）会把付款页 / 抽屉的样本筛小，先清掉再量，否则 .hit 之外的元素被筛没
  await evalJs("__qa.setInput('[data-search]', '')");
  await sleep(380);

  /** 打开一个**有付款行**的条目：.void-btn / .void-tag 只在付款行里渲染，
   *  挑错条目会让这两个元素静默地不被覆盖（本次新增的补齐点）。 */
  const openItemWithPay = async () => {
    for (let i = 0; i < 5; i += 1) {
      await evalJs(`(() => { const r = document.querySelectorAll('.item')[${i}]; if (r) { r.click(); return true; } return false; })()`);
      await sleep(480);
      const n = await evalJs("document.querySelectorAll('.drawer .mrow.payrow').length");
      if (n > 0) return i;
      await evalJs('__qa.closeDrawer()');
      await sleep(340);
    }
    return -1;
  };

  /** 一次「全场景取景」：付款页列表 → 抽屉 → 分析页图表 → 概览页图表，全部取**最小**字号。
   *  图表两页都扫（柱图在哪一页取决于数据：概览 cf.total>0、分析 trend.months 非空），取两页的最小值。 */
  const measureScene = async () => {
    const r = {};
    await goTab(2); // 付款页
    await waitFor("!!document.querySelector('.item')");
    r.payAttr = await evalJs("__qa.densityAttr('.list[data-density]')");
    r.pay = await evalJs('__qa.minFontInRows()');
    r.payIdx = await openItemWithPay();
    r.payrow = await evalJs("document.querySelectorAll('.drawer .mrow.payrow').length");
    r.drawerAttr = await evalJs("__qa.densityAttr('.drawer')");
    r.mrow = await evalJs("__qa.minFontDeep('.drawer .mrow')");
    r.head = await evalJs("__qa.minFontDeep('.drawer .drawer-head')");
    await evalJs('__qa.closeDrawer()');
    await sleep(360);
    not('抽屉已关闭', await evalJs("!!document.querySelector('.drawer')"));

    const grabCharts = async () => ({
      donut: await evalJs('__qa.donutMin()'),
      legend: await evalJs("__qa.minFontDeep('.donut-wrap .legend')"),
      mv: await evalJs("__qa.minFontDeep('.minibars .mv')"),
      ml: await evalJs("__qa.minFontDeep('.minibars .ml')"),
      donutAttr: await evalJs("__qa.densityAttr('.donut-wrap')"),
      barsAttr: await evalJs("__qa.densityAttr('.minibars')"),
    });
    await goTab(4); // 分析页（Donut + 趋势柱图）
    await sleep(480);
    const a = await grabCharts();
    await goTab(0); // 概览页（Donut + 现金流柱图）
    await sleep(480);
    const b = await grabCharts();
    /** 同一指标在两页各量一次，取**更小**的那个（最坏场景过关才算过关） */
    const pair = (k) => {
      const x = a[k] && a[k].min != null ? a[k].min : null;
      const y = b[k] && b[k].min != null ? b[k].min : null;
      const v = [x, y].filter((z) => z !== null);
      return v.length ? { min: Math.min(...v), a: x, b: y, n: (a[k] ? a[k].n : 0) + (b[k] ? b[k].n : 0) } : null;
    };
    r.donut = pair('donut');
    r.legend = pair('legend');
    r.mv = pair('mv');
    r.ml = pair('ml');
    r.donutAttr = a.donutAttr || b.donutAttr;
    r.barsAttr = a.barsAttr || b.barsAttr;
    return r;
  };

  /** 切档必须在挂了 DensityChip 的页面上进行（概览/分析页没有这个 chip） */
  const setDensityUI = async (v) => {
    await goTab(2);
    await sleep(340);
    await pickDensity(v);
  };

  await setDensityUI('compact');
  const sc = await measureScene();
  await setDensityUI('large');
  const sl = await measureScene();

  // 容器属性：四个场景都得挂上（抽屉的属性挂在 .drawer 自身，选择器必须同元素）
  eq('紧凑档四个场景容器属性都是 compact', [sc.payAttr, sc.drawerAttr, sc.donutAttr, sc.barsAttr].join(','), 'compact,compact,compact,compact');
  eq('大字档四个场景容器属性都是 large', [sl.payAttr, sl.drawerAttr, sl.donutAttr, sl.barsAttr].join(','), 'large,large,large,large');
  is(`抽屉打开到了有付款行的条目（序号 ${sl.payIdx}，付款行 ${sl.payrow} 条 —— .void-btn 才真正被覆盖）`,
    sl.payrow > 0, sl.payrow);

  // 成对实测表：每一行都是「紧凑实测值 → 大字实测值」，大字必须 ≥12 且严格大于紧凑
  const px = (v) => (v === null || v === undefined ? 'n/a' : `${v}px`);
  const table = [];
  const paired = (name, key, extra) => {
    const cv = sc[key] && sc[key].min != null ? sc[key].min : null;
    const lv = sl[key] && sl[key].min != null ? sl[key].min : null;
    const okFlag = cv !== null && lv !== null && lv >= 12 && lv > cv;
    record(okFlag, `${name}：紧凑 ${px(cv)} → 大字 ${px(lv)}`, `${cv} → ${lv}`, '大字 ≥12 且 > 紧凑');
    table.push(`   ${name}${extra ? `（${extra}）` : ''}`.padEnd(46, '·') + ` 紧凑 ${cv}px → 大字 ${lv}px`);
  };
  paired('付款页列表最小字号', 'pay', `扫 ${sl.pay ? sl.pay.count : 0} 个含文字元素`);
  paired('抽屉明细行 .mrow 子树最小字号', 'mrow', '含 .nm/.meta/.del/.void-btn');
  paired('抽屉头 .drawer-head 最小字号', 'head', '含 .ttl/.sub');
  paired('环形图 SVG <text> 最小字号', 'donut', `分析 ${sc.donut ? sc.donut.a : 'n/a'} / 概览 ${sc.donut ? sc.donut.b : 'n/a'}`);
  paired('环形图图例 .legend 最小字号', 'legend', 'K16 补挂，1.8.2 时未覆盖');
  paired('柱顶数值 .mv 最小字号', 'mv', 'K17 紧凑档下限仍是 9px');
  paired('柱底标签 .ml 最小字号', 'ml', 'K16 补挂，1.8.2 时未覆盖');
  out.push('   ---- 大字档全场景实测对照表（px）----');
  out.push(table.join('\n'));

  /* ---------------- ⑦ 持久化 ---------------- */
  section('⑦ 大字档持久化：重载后仍是大字');
  await cdp(ws, 'Page.reload');
  is('重载后应用重启', await waitFor("!!document.querySelector('.app') && !!document.querySelector('.item')"));
  await evalJs(HELPERS);
  await goTab(1);
  await waitFor("!!document.querySelector('.item')");
  const dAfter = await evalJs('__qa.densityState()');
  eq('重载后容器仍是 large', dAfter.attr, 'large');
  eq('重载后 chip 文案仍是密度·大字', dAfter.chip, '密度·大字');
  eq('重载后 localStorage 仍是 large', dAfter.ls, 'large');

  eq('页面零 JS 报错', errors.length, 0);
  if (errors.length) out.push('  errors: ' + errors.join(' | '));
} catch (e) {
  fail += 1;
  failures.push('套件异常: ' + e.message);
  out.push('FAIL 套件异常: ' + e.message);
  exitCode = 1;
} finally {
  try { chrome.kill('SIGKILL'); } catch (_) { /* ignore */ }
  try { srv.close(); } catch (_) { /* ignore */ }
}

/* 兜底：一条断言都没产出 = 套件根本没跑起来（端口抢占 / Chrome 未就绪 / dist 未构建），
   必须算失败 —— 否则汇总器会把它显示成「通过 0 / 失败 0」，看起来像绿。
   （本套件逻辑段必然有断言，真触发这条就说明浏览器段整个没起来。） */
if (pass === 0 && fail === 0) {
  fail += 1;
  out.push('FAIL 套件一条断言都没产出 —— 绝不能算通过（常见原因：端口被并发套件抢占 / Chrome 未就绪 / dist 未构建）');
}

console.log(out.join('\n'));
console.log(`\n通过 ${pass} / 失败 ${fail}`);
if (failures.length) { console.log('\n失败明细:'); for (const f of failures) console.log('  - ' + f); }
process.exit(fail || exitCode ? 1 : 0);

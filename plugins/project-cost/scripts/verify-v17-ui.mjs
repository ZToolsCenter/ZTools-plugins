/**
 * v1.7 UI 冒烟（headless Chrome + CDP，自建静态服务器）
 *
 * 覆盖（纯渲染 / 交互断言，金额链口径已由 verify-v17.mjs 锁死）：
 *  ① 骨架与六页零报错；
 *  ② A1 负数明细：抽屉里负明细显示 `-394.88` 且带 .neg（danger），正明细不带；视图态不暴露裸 pid（C5）；
 *  ③ B3 密度：默认紧凑（单行 ≤38px、首屏 ≥9 条）；v1.8.2 起为三态循环
 *     （紧凑→舒适→大字→紧凑），第三击才回到紧凑；
 *  ④ B1 搜索：搜「砂子」出现命中提示且位于第二行（不顶高）；
 *  ⑤ B2 付款排序 + C3 催收门槛：付款页默认首行 ZX0006；催收卡计数/合计保持全量、小额折叠行文案正确；
 *  ⑥ A2 口径收敛：概览/预算/分析三处 `data-coverage` 文案一致；预算页「其他费用」显示「未设预算」而非 ¥0.00；
 *  ⑦ B4 备份出口：设置页常驻「数据仅存本机…请自行备份」，从未备份时给出提示行；
 *  ⑧ A3 撤销栈：改一笔费用备注 → Ctrl+Z 逐级还原（改前/改后/撤销后三态一致）。
 *
 * 用法：npx esbuild scripts/verify-v17-ui.mjs --bundle --platform=node --format=esm \
 *         --define:process.env.NODE_ENV='"development"' --outfile=/tmp/v17-ui.mjs && node /tmp/v17-ui.mjs
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
const SRV_PORT_PREF = 8241;
const PORT_PREF = 9231;
/** 运行期真实端口：必须等 startServer / pickPort 返回后才有值，顶层不能提前拼 URL */
let SRV_PORT = SRV_PORT_PREF;
let PORT = PORT_PREF;
let URL = '';
const DIST = path.resolve('dist');
const PKG_VERSION = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).version;

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
  txt(sel) {
    const el = document.querySelector(sel);
    return el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';
  },
  allTxt(sel) { return [...document.querySelectorAll(sel)].map((e) => e.textContent.replace(/\\s+/g, ' ').trim()); },
  num(t) {
    const s = String(t).replace(/[\\u2212\\u2013\\u2014]/g, '-').replace(/[^0-9.-]/g, '');
    return parseFloat(s) || 0;
  },
  rect(sel) { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height, left: r.left, right: r.right }; },
  clickSel(sel) { const el = document.querySelector(sel); if (!el) return false; el.click(); return true; },
  clickText(text, scope) {
    const root = scope ? document.querySelector(scope) : document;
    if (!root) return false;
    const els = [...root.querySelectorAll('button, .btn, .link, .chip, .seg button, .item')];
    const hit = els.find((e) => (e.textContent || '').replace(/\\s+/g, '').includes(text.replace(/\\s+/g, '')));
    if (hit) { hit.click(); return true; }
    return false;
  },
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
  key(key, mods = {}) { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods })); return true; },
  itemByNo(no) {
    const rows = [...document.querySelectorAll('.item')];
    const hit = rows.find((r) => { const n = r.querySelector('.l1 .no'); return n && n.textContent.trim() === no; });
    if (hit) { hit.click(); return true; }
    return false;
  },
  firstItemTitle() {
    const t = document.querySelector('.item .l1 .title');
    return t ? t.textContent.trim() : '';
  },
  /** 抽屉里「明细合计」显示值（A1 用） */
  drawerDetailNeg() {
    const rows = [...document.querySelectorAll('.drawer [data-detail-row] .amt.num')];
    return rows.map((e) => ({ text: e.textContent.trim(), neg: e.classList.contains('neg') }));
  },
  drawerHasPid() { const d = document.querySelector('.drawer'); return d ? d.textContent.includes('P0001') || d.textContent.includes('P0002') : false; },
  visibleItemCount() {
    const sc = document.querySelector('.list-scroll') || document.querySelector('.list');
    if (!sc) return 0;
    const sr = sc.getBoundingClientRect();
    return [...document.querySelectorAll('.item')].filter((e) => {
      const r = e.getBoundingClientRect();
      const cy = (r.top + r.bottom) / 2;
      return r.height > 0 && cy >= sr.top - 1 && cy <= sr.bottom + 1;
    }).length;
  },
};
true;
`;

/* Chrome 的 --user-data-dir 同样要按进程区分：同一个 profile 目录被两个 Chrome 实例同时
   持有时，后起的那个会被 profile 单例锁拦下并附到先起的实例上（自己的 --remote-debugging-port
   被忽略），两个套件于是抢同一个浏览器 —— 并发跑同一个套件就是这么塌的。 */
const userData = path.join(os.tmpdir(), `ztchrome-qa17-${process.pid}`);
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
  // 把 CSS 视口钉成应用设计的 800×618，避免 headless 窗口边框吃掉高度（否则列表容器被压扁、首屏行数失真）
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

  await waitFor("!!document.querySelector('.app')");
  await evalJs('localStorage.clear(), true');
  await cdp(ws, 'Page.reload');
  is('清空本地数据后应用重启', await waitFor("!!document.querySelector('.app') && !!document.querySelector('.rail')"));
  await evalJs(HELPERS);
  await evalJs('window.confirm = () => true; true');

  /* ---------------- ① 骨架 / 六页 ---------------- */
  section('① 骨架与六页渲染');
  eq('左轨宽度 = 62px', await evalJs("getComputedStyle(document.querySelector('.rail')).width"), '62px');
  let pageOk = 0;
  for (let i = 0; i < 6; i += 1) {
    await goTab(i);
    if (await evalJs("!!(document.querySelector('.list-scroll')||document.querySelector('.content'))")) pageOk += 1;
  }
  eq('六页均有可滚动内容层', pageOk, 6);

  /* ---------------- ② A1 负数明细 + C5 pid 隐藏 ---------------- */
  section('② A1 负数明细显示 / C5 视图态不暴露裸 pid');
  await goTab(1); // 费用列表
  await waitFor("!!document.querySelector('.item')");
  is('能定位到 ZX0024（蹲便器）', await evalJs("__qa.itemByNo('ZX0024')"));
  await sleep(450);
  is('ZX0024 抽屉打开', await evalJs("!!document.querySelector('.drawer')"));
  const negRows = await evalJs('__qa.drawerDetailNeg()');
  const negHit = negRows.find((r) => r.text.startsWith('-') && r.neg);
  const posHit = negRows.find((r) => r.text.startsWith('394.88') && !r.neg);
  is('抽屉里有「-394.88」且带 .neg（danger）', !!negHit && negHit.text === '-394.88');
  is('同屏正明细「394.88」不带 .neg', !!posHit);
  is('两张明细屏上不再显示成同一个数', !!negHit && !!posHit && negHit.text !== posHit.text);
  // C5：视图态（未进入付款编辑）不应渲染裸 pid（P0001/P0002）
  is('抽屉视图态不渲染裸 pid（C5）', !(await evalJs('__qa.drawerHasPid()')));
  await evalJs("__qa.key('Escape')");
  await sleep(320);
  is('Esc 关闭抽屉', !(await evalJs("!!document.querySelector('.drawer')")));

  /* ---------------- ③ B3 密度默认紧凑 ---------------- */
  section('③ B3 列表密度默认紧凑');
  await goTab(1);
  await waitFor("!!document.querySelector('.item')");
  const compactH = await evalJs("__qa.rect('.item').height");
  is('默认行高 ≤ 38px（紧凑）', compactH > 0 && compactH <= 38);
  const scH = await evalJs("(()=>{const sc=document.querySelector('.list-scroll'); return sc?sc.clientHeight:0})()");
  const rowsFit = compactH > 0 ? Math.floor(scH / compactH) : 0;
  is('紧凑首屏可见 ≥ 9 条（容器高 ' + scH + ' ÷ 行高 ' + compactH.toFixed(2) + ' = ' + rowsFit + '）', rowsFit >= 9, rowsFit);
  // 切到舒适。K22（v1.9.x）起 chip 是**直达菜单**而非三态循环：点 chip 开菜单 → 点选项直达。
  is('存在密度切换 chip（data-density-toggle）', await evalJs("!!document.querySelector('[data-density-toggle]')"));
  const pickDensity = async (v) => {
    const opened = await evalJs("!!document.querySelector('[data-density-menu]')");
    if (!opened) { await evalJs("__qa.clickSel('[data-density-toggle]')"); await sleep(240); }
    await evalJs(`__qa.clickSel('[data-density-opt="${v}"]')`);
    await sleep(360);
  };
  await pickDensity('comfort');
  const comfortH = await evalJs("__qa.rect('.item').height");
  is('切舒适后行高变大（> 38px）', comfortH > 38);
  // 三态的第三档「大字」：从舒适**直达**大字（不再依赖循环连点），行高更大
  await pickDensity('large');
  const largeH = await evalJs("__qa.rect('.item').height");
  is('直达大字档，行高比舒适更大（新增第三档）', largeH > comfortH, largeH.toFixed(2));
  // 再直达回紧凑（三态闭合）
  await pickDensity('compact');
  const backH = await evalJs("__qa.rect('.item').height");
  is('直达紧凑，行高 ≤ 38px（三档闭合）', backH <= 38, backH.toFixed(2));

  /* ---------------- ④ B1 搜索命中提示 ---------------- */
  section('④ B1 搜索覆盖明细品名');
  await evalJs("__qa.setInput('[data-search]', '砂子')");
  await sleep(400);
  const hitCount = await evalJs("document.querySelectorAll('[data-hit]').length");
  eq('搜「砂子」命中提示出现 5 条', hitCount, 5);
  is('命中提示文本为「命中：砂子 ×1」', await evalJs("[...document.querySelectorAll('[data-hit]')].every(h=>h.textContent.trim()==='命中：砂子 ×1')"));
  is('命中提示位于第二行（.l2 内）', await evalJs("[...document.querySelectorAll('[data-hit]')].every(h=>!!h.closest('.l2'))"));
  const afterSearchH = await evalJs("__qa.rect('.item').height");
  is('命中提示不顶高行（仍为紧凑行高 ≤38px）', afterSearchH <= 38);
  await evalJs("__qa.setInput('[data-search]', '   ')");
  await sleep(300);
  eq('清空搜索后提示消失', await evalJs("document.querySelectorAll('[data-hit]').length"), 0);

  /* ---------------- ⑤ B2 付款排序 + C3 催收门槛 ---------------- */
  section('⑤ B2 付款排序默认逾期天数 + C3 催收门槛');
  await goTab(2); // 付款页
  await waitFor("!!document.querySelector('.item')");
  // 默认排序 = 逾期天数：首行项目号应为 ZX0006（逾期最久）
  const firstNo = await evalJs("document.querySelector('.item .l1 .no') ? document.querySelector('.item .l1 .no').textContent.trim() : ''");
  eq('付款页默认排序首行 = ZX0006（逾期最久）', firstNo, 'ZX0006');
  is('付款页存在排序下拉（data-pay-sort）', await evalJs("!!document.querySelector('[data-pay-sort]')"));
  // C3：催收卡计数/合计保持全量；小额折叠行文案正确
  const odCard = await evalJs("(()=>{const h=[...document.querySelectorAll('.sec-head')].find(x=>x.textContent.includes('优先催收')); return h?h.parentElement.textContent.replace(/\\s+/g,' '):''})()");
  is('催收卡头部含「5 笔 · 23,784.34」（计数/合计保持全量）', /优先催收/.test(odCard) && /5 笔/.test(odCard) && /23,784\.34/.test(odCard));
  is('小额逾期折叠行文案正确（另有 1 笔小额逾期（合计 0.46）· 展开）', await evalJs("!!document.querySelector('[data-od-small]') && /另有 1 笔小额逾期（合计 0\.46）· 展开/.test(document.querySelector('[data-od-small]').textContent)"));

  /* ---------------- ⑥ A2 口径收敛 ---------------- */
  section('⑥ A2 品类覆盖三处同源 + 预算页未设预算');
  await goTab(0); // 概览
  await waitFor("!!document.querySelector('[data-coverage]')");
  const cov0 = await evalJs("document.querySelector('[data-coverage]').textContent.trim()");
  eq('概览品类覆盖文案', cov0, '14 个品类 · 13 个已设预算');
  await goTab(3); // 预算
  const cov3 = await evalJs("(document.querySelector('[data-coverage]')||{}).textContent ? document.querySelector('[data-coverage]').textContent.trim() : ''");
  eq('预算页品类覆盖文案同源', cov3, '14 个品类 · 13 个已设预算');
  // 预算页「其他费用」显示「未设预算」而非 ¥0.00
  const noBudgetText = await evalJs("(document.querySelector('[data-over-group=\\\"nobudget\\\"]')||{}).textContent ? document.querySelector('[data-over-group=\\\"nobudget\\\"]').textContent.replace(/\\s+/g,' ') : ''");
  is('预算页未设预算组含「其他费用」', /其他费用/.test(noBudgetText));
  is('预算页未设预算组显示「未设预算」而非 ¥0.00', /未设预算/.test(noBudgetText) && !/¥0\.00/.test(noBudgetText));
  await goTab(4); // 分析
  const cov4 = await evalJs("document.querySelector('[data-coverage]') ? document.querySelector('[data-coverage]').textContent.trim() : ''");
  is('分析页品类覆盖文案含「14 个品类 · 13 个已设预算」（后缀「· 前 8 项」为视图限定语）', /14 个品类 · 13 个已设预算/.test(cov4) && /前 8 项/.test(cov4));

  /* ---------------- ⑦ B4 备份出口文案 ---------------- */
  section('⑦ B4 备份出口文案');
  await goTab(5); // 设置
  const setTxt = await evalJs("document.querySelector('.content').textContent.replace(/\\s+/g,' ')");
  is('设置页常驻「数据仅存本机，请自行备份」', /数据仅存本机/.test(setTxt) && /请自行备份/.test(setTxt));
  is('从未备份时给出提示行（data-backup-status）', await evalJs("!!document.querySelector('[data-backup-status]') && /从未|未导出/.test(document.querySelector('[data-backup-status]').textContent)"));

  /* ---------------- ⑧ A3 撤销栈（真实可撤销编辑） ---------------- */
  section('⑧ A3 撤销栈：改备注 → Ctrl+Z 还原');
  await goTab(1); // 费用列表
  await waitFor("!!document.querySelector('.item')");
  const beforeTitle = await evalJs('__qa.firstItemTitle()');
  // 打开首条 → 进入编辑态 → 改备注 → 保存 → 校验变化 → Ctrl+Z → 校验还原
  await evalJs("document.querySelector('.item').click()");
  await sleep(450);
  is('抽屉打开', await evalJs("!!document.querySelector('.drawer')"));
  await evalJs("__qa.clickExact('编辑','.drawer')");
  await sleep(350);
  const edited = await evalJs(`(()=>{const el=document.querySelector('.drawer input[placeholder=\"如 客厅瓷砖\"]'); if(!el) return false; el.value='QA_撤销测试_'+Date.now(); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return el.value;})()`);
  is('成功填入新备注', !!edited);
  await evalJs("__qa.clickExact('保存','.drawer')");
  await sleep(500);
  const afterTitle = await evalJs('__qa.firstItemTitle()');
  eq('保存后列表首行备注已变更', afterTitle, edited);
  // Ctrl+Z 撤销（焦点已不在输入框，App.onKey 会拦截 Ctrl/Cmd+Z 走 doUndo）
  await evalJs("__qa.key('z', { ctrlKey: true })");
  await sleep(500);
  const undoTitle = await evalJs('__qa.firstItemTitle()');
  eq('Ctrl+Z 还原到改前备注', undoTitle, beforeTitle);
  is('撤销后不再显示临时备注', undoTitle !== edited);

  eq('全程无 JS 报错', errors.length, 0);
  if (errors.length) out.push('   报错明细：\n   ' + errors.slice(0, 8).join('\n   '));
} catch (e) {
  fail += 1;
  out.push(`FAIL 流程异常: ${String((e && e.message) || e)}`);
  exitCode = 1;
} finally {
  try { chrome.kill('SIGKILL'); } catch (_) { /* 忽略 */ }
  try { srv?.close(); } catch (_) { /* 忽略 */ }
}

/* 兜底：一条断言都没产出 = 套件根本没跑起来（端口抢占 / Chrome 未就绪 / dist 未构建），
   必须算失败 —— 否则汇总器会把它显示成「通过 0 / 失败 0」，看起来像绿。 */
if (pass === 0 && fail === 0) {
  fail += 1;
  out.push('FAIL 套件一条断言都没产出 —— 绝不能算通过（常见原因：端口被并发套件抢占 / Chrome 未就绪 / dist 未构建）');
}

console.log(out.join('\n'));
console.log(`\n=== 通过 ${pass} / 失败 ${fail} / 合计 ${pass + fail} ===`);
if (failures.length) {
  console.log('\n失败清单：');
  failures.forEach((f) => console.log(' - ' + f));
}
if (fail) exitCode = 1;
process.exit(exitCode);

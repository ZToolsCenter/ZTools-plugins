/**
 * v1.5 UI 冒烟（headless Chrome + CDP，自建静态服务器）
 *
 * 覆盖：
 *  ① 骨架与六页无 JS 报错、左轨 62px；
 *  ② A2 分析页「材料」页签：Top 行、金额降序、Top 合计与页面文案一致、点行开抽屉；
 *  ③ A3 「费用构成」页签新增「本月 vs 上月」三格；
 *  ④ M2 付款页「超 30 天」置顶：行数、天数、金额、排序；
 *  ⑤ M1 顶部预警「忽略」：横幅消失、角标保留、设置页可恢复；
 *  ⑥ M3 设置页「到期日推算」输入并持久化；
 *  ⑦ A4 项目档案填面积 → 概览出现 ¥/㎡，刷新后仍在；
 *  ⑧ 版本文案与 package.json 一致、全程零报错。
 *
 * 用法：npx esbuild scripts/verify-v15-ui.mjs --bundle --platform=node --format=esm \
 *         --define:process.env.NODE_ENV='"development"' --outfile=/tmp/v15-ui.mjs && node /tmp/v15-ui.mjs
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
const SRV_PORT_PREF = 8235;
const PORT_PREF = 9227;
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
  nums(sel) { return [...document.querySelectorAll(sel)].map((e) => parseFloat((e.textContent || '').replace(/[^0-9.-]/g, '')) || 0); },
  clickText(text, scope) {
    const root = scope ? document.querySelector(scope) : document;
    if (!root) return false;
    const els = [...root.querySelectorAll('button, .btn, .link, .chip, .pop-row, .seg button')];
    const hit = els.find((e) => (e.textContent || '').replace(/\\s+/g, '').includes(text.replace(/\\s+/g, '')));
    if (hit) { hit.click(); return true; }
    return false;
  },
  cardByHead(text) {
    // v1.7：优先按 data-card-head 钩子定位（设计文档 §7.2 引入钩子的目的就是不再按文案找元素）。
    // 传 'materials' / 'budget-vs-actual' 这类键名即可；传其他字符串仍按标题文本匹配（向后兼容）。
    const hooked = [...document.querySelectorAll('[data-card-head]')]
      .find((el) => el.dataset.cardHead === text);
    if (hooked) return hooked.closest('.card') || null;
    const heads = [...document.querySelectorAll('.card')];
    return heads.find((c) => {
      const h = c.querySelector('.sec-head');
      return h && h.textContent.includes(text);
    }) || null;
  },
  cardTxt(text) { const c = __qa.cardByHead(text); return c ? c.textContent.replace(/\\s+/g, ' ').trim() : ''; },
  setInput(sel, val) {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.value = String(val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },
  key(key) { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); return true; },
};
true;
`;

/* Chrome 的 --user-data-dir 同样要按进程区分：同一个 profile 目录被两个 Chrome 实例同时
   持有时，后起的那个会被 profile 单例锁拦下并附到先起的实例上（自己的 --remote-debugging-port
   被忽略），两个套件于是抢同一个浏览器 —— 并发跑同一个套件就是这么塌的。 */
const userData = path.join(os.tmpdir(), `ztchrome-qa15-${process.pid}`);
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
  await cdp(ws, 'Page.navigate', { url: URL });

  const evalJs = async (expr) => {
    const r = await cdp(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r?.exceptionDetails) throw new Error('eval 异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r?.result?.value;
  };
  const waitFor = async (expr, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await evalJs(expr)) return true;
      await sleep(150);
    }
    return false;
  };
  const goTab = async (i) => {
    await evalJs(`document.querySelectorAll('.rail-item')[${i}].click()`);
    await sleep(300);
  };

  await waitFor("!!document.querySelector('.app')");
  await evalJs('localStorage.clear(), true');
  await cdp(ws, 'Page.reload');
  is('清空本地数据后应用重启', await waitFor("!!document.querySelector('.app') && !!document.querySelector('.rail')"));
  await evalJs(HELPERS);

  /* ---------------- ① 骨架 / 六页 ---------------- */
  section('① 骨架与六页渲染');
  eq('左轨宽度 = 62px', await evalJs("getComputedStyle(document.querySelector('.rail')).width"), '62px');
  let pageOk = 0;
  for (let i = 0; i < 6; i += 1) {
    await goTab(i);
    const has = await evalJs("!!(document.querySelector('.list-scroll')||document.querySelector('.content'))");
    if (has) pageOk += 1;
  }
  eq('六页均有可滚动内容层', pageOk, 6);

  /* ---------------- ② A2 材料页签 ---------------- */
  section('② A2 分析页「材料」页签');
  await goTab(4);
  const segBtns = await evalJs("__qa.allTxt('.seg button')");
  eq('分析页页签数 = 5（新增材料）', segBtns.length, 5);
  is('含「材料」页签', segBtns.includes('材料'));

  await evalJs("__qa.clickText('材料', '.seg')");
  await sleep(350);
  const matCount = await evalJs("document.querySelectorAll('.mat-row').length");
  eq('材料排行渲染 10 行（Top10）', matCount, 10);
  const matAmts = await evalJs("__qa.nums('.mat-amt')");
  is('金额降序', matAmts.every((v, i) => i === 0 || matAmts[i - 1] >= v));
  const matIdx = await evalJs("__qa.allTxt('.mat-idx')");
  eq('序号 1..10 连续', JSON.stringify(matIdx), JSON.stringify(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']));
  const matCardTxt = await evalJs("__qa.cardTxt('materials')");
  const topSumTxt = (matCardTxt.match(/Top \d+ 合计 ([\d,]+\.\d{2})/) || [])[1] || '';
  const topSum = parseFloat((topSumTxt || '').replace(/,/g, ''));
  const rowSum = Math.round(matAmts.reduce((a, b) => a + b, 0) * 100) / 100;
  eq('页面「Top 合计」= 各行金额之和', topSum.toFixed(2), rowSum.toFixed(2));
  is('明细合计 = 247,577.89', /明细合计\s*247,577\.89/.test(matCardTxt.replace(/\s+/g, ' ')));
  is('说明「同名品名已合并」', /同名品名已合并/.test(matCardTxt));

  await evalJs("document.querySelector('.mat-row').click()");
  await sleep(400);
  is('点材料行打开费用项抽屉', await evalJs("!!document.querySelector('.drawer')"));
  await evalJs("__qa.key('Escape')");
  await sleep(300);
  is('Esc 关闭抽屉', !(await evalJs("!!document.querySelector('.drawer')")));

  /* ---------------- ③ A3 月度环比 ---------------- */
  section('③ A3 本月 vs 上月');
  await evalJs("__qa.clickText('费用构成', '.seg')");
  await sleep(350);
  const cmpCardTxt = await evalJs("__qa.cardTxt('本月 vs 上月')");
  is('费用构成页出现「本月 vs 上月」卡', !!cmpCardTxt);
  eq('环比三格渲染', await evalJs("document.querySelectorAll('.cmp-cell').length"), 3);
  const cmpKeys = await evalJs("__qa.allTxt('.cmp-k')");
  eq('三格标题', JSON.stringify(cmpKeys), JSON.stringify(['应付', '已付', '新增费用项']));
  is('显示对比月份（YYYY-MM 对比 YYYY-MM）', /\d{4}-\d{2} 对比 \d{4}-\d{2}/.test(cmpCardTxt));
  is('含上月基准行', /上月基准/.test(cmpCardTxt));

  /* ---------------- ④ M2 付款页逾期置顶 ---------------- */
  section('④ M2 付款页「超 30 天」置顶');
  await goTab(2);
  is('存在超 30 天卡片', !(await evalJs("!document.querySelector('.od-card')")));
  const odRows = await evalJs("document.querySelectorAll('.od-row').length");
  is('置顶行数 > 0', odRows > 0);
  const odDays = await evalJs("__qa.nums('.od-days')");
  is('置顶行天数全部 > 30', odDays.every((d) => d > 30));
  is('天数降序（最久的在最上）', odDays.every((d, i) => i === 0 || odDays[i - 1] >= d));
  const odAmts = await evalJs("__qa.nums('.od-amt')");
  is('置顶行都有金额', odAmts.every((v) => v > 0));
  const odCardTxt = await evalJs("__qa.cardTxt('超 30 天')");
  is('卡片标注笔数与合计', /(\d+) 笔 · /.test(odCardTxt));
  const odDaysColor = await evalJs("getComputedStyle(document.querySelector('.od-days')).color");
  const dangerColor = await evalJs(`(()=>{const s=document.createElement('span');s.style.color='var(--danger)';document.body.appendChild(s);const c=getComputedStyle(s).color;s.remove();return c;})()`);
  eq('天数徽标用 danger 色', odDaysColor, dangerColor);

  await evalJs("document.querySelector('.od-row').click()");
  await sleep(400);
  is('点置顶行打开费用项抽屉', await evalJs("!!document.querySelector('.drawer')"));
  await evalJs("__qa.key('Escape')");
  await sleep(300);

  /* ---------------- ⑤ M1 预警忽略 ---------------- */
  section('⑤ M1 顶部预警「忽略」按天生效');
  await goTab(0);
  const chipsBefore = await evalJs("document.querySelectorAll('.alert-chip').length");
  is('首页有预警横幅', chipsBefore > 0);
  is('首页有角标（rail-dot）', await evalJs("!!document.querySelector('.rail-dot')"));
  const chipsTexts = await evalJs("__qa.allTxt('.alert-chip')");
  is('默认台账含「超30天」实心标记', chipsTexts.some((t) => t.startsWith('超30天')));
  is('默认台账含普通「逾期」', chipsTexts.some((t) => t.startsWith('逾期')));
  const severeBg = await evalJs(`(()=>{const el=[...document.querySelectorAll('.alert-chip')].find(e=>e.classList.contains('severe')); return el?getComputedStyle(el).backgroundColor:''})()`);
  is('超 30 天 chip 为实心 danger 背景', !!severeBg && severeBg !== 'rgba(0, 0, 0, 0)');

  is('点「忽略」按钮', await evalJs("__qa.clickText('忽略')"));
  await sleep(350);
  eq('忽略后横幅消失', await evalJs("document.querySelectorAll('.alert-chip').length"), 0);
  is('忽略后角标仍保留计数', await evalJs("!!document.querySelector('.rail-dot')"));

  await goTab(5);
  const ignoreLine = await evalJs("__qa.cardTxt('预算临界预警')");
  is('设置页显示「今日已忽略 N 类」', /今日已忽略 \d+ 类提醒/.test(ignoreLine));
  is('点「恢复」', await evalJs("(()=>{const c=__qa.cardByHead('预算临界预警'); const b=c&&c.querySelector('.link'); if(!b) return false; b.click(); return true})()"));
  await sleep(400);
  is('恢复后设置页不再显示忽略行', !/今日已忽略/.test(await evalJs("__qa.cardTxt('预算临界预警')")));
  await goTab(0);
  const chipsBack = await evalJs("document.querySelectorAll('.alert-chip').length");
  eq('恢复后横幅回来', chipsBack, chipsBefore);

  /* ---------------- ⑥ M3 到期日推算 ---------------- */
  section('⑥ M3 设置页「到期日推算」');
  await goTab(5);
  const dueCardTxt = await evalJs("__qa.cardTxt('到期日推算')");
  is('设置页有「到期日推算」卡', !!dueCardTxt);
  is('默认显示按 30 天推算', /下单日 \+ 30 天/.test(dueCardTxt));
  const dueSel = `(()=>{const c=__qa.cardByHead('到期日推算'); const el=c&&c.querySelector('input'); return el?'.ok':'no'})()`;
  eq('卡片内有数字输入框', await evalJs(dueSel), '.ok');
  await evalJs("(()=>{const c=__qa.cardByHead('到期日推算'); const el=c.querySelector('input'); el.value='7'; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true})()");
  await sleep(350);
  is('改为 7 天后文案同步', /下单日 \+ 7 天/.test(await evalJs("__qa.cardTxt('到期日推算')")));
  const persisted = await evalJs("(()=>{const raw=localStorage.getItem('ztools_project_cost_v1'); if(!raw) return -1; const d=JSON.parse(raw); const bs=d.books||[]; const b=bs.find(x=>x.id===d.activeBookId)||bs[0]; return b?b.dueDays:-1})()");
  eq('dueDays 已写入主键（持久化）', persisted, 7);
  // 恢复 30，避免影响后续断言（账龄/逾期基线）
  await evalJs("(()=>{const c=__qa.cardByHead('到期日推算'); const el=c.querySelector('input'); el.value='30'; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true})()");
  await sleep(300);

  /* ---------------- ⑦ A4 单方造价 ---------------- */
  section('⑦ A4 项目档案面积 → 单方造价');
  await goTab(0);
  is('未填面积时概览不显示单方造价', !/单方造价/.test(await evalJs("document.querySelector('.content').textContent")));
  await evalJs("document.querySelector('.book-chip').click()");
  await sleep(250);
  is('项目菜单可用', await evalJs("__qa.clickText('管理项目与模板')"));
  await sleep(400);
  is('项目管理抽屉打开', await evalJs("!!document.querySelector('.drawer')"));
  is('档案里有面积输入框', await evalJs("!!document.querySelector('.area-input')"));
  await evalJs("(()=>{const el=document.querySelector('.area-input'); el.value='89'; el.dispatchEvent(new Event('change',{bubbles:true})); return true})()");
  await sleep(350);
  await evalJs("__qa.key('Escape')");
  await sleep(350);
  const ovTxt = await evalJs("document.querySelector('.content').textContent.replace(/\\s+/g,' ')");
  is('概览出现 ¥2,765/㎡', /单方造价/.test(ovTxt) && /2,765/.test(ovTxt));

  await goTab(4);
  const costChip = await evalJs("__qa.txt('.cost-area')");
  eq('分析页命令栏显示 ¥2,765/㎡', costChip, '¥2,765/㎡');
  await goTab(0);

  // 重新加载：面积与 ¥/㎡ 应持久
  await cdp(ws, 'Page.reload');
  await waitFor("!!document.querySelector('.app')");
  await evalJs(HELPERS);
  await sleep(400);
  is('刷新后单方造价仍在', /2,765/.test(await evalJs("document.querySelector('.content').textContent")));

  /* ---------------- ⑧ 版本 / 报错 ---------------- */
  section('⑧ 版本与零报错');
  await goTab(5);
  const footTxt = await evalJs("__qa.txt('.content')");
  is(`设置页版本文案为 v${PKG_VERSION}`, new RegExp(`v${PKG_VERSION.replace(/\./g, '\\.')}`).test(footTxt));
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

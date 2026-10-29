/**
 * v1.4 UI 冒烟（headless Chrome + CDP，自建静态服务器）
 *
 * 覆盖：
 *  ① 骨架与六页渲染无 JS 报错、左轨 62px；
 *  ② A1 分析页第 4 个页签「账龄」：四桶渲染、金额之和 = 待付、90+ 桶可展开明细、点行开抽屉；
 *  ③ A1 收款方下钻：下拉选项 = 欠款方 + 「全部」、切换后桶合计等于该方欠款；
 *  ④ Q3 设置页存储占用：容量文本、进度条宽度、百分比、主数据/快照分项；
 *  ⑤ 版本文案与 package.json 一致；
 *  ⑥ 全程无 JS 报错。
 *
 * 用法：npx esbuild scripts/verify-v14-ui.mjs --bundle --platform=node --format=esm \
 *         --define:process.env.NODE_ENV='"development"' --outfile=/tmp/v14-ui.mjs && node /tmp/v14-ui.mjs
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
const SRV_PORT_PREF = 8234;
const PORT_PREF = 9226;
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
setTimeout(() => { console.error('WATCHDOG: 超时强制退出'); process.exit(2); }, 150000).unref();

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
    const els = [...root.querySelectorAll('button, .btn, .link, .chip')];
    const hit = els.find((e) => (e.textContent || '').replace(/\\s+/g, '').includes(text.replace(/\\s+/g, '')));
    if (hit) { hit.click(); return true; }
    return false;
  },
  key(key) { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); return true; },
};
true;
`;

/* Chrome 的 --user-data-dir 同样要按进程区分：同一个 profile 目录被两个 Chrome 实例同时
   持有时，后起的那个会被 profile 单例锁拦下并附到先起的实例上（自己的 --remote-debugging-port
   被忽略），两个套件于是抢同一个浏览器 —— 并发跑同一个套件就是这么塌的。 */
const userData = path.join(os.tmpdir(), `ztchrome-qa14-${process.pid}`);
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

  await waitFor("!!document.querySelector('.app')");
  await evalJs('localStorage.clear(), true');
  await cdp(ws, 'Page.reload');
  is('清空本地数据后应用重启', await waitFor("!!document.querySelector('.app') && !!document.querySelector('.rail')"));
  await evalJs(HELPERS);

  /* ---------------- ① 骨架 / 六页 ---------------- */
  section('① 骨架与六页渲染');
  eq('左轨宽度 = 62px', await evalJs("getComputedStyle(document.querySelector('.rail')).width"), '62px');
  const railCount = await evalJs("document.querySelectorAll('.rail-item').length");
  let pageOk = 0;
  for (let i = 0; i < Math.min(6, railCount); i += 1) {
    await evalJs(`document.querySelectorAll('.rail-item')[${i}].click()`);
    await sleep(260);
    const has = await evalJs("!!(document.querySelector('.list-scroll')||document.querySelector('.content'))");
    if (has) pageOk += 1;
  }
  eq('六页均有可滚动内容层', pageOk, 6);
  eq('切页无 JS 报错（阶段性）', errors.length, 0);

  /* ---------------- ② A1 账龄页签 ---------------- */
  section('② A1 分析页「账龄」页签');
  await evalJs("document.querySelectorAll('.rail-item')[4].click()");
  await sleep(350);
  const segBtns = await evalJs("__qa.allTxt('.seg button')");
  // v1.5 起分析页新增「材料」页签，共 5 个（本断言随版本更新，避免过期资产误报）
  eq('分析页页签数 = 5', segBtns.length, 5);
  is('含「账龄」页签', segBtns.some((t) => t === '账龄'));

  await evalJs("__qa.clickText('账龄', '.seg')");
  await sleep(350);
  eq('四个账龄桶渲染', await evalJs("document.querySelectorAll('.age-row').length"), 4);
  const labels = await evalJs("__qa.allTxt('.age-row .age-lb')");
  eq('桶标签顺序', JSON.stringify(labels), JSON.stringify(['0–30 天', '31–60 天', '61–90 天', '90 天以上']));

  const bucketAmts = await evalJs("__qa.nums('.age-row .age-amt')");
  const bucketSum = Math.round(bucketAmts.reduce((a, b) => a + b, 0) * 100) / 100;
  const totalTxt = await evalJs("__qa.txt('.card .mini b.num')");
  const totalNum = parseFloat((totalTxt || '').replace(/[^0-9.]/g, ''));
  eq('四桶金额之和 = 待付合计（页面读数）', bucketSum.toFixed(2), (totalNum || 0).toFixed(2));
  eq('待付合计 = 57,526.86', bucketSum.toFixed(2), '57526.86');

  const counts = await evalJs("[...document.querySelectorAll('.age-cnt')].map(e=>parseInt(e.textContent)||0)");
  is('每桶显示笔数', counts.length === 4);
  eq('90+ 桶有欠款（最久一笔）', counts[3] > 0, true);
  const worstTxt = await evalJs("[...document.querySelectorAll('.mini')].map(e=>e.textContent).find(t=>/最久逾期/.test(t)) || ''");
  const worstDays = parseInt((worstTxt.match(/最久逾期\s*(\d+)\s*天/) || [])[1], 10);
  is('最久逾期天数 > 90', worstDays > 90);

  /* 展开 90+ 桶 */
  await evalJs("document.querySelectorAll('.age-row')[3].click()");
  await sleep(260);
  eq('90+ 桶可展开明细', await evalJs("document.querySelectorAll('.age-item').length"), counts[3]);
  const itemRows = await evalJs("__qa.allTxt('.age-item')");
  is('明细行显示「逾期 N 天」', itemRows.every((t) => /逾期 \d+ 天|未到期/.test(t)));
  is('明细行显示金额', itemRows.length > 0 && /[\d,]+\.\d{2}/.test(itemRows[0]));

  /* 再次点击同一桶 → 收起 */
  await evalJs("document.querySelectorAll('.age-row')[3].click()");
  await sleep(200);
  eq('再次点击同桶收起明细', await evalJs("document.querySelectorAll('.age-item').length"), 0);

  /* 点明细行打开抽屉 */
  await evalJs("document.querySelectorAll('.age-row')[3].click()");
  await sleep(250);
  const firstName = await evalJs("(__qa.txt('.age-item .ai-nm')||'').trim()");
  await evalJs("document.querySelectorAll('.age-item')[0].click()");
  await sleep(420);
  is('点账龄明细行打开费用项抽屉', await evalJs("!!document.querySelector('.drawer')"));
  const drawerTxt = await evalJs("__qa.txt('.drawer')");
  is('抽屉内容与所点费用项一致', drawerTxt.includes(firstName));
  await evalJs("__qa.key('Escape')");
  await sleep(250);
  eq('Esc 关闭抽屉', await evalJs("!!document.querySelector('.drawer')"), false);

  /* ---------------- ③ A1 收款方下钻 ---------------- */
  section('③ A1 收款方下钻');
  const optCount = await evalJs("document.querySelectorAll('.age-sel option').length");
  is('下拉含「全部收款方」+ 各欠款方', optCount >= 2);
  const payeeRows = await evalJs("document.querySelectorAll('.rank-row').length");
  eq('收款方下钻列表行数 = 下拉方数 − 1', payeeRows, optCount - 1);
  const firstPayeeOwe = await evalJs("__qa.nums('.rank-row .vb')[0]");
  const firstPayeeName = await evalJs("(__qa.txt('.rank-row .nm')||'').trim()");
  await evalJs(`(()=>{const s=document.querySelector('.age-sel'); const o=[...s.options].find(x=>x.value && x.value.trim()===${JSON.stringify('PLACEHOLDER')}); return !!o})()`);
  await evalJs(`(()=>{const s=document.querySelector('.age-sel'); s.value=s.options[1].value; s.dispatchEvent(new Event('change',{bubbles:true})); return s.value})()`);
  await sleep(320);
  const subAmts = await evalJs("__qa.nums('.age-row .age-amt')");
  const subSum = Math.round(subAmts.reduce((a, b) => a + b, 0) * 100) / 100;
  eq('下钻后四桶之和 = 该方欠款', subSum.toFixed(2), firstPayeeOwe.toFixed(2));
  is('下钻后「只看」按钮变为「取消」', await evalJs("__qa.allTxt('.rank-row .link').some(t=>t==='取消')"));
  /* 复位：点「取消」 */
  await evalJs("__qa.clickText('取消', '.rank-row')");
  await sleep(280);
  const backAmts = await evalJs("__qa.nums('.age-row .age-amt')");
  eq('取消下钻后回到全量 57,526.86', (Math.round(backAmts.reduce((a, b) => a + b, 0) * 100) / 100).toFixed(2), '57526.86');

  /* ---------------- ④ Q3 设置页存储占用 ---------------- */
  section('④ Q3 设置页存储占用与配额');
  await evalJs("document.querySelectorAll('.rail-item')[5].click()");
  await sleep(420);
  const storeTxt = await evalJs("__qa.txt('.card')");
  is('出现「存储占用」行', /存储占用/.test(storeTxt));
  is('显示 已用 / 5 MB 容量文本', /KB|MB/.test(storeTxt) && /\/\s*5\.00 MB/.test(storeTxt));
  is('显示百分比', /已用\s*\d+(\.\d+)?%/.test(storeTxt));
  is('主数据与快照分开计数', /主数据\s*[\d.]+\s*KB/.test(storeTxt) && /快照\s*[\d.]+\s*KB/.test(storeTxt));
  const barW = await evalJs("(()=>{const i=document.querySelector('.st-bar > i'); return i? i.getBoundingClientRect().width : -1})()");
  is('进度条已渲染且宽度 > 0', barW > 0);
  const barRatio = await evalJs("(()=>{const bar=document.querySelector('.st-bar'); const i=bar.querySelector('i'); return +(i.style.width||'').replace('%','')})()");
  is('进度条宽度比例 = 页面百分比', Math.abs(barRatio - (parseFloat((storeTxt.match(/已用\s*(\d+(?:\.\d+)?)%/) || [])[1]) || -1)) < 0.6);
  const barColorOk = await evalJs(`(()=>{
    const bar = getComputedStyle(document.querySelector('.st-bar > i')).backgroundColor;
    const probe = document.createElement('span');
    probe.style.color = 'var(--muted)';
    document.body.appendChild(probe);
    const muted = getComputedStyle(probe).color;
    probe.style.color = 'var(--danger)';
    const danger = getComputedStyle(probe).color;
    probe.remove();
    return bar !== danger && bar === muted;
  })()`);
  is('正常占用为 muted 色（非红）', barColorOk);
  is('无「接近上限」误报', !/接近上限/.test(storeTxt));
  const keyTxt = await evalJs("[...document.querySelectorAll('.kv')].map(e=>e.textContent).find(t=>/存储键/.test(t)) || ''");
  is('仍展示存储键命名空间', /ztools_project_cost_v1/.test(keyTxt));

  /* ---------------- ⑤ 版本文案 ---------------- */
  section('⑤ 版本文案');
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

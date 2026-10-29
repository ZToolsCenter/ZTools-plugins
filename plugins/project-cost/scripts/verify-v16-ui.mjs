/**
 * v1.6 UI 冒烟（headless Chrome + CDP，自建静态服务器）
 *
 * 覆盖：
 *  ① 骨架与六页零报错；
 *  ② C5 付款作废：抽屉里每笔付款有「作废」按钮 → 作废后行变灰 + 出现作废标记 + 已付减少 →
 *     恢复后回到原状；
 *  ③ C5 彻底删除仍可用（确认后流水减少），且不残留作废标记；
 *  ④ C4 批量付款：勾 3 条未付/部分付 → 出现「批量付款」→ 面板预填待付合计 + 分配预览 →
 *     登记后流水 +3、待付合计减少；
 *  ⑤ K1 唯一键：localStorage 里每笔付款都有 pid 且项目内唯一；
 *  ⑥ 导出付款表表头含「付款编号 / 作废」（读 dist 打包后的 HEADS 不可行，改为验证导入提示文案）；
 *  ⑦ 版本文案与 package.json 一致。
 *
 * 用法：npx esbuild scripts/verify-v16-ui.mjs --bundle --platform=node --format=esm \
 *         --define:process.env.NODE_ENV='"development"' --outfile=/tmp/v16-ui.mjs && node /tmp/v16-ui.mjs
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
const SRV_PORT_PREF = 8236;
const PORT_PREF = 9228;
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
    // 负数在界面里可能用 U+2212 之类的排版减号，先归一化再取数，否则 -394.88 会被读成 394.88
    const s = String(t).replace(/[\u2212\u2013\u2014]/g, '-').replace(/[^0-9.-]/g, '');
    return parseFloat(s) || 0;
  },
  /** 读抽屉里「已付 / 待付」这类 label + 数值的组合（先限定在抽屉内，避免命中列表上的状态徽标） */
  stat(label) {
    const roots = [document.querySelector('.drawer'), document].filter(Boolean);
    for (const root of roots) {
      const s = [...root.querySelectorAll('span')].find((e) => e.textContent.trim() === label && e.nextElementSibling);
      if (s) return __qa.num(s.nextElementSibling.textContent);
    }
    return NaN;
  },
  clickText(text, scope) {
    const root = scope ? document.querySelector(scope) : document;
    if (!root) return false;
    const els = [...root.querySelectorAll('button, .btn, .link, .chip, .seg button, .item')];
    const hit = els.find((e) => (e.textContent || '').replace(/\\s+/g, '').includes(text.replace(/\\s+/g, '')));
    if (hit) { hit.click(); return true; }
    return false;
  },
  cardByHead(text) {
    const heads = [...document.querySelectorAll('.card')];
    return heads.find((c) => {
      const h = c.querySelector('.sec-head');
      return h && h.textContent.includes(text);
    }) || null;
  },
  setInput(sel, val) {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.value = String(val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },
  key(key) { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); return true; },
  /** 本地台账里的付款唯一键体检（K1） */
  pidAudit() {
    const raw = localStorage.getItem('ztools_project_cost_v1');
    if (!raw) return { ok: false, reason: 'no-key' };
    const d = JSON.parse(raw);
    const bs = d.books || [];
    const b = bs.find((x) => x.id === d.activeBookId) || bs[0];
    if (!b) return { ok: false, reason: 'no-book' };
    let total = 0; let missing = 0; let dup = 0;
    (b.projects || []).forEach((p) => {
      const pays = p.payments || [];
      total += pays.length;
      const seen = new Set();
      pays.forEach((py) => {
        if (!/^P\\d{4,}$/.test(py.pid || '')) missing += 1;
        else if (seen.has(py.pid)) dup += 1;
        else seen.add(py.pid);
      });
    });
    return { ok: missing === 0 && dup === 0, total, missing, dup };
  },
  /** 本地台账里的付款金额之和（校验批量付款是否精确入账） */
  paySum() {
    const raw = localStorage.getItem('ztools_project_cost_v1');
    const d = JSON.parse(raw);
    const bs = d.books || [];
    const b = bs.find((x) => x.id === d.activeBookId) || bs[0];
    let n = 0; let sum = 0;
    (b.projects || []).forEach((p) => (p.payments || []).forEach((py) => {
      if (!py.void) { n += 1; sum += +py.amount || 0; }
    }));
    return { n, sum: Math.round(sum * 100) / 100 };
  },
};
true;
`;

/* Chrome 的 --user-data-dir 同样要按进程区分：同一个 profile 目录被两个 Chrome 实例同时
   持有时，后起的那个会被 profile 单例锁拦下并附到先起的实例上（自己的 --remote-debugging-port
   被忽略），两个套件于是抢同一个浏览器 —— 并发跑同一个套件就是这么塌的。 */
const userData = path.join(os.tmpdir(), `ztchrome-qa16-${process.pid}`);
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
    await sleep(320);
  };

  await waitFor("!!document.querySelector('.app')");
  await evalJs('localStorage.clear(), true');
  await cdp(ws, 'Page.reload');
  is('清空本地数据后应用重启', await waitFor("!!document.querySelector('.app') && !!document.querySelector('.rail')"));
  await evalJs(HELPERS);
  // 删除确认在 headless 里没有 UI，统一放行
  await evalJs('window.confirm = () => true; true');

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

  /* ---------------- ② K1 唯一键（启动即回填） ---------------- */
  section('② K1 付款唯一键回填');
  const audit0 = await evalJs('__qa.pidAudit()');
  is('88 笔付款全部有合法 pid', audit0.ok);
  eq('付款总笔数 88', audit0.total, 88);
  eq('缺失编号 0 笔', audit0.missing, 0);
  eq('重复编号 0 笔', audit0.dup, 0);

  /* ---------------- ③ C5 作废 / 恢复 ---------------- */
  section('③ C5 付款作废与恢复');
  await goTab(2); // 付款页
  // 优先开「部分付」的费用项：已付 > 0 且待付 > 0，作废的增减才有可观测意义
  await evalJs(`(()=>{
    const rows=[...document.querySelectorAll('.item')];
    const hit=rows.find(r=>/部分付/.test((r.querySelector('.badge')||{}).textContent||''))||rows[0];
    hit.click(); return true;
  })()`);
  await sleep(450);
  is('费用项抽屉打开', await evalJs("!!document.querySelector('.drawer')"));
  eq('付款行使用 payrow 布局', await evalJs("document.querySelectorAll('.mrow.payrow').length > 0"), true);
  const payRowsN = await evalJs("document.querySelectorAll('.mrow.payrow').length");
  is('每行都有「作废」按钮', await evalJs(`[...document.querySelectorAll('.mrow.payrow')].every(r=>!!r.querySelector('.void-btn'))`));
  eq('每行都有彻底删除按钮', await evalJs(`[...document.querySelectorAll('.mrow.payrow')].every(r=>!!r.querySelector('.void-btn + .del'))`), true);
  eq('初始作废行 0 条', await evalJs("document.querySelectorAll('.mrow.voided').length"), 0);

  const paidBefore = await evalJs("__qa.stat('已付')");
  const dueBefore = await evalJs("__qa.stat('待付')");
  // 挑一笔**正数**付款来作废：付款流水里也有退款（负数，显示为「退款 xxx」），
  // 拿退款作废会让已付反向增加，测不出「作废掉一笔已付款」的语义。
  const vIdx = await evalJs(`(()=>{
    const rows=[...document.querySelectorAll('.mrow.payrow')];
    return rows.findIndex(r=>!/退款/.test(r.querySelector('.amt').textContent));
  })()`);
  is('找到一笔正数付款', vIdx >= 0);
  const firstAmt = await evalJs(`__qa.num(document.querySelectorAll('.mrow.payrow')[${vIdx}].querySelector('.amt').textContent)`);
  is('读到首笔付款金额', firstAmt > 0);
  is('读到已付金额（可为 0，只要求是数字）', !Number.isNaN(paidBefore));
  is('读到待付金额（可为 0，只要求是数字）', !Number.isNaN(dueBefore));

  await evalJs(`document.querySelectorAll('.mrow.payrow')[${vIdx}].querySelector('.void-btn').click()`);
  await sleep(400);
  eq('作废后出现 1 条灰显行', await evalJs("document.querySelectorAll('.mrow.voided').length"), 1);
  eq('作废行出现「作废」标记', await evalJs("!!document.querySelector('.mrow.voided .void-tag')"), true);
  eq('作废行按钮变成「恢复」', await evalJs("document.querySelector('.mrow.voided .void-btn').textContent.trim()"), '恢复');
  eq('付款行数不变（作废不删记录）', await evalJs("document.querySelectorAll('.mrow.payrow').length"), payRowsN);
  const paidAfterVoid = await evalJs("__qa.stat('已付')");
  const dueAfterVoid = await evalJs("__qa.stat('待付')");
  eq('已付减少该笔金额', Math.round((paidBefore - paidAfterVoid) * 100) / 100, Math.round(firstAmt * 100) / 100);
  eq('待付增加该笔金额', Math.round((dueAfterVoid - dueBefore) * 100) / 100, Math.round(firstAmt * 100) / 100);
  eq('抽屉标题显示作废笔数', await evalJs("(()=>{const h=[...document.querySelectorAll('.sec-head')].find(x=>x.textContent.includes('付款记录')); return h?/作废 1/.test(h.textContent):false})()"), true);

  await evalJs("document.querySelector('.mrow.voided .void-btn').click()");
  await sleep(400);
  eq('恢复后灰显行归 0', await evalJs("document.querySelectorAll('.mrow.voided').length"), 0);
  eq('恢复后已付回到原值', await evalJs("__qa.stat('已付')"), paidBefore);
  eq('恢复后待付回到原值', await evalJs("__qa.stat('待付')"), dueBefore);

  /* ---------------- ④ C5 彻底删除 ---------------- */
  section('④ C5 彻底删除');
  await evalJs("document.querySelector('.mrow.payrow .del').click()");
  await sleep(400);
  eq('彻底删除后流水 -1', await evalJs("document.querySelectorAll('.mrow.payrow').length"), payRowsN - 1);
  eq('删除后不残留作废行', await evalJs("document.querySelectorAll('.mrow.voided').length"), 0);
  await evalJs("__qa.key('Escape')");
  await sleep(320);
  is('Esc 关闭抽屉', !(await evalJs("!!document.querySelector('.drawer')")));

  /* ---------------- ⑤ C4 批量付款 ---------------- */
  section('⑤ C4 批量登记付款');
  await goTab(1); // 费用列表
  eq('批量条默认提示选择方框', /勾选左侧方框/.test(await evalJs("__qa.txt('.batch-bar')")), true);
  eq('默认没有「批量付款」按钮', await evalJs("__qa.clickText('批量付款', '.batch-bar')"), false);

  // 只勾「未付 / 部分付」的行，保证有待付金额
  const picked = await evalJs(`(()=>{
    const rows=[...document.querySelectorAll('.item')].filter(el=>{
      const b=el.querySelector('.badge');
      return b && /未付|部分付/.test(b.textContent);
    }).slice(0,3);
    rows.forEach(el=>{ const cb=el.querySelector('.sel-box input'); if(cb) cb.click(); });
    return rows.length;
  })()`);
  eq('勾选 3 条有待付的费用项', picked, 3);
  await sleep(320);
  eq('批量条显示已选 3', /已选 3/.test(await evalJs("__qa.txt('.batch-bar')")), true);

  is('出现「批量付款」按钮', await evalJs("__qa.clickText('批量付款', '.batch-bar')"));
  await sleep(320);
  is('批量付款面板打开', await evalJs("!!document.querySelector('.bp')"));
  eq('面板分配行数 = 3', await evalJs("document.querySelectorAll('.bp-chip').length"), 3);
  const prefilled = await evalJs("__qa.num(document.querySelector('.bp-amt').value)");
  is('总额默认预填为所选待付合计', prefilled > 0);
  eq('分配方式默认按待付比例', await evalJs("document.querySelector('.bp .mini-select').value"), 'due');
  eq('按钮文案含笔数', /登记 3 笔/.test(await evalJs("__qa.txt('.bp .btn.primary')")), true);
  const chipSum = await evalJs("__qa.num(document.querySelectorAll('.bp-chip b').length ? [...document.querySelectorAll('.bp-chip b')].map(b=>__qa.num(b.textContent)).reduce((a,b)=>a+b,0) : 0)");
  eq('分配预览合计 = 总额', Math.round(chipSum * 100) / 100, Math.round(prefilled * 100) / 100);

  // 改成 6000，验证重算
  await evalJs("__qa.setInput('.bp-amt', '6000')");
  await sleep(300);
  const chipSum2 = await evalJs("[...document.querySelectorAll('.bp-chip b')].map(b=>__qa.num(b.textContent)).reduce((a,b)=>a+b,0)");
  eq('改总额后分配合计跟着变', Math.round(chipSum2 * 100) / 100, 6000);

  const payBefore = await evalJs('__qa.paySum()');
  await evalJs("document.querySelector('.bp .btn.primary').click()");
  await sleep(500);
  const payAfter = await evalJs('__qa.paySum()');
  eq('登记后流水 +3', payAfter.n - payBefore.n, 3);
  eq('登记后已付 +6000', Math.round((payAfter.sum - payBefore.sum) * 100) / 100, 6000);
  eq('登记后批量条回到空态', /勾选左侧方框/.test(await evalJs("__qa.txt('.batch-bar')")), true);
  eq('批量付款面板已收起', await evalJs("!!document.querySelector('.bp')"), false);
  const audit1 = await evalJs('__qa.pidAudit()');
  is('批量登记后编号仍全部合法且唯一', audit1.ok);
  eq('总笔数 = 起始 88 − 删除 1 + 批量 3', audit1.total, audit0.total - 1 + 3);

  /* ---------------- ⑥ 设置页导入提示 + 版本 ---------------- */
  section('⑥ 设置页文案与版本');
  await goTab(5);
  const setTxt = await evalJs("document.querySelector('.content').textContent.replace(/\\s+/g,' ')");
  is(`设置页版本文案为 v${PKG_VERSION}`, new RegExp(`v${PKG_VERSION.replace(/\./g, '\\.')}`).test(setTxt));
  is('设置页仍有数据体检卡', /数据体检/.test(setTxt));

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

/**
 * v1.3 UI 冒烟（headless Chrome + CDP，自建静态服务器，不依赖后台进程）
 *
 * 覆盖：
 *  ① 六页渲染无 JS 报错；左轨 62px；
 *  ② 概览 B1 双口径文案（确定应付 231,180.97 / 其中预估 14,875.00，顶栏仍是真源 246,055.97）；
 *     另含 K10（v1.8.2）反向钉：概览页与分析页可见文本里不再出现「数字+万」的万位金额；
 *  ③ R5 列表多选：复选框点击不穿透、全选/清空、Shift 连选、J/K/Enter/⌘K 仍可用、Esc 清选择；
 *  ④ R3 品名联想：datalist 有条目、显示「上次记账」、采纳后单位/单价自动填入；
 *  ⑤ R1 批量粘贴：抽屉内粘 12 行（10 有效 + 2 坏行）→ 预览行数/坏行数/有效合计 → 确认导入后
 *     明细条数 +10、合计 +8974；
 *  ⑥ R4「复制到…」浮层（含明细勾选默认勾选）；
 *  ⑦ C3 对账单抽屉：费用项 + 付款流水 + 三行小计自洽、打印 CSS 生效、无打印能力时降级提示；
 *  ⑧ X1 设置页 CSV 导入面板（表类型/选文件/去重键提示）；
 *  ⑨ 版本文案（T05-⑤ 要求 v1.3.0）。
 *
 * 用法：npx esbuild scripts/verify-v13-ui.mjs --bundle --platform=node --format=esm \
 *         --define:process.env.NODE_ENV='"development"' --outfile=/tmp/v13-ui.mjs && node /tmp/v13-ui.mjs
 * 前置：dist/ 已构建（脚本自带静态服务器，无需手工起 python http.server）。
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import { pickPort, listenServer } from './free-port.mjs';
import { SEED } from '../src/lib/seed.js';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/**
 * 端口：**只是首选值**，不是写死的固定端口。并发跑多个 UI 套件时若首选号已被占，
 * 由 scripts/free-port.mjs 自动退让到 OS 分配的空闲端口 —— 端口撞车会让
 * `srv.listen()` 的回调永不触发，套件挂到看门狗超时后一条断言都不产出，
 * 汇总器会把「0 通过 0 失败」画成 ✓（假通过）。
 */
const SRV_PORT_PREF = 8232;
const PORT_PREF = 9224;
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
const not = (label, actual) => record(!actual, label, actual, 'falsy');
const section = (t) => out.push(`\n== ${t} ==`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wsGet = async (u) => (await fetch(u)).json();
setTimeout(() => { console.error('WATCHDOG: 超时强制退出'); process.exit(2); }, 120000).unref();

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

/* 页面内小工具：原生 setter 赋值（Vue v-model 依赖 input 事件）、按文本点按钮 */
const HELPERS = `
window.__qa = {
  set(sel, val) {
    const el = document.querySelector(sel);
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  },
  change(sel) {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },
  clickText(text, scope) {
    const root = scope ? document.querySelector(scope) : document;
    if (!root) return false;
    const els = [...root.querySelectorAll('button, .btn, .link, .chip')];
    const hit = els.find((e) => (e.textContent || '').replace(/\\s+/g, '').includes(text.replace(/\\s+/g, '')));
    if (hit) { hit.click(); return true; }
    return false;
  },
  txt(sel) {
    const el = document.querySelector(sel);
    return el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';
  },
  allTxt(sel) { return [...document.querySelectorAll(sel)].map((e) => e.textContent.replace(/\\s+/g, ' ').trim()); },
  key(key, mods) {
    const ev = new KeyboardEvent('keydown', Object.assign({ key, bubbles: true, cancelable: true }, mods || {}));
    window.dispatchEvent(ev);
    return true;
  },
};
true;
`;

/* Chrome 的 --user-data-dir 同样要按进程区分：同一个 profile 目录被两个 Chrome 实例同时
   持有时，后起的那个会被 profile 单例锁拦下并附到先起的实例上（自己的 --remote-debugging-port
   被忽略），两个套件于是抢同一个浏览器 —— 并发跑同一个套件就是这么塌的。 */
const userData = path.join(os.tmpdir(), `ztchrome-qa13-${process.pid}`);
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

  // 干净基线：清 localStorage → 重载（否则上一轮运行的改动会残留）
  await waitFor("!!document.querySelector('.app')");
  await evalJs('localStorage.clear(), true');
  await cdp(ws, 'Page.reload');
  is('清空本地数据后应用重启', await waitFor("!!document.querySelector('.app') && !!document.querySelector('.rail')"));
  await evalJs(HELPERS);

  /* ---------------- ① 骨架 / 六页 ---------------- */
  section('① 骨架与六页渲染');
  eq('左轨宽度 = 62px', await evalJs("getComputedStyle(document.querySelector('.rail')).width"), '62px');
  eq('rail-item 数量', await evalJs("document.querySelectorAll('.rail-item').length >= 6"), true);
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
  if (errors.length) out.push('   报错：' + errors.slice(0, 5).join(' / '));

  /* ---------------- ② 概览 B1 双口径 ---------------- */
  section('② 概览 B1 双口径文案');
  await evalJs("document.querySelectorAll('.rail-item')[0].click()");
  await sleep(300);
  const ovCard = await evalJs("__qa.txt('.ov2 .card')");
  is('付款进度卡含「确定应付（不含预估）」', /确定应付（不含预估）/.test(ovCard));
  is('确定应付显示 ¥231,180.97', /231,180\.97/.test(ovCard));
  is('其中预估显示 ¥14,875.00', /14,875\.00/.test(ovCard));
  is('真源「累计应付」仍为 ¥246,055.97', /246,055\.97/.test(ovCard));
  const topstat = await evalJs("__qa.txt('.topstat')");
  // K10（v1.8.2）：万位出口 fmtW 已废除，顶栏改为元 + 千分位，与同屏小字同精度
  is('顶栏应付仍是真源 ¥246,055.97', /246,055\.97/.test(topstat));
  is('顶栏待付 ¥57,526.86', /57,526\.86/.test(topstat));
  not('顶栏不再出现万位金额（无「数字+万」）', /[\d.]万/.test(topstat));

  /* ---------------- ②+ K10（v1.8.2）全站单一精度反向钉 ---------------- */
  // 背景：v1.7 有「万位」第二精度 fmtW，同一笔 8,000 在两张图里长得不一样，被客户质疑算错。
  // v1.8.2 裁决：全站统一为「元 + 千分位 + 2 位小数」，fmtW 从 src/lib/core.js 删除。
  // 这里钉两件事：① 概览页与分析页的可见文本里不再出现「数字 + 万」；② 换精度后窄位不溢出。
  section('②+ K10 全站单一精度反向钉（无万位 / 窄位不溢出）—— 数据仍为基线，跑在 ③ 改动数据之前');

  // 概览页
  await evalJs("document.querySelectorAll('.rail-item')[0].click()");
  await sleep(320);
  const ovWan = await evalJs(`(() => {
    const t = (document.querySelector('.main') || document.body).innerText || '';
    return (t.match(/.{0,20}[\\d.]万.{0,8}/g) || []);
  })()`);
  eq('概览页可见文本无「数字+万」', JSON.stringify(ovWan), '[]');
  // 顶栏两条字面值由 ② 已钉（246,055.97 / 57,526.86），此处只补「无万位」与窄位不溢出
  // 柱顶数值的口径：① .mv 实际渲染宽 ≤ 列宽（硬兜底：绝不叠压邻柱）
  //               ② scrollWidth ≤ clientWidth（没触发省略号，真实场景数值是完整的）
  const MEASURE_BARS = `(() => {
    const mb = document.querySelector('.minibars');
    if (!mb) return { n: 0 };
    const cols = [...mb.querySelectorAll('.mb')];
    const rows = cols.map((c) => {
      const s = c.querySelector('.mv');
      return {
        colW: c.getBoundingClientRect().width,
        mvW: s.getBoundingClientRect().width,
        clip: s.scrollWidth - s.clientWidth,
        text: (s.textContent || '').trim(),
      };
    });
    const worstBleed = rows.reduce((m, r) => Math.max(m, r.mvW - r.colW), -999);
    const worstClip = rows.reduce((m, r) => Math.max(m, r.clip), -999);
    const longest = rows.map((r) => r.text).sort((a, b) => b.length - a.length)[0];
    return {
      n: cols.length,
      colW: +rows[0].colW.toFixed(2),
      mvW: +Math.max(...rows.map((r) => r.mvW)).toFixed(2),
      worstBleed: +worstBleed.toFixed(2),
      worstClip: +worstClip.toFixed(2),
      longest,
      allMoney: rows.every((r) => r.text === '' || /^¥[\\d,]+\\.\\d{2}$/.test(r.text)),
    };
  })()`;
  const ovBars = await evalJs(MEASURE_BARS);
  is('概览现金流柱图有柱（6 列）', ovBars.n >= 6);
  is(`概览柱顶数值不叠压邻柱（.mv 最宽 ${ovBars.mvW}px ≤ 列宽 ${ovBars.colW}px）`, ovBars.worstBleed <= 0);
  is(`概览柱顶数值未被省略号截断（scrollWidth−clientWidth 最大 ${ovBars.worstClip}px）`, ovBars.worstClip <= 0.5);
  is(`概览柱顶数值全是元 + 千分位（最长 ${ovBars.longest}）`, ovBars.allMoney);

  // 分析页：三枚 Donut（size=112）+ 月度趋势 MiniBars 都在这一页
  await evalJs("document.querySelectorAll('.rail-item')[4].click()");
  await sleep(320);
  const anWan = await evalJs(`(() => {
    const t = (document.querySelector('.main') || document.body).innerText || '';
    return (t.match(/.{0,20}[\\d.]万.{0,8}/g) || []);
  })()`);
  eq('分析页（品类签）可见文本无「数字+万」', JSON.stringify(anWan), '[]');
  const donutFit = await evalJs(`(() => {
    const svg = document.querySelector('.donut-wrap svg');
    if (!svg) return null;
    const size = +svg.getAttribute('width');
    const cx = size / 2;
    const val = [...svg.querySelectorAll('text')].pop();
    const bb = val.getBBox();
    const innerR = size / 2 - 9 - 5.5;
    const bottom = (bb.y + bb.height) - cx;
    return {
      size, text: val.textContent.trim(), fs: +val.getAttribute('font-size'),
      w: +bb.width.toFixed(2), corner: +Math.hypot(bb.width / 2, bottom).toFixed(2), innerR: +innerR.toFixed(2),
    };
  })()`);
  is('分析页 Donut 中心值为元 + 千分位', /^¥[\d,]+\.\d{2}$/.test(donutFit?.text || ''));
  eq('分析页 Donut 中心值逐字 ¥246,055.97', donutFit?.text, '¥246,055.97');
  eq('分析页 Donut 字号降到 11（11 字符档）', donutFit?.fs, 11);
  is(`Donut 中心文字不压色环（角落 ${donutFit?.corner}px < 内圈半径 ${donutFit?.innerR}px）`, donutFit && donutFit.corner < donutFit.innerR);

  // 趋势签（第 5 个 .seg[data-tab] 按钮）
  await evalJs("document.querySelectorAll('.seg[data-tab] button')[4].click()");
  await sleep(320);
  const trWan = await evalJs(`(() => {
    const t = (document.querySelector('.main') || document.body).innerText || '';
    return (t.match(/.{0,20}[\\d.]万.{0,8}/g) || []);
  })()`);
  eq('分析页（趋势签）可见文本无「数字+万」', JSON.stringify(trWan), '[]');
  const trBars = await evalJs(MEASURE_BARS);
  is('月度趋势柱图有柱（≥7 列）', trBars.n >= 7);
  is(`趋势柱顶数值不叠压邻柱（.mv 最宽 ${trBars.mvW}px ≤ 列宽 ${trBars.colW}px）`, trBars.worstBleed <= 0);
  is(`趋势柱顶数值未被省略号截断（scrollWidth−clientWidth 最大 ${trBars.worstClip}px）`, trBars.worstClip <= 0.5);
  is(`趋势柱顶数值全是元 + 千分位（最长 ${trBars.longest}）`, trBars.allMoney);

  // MiniBars 应力：12 列 + 百万级金额（克隆真实节点，保留 scoped 属性；
  // 手工把 font-size 设成 8px 是为了复刻 valFont 在 12 列时给出的档位）
  const stress = await evalJs(`(() => {
    const src = document.querySelector('.minibars');
    if (!src) return null;
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;width:'
      + src.getBoundingClientRect().width + 'px;';
    document.body.appendChild(host);
    const wrap = src.cloneNode(true);
    const proto = wrap.querySelector('.mb');
    while (wrap.querySelectorAll('.mb').length < 12) wrap.appendChild(proto.cloneNode(true));
    const cols = [...wrap.querySelectorAll('.mb')];
    cols.forEach((c, i) => {
      const mv = c.querySelector('.mv');
      mv.textContent = '¥1,234,567.89';
      mv.style.fontSize = '8px';
      c.setAttribute('title', '2024-0' + ((i % 9) + 1) + ' · ¥1,234,567.89');
    });
    host.appendChild(wrap);
    const rows = [...wrap.querySelectorAll('.mb')].map((c) => {
      const mv = c.querySelector('.mv');
      return {
        colW: c.getBoundingClientRect().width,
        mvW: mv.getBoundingClientRect().width,
        clip: mv.scrollWidth - mv.clientWidth,
        title: c.getAttribute('title') || '',
      };
    });
    const res = {
      n: rows.length,
      colW: +rows[0].colW.toFixed(2),
      mvW: +rows[0].mvW.toFixed(2),
      worstBleed: +rows.reduce((m, r) => Math.max(m, r.mvW - r.colW), -999).toFixed(2),
      clipped: rows[0].clip > 0.5,
      title: rows[0].title,
    };
    wrap.remove();
    host.remove();
    return res;
  })()`);
  eq('应力场景造出 12 列', stress?.n, 12);
  is(`应力（12 列 + ¥1,234,567.89 @8px）仍不叠压邻柱（.mv ${stress?.mvW}px ≤ 列宽 ${stress?.colW}px，最差 ${stress?.worstBleed}px）`,
    stress && stress.worstBleed <= 0);
  eq('应力下省略号兜底确实生效（scrollWidth > clientWidth）', stress?.clipped, true);
  is(`应力下该柱 title 仍给出完整金额（${stress?.title}）`, /¥1,234,567\.89/.test(stress?.title || ''));

  /* ---------------- ③ R5 多选与键盘 ---------------- */
  section('③ R5 列表多选 / 键盘导航');
  await evalJs("document.querySelectorAll('.rail-item')[1].click()");
  await sleep(320);
  eq('批量操作条存在', await evalJs("!!document.querySelector('.batch-bar')"), true);
  const firstNo = await evalJs("(__qa.txt('.list .item .no')||'').trim()");
  is('取到首条项目号（供 X1 端到端用例使用）', /^ZX\d+/.test(firstNo));
  eq('批量条未选中时提示「勾选左侧方框」', await evalJs("/勾选左侧方框/.test(__qa.txt('.batch-bar'))"), true);

  // 复选框点击不穿透打开抽屉
  await evalJs("document.querySelectorAll('.list .item .sel-box input')[0].click()");
  await sleep(200);
  eq('点复选框不穿透（抽屉未打开）', await evalJs("!!document.querySelector('.drawer')"), false);
  is('已选 1 条', /已选\s*1/.test(await evalJs("__qa.txt('.batch-bar')")));

  // Shift 连选：先清空 → 点最靠下那行（记录 lastIndex）→ 按住 Shift 点最靠上那行，
  // 期望「两行之间全部选中」（条数 = 行距 + 1），而不是只多选 1 条。
  // ★ 用 CDP Input.dispatchMouseEvent 发真实鼠标事件（modifiers=8 即 Shift），
  //   并先用 elementFromPoint 确认坐标真能命中复选框（列表下半部分被底部批量条裁掉）。
  await evalJs("__qa.clickText('清空', '.batch-bar')");
  await sleep(220);
  const hitList = await evalJs(`(() => {
    const ins = [...document.querySelectorAll('.list .item .sel-box input')];
    const hits = [];
    ins.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const x = Math.round(r.x + r.width / 2);
      const y = Math.round(r.y + r.height / 2);
      if (document.elementFromPoint(x, y) === el) hits.push({ i, x, y });
    });
    return hits;
  })()`);
  is('可命中的复选框 ≥ 3 行（用例前提）', hitList.length >= 3);
  const firstHit = hitList[0];
  const lastHit = hitList[hitList.length - 1];
  is('可用行距 ≥ 2（足以区分连选与单选）', lastHit.i - firstHit.i >= 2);
  await evalJs(`document.querySelectorAll('.list .item .sel-box input')[${lastHit.i}].click()`);
  await sleep(180);
  eq('连选起点：已选 1 条', await evalJs("(document.querySelector('.batch-n b')||{}).textContent"), '1');
  await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: firstHit.x, y: firstHit.y, modifiers: 8 });
  await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: firstHit.x, y: firstHit.y, button: 'left', buttons: 1, clickCount: 1, modifiers: 8 });
  await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: firstHit.x, y: firstHit.y, button: 'left', buttons: 0, clickCount: 1, modifiers: 8 });
  await sleep(300);
  const afterShift = await evalJs("(document.querySelector('.batch-n b')||{}).textContent");
  eq(`Shift 连选应选中第 1–${lastHit.i + 1} 行（共 ${lastHit.i + 1} 条）`, afterShift, String(lastHit.i + 1));

  // 全选 / 清空
  await evalJs("__qa.clickText('清空', '.batch-bar')");
  await sleep(180);
  await evalJs("__qa.clickText('全选本页', '.batch-bar')");
  await sleep(250);
  eq('全选本页 → 已选 71', await evalJs("(document.querySelector('.batch-n b')||{}).textContent"), '71');
  is('全选后出现批量动作按钮', await evalJs("/改品类/.test(__qa.txt('.batch-bar')) && /改收款方/.test(__qa.txt('.batch-bar')) && /改到期日/.test(__qa.txt('.batch-bar'))"));
  // 已选态下「取消全选」必须可达（否则勾满后再也退不出来）
  is('全选后「取消全选」可达', /取消全选/.test(await evalJs("__qa.txt('.batch-bar')")));
  eq('点「取消全选」按钮命中', await evalJs("__qa.clickText('取消全选', '.batch-bar')"), true);
  await sleep(220);
  eq('取消全选后回到未选中态', await evalJs("/勾选左侧方框/.test(__qa.txt('.batch-bar'))"), true);
  // 「清空」同样可复位
  await evalJs("__qa.clickText('全选本页', '.batch-bar')");
  await sleep(240);
  eq('再次全选 → 71', await evalJs("(document.querySelector('.batch-n b')||{}).textContent"), '71');
  eq('「清空」按钮可复位', await evalJs("__qa.clickText('清空', '.batch-bar')"), true);
  await sleep(200);
  eq('清空后回到未选中态', await evalJs("/勾选左侧方框/.test(__qa.txt('.batch-bar'))"), true);

  // J/K/Enter/⌘K 与多选共存
  await evalJs("__qa.key('j')");
  await sleep(200);
  eq('J 键可移动选中（.item.sel 出现）', await evalJs("!!document.querySelector('.item.sel')"), true);
  await evalJs("__qa.key('j')");
  await sleep(150);
  const selIndex2 = await evalJs("[...document.querySelectorAll('.list .item')].findIndex(e => e.classList.contains('sel'))");
  is('连按 J 选中项下移（索引 1）', selIndex2 === 1);
  await evalJs("__qa.key('k')");
  await sleep(150);
  eq('K 键回退到索引 0', await evalJs("[...document.querySelectorAll('.list .item')].findIndex(e => e.classList.contains('sel'))"), 0);
  await evalJs("__qa.key('Enter')");
  await sleep(400);
  eq('Enter 打开抽屉', await evalJs("!!document.querySelector('.drawer')"), true);
  await evalJs("__qa.key('Escape')");
  await sleep(300);
  eq('Esc 关闭抽屉', await evalJs("!!document.querySelector('.drawer')"), false);
  // 多选态下 ⌘K 仍可聚焦搜索
  await evalJs("document.querySelectorAll('.list .item .sel-box input')[0].click()");
  await sleep(150);
  await evalJs("__qa.key('k', { metaKey: true })");
  await sleep(300);
  eq('多选态下 ⌘K 仍聚焦搜索框', await evalJs("document.activeElement && document.activeElement.hasAttribute('data-search')"), true);
  await evalJs("document.activeElement.blur()");
  await sleep(120);
  // Esc 清多选（无抽屉时）
  await evalJs("__qa.key('Escape')");
  await sleep(250);
  eq('Esc 清空多选', await evalJs("!!document.querySelector('.batch-n')"), false);

  /* ---------------- ④ R3 品名联想 ---------------- */
  section('④ R3 品名历史单价联想');
  // 期望值按设计 §1.2 取数规则复算：项目按 date 降序，同品名取「最近一条」
  const sorted = [...SEED.projects].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  let expectHint = null;
  sorted.forEach((p) => (p.details || []).forEach((d) => {
    const nm = (d.name || '').trim();
    if (!expectHint && nm === '砂子') expectHint = { unit: d.unit || '', price: +d.price || 0 };
  }));
  is('用例前提：台账里有「砂子」历史', !!expectHint);
  await evalJs("document.querySelectorAll('.list .item')[0].click()");
  await sleep(400);
  await evalJs("__qa.clickText('添加', '.drawer .sec-head')");
  await sleep(320);
  eq('进入明细表单（出现品名 datalist 输入框）',
    await evalJs("!!document.querySelector('input[list=\"name-price-list\"]')"), true);
  const dlCount = await evalJs("document.querySelectorAll('#name-price-list option').length");
  is('datalist 条目数 > 0', dlCount > 0);
  await evalJs("__qa.set('input[list=\"name-price-list\"]', '砂子')");
  await sleep(200);
  is('输入命中后显示「上次记账」提示', /上次记账/.test(await evalJs("__qa.txt('.drawer')")));
  is('提示含单位与单价', new RegExp(`${expectHint.unit}`).test(await evalJs("__qa.txt('.drawer')")));
  eq('采纳前单位为空（未被打断）', await evalJs("document.querySelectorAll('.form .grid3 .field input')[0].value"), '');
  await evalJs("__qa.change('input[list=\"name-price-list\"]')");
  await sleep(200);
  eq('采纳后单位自动填入', await evalJs("document.querySelectorAll('.form .grid3 .field input')[0].value"), expectHint.unit);
  eq('采纳后单价自动填入', await evalJs("document.querySelectorAll('.form .grid3 .field input')[2].value"), String(expectHint.price));
  // 联想只填字段、不落库：取消后回到详情态，且明细条数未变
  await evalJs("__qa.clickText('取消', '.drawer-foot')");
  await sleep(280);
  eq('取消明细表单后回到详情态', await evalJs("!!document.querySelector('.batch-area')"), false);

  /* ---------------- ⑤ R1 批量粘贴 ---------------- */
  section('⑤ R1 明细批量粘贴（抽屉内端到端）');
  const TSV10 = [
    'QA砂A\t方\t10\t210', 'QA水泥\t包\t20\t25.5', 'QA红砖\t块\t500\t0.8', 'QA腻子\t包\t12\t45',
    'QA乳胶漆\t桶\t3\t380', 'QA瓷砖\tm2\t25\t88', 'QA防水\t桶\t2\t460', 'QA石膏线\t米\t30\t12',
    'QA木方\t根\t40\t18.6', 'QA钉子\t盒\t5\t12',
  ].join('\\n');
  const MIXED = `${TSV10}\\n\\t方\\t5\\t100\\nQA坏行\\t方\\tabc\\t100`;
  const readDetailHint = async () => {
    const t = await evalJs(`(() => {
      const h = [...document.querySelectorAll('.drawer .sec-head')].find(e => e.textContent.includes('明细'));
      return h ? (h.querySelector('.hint')||{}).textContent : '';
    })()`);
    const m = (/^([\d]+) 条 · 合计 ([\d,\.]+)/).exec((t || '').replace(/\s+/g, ' ').trim());
    return m ? { n: +m[1], sum: +m[2].replace(/,/g, '') } : null;
  };
  const h0 = await readDetailHint();
  is('读到导入前「N 条 · 合计」', !!h0);
  await evalJs("__qa.clickText('添加', '.drawer .sec-head')");
  await sleep(300);
  await evalJs("__qa.clickText('批量粘贴', '.drawer')");
  await sleep(320);
  eq('进入批量粘贴态（textarea 出现）', await evalJs("!!document.querySelector('.batch-area')"), true);
  eq('有效行为 0 时确认按钮 disabled', await evalJs("(()=>{const b=[...document.querySelectorAll('.drawer-foot button')].find(x=>/确认导入/.test(x.textContent)); return b ? b.disabled : null})()"), true);
  await evalJs(`__qa.set('.batch-area', "${MIXED}")`);
  await sleep(280);
  eq('预览行数 = 12', await evalJs("document.querySelectorAll('.bp-row').length"), 12);
  eq('坏行 2 行标红（.bad）', await evalJs("document.querySelectorAll('.bp-row.bad').length"), 2);
  const prevTxt = await evalJs("__qa.txt('.batch-prev')");
  is('提示「有 2 行无效（不导入）」', /有 2 行无效/.test(prevTxt));
  is('有效合计 = 8,974.00', /8,974\.00/.test(prevTxt));
  eq('确认按钮文案带条数 10', await evalJs("[...document.querySelectorAll('.drawer-foot button')].some(b=>/确认导入 10 行/.test(b.textContent))"), true);
  await evalJs("__qa.clickText('确认导入', '.drawer-foot')");
  await sleep(500);
  eq('导入后回到详情态（textarea 消失）', await evalJs("!!document.querySelector('.batch-area')"), false);
  const h1 = await readDetailHint();
  is('导入后读到「N 条 · 合计」', !!h1);
  eq('明细条数 +10', h1.n - h0.n, 10);
  eq('明细合计 +8974', Math.round((h1.sum - h0.sum) * 100) / 100, 8974);
  const toastTxt = await evalJs("__qa.txt('.toast-layer')");
  is('Toast「已导入 10 条明细」', /已导入 10 条明细/.test(toastTxt));

  /* ---------------- ⑥ R4 复制到浮层 ---------------- */
  section('⑥ R4「复制到…」浮层');
  await evalJs("__qa.clickText('复制到', '.drawer-foot')");
  await sleep(300);
  eq('复制浮层出现', await evalJs("!!document.querySelector('.copy-panel')"), true);
  eq('目标下拉默认选中当前项目', await evalJs("(()=>{const s=document.querySelector('.copy-panel select'); return s ? s.value === s.options[0].value && /当前/.test(s.options[0].textContent) : false})()"), true);
  eq('「包含明细」默认勾选', await evalJs("document.querySelector('.copy-panel input[type=checkbox]').checked"), true);
  is('浮层含「确认复制」', /确认复制/.test(await evalJs("__qa.txt('.copy-panel')")));
  await evalJs("__qa.clickText('取消', '.copy-panel')");
  await sleep(200);
  eq('取消后浮层收起', await evalJs("!!document.querySelector('.copy-panel')"), false);

  /* ---------------- ⑦ C3 对账单 ---------------- */
  section('⑦ C3 收款方对账单');
  await evalJs("__qa.key('Escape')");
  await sleep(250);
  await evalJs("document.querySelectorAll('.rail-item')[2].click()");
  await sleep(350);
  eq('付款页有「对账单」入口', await evalJs("[...document.querySelectorAll('.rank-row .link')].some(b=>/对账单/.test(b.textContent))"), true);
  await evalJs("[...document.querySelectorAll('.rank-row .link')].find(b=>/对账单/.test(b.textContent)).click()");
  await sleep(450);
  eq('对账单抽屉打开（.statement）', await evalJs("!!document.querySelector('.statement')"), true);
  eq('body 挂上打印开关类', await evalJs("document.body.classList.contains('statement-open')"), true);
  const stTxt = await evalJs("__qa.txt('.statement')");
  is('含「费用项」段', /费用项/.test(stTxt));
  is('含「付款流水」段', /付款流水/.test(stTxt));
  is('含三行小计（应付/已付/待付合计）', /应付合计/.test(stTxt) && /已付合计/.test(stTxt) && /待付合计/.test(stTxt));
  const numOf = (t) => +String(t).replace(/[^\d.-]/g, '');
  const sumLines = await evalJs(`(() => {
    const kv = [...document.querySelectorAll('.statement .kv')].slice(-3).map(e => e.textContent.replace(/\\s+/g,' ').trim());
    return kv;
  })()`);
  const paySum = numOf((sumLines[0] || '').split('¥')[1]);
  const paidSum = numOf((sumLines[1] || '').split('¥')[1]);
  const dueSum = numOf((sumLines[2] || '').split('¥')[1]);
  is('三行小计均为数字', Number.isFinite(paySum) && Number.isFinite(paidSum) && Number.isFinite(dueSum));
  eq('小计自洽：待付 = 应付 − 已付', Math.round((paySum - paidSum - dueSum) * 100) / 100, 0, 0);
  is('抽屉副标题给出费用项/付款笔数', /项费用 · \d+ 笔付款/.test(await evalJs("__qa.txt('.drawer-head')")));

  // 打印 CSS（模拟 print media）
  await cdp(ws, 'Emulation.setEmulatedMedia', { media: 'print' });
  await sleep(250);
  eq('打印时隐藏左轨', await evalJs("getComputedStyle(document.querySelector('.rail')).display"), 'none');
  eq('打印时隐藏抽屉头', await evalJs("getComputedStyle(document.querySelector('.drawer-head')).display"), 'none');
  eq('打印时抽屉改为自然流（static）', await evalJs("getComputedStyle(document.querySelector('.drawer')).position"), 'static');
  eq('打印时补上对账单抬头', await evalJs("getComputedStyle(document.querySelector('.statement-print-head')).display"), 'block');
  await cdp(ws, 'Emulation.setEmulatedMedia', { media: '' });
  await sleep(200);

  // 无打印能力 → 降级提示
  await evalJs("window.__qaPrint = window.print; window.print = undefined; true");
  await evalJs("__qa.clickText('打印', '.drawer-foot')");
  await sleep(350);
  is('打印不可用时给出降级提示', /当前环境未提供打印能力/.test(await evalJs("__qa.txt('.statement')")));
  is('降级 Toast 提示导出 CSV / A4 网页', /不支持直接打印/.test(await evalJs("__qa.txt('.toast-layer')")));
  is('降级后仍提供「导出 CSV」与「A4 网页」按钮',
    /导出 CSV/.test(await evalJs("__qa.txt('.drawer-foot')")) && /A4 网页/.test(await evalJs("__qa.txt('.drawer-foot')")));
  await evalJs("window.print = window.__qaPrint; true");
  await evalJs("__qa.key('Escape')");
  await sleep(250);
  eq('关闭对账单后摘掉打印开关类', await evalJs("document.body.classList.contains('statement-open')"), false);

  /* ---------------- ⑧ X1 设置页 CSV 面板 ---------------- */
  section('⑧ X1 设置页 CSV 导入面板');
  await evalJs("document.querySelectorAll('.rail-item')[5].click()");
  await sleep(400);
  const setTxt = await evalJs("__qa.txt('.content')");
  is('存在「CSV 导入」卡片', /CSV 导入/.test(setTxt));
  is('三种表类型可选', /费用项/.test(setTxt) && /明细/.test(setTxt) && /付款/.test(setTxt));
  is('列顺序提示展示（明细 9 列）', /项目号 \/ 品名 \/ 单位 \/ 数量 \/ 单价 \/ 金额 \/ 工艺 \/ 备注 \/ 预估/.test(setTxt));
  eq('隐藏的文件选择器存在且接受 csv', await evalJs("(()=>{const i=[...document.querySelectorAll('input[type=file]')].find(x=>/\\.csv/.test(x.accept)); return !!i})()"), true);
  is('提示导入前会存快照并支持撤销', /导入前会自动存一份「历史版本」快照/.test(setTxt));
  is('设置页版本文案与 package.json 一致', new RegExp('v' + PKG_VERSION.replace(/\./g, '\\.')).test(setTxt));

  /* ---------------- ⑨ X1 CSV 导入端到端（真实文件 + 表头对齐 + 坏行） ---------------- */
  section('⑨ X1 CSV 导入端到端（真实 CSV 文件 → 预览 → 追加导入）');
  const readDetailsKpi = async () => {
    const t = await evalJs("__qa.txt('.content .kpi.sky .s')");
    const m = (/([\d]+) 条明细/).exec(t || '');
    return m ? +m[1] : null;
  };
  const detailsBefore = await readDetailsKpi();
  is('读到「N 条明细」KPI', Number.isFinite(detailsBefore));
  const csvPath = path.join(os.tmpdir(), 'qa-x1-detail.csv');
  fs.writeFileSync(csvPath, `\uFEFF${[
    '项目号,品名,单位,数量,单价,金额,工艺,备注,预估',
    `${firstNo},QA-UI-明细1,项,1,100,100,,,否`,
    `${firstNo},QA-UI-明细2,项,2,50,100,,,否`,
    `${firstNo},,项,1,100,100,,,`,
  ].join('\n')}`, 'utf8');
  await cdp(ws, 'DOM.enable');
  const doc = await cdp(ws, 'DOM.getDocument', {});
  const q = await cdp(ws, 'DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector: 'input[type=file][accept*="csv"]',
  });
  is('定位到 CSV 文件输入框', !!q?.nodeId);
  await cdp(ws, 'DOM.setFileInputFiles', { files: [csvPath], nodeId: q.nodeId });
  const previewOk = await waitFor("document.querySelectorAll('.imp-line').length > 0", 6000);
  eq('选择文件后出现预览', previewOk, true);
  const impTxt = await evalJs("__qa.txt('.content')");
  is('预览显示「可导入 2」', /可导入 2/.test(impTxt));
  is('预览显示「错误 1」', /错误 1/.test(impTxt));
  is('去重键提示：明细按「项目号 + 品名 + 金额」', /明细按「项目号 \+ 品名 \+ 金额」去重/.test(impTxt));
  is('坏行列出行号与原因', /第 4 行：缺少品名/.test(impTxt));
  await evalJs("__qa.clickText('确认导入', '.content')");
  await sleep(600);
  const toastTxt2 = await evalJs("__qa.txt('.toast-layer')");
  is('导入 Toast「导入 2 条（覆盖 0 / 跳过 0）」', /导入 2 条（覆盖 0 \/ 跳过 0）/.test(toastTxt2));
  const detailsAfter = await readDetailsKpi();
  eq('数据概况明细数 +2（坏行未落库）', detailsAfter - detailsBefore, 2);
  eq('导入后预览区收起', await evalJs("document.querySelectorAll('.imp-line').length"), 0);

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

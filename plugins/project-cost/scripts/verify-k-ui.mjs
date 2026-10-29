/**
 * v1.8 录入与列表 UI（需求池 2.9）自验：K7 / K8 / K14 + 三条红线 + K10 现状 sanity。
 *
 * 运行（指定唯一 /tmp 路径，避免与 v17 / k-data / k-io 冲突）：
 *   npx esbuild scripts/verify-k-ui.mjs --bundle --platform=node --format=esm \
 *     --define:process.env.NODE_ENV='"development"' --outfile=/tmp/k-ui.mjs && node /tmp/k-ui.mjs
 *
 * 覆盖：
 *   K7  批量粘贴逐条撤销 —— 每行 pushUndo + upsertDetail(noUndo)：单步撤销只退最后 1 条
 *   K8  列表排序         —— sortProjects 六档（date/no/amount/due/duedate/payee）口径与单调性
 *   K8  字段级命中       —— filterProjectsWithHits 新增 fieldHits，且 hits 结构/行为不变
 *   K14 密度与撤销可见   —— 密度偏好（紧凑默认）+ 撤销按钮所依赖的 canUndo 契约
 *   K10 金额精度        —— v1.8.2 全站统一为元 + 千分位，fmtW 万位出口已删除；
 *                          含源码级反向钉（src 下不得再出现 fmtW / 数字+万）
 *   红线 ① 金额链五项字面不变
 *   红线 ② sumBudget===234688 且 Object.keys(book.budget).length===13
 *
 * 注意：本脚本会读 src/ 源码做静态扫描，必须在项目根目录下运行（verify-all 满足该前提）。
 *
 * 说明：K7/K8/K14 的**渲染**部分（高亮底色 .hitrow、定位描边 .nav、上/下一条按钮、
 *       撤销按钮）是纯渲染断言，UI 侧由 verify-v17-ui 的 B3 密度断言守住行高不被破坏；
 *       本脚本钉住它们依赖的**逻辑契约**，两者合起来才算覆盖完整。
 */
import fs from 'node:fs';
import path from 'node:path';
import './fake-ls.mjs';
import { SEED } from '../src/lib/seed.js';
import * as store from '../src/lib/store.js';
import {
  calc, sumBudget, fmt, fmtNum, payableOf, dueOf, donutValSize,
} from '../src/lib/core.js';
import {
  sortProjects, filterProjectsWithHits, filterProjects,
} from '../src/lib/filters.js';
import { getDensity, setDensity } from '../src/lib/prefs.js';

/* ---------------- 断言框架 ---------------- */
const lines = [];
const failures = [];
let pass = 0;
let fail = 0;
const section = (t) => lines.push(`\n== ${t} ==`);
function record(okFlag, label, actual, expected) {
  if (okFlag) { pass += 1; lines.push(`PASS ${label}: ${actual}`); } else {
    fail += 1;
    const msg = `${label}: ${actual}${expected === undefined ? '' : ` (期望 ${expected})`}`;
    lines.push(`FAIL ${msg}`);
    failures.push(msg);
  }
  return okFlag;
}
const eq = (label, actual, expected) => record(String(actual) === String(expected), label, actual, expected);
const is = (label, actual) => record(!!actual, label, actual, 'truthy');
const not = (label, actual) => record(!actual, label, actual, 'falsy');
const near = (label, actual, expected, tol = 0.005) =>
  record(Math.abs((+actual || 0) - (+expected || 0)) <= tol, label, actual, expected);

/* ---------------- 环境 ---------------- */
const freshBoot = () => { try { localStorage.clear(); } catch (_) { /* fake-ls */ } return store.boot(); };
const B = () => store.book.value;

/* ================= K7. 批量粘贴逐条撤销 ================= */
section('K7 批量粘贴逐条撤销（P1）');
freshBoot();
store.clearUndo();
const p0 = B().projects[0];
const pid = p0.id;
const detailCount = () => (B().projects.find((x) => x.id === pid).details || []).length;
const baseCount = detailCount();

// 复刻 confirmBatch 改后的写法：每行先入栈，再 upsertDetail({noUndo:true})
for (let i = 0; i < 3; i += 1) {
  store.pushUndo();
  store.upsertDetail(pid, {
    name: `K7测试${i}`, unit: '项', est: '否',
    qty: 1, price: 10, amount: 10, craft: '', note: '',
  }, -1, { noUndo: true });
}
eq('K7 粘贴 3 条后条数 = 基线+3', detailCount(), baseCount + 3);

const u1 = store.undo();
is('K7 第 1 次 undo ok', u1.ok);
eq('K7 单步撤销只退最后 1 条（不是整批 3 条）', detailCount(), baseCount + 2);
const u2 = store.undo();
is('K7 第 2 次 undo ok', u2.ok);
eq('K7 第 2 次退到 基线+1', detailCount(), baseCount + 1);
store.undo();
eq('K7 第 3 次回到基线', detailCount(), baseCount);
not('K7 退完后无可撤', store.canUndo());

/* ================= K8. 列表排序 ================= */
section('K8 列表排序（P1）');
freshBoot();
const projs = B().projects;
eq('K8 基线费用项 71 条', projs.length, 71);

// 按待付：首行必须是待付最大的费用项
const byDue = sortProjects(projs, 'due');
const maxDue = Math.max(...projs.map((p) => dueOf(p)));
near('K8 按待付：首行 = 最大待付', dueOf(byDue[0]), maxDue);
let monoDue = true;
for (let i = 1; i < byDue.length; i += 1) {
  if (dueOf(byDue[i - 1]) < dueOf(byDue[i]) - 1e-9) monoDue = false;
}
is('K8 按待付：整体单调不增', monoDue);

// 按应付：与 v1.6/v1.7 既有 amount 档同口径
const byAmt = sortProjects(projs, 'amount');
const maxPayable = Math.max(...projs.map((p) => payableOf(p)));
near('K8 按金额：首行 = 最大应付', payableOf(byAmt[0]), maxPayable);

// 按收款方：升序（空串排最前，属 localeCompare 正常行为）
const byPayee = sortProjects(projs, 'payee');
let monoPayee = true;
for (let i = 1; i < byPayee.length; i += 1) {
  if ((byPayee[i - 1].object || '').localeCompare(byPayee[i].object || '') > 0) monoPayee = false;
}
is('K8 按收款方：升序单调', monoPayee);

// 按到期日：非空升序
const byDuedate = sortProjects(projs, 'duedate');
const nonEmpty = byDuedate.filter((p) => p.due).map((p) => p.due);
let monoDate = true;
for (let i = 1; i < nonEmpty.length; i += 1) {
  if (nonEmpty[i - 1] > nonEmpty[i]) monoDate = false;
}
is('K8 按到期日：非空升序单调', monoDate);

// 既有两档不能被改坏
eq('K8 排序不改入参数组长度', projs.length, 71);
is('K8 按项目号档可用', sortProjects(projs, 'no').length === 71);
is('K8 默认档（date）可用', sortProjects(projs).length === 71);

/* ================= K8. 字段级命中（高亮数据源）================= */
section('K8 字段级命中 fieldHits（P1）');
freshBoot();
// 用真实数据里一定存在的关键词，避免硬编码词在数据变动后失配
const seedRemark = String(B().projects[0].remark || '').trim();
const qq = seedRemark.slice(0, 2) || '费用';
const res = filterProjectsWithHits(B().projects, { query: qq });
is('K8 fieldHits 是 Map', res.fieldHits instanceof Map);
is('K8 有命中行', res.rows.length > 0);
const hitRow = res.rows.find((p) => String(p.remark || '').includes(qq));
if (hitRow) {
  const fh = res.fieldHits.get(hitRow.id) || {};
  is('K8 命中行的 remark 字段被标记', fh.remark === true);
} else {
  is('K8 命中行（退化为任一命中）有 fieldHits 记录', !!res.fieldHits.get(res.rows[0].id));
}
// 回归：filterProjects 行为不变（仍只返回行数组，不因新增 fieldHits 而改变）
const rowsOnly = filterProjects(B().projects, { query: qq });
is('K8 filterProjects 仍返回数组', Array.isArray(rowsOnly));
eq('K8 filterProjects 行数与 rows 一致', rowsOnly.length, res.rows.length);
// 空关键词：fieldHits 为空 Map（不能 undefined，否则模板 .get 会炸）
const emptyRes = filterProjectsWithHits(B().projects, { query: '' });
is('K8 空关键词时 fieldHits 为空 Map', emptyRes.fieldHits instanceof Map && emptyRes.fieldHits.size === 0);

/* ================= K14. 密度与撤销可见性 ================= */
section('K14 密度偏好 / 撤销按钮契约（P2）');
freshBoot();
eq('K14 默认紧凑（B3 口径不变）', getDensity(), 'compact');
eq('K14 切换到舒适返回 comfort', setDensity('comfort'), 'comfort');
eq('K14 读回 comfort', getDensity(), 'comfort');
eq('K14 切回紧凑', setDensity('compact'), 'compact');
eq('K14 读回 compact', getDensity(), 'compact');
store.clearUndo();
not('K14 无可撤时撤销按钮应禁用（canUndo=false）', store.canUndo());
store.pushUndo();
is('K14 有可撤时撤销按钮应可用（canUndo=true）', store.canUndo());
store.clearUndo();

/* ================= K10. 金额精度（v1.8.2 全站唯一精度）================= */
section('K10 金额精度（v1.8.2 全站统一为元 + 千分位，万位出口已废除）');
// 逐字钉：全站只剩 fmt / fmtNum 两个出口，且任何数量级都不再切换单位
eq('K10 fmtNum(8000) = 千分位到分', fmtNum(8000), '8,000.00');
eq('K10 fmt(8000) = ¥ 千分位到分', fmt(8000), '¥8,000.00');
eq('K10 fmt(246055.97) = ¥246,055.97（不再是 ¥24.6万）', fmt(246055.97), '¥246,055.97');
eq('K10 fmtNum(246055.97) = 246,055.97', fmtNum(246055.97), '246,055.97');
eq('K10 fmt(-394.88) 负号在币种前 = -¥394.88', fmt(-394.88), '-¥394.88');
eq('K10 fmtNum(-394.88) = -394.88', fmtNum(-394.88), '-394.88');
eq('K10 fmt(0) = ¥0.00', fmt(0), '¥0.00');
eq('K10 fmt(-0.001) 归一为 ¥0.00（无 -¥0.00）', fmt(-0.001), '¥0.00');
eq('K10 fmt(undefined) = ¥0.00', fmt(undefined), '¥0.00');
eq('K10 fmtNum(undefined) = 0.00', fmtNum(undefined), '0.00');
eq('K10 fmtNum(0) = 0.00', fmtNum(0), '0.00');
eq('K10 fmt(1234567.89) 百万级仍是元 + 千分位', fmt(1234567.89), '¥1,234,567.89');
eq('K10 fmtW 已从 core 导出中删除（typeof undefined）', typeof fmtW, 'undefined');
not('K10 fmt(8000) 不含「万」', /万/.test(fmt(8000)));
not('K10 fmt(246055.97) 不含「万」', /万/.test(fmt(246055.97)));
not('K10 fmtNum(246055.97) 不含「万」', /万/.test(fmtNum(246055.97)));

/* K10 反向钉①：源码级 —— src 下再也不得出现 fmtW 标识符（防后人复活第二精度）
 *
 * 为什么**连注释一起扫**（而不是只扫非注释行）：只扫代码行的话，「在注释里把这个出口的名字
 * 写回来」是合法的，后人一抄注释就会把它复活。扫全文能让这个标识符彻底无法重现。
 * 代价是历史注释里不能直呼其名 —— 现已改写为「v1.7 曾另有第二个金额出口（≥1 万变 ¥24.6 万）」，
 * 语义完整、可追溯。
 * ⇒ 若将来确实需要在注释里提及它，请用「第二个金额出口 / 万位出口」这类描述，不要写标识符，
 *   否则本钉子会 FAIL —— 这是**故意的**，不是误伤。
 */
section('K10 反向钉① 源码无 fmtW（防第二精度复活，连注释一起扫）');
const SRC_ROOT = path.resolve('src');
function walkSrc(dir) {
  const acc = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) acc.push(...walkSrc(p));
    else if (/\.(js|vue)$/.test(e.name)) acc.push(p);
  }
  return acc;
}
/** 去掉注释行（`//…` / `* …` / `/*…`），只对真正会被打包执行的代码行下钉 */
const isCommentLine = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);
const srcFiles = fs.existsSync(SRC_ROOT) ? walkSrc(SRC_ROOT) : [];
const srcLines = srcFiles.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n')
  .map((line, i) => ({ f: path.relative(SRC_ROOT, f), i: i + 1, line })));
is('扫到 src 下的 .js / .vue 源文件（≥ 20 个）', srcFiles.length >= 20);
eq('src/**/*.{js,vue} 中 fmtW 命中 0 处（含注释也不许出现）',
  srcLines.filter((x) => /(^|[^A-Za-z0-9_$.])fmtW([^A-Za-z0-9_$]|$)/.test(x.line)).length, 0);
const wanHits = srcLines
  .filter((x) => !isCommentLine(x.line))
  .filter((x) => /[\d.]万/.test(x.line));
eq('src 非注释代码行中无「数字+万」的硬编码金额', wanHits.length, 0);
[...srcLines.filter((x) => /(^|[^A-Za-z0-9_$.])fmtW([^A-Za-z0-9_$]|$)/.test(x.line)), ...wanHits]
  .slice(0, 10)
  .forEach((h) => lines.push(`   命中 ${h.f}:${h.i} ${h.line.trim()}`));

/* K10 反向钉②：环形图字号档位纯函数 —— 全覆盖（含当前不触发的小环分支） */
// 说明：donutValSize 的「size<104 且 len>8 → 9」这一档在真实数据下不触发（概览两枚 96 号环
// 走的是 percentText / '—'），若只在 UI 侧观测定不到它。故把档位抽成纯函数，逐档钉死，
// 让它成为「被测过的代码」而不是投机分支。标定数字见 src/lib/core.js 的 donutValSize 注释。
section('K10 反向钉② 环形图字号档位 donutValSize 全覆盖');
eq('donutValSize(6, 112) 短文本 → 13.5', donutValSize(6, 112), 13.5);
eq('donutValSize(8, 112) len>8 才降档（等号不吞）→ 13.5', donutValSize(8, 112), 13.5);
eq('donutValSize(9, 112) `¥8,000.00` → 11', donutValSize(9, 112), 11);
eq('donutValSize(11, 112) `¥246,055.97` → 11', donutValSize(11, 112), 11);
eq('donutValSize(12, 112) `-¥246,055.97` → 10', donutValSize(12, 112), 10);
eq('donutValSize(13, 112) `¥1,234,567.89` → 10', donutValSize(13, 112), 10);
eq('donutValSize(14, 112) `-¥1,234,567.89` → 9', donutValSize(14, 112), 9);
eq('donutValSize(20, 112) 超长兜底 → 9', donutValSize(20, 112), 9);
eq('donutValSize(6, 96) 小环短文本仍 13.5（概览观感不变）', donutValSize(6, 96), 13.5);
eq('donutValSize(8, 96) 小环 len>8 才降档（等号不吞）→ 13.5', donutValSize(8, 96), 13.5);
eq('donutValSize(11, 96) 小环长金额 → 9（原未覆盖分支）', donutValSize(11, 96), 9);
eq('donutValSize(14, 96) 小环超长 → 9', donutValSize(14, 96), 9);
eq('donutValSize(11, 104) 阈值边界：104 归大环 → 11', donutValSize(11, 104), 11);
eq('donutValSize(11, 103) 阈值边界：103 归小环 → 9', donutValSize(11, 103), 9);
eq('donutValSize(undefined, 112) 脏输入归一 → 13.5', donutValSize(undefined, 112), 13.5);
eq('donutValSize(NaN, 112) 脏输入归一 → 13.5', donutValSize(Number.NaN, 112), 13.5);

/* ================= 三条红线 ================= */
section('红线（任一破就不能发）');
freshBoot();
const s = calc(B());
near('红线① 应付 246,055.97', s.payable, 246055.97);
near('红线① 已付 188,529.11', s.paid, 188529.11);
near('红线① 待付 57,526.86', s.payable - s.paid, 57526.86);
eq('红线② sumBudget = 234688', sumBudget(B()), 234688);
eq('红线② 预算键 13 个（不许变 14）', Object.keys(B().budget).length, 13);
near('红线① 预算 234,688.00', sumBudget(B()), 234688);
near('红线① 结余 −11,367.97', sumBudget(B()) - s.payable, -11367.97);
eq('SEED 未被污染（71 项）', B().projects.length, 71);

/* ---------------- 汇总 ---------------- */
console.log(lines.join('\n'));
console.log(`\nPASS_TOTAL ${pass}`);
console.log(`FAIL_TOTAL ${fail}`);
if (fail) {
  console.log(`\n失败项：\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
}

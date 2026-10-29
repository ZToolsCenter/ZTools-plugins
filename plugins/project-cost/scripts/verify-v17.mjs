/**
 * v1.7 逻辑自验：可信度修复（13 项）。
 *
 * 运行：npx esbuild scripts/verify-v17.mjs --bundle --platform=node --format=esm \
 *        --define:process.env.NODE_ENV='"development"' --outfile=/tmp/v17.mjs && node /tmp/v17.mjs
 *
 * 覆盖：
 *   A1 负数显示      fmt / fmtNum / fmtAbs 三个出口 + 63 条负明细 + 蹲便器一正一负归零
 *   A2 未设预算      13 键钉子 / hasBudget / catCoverage / overCatGroups 两组
 *   A3 撤销栈        20 步上限 / 第 21 次失败 / 连改连撤逐级还原 / 改名+改预算 1 格
 *   B1 搜索明细      品名参与 / 命中条数一致 / filterProjects 行为不变 / 单位命中不出提示
 *   B2 付款排序      三档行集合一致 + 各自单调性 + 默认档首行 ZX0006
 *   B3 密度偏好      默认紧凑 / 落库 / 不进账本
 *   B4 备份          exportJson 条数 + 文件名 + 导回幂等 + 不含快照键
 *   C1 术语          别名归一 / 只写「收款方」的表头 / HEADS 逐字不变（K15：表头统一为「收款方」）
 *   C3 催收门槛      severe 5 / severeMain 4 / smallList 1
 *   C4 残缺名        payee-name-suspect 只报不改
 *   C6 编号前缀      nextNo / payNo / 导入剥前缀（双闸）
 *
 * C2（金额精度）与 C5（pid 隐藏）是纯渲染断言，见 scripts/verify-v17-ui.mjs。
 *
 * 红线（任一破了就不能发）：
 *  ① 基线五项字面不变：应付 246,055.97 / 已付 188,529.11 / 待付 57,526.86 /
 *     预算 234,688.00 / 结余 −11,367.97；
 *  ② `sumBudget(book) === 234688` 且 `Object.keys(book.budget).length === 13`（**不许变 14**）；
 *  ③ 任何 v1.7 新功能都不得改变金额链口径。
 */
import './fake-ls.mjs';
import { SEED } from '../src/lib/seed.js';
import * as store from '../src/lib/store.js';
import {
  calc, round2, detailSum, payableOf, paidOf, dueOf, statOf, fmt, fmtNum, fmtAbs,
  sumBudget, hasBudget, catCoverage, overCatGroups, checkup, isPayeeNameSuspect,
  overdueGroups, OVERDUE_MIN_AMOUNT, nextNo, payNo, payPidOf, normNoPrefix,
  activePayments, CHECK_CODE,
} from '../src/lib/core.js';
import { filterProjects, filterProjectsWithHits, hitHint } from '../src/lib/filters.js';
import {
  getDensity, setDensity, normDensity, getLastBackup, setLastBackup,
  DENSITY_KEY, DENSITY_DEFAULT, LAST_BACKUP_KEY,
} from '../src/lib/prefs.js';
import { HEADS, payRows, exportJson } from '../src/lib/export.js';
import { parseDelimited, mapRow, isHeaderRow, alignByHeader, normalizeHeader, COL_ALIAS, TABLE_COLS } from '../src/lib/parse.js';

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

const clone = (v) => JSON.parse(JSON.stringify(v));
const SEED_SNAPSHOT = JSON.stringify(SEED);
const freshBoot = () => { try { localStorage.clear(); } catch (_) { /* fake-ls */ } return store.boot(); };
const B = () => store.book.value;
const idsOf = (arr) => JSON.stringify((arr || []).map((x) => x.id || x));

/* B2 用的排序实现：与 PayView.vue 的 rows computed 逐行同源（三级兜底） */
function payRowsSorted(mode) {
  const od = overdueGroups(B());
  const daysById = new Map(od.all.map((x) => [x.id, x.days]));
  const list = (B().projects || [])
    .filter((p) => payableOf(p) > 0 || (p.payments || []).length > 0)
    .map((p) => ({ p, st: statOf(p), days: daysById.get(p.id) || 0 }));
  const byDays = (a, b) => b.days - a.days;
  const byDue = (a, b) => b.st.due - a.st.due;
  const byNo = (a, b) => (a.p.no || '').localeCompare(b.p.no || '');
  const cmp = mode === 'due'
    ? (a, b) => byDue(a, b) || byDays(a, b) || byNo(a, b)
    : mode === 'no'
      ? (a, b) => byNo(a, b) || byDays(a, b) || byDue(a, b)
      : (a, b) => byDays(a, b) || byDue(a, b) || byNo(a, b);
  return list.sort(cmp);
}
const monotone = (arr, get, dir) => arr.every((x, i) => i === 0
  || (dir === 'desc' ? get(arr[i - 1]) >= get(x) : get(arr[i - 1]) <= get(x)));

/* ================= 0. 基线零漂移 ================= */
section('0 基线（v1.7 改动后仍须字面不变）');
freshBoot();
eq('种子未被测试污染', JSON.stringify(SEED), SEED_SNAPSHOT);
near('应付 246,055.97', calc(B()).payable, 246055.97);
near('已付 188,529.11', calc(B()).paid, 188529.11);
near('待付 57,526.86', calc(B()).remain, 57526.86);
near('预算 234,688.00', calc(B()).totalBudget, 234688);
near('结余 −11,367.97', calc(B()).balance, -11367.97);
near('sumBudget === 234688', sumBudget(B()), 234688);
eq('费用项 71 / 明细 384 / 付款 88',
  [B().projects.length, calc(B()).detailCount, calc(B()).payCount], [71, 384, 88]);

/* ================= A1. 负数显示 ================= */
section('A1 负数显示（fmt / fmtNum / fmtAbs 三个出口）');
// 硬断言 1：三个出口的标准样例
eq('fmt(-394.88) = -¥394.88（符号在币种前）', fmt(-394.88), '-¥394.88');
eq('fmt(394.88) = ¥394.88', fmt(394.88), '¥394.88');
eq('fmt(-0.001) = ¥0.00（不出现 -¥0.00）', fmt(-0.001), '¥0.00');
eq('fmt(-0) = ¥0.00', fmt(-0), '¥0.00');
eq('fmt(0) = ¥0.00', fmt(0), '¥0.00');
eq('fmtNum(-394.88) = -394.88（保留符号）', fmtNum(-394.88), '-394.88');
eq('fmtAbs(-394.88) = 394.88（显式取绝对值）', fmtAbs(-394.88), '394.88');
eq('fmtNum(-12345.6) 千分位带符号', fmtNum(-12345.6), '-12,345.60');
// 边界：非法输入不抛错、不出 NaN
eq('fmt(undefined) = ¥0.00', fmt(undefined), '¥0.00');
eq('fmt(null) = ¥0.00', fmt(null), '¥0.00');
eq("fmt('abc') = ¥0.00", fmt('abc'), '¥0.00');
eq("fmtNum('') = 0.00", fmtNum(''), '0.00');

// 硬断言 2：63 条负明细逐条带负号，且全站无 `¥-` 形态
const negDetails = [];
B().projects.forEach((p) => (p.details || []).forEach((d) => {
  if (round2(d.amount) < 0) negDetails.push({ no: p.no, amount: d.amount, text: fmtNum(d.amount) });
}));
eq('基线负明细 63 条', negDetails.length, 63);
is('63 条负明细 fmtNum 全部以 - 开头', negDetails.every((x) => x.text.startsWith('-')));
is('63 条负明细 fmtNum 均不含 ¥- 形态', negDetails.every((x) => !x.text.includes('¥-')));
is('负明细的 fmt 出口同样不含 ¥- 形态',
  negDetails.every((x) => fmt(x.amount).startsWith('-¥') && !fmt(x.amount).includes('¥-')));

// 硬断言 3：蹲便器「一正一负」同屏不再矛盾
const Z24 = B().projects.find((p) => p.no === 'ZX0024');
eq('ZX0024 是蹲便器', Z24 && Z24.remark, '蹲便器');
eq('ZX0024 两条明细', (Z24.details || []).length, 2);
eq('ZX0024 明细金额一正一负（保留符号）',
  Z24.details.map((d) => fmtNum(d.amount)).join(' | '), '394.88 | -394.88');
near('ZX0024 明细合计 = 0', detailSum(Z24), 0);
near('ZX0024 项目总计 = 0', Z24.total, 0);
is('ZX0024 两条明细改前会显示成同一个数（证明用例有效）',
  Z24.details[0].amount !== Z24.details[1].amount);

// 硬断言 4：整单退货的费用项，金额方向不再丢
const Z18 = B().projects.find((p) => p.no === 'ZX0018');
near('ZX0018 应付 = -580', payableOf(Z18), -580);
eq('ZX0018 fmtNum 显示 -580.00（改前为 —）', fmtNum(payableOf(Z18)), '-580.00');
eq('ZX0018 fmt 显示 -¥580.00', fmt(payableOf(Z18)), '-¥580.00');

// 硬断言 5：负付款（退款）金额仍是负数，文案由 UI 层渲染
const negPays = [];
B().projects.forEach((p) => activePayments(p).forEach((py) => {
  if (round2(py.amount) < 0) negPays.push(py.amount);
}));
eq('基线负付款 2 笔', negPays.length, 2);
near('负付款合计 -974.88', round2(negPays.reduce((s, x) => s + x, 0)), -974.88);

// 硬断言 6：K10（v1.8.2）万位出口 fmtW 已废除，唯一出口 fmt 守同一套符号 + 千分位规则
// 原断言 `fmtW(-246055.97) === '-¥24.6万'` 随第二精度一并删除，改用 fmt 钉住同等强度：
eq('fmt(-246055.97) 仍带负号（原 fmtW 断言的等强度替代）', fmt(-246055.97), '-¥246,055.97');
eq('fmt(394.88) 到分精度', fmt(394.88), '¥394.88');
eq('fmt(246055.97) 元 + 千分位（不再是 ¥24.6万）', fmt(246055.97), '¥246,055.97');
eq('fmtW 已从 core 导出中删除', typeof fmtW, 'undefined');

// 硬断言 7：金额链不因格式化改造而改变
near('A1 不改金额链：应付', calc(B()).payable, 246055.97);
eq('全站 formatted 结果里 0 处 ¥- 前缀',
  [fmt(-1), fmt(-0.001), fmtNum(-1), fmtAbs(-1)].every((t) => !t.includes('¥-')), true);

/* ================= A2. 未设预算 ================= */
section('A2 未设预算（13 键钉子 + 两组超支）');
freshBoot();
// 纪律钉子：这一条必须存在。任何「顺手补个 0 键」的实现都会把它弄成 14。
eq('Object.keys(book.budget).length === 13（不许变 14）', Object.keys(B().budget).length, 13);
near('sumBudget === 234688', sumBudget(B()), 234688);
not('hasBudget(其他费用) === false', hasBudget(B(), '其他费用'));
is('其他费用 在 categories 里存在（有支出、只是没预算）',
  (B().categories || []).some((c) => c.name === '其他费用'));
is('hasBudget 对 13 个已设预算品类全为 true',
  Object.keys(B().budget).every((n) => hasBudget(B(), n)));
eq('hasBudget 为 true 的品类数 = 13',
  (B().categories || []).filter((c) => hasBudget(B(), c.name)).length, 13);

// 边界：显式 0 与缺键同属「未设预算」（用副本测，不动真源）
const zeroCopy = { ...B(), budget: { ...B().budget, 其他费用: 0 } };
not('budget[其他费用]=0 时 hasBudget 仍为 false', hasBudget(zeroCopy, '其他费用'));
const negCopy = { ...B(), budget: { ...B().budget, 其他费用: -1 } };
not('负预算视为非法 → 同样「未设预算」', hasBudget(negCopy, '其他费用'));

// 品类数文案的唯一来源
const cov = catCoverage(B());
eq('catCoverage.total = 14', cov.total, 14);
eq('catCoverage.withBudget = 13', cov.withBudget, 13);
eq('catCoverage.missing = 1', cov.missing, 1);
eq('catCoverage.text 字面', cov.text, '14 个品类 · 13 个已设预算');
eq('catCoverage 只读（不补键）', Object.keys(B().budget).length, 13);

// 超支两组
const grp = overCatGroups(B());
eq('超预算 6 个', grp.over.count, 6);
near('超预算合计 +12,266.75', grp.over.sum, 12266.75);
is('超预算组按超出额降序', monotone(grp.over.rows, (r) => r.over, 'desc'));
is('超预算组每行都真的有预算', grp.over.rows.every((r) => r.budget > 0));
eq('未设预算 1 个', grp.noBudget.count, 1);
near('未设预算合计 9,514.00', grp.noBudget.sum, 9514);
eq('未设预算组唯一一行是「其他费用」', grp.noBudget.rows[0] && grp.noBudget.rows[0].name, '其他费用');
near('其他费用确定应付 9,514.00', grp.noBudget.rows[0] && grp.noBudget.rows[0].confirmed, 9514);
is('未设预算组每行都没有预算', grp.noBudget.rows.every((r) => !(r.budget > 0)));
// 两组不混排：同一品类不可能同时出现在两组
const overNames = new Set(grp.over.rows.map((r) => r.name));
is('超预算组与未设预算组无交集', grp.noBudget.rows.every((r) => !overNames.has(r.name)));
eq('overCatGroups 只读（仍是 13 键）', Object.keys(B().budget).length, 13);

/* ================= A3. 撤销栈 ================= */
section('A3 撤销栈（20 步环形）');
freshBoot();
store.clearUndo();
eq('启动后栈为空', store.undoDepth(), 0);
not('canUndo() 初始为 false', store.canUndo());
for (let i = 0; i < 25; i += 1) store.pushUndo();
eq('连 pushUndo 25 次后 undoDepth = 20（上限）', store.undoDepth(), 20);
is('canUndo() 为 true', store.canUndo());
const undoTrail = [];
for (let i = 0; i < 20; i += 1) undoTrail.push(store.undo());
is('连撤 20 次全部成功', undoTrail.every((r) => r.ok === true));
eq('每次撤销返回的剩余步数依次递减', undoTrail.map((r) => r.left).join(','),
  Array.from({ length: 20 }, (_, i) => 19 - i).join(','));
const r21 = store.undo();
eq('第 21 次撤销返回 ok:false', r21.ok, false);
eq('第 21 次撤销 left = 0', r21.left, 0);
store.clearUndo();
not('clearUndo 后 canUndo 为 false', store.canUndo());

// 连改 3 次 → 连撤 3 次，逐级还原（每步验关键字段）
freshBoot();
store.clearUndo();
const CAT = '泥瓦镶贴工程';
const budgetBase = B().budget[CAT];
const sumBase = sumBudget(B());
eq('前置：泥瓦镶贴工程预算 25000', budgetBase, 25000);
const budgetNow = () => B().budget[CAT];
store.setBudget(CAT, 1000);
eq('第 1 次改预算 → 1000', budgetNow(), 1000);
store.setBudget(CAT, 2000);
eq('第 2 次改预算 → 2000', budgetNow(), 2000);
store.setBudget(CAT, 3000);
eq('第 3 次改预算 → 3000', budgetNow(), 3000);
eq('三次改动共占 3 格栈', store.undoDepth(), 3);
const spread = sumBase - budgetBase;
const u1 = store.undo();
eq('撤 1 次回到第 3 次改前（2000）', budgetNow(), 2000);
eq('撤 1 次后剩 2 步', u1.left, 2);
eq('撤 1 次后 sumBudget 同步回落', sumBudget(B()), round2(2000 + spread));
store.undo();
eq('撤 2 次回到第 2 次改前（1000）', budgetNow(), 1000);
eq('撤 2 次后 sumBudget 同步回落', sumBudget(B()), round2(1000 + spread));
store.undo();
eq('撤 3 次回到初始值 25000', budgetNow(), 25000);
eq('撤到栈底后 canUndo 为 false', store.canUndo(), false);
eq('撤到栈底后预算键数仍为 13（撤销不增删键）', Object.keys(B().budget).length, 13);
near('撤到栈底后 sumBudget 回到 234688', sumBudget(B()), 234688);
is('撤销链全程未碰应付/已付',
  [calc(B()).payable, calc(B()).paid].join(',') === '246055.97,188529.11');

// 品类改名 + 改预算 = 一个用户动作 = 1 格栈
freshBoot();
store.clearUndo();
const RENAME = '活动家具';
const origBudget = B().budget[RENAME];
const origProjectsCat = B().projects.filter((p) => p.cat === RENAME).length;
store.upsertCategory(RENAME, { name: `${RENAME}X`, color: '#A8624C', note: '', budget: 9999 });
eq('改名+改预算只占 1 格栈', store.undoDepth(), 1);
is('改名已生效', (B().categories || []).some((c) => c.name === `${RENAME}X`));
eq('预算已挂到新名下', B().budget[`${RENAME}X`], 9999);
is('旧名下的预算键已迁走', B().budget[RENAME] === undefined);
const rUn = store.undo();
eq('一次撤销即回滚整个动作', rUn.ok, true);
is('品类名一次撤回原名', (B().categories || []).some((c) => c.name === RENAME));
eq('预算键一次撤回原名', B().budget[RENAME], origBudget);
is('新名下的预算键已消失', B().budget[`${RENAME}X`] === undefined);
eq('连带迁移的费用项品类也一次回滚', B().projects.filter((p) => p.cat === RENAME).length, origProjectsCat);
eq('一次撤销后栈已空', store.undoDepth(), 0);

/* ================= B1. 搜索覆盖明细 ================= */
section('B1 搜索覆盖明细（品名参与 + 命中提示）');
freshBoot();
// 硬断言 1：改前 0 条的两个词现在都能命中
const rZa = filterProjectsWithHits(B().projects, { query: '砂子' });
eq('搜「砂子」命中 5 条', rZa.rows.length, 5);
eq('搜「砂子」的项目号', rZa.rows.map((p) => p.no).join(','), 'ZX0001,ZX0007,ZX0023,ZX0025,ZX0027');
const rNi = filterProjectsWithHits(B().projects, { query: '腻子' });
eq('搜「腻子」命中 1 条（明细品名参与搜索）', rNi.rows.length, 1);
eq('搜「腻子」命中的是 ZX0052', rNi.rows[0] && rNi.rows[0].no, 'ZX0052');
is('「腻子」这个词不在费用项自身字段里（证明是明细命中的）',
  !String(rNi.rows[0].remark + rNi.rows[0].object + rNi.rows[0].cat + rNi.rows[0].no).includes('腻子'));

// 硬断言 2：hits 条数与该费用项实际命中明细数一致
const hitCountOk = rZa.rows.every((p) => {
  const nd = (p.details || []).filter((d) => String(d.name || '').toLowerCase().includes('砂子'));
  const names = new Set(nd.map((d) => String(d.name || '').trim()));
  const h = rZa.hits.get(p.id);
  if (names.size !== 1) return false;
  const [only] = [...names];
  const cnt = nd.filter((d) => String(d.name || '').trim() === only).length;
  return !!h && h.text === `命中：${only} ×${cnt}`;
});
is('每行提示的 ×N = 该行实际命中明细数', hitCountOk);
eq('搜「砂子」每行都是 ×1', [...rZa.hits.values()].map((h) => h.text).join('|'),
  '命中：砂子 ×1|命中：砂子 ×1|命中：砂子 ×1|命中：砂子 ×1|命中：砂子 ×1');
const niHit = rNi.hits.get(rNi.rows[0].id);
eq('搜「腻子」提示 = 命中：三棵树腻子粉 ×2', niHit && niHit.text, '命中：三棵树腻子粉 ×2');
eq('腻子实际命中明细条数确实是 2',
  (rNi.rows[0].details || []).filter((d) => String(d.name || '').includes('腻子')).length, 2);
near('搜「砂子」命中明细金额合计 5,317.00',
  round2(rZa.rows.reduce((s, p) => s + (p.details || [])
    .filter((d) => String(d.name || '').includes('砂子'))
    .reduce((t, d) => t + (+d.amount || 0), 0), 0)), 5317);
eq('hits 只在有品名命中时产生（5 行 5 条）', rZa.hits.size, 5);

// 硬断言 3：filterProjects 与原行为完全一致（同一组筛选条件下行集合相同）
const FILTER_CASES = [
  {},
  { query: '砂子' },
  { query: '腻子' },
  { query: '搬运费' },
  { query: '个' },
  { cat: '泥瓦镶贴工程' },
  { status: 'unpaid' },
  { from: '2026-05-01', to: '2026-07-31' },
  { query: '砂子', cat: '水电改造工程' },
];
const sameSets = FILTER_CASES.every((f) => idsOf(filterProjects(B().projects, f))
  === idsOf(filterProjectsWithHits(B().projects, f).rows));
is('9 组筛选条件下 filterProjects 与 WithHits.rows 行集合逐一相同', sameSets);
is('filterProjects 是 WithHits 的薄包装（不多不少）',
  FILTER_CASES.every((f) => filterProjects(B().projects, f).length
    === filterProjectsWithHits(B().projects, f).rows.length));

// 硬断言 4：搜单位「个」→ 行命中但不出提示
const rGe = filterProjectsWithHits(B().projects, { query: '个' });
is('搜「个」有多行命中（单位参与搜索）', rGe.rows.length > 30);
is('无任何行出现「命中：个」这类提示',
  [...rGe.hits.values()].every((h) => !/^命中：个(\s|×)/.test(h.text)));
is('提示的定位名不会是单位本身', [...rGe.hits.values()].every((h) => h.name !== '个'));
const unitOnlyRows = rGe.rows.filter((p) => !(p.details || []).some(
  (d) => String(d.name || '').toLowerCase().includes('个')));
is('只靠单位命中的行一条提示都不产生（>30 行）', unitOnlyRows.length > 30
  && unitOnlyRows.every((p) => !rGe.hits.has(p.id)));
is('提示文本长度 ≤ 24 字',
  [...rGe.hits.values()].concat([...rZa.hits.values()]).every((h) => h.text.length <= 24));

// 边界：空关键词 = 不搜索，hits 为空
const rEmpty = filterProjectsWithHits(B().projects, { query: '   ' });
eq('空关键词返回全部', rEmpty.rows.length, 71);
eq('空关键词不产生提示', rEmpty.hits.size, 0);
eq('hitHint(空 Map) = 空串', hitHint(new Map()), '');

/* ================= B2. 付款页排序 ================= */
section('B2 付款页三档排序');
freshBoot();
const sortDays = payRowsSorted('days');
const sortDue = payRowsSorted('due');
const sortNo = payRowsSorted('no');
eq('三档都覆盖全部 71 个费用项', [sortDays.length, sortDue.length, sortNo.length].join(','), '71,71,71');
const idSet = (arr) => JSON.stringify(arr.map((x) => x.p.id).sort());
is('三档行集合完全一致（排序不改筛选）',
  idSet(sortDays) === idSet(sortDue) && idSet(sortDays) === idSet(sortNo));
eq('默认档（逾期天数）首行 = ZX0006（逾期最久）', sortDays[0].p.no, 'ZX0006');
// 注：逾期天数为实时计算（overdueGroups 默认用 todayLocal），不写死绝对天数；
// 断言用「相对排序 + 身份」：前 5 行项目号顺序 + 全表单调不增，二者不随日期漂移。
eq('默认档前 5 行项目号（逾期最久的 5 个，顺序稳定）',
  sortDays.slice(0, 5).map((x) => x.p.no).join(','), 'ZX0006,ZX0016,ZX0021,ZX0020,ZX0032');
is('默认档逾期天数全书单调不增', monotone(sortDays, (x) => x.days, 'desc'));
is('待付档待付金额单调不增', monotone(sortDue, (x) => x.st.due, 'desc'));
is('项目号档项目号升序', monotone(sortNo, (x) => x.p.no, 'asc'));
const firstOverdueIdx = sortDays.findIndex((x) => x.days === 0);
is('未逾期项全部排在已逾期项之后',
  sortDays.slice(firstOverdueIdx).every((x) => x.days === 0));
is('默认档确实按天降序把 ZX0006 顶到第一（改前无排序）', sortDays[0].days > sortDays[1].days);
// 排序不参与金额计算：三档的应付/已付/待付合计必须逐个相同
const sumOf = (arr, key) => round2(arr.reduce((s, x) => s + x.st[key], 0));
['payable', 'paid', 'due'].forEach((key) => {
  const base = sumOf(sortDays, key);
  is(`三档 ${key} 合计完全相同`, sumOf(sortDue, key) === base && sumOf(sortNo, key) === base);
});
near('付款页应付合计 = 基线应付 246,055.97', sumOf(sortDays, 'payable'), 246055.97);
near('付款页待付合计 = 基线待付 57,526.86', sumOf(sortDays, 'due'), 57526.86);
near('付款页已付合计 = 基线已付 188,529.11', sumOf(sortDays, 'paid'), 188529.11);
near('付款页待付合计 = 基线待付', round2(sortDays.reduce((s, x) => s + x.st.due, 0)), 57526.86);

/* ================= B3. 信息密度 ================= */
section('B3 密度偏好（只存本机、不进账本）');
freshBoot();
try { localStorage.removeItem(DENSITY_KEY); } catch (_) { /* fake-ls */ }
eq('默认密度 = compact', getDensity(), DENSITY_DEFAULT);
eq('DENSITY_DEFAULT === compact', DENSITY_DEFAULT, 'compact');
eq('setDensity(comfort) 返回 comfort', setDensity('comfort'), 'comfort');
eq('落库键名', DENSITY_KEY, 'ztools_rc_density');
eq('写后读回 comfort', getDensity(), 'comfort');
eq('localStorage 里确实是 comfort', localStorage.getItem(DENSITY_KEY), 'comfort');
eq('setDensity(compact) 可切回', setDensity('compact'), 'compact');
eq('切回后读回 compact', getDensity(), 'compact');
eq('非法值归一为 compact', normDensity('huge'), 'compact');
eq('setDensity 非法值返回归一结果', setDensity('huge'), 'compact');
// 纪律：密度不许进账本
const led = storageLedger();
not('台账 JSON 里不含 density 字段', /"density"/.test(led));
eq('台账顶层键只有 4 个（books/activeBookId/templates/warnThreshold）',
  Object.keys(JSON.parse(led)).sort().join(','), 'activeBookId,books,templates,warnThreshold');
is('切换密度不写台账（切完账本字节数不变）', (() => {
  const before = storageLedger();
  setDensity('comfort');
  setDensity('compact');
  return storageLedger() === before;
})());
// 备份时间键同样独立
try { localStorage.removeItem(LAST_BACKUP_KEY); } catch (_) { /* fake-ls */ }
eq('从未备份时 getLastBackup = 0', getLastBackup(), 0);
eq('LAST_BACKUP_KEY 键名', LAST_BACKUP_KEY, 'ztools_rc_last_backup');
const fixedTs = Date.parse('2026-10-20T10:00:00');
eq('setLastBackup 返回写入值', setLastBackup(fixedTs), fixedTs);
eq('getLastBackup 读回同一时间戳', getLastBackup(), fixedTs);
eq('非法时间戳回落 now（>0）', setLastBackup('abc') > 0, true);

/* ================= B4. 备份出口 ================= */
section('B4 JSON 备份（文件名 / 条数 / 导回幂等）');
freshBoot();
// node 里给 download() 装最小 DOM 桩，并把 Blob 收出来读内容
const captured = [];
globalThis.URL.createObjectURL = (b) => { captured.push(b); return 'blob:test'; };
globalThis.URL.revokeObjectURL = () => {};
globalThis.document = { body: { appendChild() {} }, createElement: () => ({ href: '', download: '', click() {}, remove() {} }) };
const stateSnapshot = {
  books: store.state.books,
  activeBookId: store.state.activeBookId,
  templates: store.state.templates,
  warnThreshold: store.state.warnThreshold,
};
const meta = exportJson(stateSnapshot, B());
eq('备份条数 items = 71', meta.items, 71);
eq('备份明细数 details = 384', meta.details, 384);
is('文件名匹配「项目费用备份_<账套>_<日期>[_时间戳]_71项384明细.json」',
  /^项目费用备份_.+_\d{4}-\d{2}-\d{2}(_\d{8}-\d{6})?_71项384明细\.json$/.test(meta.name));
is('文件名含账套名', meta.name.includes('自宅装修'));
is('文件名不含 Windows 非法字符', !/[\\/:*?"<>|]/.test(meta.name.slice('项目费用备份_'.length)));
eq('只下载了 1 个文件', captured.length, 1);
const backupText = await captured[0].text();
const parsed = JSON.parse(backupText);
eq('备份内容 books.length = 1', parsed.books.length, 1);
eq('备份内容 projects = 71', parsed.books[0].projects.length, 71);
eq('备份内容 details = 384',
  parsed.books[0].projects.reduce((s, p) => s + (p.details || []).length, 0), 384);
eq('备份内容 payments = 88',
  parsed.books[0].projects.reduce((s, p) => s + (p.payments || []).length, 0), 88);
not('备份文件不含快照键内容', backupText.includes('ztools_project_cost_snap_v1'));
is('备份是格式化 JSON（便于人工排查）', backupText.includes('\n  "books"'));

// 导回：格式必须是 importState 能吃的
const imp = store.importState(parsed);
eq('importState 返回 ok', imp.ok, true);
near('导回后应付 = 246,055.97', calc(B()).payable, 246055.97);
near('导回后已付 = 188,529.11', calc(B()).paid, 188529.11);
near('导回后待付 = 57,526.86', calc(B()).remain, 57526.86);
near('导回后预算 = 234,688', sumBudget(B()), 234688);
eq('导回后预算键数仍为 13', Object.keys(B().budget).length, 13);
eq('导回是幂等的（条数不变）', [B().projects.length, calc(B()).detailCount, calc(B()).payCount].join(','), '71,384,88');
eq('空备份被拒绝', store.importState({ books: [] }).ok, false);
eq('缺 books 的备份被拒绝', store.importState({}).ok, false);

/* ================= C1. 术语 ================= */
/*
 * K15（v1.9）口径变更说明（本段 3 条断言随之改写，原因逐条标注）：
 *   v1.7 定的是「界面改叫收款方，导出表头保留原词支付对象」。客户验收 v1.8 后提出：
 *   导出表要发给会计，表头写「支付对象」而界面写「收款方」，会被追问是不是两回事。
 *   故 K15 按客户要求把**导出表头也统一为「收款方」**，v1.7 C1 的旧决定在此被推翻。
 *   兼容性由 `parse.js::COL_ALIAS['收款方'] = '支付对象'` 兜住（该别名 v1.7 就存在），
 *   因此导出→导回仍是 88 行 0 坏行 —— 见 scripts/verify-k-export.mjs 的实测。
 */
section('C1 术语归一（K15：导出表头统一为「收款方」）');
freshBoot();
eq('COL_ALIAS 收款方 → 支付对象', COL_ALIAS['收款方'], '支付对象');
eq('COL_ALIAS 事项 → 费用备注', COL_ALIAS['事项'], '费用备注');
eq('normalizeHeader(收款方)', normalizeHeader('收款方'), '支付对象');
eq('normalizeHeader(事项)', normalizeHeader('事项'), '费用备注');
eq('未登记列原样返回', normalizeHeader('凭证号'), '凭证号');
eq('空白列归为空串', normalizeHeader('  项目号  '), '项目号');

// 那个坑：表头只写「收款方」时仍须判定为表头行（否则整表按位置错位）
is('只有「收款方」的表头仍被认成表头（≥2 列命中）',
  isHeaderRow('project', ['项目号', '收款方']));
is('只有「事项」的表头同样被认成表头', isHeaderRow('project', ['项目号', '事项']));
not('数据行不会被误判为表头', isHeaderRow('project', ['ZX0001', '泥工-张三']));
const aliasCsv = ['项目号,收款方,事项,总计', 'ZX0001,泥工-张三,瓷砖人工费,100'].join('\n');
const grid = parseDelimited(aliasCsv);
is('别名表头识别为表头行', isHeaderRow('project', grid[0]));
const aligned = alignByHeader('project', grid[0], grid[1]);
const aliasRow = mapRow('project', aligned);
not('别名 CSV 解析无错误', aliasRow.error);
eq('「收款方」列映射到 object', aliasRow.object, '泥工-张三');
eq('「事项」列映射到 remark', aliasRow.remark, '瓷砖人工费');
near('「总计」列仍按位置对齐', aliasRow.total, 100);
// 两列同时出现 → 不报错，且取值「确定」。
// 实测：归一化（收款方→支付对象）后按 indexOf 取**首个匹配列**，故先出现的「收款方」列胜出。
// PRD §2.8 的括号注写的正是「先归一后 indexOf 的确定性结果」，实现与该机制一致；
// PRD 正文「取『支付对象』列」与机制描述有措辞出入 —— 已作为 P2 文案问题回报主理人，
// 这里按「不报错 + 取值可预测」断言（不放松：一旦实现改成别的取法会立刻红）。
const bothHeader = ['项目号', '收款方', '支付对象', '费用备注', '总计'];
const bothRow = ['ZX0002', '先出现的值', '后出现的值', '备注', '200'];
const bothParsed = (() => {
  const a = mapRow('project', alignByHeader('project', bothHeader, bothRow));
  const b = mapRow('project', alignByHeader('project', bothHeader, bothRow));
  return { a, b };
})();
not('同表两列并存时不报错', bothParsed.a.error);
eq('取值确定（两次解析结果完全一致）', JSON.stringify(bothParsed.a), JSON.stringify(bothParsed.b));
eq('取值 = 归一后首个匹配列（先出现的「收款方」列）', bothParsed.a.object, '先出现的值');

// 钉子：HEADS 三表列名逐字不变（K15：proj / pay 的「支付对象」列改为「收款方」）
eq('HEADS.proj 列数 14', HEADS.proj.length, 14);
eq('HEADS.detail 列数 12', HEADS.detail.length, 12);
eq('HEADS.pay 列数 10', HEADS.pay.length, 10);
// K15 改写①：proj 第 12 列「支付对象」→「收款方」（客户要求术语统一）
eq('HEADS.proj 逐字不变', HEADS.proj.join(','),
  '项目号,项目分类,费用类型,费用备注,日期,到期日,总计,优惠,应付,已付,待付,收款方,状态,凭证');
eq('HEADS.detail 逐字不变', HEADS.detail.join(','),
  '项目号,项目分类,费用类型,费用备注,品名,单位,数量,单价,金额,工艺,备注,预估');
// K15 改写②：pay 第 3 列「支付对象」→「收款方」
eq('HEADS.pay 逐字不变', HEADS.pay.join(','),
  '项目号,费用备注,收款方,付款日期,付款方式,金额,备注,凭证号,付款编号,作废');
// K15 改写③：原写法是 `HEADS[key].includes(c)` 字面包含。改表头后，导入规范名「支付对象」
// 不再字面出现在导出列里（导出的是它的别名「收款方」），故改为**按归一名比较**：
// 导出列 h 与导入列 c 只要 normalizeHeader 后相同即视为同一列。
// 强度不降：表头一旦改成 normalizeHeader 认不出的第三方词，这条立刻红。
is('导入列在导出列里都有（三表，按归一名比对）',
  ['project', 'detail', 'pay'].every((t) => {
    const key = t === 'project' ? 'proj' : t;
    return TABLE_COLS[t].every((c) => HEADS[key].some((h) => normalizeHeader(h) === normalizeHeader(c)));
  }));
// K15 改写④：原断言是反向钉子「导出表头里不许出现收款方」，与新口径直接冲突，翻正为正向钉子
is('导出表头已统一为「收款方」', HEADS.proj.includes('收款方') && HEADS.pay.includes('收款方'));
not('导出表头里已无旧词「支付对象」', HEADS.proj.includes('支付对象') || HEADS.pay.includes('支付对象'));
// 别名链路仍在（parse.js 未改）：收款方 → 支付对象，导出→导回靠它对齐
eq('K15 兼容链：normalizeHeader(收款方) = 支付对象', normalizeHeader('收款方'), '支付对象');

/* ================= C3. 催收金额门槛 ================= */
section('C3 催收门槛（<100 元折叠）');
freshBoot();
eq('门槛常量 = 100 元', OVERDUE_MIN_AMOUNT, 100);
const og = overdueGroups(B());
eq('severe 全量 5 笔（口径不变）', og.severe.length, 5);
near('severe 合计 23,784.34', og.severeAmount, 23784.34);
eq('severeMain 主列表 4 笔', og.severeMain.length, 4);
near('severeMain 合计 23,783.88', round2(og.severeMain.reduce((s, x) => s + x.amount, 0)), 23783.88);
eq('smallList 折叠 1 笔', og.smallList.length, 1);
near('smallList 合计 0.46', og.smallSum, 0.46);
eq('smallSum 与 smallList 逐分一致', og.smallSum, round2(og.smallList.reduce((s, x) => s + x.amount, 0)));
eq('severeMain + smallList 恰好等于 severe（不丢不重）',
  og.severeMain.length + og.smallList.length, og.severe.length);
is('两组的 id 集合互不相交',
  og.smallList.every((x) => !og.severeMain.some((y) => y.id === x.id)));
is('severeMain 每笔都 ≥ 门槛', og.severeMain.every((x) => x.amount >= OVERDUE_MIN_AMOUNT));
is('smallList 每笔都 < 门槛', og.smallList.every((x) => x.amount < OVERDUE_MIN_AMOUNT));
eq('小额那笔正是 ZX0016（金额 0.46，< 门槛）',
  og.smallList[0] && `${og.smallList[0].no}|${og.smallList[0].amount}`,
  'ZX0016|0.46');
eq('门槛不影响逾期总笔数（仍 6 笔）', og.count, 6);
near('门槛不影响逾期总金额（= severe 全量 + normal 全量）', og.amount,
  round2(og.severeAmount + og.normal.reduce((s, x) => s + x.amount, 0)));
is('逾期总金额没被门槛砍成 severeMain 的 23,783.88', round2(og.amount) !== 23783.88);
is('normal（1–30 天）不含 severe', og.normal.every((x) => !x.severe));

/* ================= C4. 收款方名残缺 ================= */
section('C4 收款方名疑似残缺（只报不改）');
freshBoot();
const objBefore = JSON.stringify(B().projects.map((p) => p.object));
const payeesBefore = JSON.stringify(B().payees);
const chk = checkup(B());
const sup = chk.issues.find((i) => i.code === CHECK_CODE.PAYEE_NAME_SUSPECT);
is('体检新增 payee-name-suspect', !!sup);
eq('payee-name-suspect.count = 2', sup && sup.count, 2);
near('payee-name-suspect.amount = 26,780.00', sup && sup.amount, 26780);
eq('payee-name-suspect.fix = null（只报不改）', sup && sup.fix, null);
eq('payee-name-suspect.level = warn', sup && sup.level, 'warn');
eq('payee-name-suspect.unit = 项', sup && sup.unit, '项');
is('samples 含「泥工-」', sup && sup.samples.some((s) => s.text.includes('泥工-')));
is('samples 含「木工-」', sup && sup.samples.some((s) => s.text.includes('木工-')));
is('samples 带各自金额 14,980.00 / 11,800.00',
  sup && sup.samples.map((s) => s.text).join('|').includes('¥14,980.00')
  && sup.samples.map((s) => s.text).join('|').includes('¥11,800.00'));
// 只读铁律
eq('checkup 前后 projects[].object 完全不变', JSON.stringify(B().projects.map((p) => p.object)), objBefore);
eq('checkup 前后 payees 档案完全不变', JSON.stringify(B().payees), payeesBefore);
// 与 orphan-payee 的关系：档案里存在「泥工-」，故只命中本条
is('「泥工-」在收款方档案里存在', (B().payees || []).some((x) => x.name === '泥工-'));
is('「泥工-」不同时触发 orphan-payee',
  !chk.issues.some((i) => i.code === CHECK_CODE.ORPHAN_PAYEE));
is('pay-no-date 仍独立存在', chk.issues.some((i) => i.code === CHECK_CODE.PAY_NO_DATE));
// 判定函数边界
is('isPayeeNameSuspect(泥工-) = true（以分隔符结尾）', isPayeeNameSuspect('泥工-'));
is('isPayeeNameSuspect(泥工-张三) = false', !isPayeeNameSuspect('泥工-张三'));
is('isPayeeNameSuspect(泥工) = false', !isPayeeNameSuspect('泥工'));
is("isPayeeNameSuspect('A') = true（≤3 字且非纯中文）", isPayeeNameSuspect('A'));
is('isPayeeNameSuspect(—) = true（全符号）', isPayeeNameSuspect('—'));
is('isPayeeNameSuspect(空串) = false', !isPayeeNameSuspect(''));
is('isPayeeNameSuspect(张三) = false（2 字纯中文合法）', !isPayeeNameSuspect('张三'));
is('isPayeeNameSuspect(木工-) = true', isPayeeNameSuspect('木工-'));

/* ================= C6. 编号前缀 ================= */
section('C6 编号前缀 / 付款全号 / 导入剥前缀');
freshBoot();
eq('nextNo(空账套, WX) = WX0001', nextNo([], 'WX'), 'WX0001');
eq('nextNo(基线, 默认) = ZX0072（基线最大 ZX0071）', nextNo(B().projects), 'ZX0072');
eq('nextNo(基线, WX) = WX0001（混前缀不互相顶飞）', nextNo(B().projects, 'WX'), 'WX0001');
eq('nextNo(含 WX0003, WX) = WX0004',
  nextNo([{ no: 'WX0003' }, { no: 'ZX0099' }], 'WX'), 'WX0004');
eq('nextNo 不认别的前缀的号', nextNo([{ no: 'ZX9999' }], 'WX'), 'WX0001');
eq('nextNo 小写前缀归一为 ZX', nextNo([], 'zx'), 'ZX0001');
eq('payNo(ZX0024, P0001) = ZX0024-P0001', payNo('ZX0024', 'P0001'), 'ZX0024-P0001');
eq('payNo 无项目号时退化为单段', payNo('', 'P0001'), 'P0001');
eq('payNo 无 pid 时返回空串', payNo('ZX0001', ''), '');
eq('payNo 与本项目实际首笔一致',
  payRows(B())[0][8], payNo(B().projects.find((p) => (p.payments || []).length).no,
    B().projects.find((p) => (p.payments || []).length).payments[0].pid));

// 导入剥前缀（第一道闸：mapRow）
eq('mapRow 把 ZX0001-P0001 剥成 P0001',
  mapRow('pay', ['ZX0001', '2026-01-01', '微信', '100', '', '', 'ZX0001-P0001', '否']).pid, 'P0001');
eq('mapRow 对纯 pid 直通',
  mapRow('pay', ['ZX0001', '2026-01-01', '微信', '100', '', '', 'P0001', '否']).pid, 'P0001');
eq('mapRow 对非法前缀不产生 pid（交回补号）',
  mapRow('pay', ['ZX0001', '2026-01-01', '微信', '100', '', '', 'XX-P0001', '否']).pid, '');
eq('payPidOf 对乱串返回空串', payPidOf('abc-123'), '');
eq('payPidOf 对空值返回空串', payPidOf(''), '');
eq('payPidOf 对全号返回 pid', payPidOf('WX0007-P0012'), 'P0012');
eq('normNoPrefix 非法值回落 ZX', normNoPrefix('MZ12'), 'ZX');
eq('normNoPrefix 空值回落 ZX', normNoPrefix(''), 'ZX');
eq('normNoPrefix 合法值保留', normNoPrefix('mz'), 'MZ');

// 第二道闸：绕过解析层直接调 importTable 也不许把全号写进库
freshBoot();
const P0 = B().projects.find((p) => (p.payments || []).length);
const py0 = P0.payments[0];
const gate = store.importTable('pay', [{
  no: P0.no, date: py0.date, method: py0.method, amount: py0.amount, note: '', ref: '',
  pid: `${P0.no}-${py0.pid}`, voidFlag: false,
}], 'overwrite');
eq('直接传全号也能命中（覆盖 1 条，新增 0）', `${gate.overwritten},${gate.imported}`, '1,0');
eq('库里没有任何带 - 的 pid',
  B().projects.every((p) => (p.payments || []).every((x) => !String(x.pid).includes('-'))), true);
eq('命中后原 pid 一个字没变', B().projects.find((p) => p.no === P0.no).payments[0].pid, py0.pid);
near('金额零变化', calc(B()).paid, 188529.11);
// 导出→导回幂等（C6 全号下的 K1 不破）
freshBoot();
const csvPay = `${HEADS.pay.join(',')}\n${payRows(B()).map((r) => r.map((c) => {
  const s = String(c ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(',')).join('\n')}`;
const g2 = parseDelimited(csvPay);
const backRows = g2.slice(1).map((cells) => mapRow('pay', alignByHeader('pay', g2[0], cells)));
eq('回读 88 行全部成功', backRows.filter((r) => !r.error).length, 88);
const rImp = store.importTable('pay', backRows, 'overwrite');
eq('C6 全号原样导回：覆盖 88 / 新增 0', `${rImp.overwritten},${rImp.imported}`, '88,0');
near('C6 全号原样导回后已付不变', calc(B()).paid, 188529.11);
eq('C6 全号原样导回后 pid 集合仍是纯 P 号',
  B().projects.every((p) => (p.payments || []).every((x) => /^P\d{4,}$/.test(x.pid))), true);

/* ================= 汇总 ================= */
lines.push('');
lines.push(`PASS_TOTAL ${pass}`);
lines.push(`FAIL_TOTAL ${fail}`);
console.log(lines.join('\n'));
if (fail) {
  console.log('\n--- 失败明细 ---');
  failures.forEach((f) => console.log(`  · ${f}`));
}
// 用 exitCode 而不是 process.exit()：输出经管道时 process.exit 可能截断未刷出的 stdout
process.exitCode = fail ? 1 : 0;

/** 读台账原始 JSON（B3 用；放在文件末尾避免与 hoist 顺序纠缠） */
function storageLedger() {
  return localStorage.getItem('ztools_project_cost_v1') || '{}';
}

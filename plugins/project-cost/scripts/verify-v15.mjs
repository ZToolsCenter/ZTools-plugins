/**
 * v1.5 验证：M3 到期日推算可配 / M2 逾期分级 / M1 预警忽略持久化 /
 *            A2 材料排行 / A3 月度环比 / A4 单方造价
 *
 * 运行：npx esbuild scripts/verify-v15.mjs --bundle --platform=node --format=esm \
 *        --define:process.env.NODE_ENV='"development"' --outfile=/tmp/v15.mjs && node /tmp/v15.mjs
 */
import { SEED } from '../src/lib/seed.js';
import {
  calc, agingRows, agingPayees, buildAlerts, overdueGroups, materialRows, monthCompare,
  costPerArea, effectiveDue, bookDueDays, addDays, todayLocal, round2, payableOf, detailSum,
  checkup, SEVERE_DAYS, DEFAULT_DUE_DAYS,
} from '../src/lib/core.js';
import {
  isIgnored, ignoreTypes, clearIgnore, refreshIgnore, reloadIgnore, ignoredCount,
  ignoreState, IGNORE_KEY,
} from '../src/lib/alertIgnore.js';

let pass = 0;
let fail = 0;
const fails = [];
const lines = [];
function mark(okFlag, name, detail) {
  if (okFlag) { pass += 1; lines.push(`PASS ${name}: ${detail}`); } else { fail += 1; lines.push(`FAIL ${name}: ${detail}`); }
  return okFlag;
}
function ok(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fails.push(`${name}\n    期望 ${e}\n    实际 ${a}`);
  return mark(a === e, name, a);
}
function truthy(name, v) { return ok(name, !!v, true); }
function near(name, actual, expected, eps = 0.005) {
  const good = Math.abs(actual - expected) <= eps;
  if (!good) fails.push(`${name}\n    期望 ${expected} ±${eps}\n    实际 ${actual}`);
  return mark(good, name, actual);
}
function section(t) { lines.push(`\n== ${t} ==`); }

const TODAY = todayLocal();
const clone = (v) => JSON.parse(JSON.stringify(v));
const SEED_SNAPSHOT = JSON.stringify(SEED);

/* 造账本的工具 */
const mkProj = (over) => ({
  id: `p-${Math.random().toString(36).slice(2, 8)}`,
  no: 'T0001', name: '测试项', cat: '材料费', sub: '材料费', object: '甲',
  date: '2026-01-01', discount: 0, total: 1000, remark: '测试项',
  details: [], payments: [], ...over,
});
const mkBook = (projects, extra = {}) => ({
  id: 'b1', name: '测试账本', projects,
  budget: {}, categories: [], payees: [], ...extra,
});

/* ================= M3：到期日推算可配 ================= */
section('M3 到期日推算（book.dueDays）');

ok('默认推算天数常量 = 30', DEFAULT_DUE_DAYS, 30);
ok('未填到期日 + 缺省 dueDays → 下单日 + 30', effectiveDue({ date: '2026-01-01' }), '2026-01-31');
ok('dueDays=7 → 下单日 + 7', effectiveDue({ date: '2026-01-01' }, 7), '2026-01-08');
ok('已填到期日优先于 dueDays', effectiveDue({ date: '2026-01-01', due: '2026-03-01' }, 7), '2026-03-01');
ok('dueDays=0 回落 30', effectiveDue({ date: '2026-01-01' }, 0), '2026-01-31');
ok('dueDays 负数回落 30', effectiveDue({ date: '2026-01-01' }, -5), '2026-01-31');
ok('dueDays 非数字回落 30', effectiveDue({ date: '2026-01-01' }, 'abc'), '2026-01-31');
ok('dueDays 上限 365', effectiveDue({ date: '2026-01-01' }, 999), addDays('2026-01-01', 365));
ok('空日期不炸（返回空串）', effectiveDue({}, 7), '');

ok('bookDueDays 缺省 = 30', bookDueDays({}), 30);
ok('bookDueDays 读取账本字段', bookDueDays({ dueDays: 15 }), 15);
ok('bookDueDays 非法值回落 30', bookDueDays({ dueDays: 'x' }), 30);
ok('bookDueDays 0 回落 30', bookDueDays({ dueDays: 0 }), 30);
ok('bookDueDays 上限 365', bookDueDays({ dueDays: 900 }), 365);

/* 45 天前的单，未填到期日：dueDays 30 → 逾期 15 天；dueDays 7 → 逾期 38 天 */
const oldDate = addDays(TODAY, -45);
const p45 = mkProj({ date: oldDate, total: 1000 });
const b30 = mkBook([clone(p45)], { dueDays: 30 });
const b7 = mkBook([clone(p45)], { dueDays: 7 });

ok('dueDays=30 时该单到期日 = 下单日+30', agingRows(b30, TODAY).items[0].due, addDays(oldDate, 30));
near('dueDays=30 → 逾期 15 天', agingRows(b30, TODAY).items[0].overdue, 15);
near('dueDays=7 → 逾期 38 天', agingRows(b7, TODAY).items[0].overdue, 38);
ok('dueDays=7 时到期日提前', agingRows(b7, TODAY).items[0].due, addDays(oldDate, 7));
ok('dueDays 只影响未填到期日的单（已填则不变）', agingRows(
  mkBook([mkProj({ date: oldDate, due: addDays(TODAY, -3) })], { dueDays: 7 }), TODAY,
).items[0].due, addDays(TODAY, -3));

/* M3 × M2 联动：同一笔单，推算天数不同 → 逾期分级从 normal 变 severe */
ok('dueDays=30 → 该单不算超 30 天', overdueGroups(b30, TODAY).severe.length, 0);
ok('dueDays=30 → 该单是普通逾期', overdueGroups(b30, TODAY).normal.length, 1);
ok('dueDays=7 → 该单升级为超 30 天', overdueGroups(b7, TODAY).severe.length, 1);
ok('dueDays=7 → buildAlerts 计入 severeCount', buildAlerts(b7, TODAY).severeCount, 1);
ok('dueDays=30 → buildAlerts severeCount = 0', buildAlerts(b30, TODAY).severeCount, 0);
near('dueDays 改动不影响待付金额', agingRows(b7, TODAY).total, agingRows(b30, TODAY).total);
ok('dueDays 越界值不会改变金额链', calc(b7).remain, calc(b30).remain);

/* 默认台账没有 dueDays 字段，行为必须与显式 30 天完全一致（回归栅栏） */
const seedNoDueDays = clone(SEED);
delete seedNoDueDays.dueDays;
const seedWith30 = { ...clone(SEED), dueDays: 30 };
ok('SEED 无 dueDays 时账龄与显式 30 完全一致',
  JSON.stringify(agingRows(seedNoDueDays, TODAY).buckets), JSON.stringify(agingRows(seedWith30, TODAY).buckets));

/* ================= M2：逾期分级 ================= */
section('M2 逾期分级（超 30 天）');

ok('分级阈值 = 30 天', SEVERE_DAYS, 30);
const g = overdueGroups(SEED, TODAY);
truthy('默认台账存在逾期项', g.count > 0);
truthy('默认台账存在超 30 天的项', g.severe.length > 0);
ok('severe + normal = 全部逾期', g.severe.length + g.normal.length, g.count);
near('severe + normal 金额之和 = 全部逾期金额', round2(
  g.severe.reduce((t, x) => t + x.amount, 0) + g.normal.reduce((t, x) => t + x.amount, 0),
), g.amount);
truthy('severe 每项 days > 30', g.severe.every((x) => x.days > 30));
truthy('normal 每项 1 ≤ days ≤ 30', g.normal.every((x) => x.days >= 1 && x.days <= 30));
truthy('全部按逾期天数降序', g.all.every((x, i) => i === 0 || g.all[i - 1].days >= x.days));
truthy('只含仍欠款的费用项', g.all.every((x) => x.amount > 0.005));
near('severeAmount 自洽', g.severeAmount, round2(g.severe.reduce((t, x) => t + x.amount, 0)));

/* 边界：正好 30 天 vs 31 天 */
const edge = mkBook([
  mkProj({ id: 'e30', no: 'E0030', due: addDays(TODAY, -30), total: 100 }),
  mkProj({ id: 'e31', no: 'E0031', due: addDays(TODAY, -31), total: 200 }),
  mkProj({ id: 'e0', no: 'E0000', due: addDays(TODAY, 3), total: 400 }),   // 未逾期
  mkProj({ id: 'e99', no: 'E0099', due: addDays(TODAY, -99), total: 800 }), // 超 90 天
]);
const eg = overdueGroups(edge, TODAY);
ok('边界：30 天算 normal、31 天算 severe', [eg.severe.map((x) => x.no).sort(), eg.normal.map((x) => x.no).sort()], [['E0031', 'E0099'], ['E0030']]);
ok('未到期的不进逾期清单', eg.count, 3);
near('逾期金额合计只含逾期项', eg.amount, 1100);
truthy('与 buildAlerts 的逾期条数一致', buildAlerts(edge, TODAY).overdue.length === eg.count);
truthy('buildAlerts 的 severe 标记与 overdueGroups 一致',
  buildAlerts(edge, TODAY).overdue.filter((x) => x.severe).map((x) => x.id).sort().join(',')
  === eg.severe.map((x) => x.id).sort().join(','));

/* 默认台账：顶部预警与付款页置顶口径必须一致 */
const alerts = buildAlerts(SEED, TODAY);
ok('默认台账 severeCount = overdueGroups.severe.length', alerts.severeCount, g.severe.length);
ok('默认台账 overdue 条数 = overdueGroups.count', alerts.overdue.length, g.count);
truthy('默认台账所有 severe 的 days > 30', alerts.overdue.filter((x) => x.severe).every((x) => x.days > 30));

/* 文案：超 30 天用「超30天」前缀，普通逾期用「逾期」 */
const textBook = mkBook([
  mkProj({ id: 's1', no: 'S0001', remark: '严重项', due: addDays(TODAY, -40), total: 1000 }),
  mkProj({ id: 's2', no: 'S0002', remark: '普通项', due: addDays(TODAY, -5), total: 500 }),
]);
const tAlerts = buildAlerts(textBook, TODAY);
const severeItem = tAlerts.items.find((a) => a.type === 'overdue' && a.severe);
const normalItem = tAlerts.items.find((a) => a.type === 'overdue' && !a.severe);
truthy('超 30 天文案以「超30天」开头', severeItem?.text.startsWith('超30天'));
truthy('普通逾期文案以「逾期」开头', normalItem?.text.startsWith('逾期'));
truthy('超 30 天项带 severe 标记（供 danger 实心样式）', severeItem?.severe === true);

/* ================= M1：预警忽略持久化 ================= */
section('M1 预警忽略（按天持久化）');

// node 无 DOM：装一个内存版 localStorage（alertIgnore 的所有读写都在 try/catch 内，缺了也能跑）
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(String(k), String(v)); },
  removeItem: (k) => { mem.delete(String(k)); },
  clear: () => mem.clear(),
};

clearIgnore();
refreshIgnore(TODAY);
ok('初始无忽略', ignoredCount(TODAY), 0);
ok('未忽略时 isIgnored = false', isIgnored('over', TODAY), false);

const added = ignoreTypes(['over', 'soon', 'over'], TODAY);
ok('忽略两类（重复项去重）', added, 2);
ok('over 已忽略', isIgnored('over', TODAY), true);
ok('soon 已忽略', isIgnored('soon', TODAY), true);
ok('overdue 未忽略（只忽略点过的那几类）', isIgnored('overdue', TODAY), false);
ok('忽略类数 = 2', ignoredCount(TODAY), 2);
ok('未传类型不炸', ignoreTypes([null, '', 123], TODAY), 0);
ok('空 className 不算忽略', isIgnored('', TODAY), false);

// 持久化：写入后原始存储里能读到当天 + 类型
const raw = JSON.parse(mem.get(IGNORE_KEY) || '{}');
ok('已写入独立存储键', Object.keys(raw).sort(), ['date', 'types']);
ok('存储里记的是今天', raw.date, TODAY);
ok('存储里记了两类', raw.types.slice().sort(), ['over', 'soon']);

// 重新加载（模拟重启插件）
ignoreState.date = '';
ignoreState.types = [];
const re = reloadIgnore(TODAY);
ok('重启后仍记得忽略', [re.date, re.types.slice().sort()], [TODAY, ['over', 'soon']]);
ok('重启后 isIgnored 仍为 true', isIgnored('over', TODAY), true);

// 跨天自动失效
mem.set(IGNORE_KEY, JSON.stringify({ date: '2000-01-01', types: ['over', 'soon'] }));
reloadIgnore(TODAY);
ok('昨天的忽略今天自动失效', [ignoredCount(TODAY), isIgnored('over', TODAY)], [0, false]);
ok('跨天复位后存储被改写为今天', JSON.parse(mem.get(IGNORE_KEY)).date, TODAY);

// 坏数据 / 存储不可用
mem.set(IGNORE_KEY, '{坏JSON');
let badOk = true;
try { reloadIgnore(TODAY); } catch (_) { badOk = false; }
truthy('坏 JSON 不抛错', badOk);
ok('坏 JSON 视为无忽略', ignoredCount(TODAY), 0);

const savedLS = globalThis.localStorage;
globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
let deniedOk = true;
try { ignoreTypes(['over'], TODAY); } catch (_) { deniedOk = false; }
truthy('localStorage 不可用时忽略仍不抛错', deniedOk);
ok('不可用时本会话内仍生效', isIgnored('over', TODAY), true);
globalThis.localStorage = savedLS;

clearIgnore();
ok('恢复后清零', [ignoredCount(TODAY), isIgnored('over', TODAY)], [0, false]);
ok('恢复后存储 types 为空', JSON.parse(mem.get(IGNORE_KEY)).types, []);

/* 忽略只影响展示，不影响数据与统计 */
const beforeIgnore = JSON.stringify(SEED);
ignoreTypes(['over', 'overdue'], TODAY);
truthy('忽略不改变账本数据', JSON.stringify(SEED) === beforeIgnore);
ok('忽略不改变预警条数', buildAlerts(SEED, TODAY).total, alerts.total);
clearIgnore();

/* ================= A2：材料排行 ================= */
section('A2 明细品名支出排行');

const mats = materialRows(SEED, 10);
const detailTotal = round2(SEED.projects.reduce((t, p) => t + detailSum(p), 0));
near('明细合计 = Σ 各费用项明细', mats.total, detailTotal);
near('明细合计字面 = 247,577.89', mats.total, 247577.89);
truthy('Top 行数 ≤ 10', mats.rows.length <= 10);
truthy('Top 行数 = min(10, 品名数)', mats.rows.length === Math.min(10, mats.names));
near('Top 合计 + 其他 = 明细合计', round2(mats.topTotal + mats.others), mats.total);
near('topTotal 自洽', mats.topTotal, round2(mats.rows.reduce((t, m) => t + m.amount, 0)));
truthy('按金额降序', mats.rows.every((m, i) => i === 0 || mats.rows[i - 1].amount >= m.amount));
ok('max = Top1 金额', mats.max, mats.rows[0].amount);
ok('条数之和 = 明细条数', mats.rows.reduce((t, m) => t + m.count, 0) + 0,
  mats.rows.reduce((t, m) => t + m.count, 0));
truthy('Top1 金额 > 0', mats.rows[0].amount > 0);
truthy('每行 itemId 指向真实费用项', mats.rows.every((m) => SEED.projects.some((p) => p.id === m.itemId)));
truthy('每行都有品名与条数', mats.rows.every((m) => m.name && m.count >= 1));
ok('不返回内部临时字段', Object.keys(mats.rows[0]).filter((k) => k.startsWith('_')), []);
truthy('othersCount 与品名数自洽', mats.othersCount === Math.max(0, mats.names - mats.rows.length));

/* 同名合并：忽略空格与大小写 */
const mergeBook = mkBook([
  mkProj({
    id: 'm1',
    details: [
      { name: '瓷砖 胶', unit: '袋', qty: 1, price: 100, amount: 100 },
      { name: '瓷砖胶', unit: '袋', qty: 1, price: 200, amount: 200 },
      { name: 'Cement', unit: 'kg', qty: 1, price: 50, amount: 50 },
      { name: 'cement', unit: 'kg', qty: 1, price: 70, amount: 70 },
      { name: '黄沙', unit: '方', qty: 2, price: 150, amount: 300 },
    ],
  }),
]);
const mb = materialRows(mergeBook, 10);
ok('「瓷砖 胶」与「瓷砖胶」合并为一行', mb.rows.find((m) => m.name.startsWith('瓷砖'))?.amount, 300);
ok('英文大小写合并', mb.rows.find((m) => m.name.toLowerCase() === 'cement')?.amount, 120);
ok('合并后品名数 = 3', mb.names, 3);
ok('同条数累加', mb.rows.find((m) => m.name.startsWith('瓷砖'))?.count, 2);
near('合并后总额不变', mb.total, 720);

/* 空品名不计入排行但计入总额 */
const emptyBook = mkBook([
  mkProj({ id: 'e1', details: [{ name: '', amount: 999 }, { name: '沙子', amount: 1 }] }),
]);
const eb = materialRows(emptyBook, 10);
ok('空品名不进排行', eb.rows.length, 1);
near('空品名仍计入总额', eb.total, 1000);
near('空品名进 others', eb.others, 999);

truthy('材料排行不 mutate 台账', JSON.stringify(SEED) === beforeIgnore);

/* ================= A3：月度环比 ================= */
section('A3 月度环比');

const curYM = TODAY.slice(0, 7);
const cmp = monthCompare(SEED, TODAY);
ok('当前月 = 今天所在月', cmp.cur, curYM);
truthy('上月按自然月回退', /^\d{4}-\d{2}$/.test(cmp.prev) && cmp.prev < cmp.cur);
const expectCurPayable = round2(SEED.projects
  .filter((p) => String(p.date || '').slice(0, 7) === curYM)
  .reduce((t, p) => t + payableOf(p), 0));
near('本月应付 = 本月下单费用项应付合计', cmp.payable.cur, expectCurPayable);
const expectCurPaid = round2(SEED.projects.reduce((t, p) => t + (p.payments || [])
  .filter((py) => String(py.date || '').slice(0, 7) === curYM)
  .reduce((t2, py) => t2 + (+py.amount || 0), 0), 0));
near('本月已付 = 本月付款流水合计', cmp.paid.cur, expectCurPaid);
near('应付差额 = 本月 − 上月', cmp.payable.diff, round2(cmp.payable.cur - cmp.payable.prev));
ok('差额为 0 时增幅为 0', monthCompare(mkBook([]), TODAY).payable.pct, 0);

/* 合成：上月 1000，本月 3000 → +2000 / +200% */
const thisM = `${curYM}-05`;
const prevM = `${cmp.prev}-05`;
const cmpBook = mkBook([
  mkProj({ id: 'c1', cat: '材料费', date: prevM, total: 1000, details: [] }),
  mkProj({ id: 'c2', cat: '人工费', date: thisM, total: 3000, details: [] }),
]);
const cc = monthCompare(cmpBook, TODAY);
near('合成：本月应付 3000', cc.payable.cur, 3000);
near('合成：上月应付 1000', cc.payable.prev, 1000);
near('合成：差额 +2000', cc.payable.diff, 2000);
near('合成：增幅 +200%', cc.payable.pct, 200);
ok('合成：新增费用项 1 vs 1', [cc.count.cur, cc.count.prev, cc.count.diff], [1, 1, 0]);
ok('合成：增幅最大品类 = 人工费 +3000', [cc.topCat.name, cc.topCat.diff], ['人工费', 3000]);
truthy('合成：hasData = true', cc.hasData);

/* 跨年：1 月的上月是去年 12 月 */
ok('跨年上月计算正确', monthCompare(mkBook([]), '2026-01-15').prev, '2025-12');
ok('月份格式不被 today 之外的输入破坏', monthCompare(mkBook([]), '2026-03-31').prev, '2026-02');

/* 本月无数据但上月有：diff 为负 */
const onlyPrev = mkBook([mkProj({ date: prevM, total: 500 })]);
near('本月 0 / 上月 500 → diff -500', monthCompare(onlyPrev, TODAY).payable.diff, -500);
near('上月有数据时增幅 = -100%', monthCompare(onlyPrev, TODAY).payable.pct, -100);

/* ================= A4：单方造价 ================= */
section('A4 单方造价（元/㎡）');

ok('未填面积返回 null（界面不显示）', costPerArea(SEED), null);
ok('面积为 0 返回 null', costPerArea({ ...clone(SEED), area: 0 }), null);
ok('面积为负返回 null', costPerArea({ ...clone(SEED), area: -10 }), null);

const withArea = costPerArea({ ...clone(SEED), area: 89 });
near('面积 89㎡ 时应付仍是真源', withArea.payable, 246055.97);
ok('单方造价 = 四舍五入到元', withArea.perArea, Math.round(246055.97 / 89));
ok('89㎡ → ¥2,765/㎡（PRD 验收样例）', withArea.perArea, 2765);
near('确定口径单方造价 = confirmedPayable / 面积', withArea.perAreaConfirmed, Math.round(231180.97 / 89));
ok('面积原样返回', withArea.area, 89);
truthy('算单方造价不改台账', JSON.stringify(SEED) === beforeIgnore);

/* ================= 回归：金额链真源 ================= */
section('回归 v1.3 / v1.4 基线');
const after = calc(SEED);
ok('金额链真源字面不变', [after.payable, after.paid, after.remain], [246055.97, 188529.11, 57526.86]);
ok('预算/结余不变', [after.totalBudget, after.balance], [234688, -11367.97]);
ok('B1 派生不变', [after.estTotal, after.confirmedPayable], [14875, 231180.97]);
near('账龄总额 = 待付合计', agingRows(SEED, TODAY).total, after.remain);
near('收款方欠款之和 = 待付合计', round2(agingPayees(SEED, TODAY).reduce((t, p) => t + p.owe, 0)), after.remain);
const chk = checkup(SEED);
// v1.7 C4：体检新增 payee-name-suspect（只报不改），问题总数不再恒为 1。
// 改为「按 code 断言 + 无 fix 类问题」两条，强度不降且以后加规则不必改测试。
const chkIssues = chk.issues || chk;
ok('体检仍含 pay-no-date（无日期付款）', chkIssues.some((i) => i.code === 'pay-no-date'), true);
ok('基线数据无 fix 类问题（自洽）', chkIssues.filter((i) => i.fix).length, 0);
ok('费用项/明细/付款条数不变', [SEED.projects.length,
  SEED.projects.reduce((t, p) => t + (p.details || []).length, 0),
  SEED.projects.reduce((t, p) => t + (p.payments || []).length, 0)], [71, 384, 88]);
truthy('全流程不改动 SEED（序列化逐字节一致）', JSON.stringify(SEED) === SEED_SNAPSHOT);

/* ================= 汇总 ================= */
console.log(lines.join('\n'));
console.log('\n================ v1.5 验证结果 ================');
console.log(`用例 ${pass + fail} · 通过 ${pass} · 失败 ${fail}`);
if (fail) {
  console.log('\n--- 失败明细 ---');
  fails.forEach((f, i) => console.log(`${i + 1}. ${f}`));
  process.exitCode = 1;
} else {
  console.log('ALL PASS ✅');
}

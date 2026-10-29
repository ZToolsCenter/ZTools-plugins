/**
 * v1.6 逻辑自验：K1 付款唯一键 / C5 付款作废留痕 / C4 批量登记付款。
 *
 * 运行：npx esbuild scripts/verify-v16.mjs --bundle --platform=node --format=esm \
 *        --define:process.env.NODE_ENV='"development"' --outfile=/tmp/v16.mjs && node /tmp/v16.mjs
 *
 * 本批守着四条红线（任一破了就不能发）：
 *  ① 基线三项字面不变：应付 246,055.97 / 已付 188,529.11 / 待付 57,526.86；
 *  ② 编号只是身份：加 pid、回填 pid、作废、批量付款都不得改变金额链口径；
 *  ③ 作废 ≠ 删除：作废后金额减、恢复后金额加回，pid 与凭证号全程不变；
 *  ④ 导出→导回幂等：带 pid 的文件二次导入 imported=0 且金额零变化。
 */
import './fake-ls.mjs';
import { SEED } from '../src/lib/seed.js';
import * as store from '../src/lib/store.js';
import {
  calc, paidOf, dueOf, payableOf, round2, nextPid, PID_RE, activePayments, voidPayments,
  monthlyPayments, checkup, todayLocal, statOf, payNo,
} from '../src/lib/core.js';
import { parseDelimited, mapRow, isHeaderRow, alignByHeader, normalizeHeader, TABLE_COLS } from '../src/lib/parse.js';
import { HEADS, payRows } from '../src/lib/export.js';

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
const near = (label, actual, expected, tol = 0.005) =>
  record(Math.abs((+actual || 0) - (+expected || 0)) <= tol, label, actual, expected);

const clone = (v) => JSON.parse(JSON.stringify(v));
const SEED_SNAPSHOT = JSON.stringify(SEED);
const freshBoot = () => { try { localStorage.clear(); } catch (_) { /* fake-ls */ } return store.boot(); };
const B = () => store.book.value;

/** 与 SettingsView.onImpFile 完全一致的“文本 → 行对象”路径（含表头对齐） */
function readTable(table, text) {
  const grid = parseDelimited(text);
  const hasHead = grid.length > 0 && isHeaderRow(table, grid[0]);
  const header = hasHead ? grid[0] : null;
  const body = hasHead ? grid.slice(1) : grid;
  const good = []; const bad = [];
  body.forEach((cells) => {
    const r = mapRow(table, header ? alignByHeader(table, header, cells) : cells);
    (r.error ? bad : good).push(r.error || r);
  });
  return { good, bad };
}
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** 把 payRows 的输出还原成一份可导入的 CSv 文本 */
const payCsv = () => `${HEADS.pay.join(',')}\n${payRows(B()).map((r) => r.map(csvCell).join(',')).join('\n')}`;

/* ================= 0. 基线零漂移 ================= */
section('0 基线（v1.6 改动后仍须字面不变）');
freshBoot();
eq('种子未被测试污染', JSON.stringify(SEED), SEED_SNAPSHOT);
near('应付 246,055.97', calc(B()).payable, 246055.97);
near('已付 188,529.11', calc(B()).paid, 188529.11);
near('待付 57,526.86', calc(B()).remain, 57526.86);
eq('有效付款笔数 88', calc(B()).payCount, 88);
eq('作废笔数 0', calc(B()).voidCount, 0);
eq('付款行数 = 88', payRows(B()).length, 88);
is('每笔付款都有 pid', B().projects.every((p) => (p.payments || []).every((py) => PID_RE.test(py.pid))));
is('每笔付款 void 均为布尔 false', B().projects.every((p) => (p.payments || []).every((py) => py.void === false)));
is('项目内 pid 唯一', B().projects.every((p) => new Set((p.payments || []).map((x) => x.pid)).size === (p.payments || []).length));
eq('首个项目首笔 pid = P0001', B().projects.find((p) => (p.payments || []).length).payments[0].pid, 'P0001');

/* ================= 1. K1 编号规则 ================= */
section('K1 编号生成与回填');
eq('nextPid(空) = P0001', nextPid([]), 'P0001');
eq('nextPid 顺延到 max+1', nextPid([{ pid: 'P0003' }, { pid: 'P0001' }]), 'P0004');
eq('nextPid 忽略非法编号', nextPid([{ pid: 'X1' }, { pid: '' }]), 'P0001');
is('PID_RE 接受 P0001', PID_RE.test('P0001'));
is('PID_RE 拒绝 P1', !PID_RE.test('P1'));
is('PID_RE 拒绝小写', !PID_RE.test('p0001'));

const nb = (pays) => store.normalizeBook({
  projects: [{ id: 'x', no: 'X1', date: '2026-01-01', total: 0, details: [], payments: pays }],
}).projects[0].payments.map((x) => x.pid);
eq('缺失 pid 按顺序回填', nb([{}, {}, {}]), ['P0001', 'P0002', 'P0003']);
eq('合法唯一 pid 原样保留', nb([{ pid: 'P0007' }, { pid: 'P0002' }]), ['P0007', 'P0002']);
eq('重复 pid 只保留第一个，其余重发', nb([{ pid: 'P0001' }, { pid: 'P0001' }]), ['P0001', 'P0002']);
eq('非法 pid 重发且不与合法号冲突', nb([{ pid: 'ZZZ' }, { pid: 'P0005' }]), ['P0006', 'P0005']);
eq('回填幂等（再跑一次不变）', (() => {
  const b = store.normalizeBook({
    projects: [{ id: 'x', no: 'X1', payments: [{ pid: 'P0002' }, {}] }],
  });
  store.normalizeBook(b);
  return b.projects[0].payments.map((x) => x.pid);
})(), ['P0002', 'P0003']);

section('K1 导出列契约');
eq('HEADS.pay 列数 10', HEADS.pay.length, 10);
eq('前 6 列逐字不变', HEADS.pay.slice(0, 6).join(','), '项目号,费用备注,收款方,付款日期,付款方式,金额');
eq('新增两列在末尾', HEADS.pay.slice(8).join(','), '付款编号,作废');
// v1.7 C6：第 9 列由「纯 pid」改为「付款全号 = payNo(项目号, pid)」。
// 库里仍只存 pid，故取期望值时现场拼 payNo，而不是写死 `ZX0001-P0001`。
const firstPaid = B().projects.find((p) => (p.payments || []).length);
eq('payRows 第 9 列 = payNo(项目号, pid)', payRows(B())[0][8], payNo(firstPaid.no, firstPaid.payments[0].pid));
eq('payRows 第 9 列末段仍等于库里 pid', payRows(B())[0][8].slice(-firstPaid.payments[0].pid.length), firstPaid.payments[0].pid);
eq('payRows 第 10 列 = 否', payRows(B())[0][9], '否');
eq('TABLE_COLS.pay 末两列同为 付款编号/作废', TABLE_COLS.pay.slice(-2).join(','), '付款编号,作废');
is('导入列在导出列里都有（按归一名比对）', TABLE_COLS.pay.every((c) => HEADS.pay.some((h) => normalizeHeader(h) === normalizeHeader(c))));

/* ================= 2. K1 导出→导回幂等 ================= */
section('K1 导出→导回幂等');
freshBoot();
const before = clone(B());
const csv0 = payCsv();
const t0 = readTable('pay', csv0);
eq('回读行数 88', t0.good.length, 88);
eq('回读无错误行', t0.bad.length, 0);
eq('pid 全部回读成功', t0.good.every((r) => PID_RE.test(r.pid)), true);
const r0 = store.importTable('pay', t0.good, 'overwrite');
eq('原样导回：新增 0', r0.imported, 0);
eq('原样导回：覆盖 88', r0.overwritten, 88);
eq('原样导回：跳过 0', r0.skipped, 0);
near('原样导回后已付不变', calc(B()).paid, 188529.11);
eq('原样导回后流水条数不变', payRows(B()).length, 88);
eq('原样导回后 pid 集合不变',
  JSON.stringify(B().projects.map((p) => (p.payments || []).map((x) => x.pid))),
  JSON.stringify(before.projects.map((p) => (p.payments || []).map((x) => x.pid))));

/* ================= 3. 核心缺陷：同日多笔精确命中 ================= */
section('K1 同日多笔（v1.3 遗留缺陷已修）');
freshBoot();
const P = B().projects[0];
P.payments = [
  { pid: 'P0001', date: '2026-03-01', method: '微信', amount: 1000, note: '首笔', ref: '', void: false },
  { pid: 'P0002', date: '2026-03-01', method: '微信', amount: 2000, note: '第二笔', ref: '', void: false },
];
P.details = [{ name: '甲', unit: '项', qty: 1, price: 9000, amount: 9000, craft: '', note: '', est: '否' }];
P.total = 9000;
const basePaid = paidOf(P);
eq('前置：已付 = 3000', basePaid, 3000);
eq('前置：两笔同日', P.payments[0].date, P.payments[1].date);

// 只导回第 2 笔，金额 2000 → 2500。旧规则（同日期第 1 次出现）会错改第 1 笔。
const oneRow = readTable('pay', [
  HEADS.pay.join(','),
  [P.no, P.remark, P.object, '2026-03-01', '微信', '2500', '第二笔', '', 'P0002', '否'].join(','),
].join('\n'));
eq('单行回读成功', oneRow.good.length, 1);
eq('单行回读 pid 正确', oneRow.good[0] && oneRow.good[0].pid, 'P0002');
const r1 = store.importTable('pay', oneRow.good, 'overwrite');
eq('单行导入：覆盖 1 条', r1.overwritten, 1);
eq('单行导入：新增 0 条', r1.imported, 0);
eq('命中第 2 笔（不是第 1 笔）', P.payments[1].amount, 2500);
eq('第 1 笔金额未被动过', P.payments[0].amount, 1000);
eq('流水条数不变', P.payments.length, 2);
eq('已付增量 = 500', round2(paidOf(P) - basePaid), 500);
eq('pid 未被重写', P.payments.map((x) => x.pid).join(','), 'P0001,P0002');

section('K1 无编号文件仍走旧规则（不回归）');
freshBoot();
const Q = B().projects.find((p) => (p.payments || []).length >= 2);
const qIdx = B().projects.indexOf(Q);
const oldFile = [
  TABLE_COLS.pay.slice(0, 6).join(','),
  [Q.no, Q.payments[0].date, Q.payments[0].method, String(Q.payments[0].amount), '', ''].join(','),
].join('\n');
const t2 = readTable('pay', oldFile);
eq('6 列无编号文件回读成功', t2.good.length, 1);
eq('无编号文件 pid 为空', t2.good[0].pid, '');
const paidQ = paidOf(Q);
const r2 = store.importTable('pay', t2.good, 'append');
eq('无编号重复行被识别为已存在', r2.imported, 0);
near('无编号重复导入后已付不变', paidOf(B().projects[qIdx]), paidQ);

/* ================= 4. C5 作废 ================= */
section('C5 作废 / 恢复');
freshBoot();
const Z = B().projects.find((p) => (p.payments || []).length >= 2);
const zPaid = paidOf(Z);
const zDue = dueOf(Z);
const zPid = Z.payments[0].pid;
const zAmt = Z.payments[0].amount;
const v1r = store.voidPayment(Z.id, 0, true);
is('作废返回 ok', v1r.ok);
near('作废后已付减少该笔金额', paidOf(Z), zPaid - zAmt);
near('作废后待付增加该笔金额', dueOf(Z), zDue + zAmt);
eq('作废后 pid 不变', Z.payments[0].pid, zPid);
eq('作废后记录仍在（未删除）', Z.payments.length, 2);
eq('作废后 activePayments 少一笔', activePayments(Z).length, 1);
eq('作废后 voidPayments 多一笔', voidPayments(Z).length, 1);
eq('calc.voidCount 记到 1', calc(B()).voidCount, 1);
eq('calc.payCount 少一笔', calc(B()).payCount, 87);
near('账单已付随之下降', calc(B()).paid, 188529.11 - zAmt);

// 幂等：重复作废不产生新记录、不再改金额
const paidAfterVoid = paidOf(Z);
const v2r = store.voidPayment(Z.id, 0, true);
eq('重复作废幂等（msg 为空）', v2r.msg, '');
near('重复作废金额不再变', paidOf(Z), paidAfterVoid);

// 编辑作废付款：不能顺手“复活”
const editR = store.upsertPayment(Z.id, {
  date: Z.payments[0].date, method: Z.payments[0].method, amount: zAmt, note: '改备注', ref: '',
}, 0, { force: true });
is('编辑作废付款成功', editR.ok);
eq('编辑后仍为作废态', Z.payments[0].void, true);
eq('编辑后 pid 不变', Z.payments[0].pid, zPid);
near('编辑后金额仍不计入已付', paidOf(Z), paidAfterVoid);

const v3r = store.voidPayment(Z.id, 0, false);
near('恢复后已付回到原值', paidOf(Z), zPaid);
near('恢复后待付回到原值', dueOf(Z), zDue);
eq('恢复后 voidCount 归 0', calc(B()).voidCount, 0);
eq('恢复后 pid 依然不变', Z.payments[0].pid, zPid);
eq('恢复提示含金额', /已恢复/.test(v3r.msg), true);

section('C5 作废不参与重复检测 / 趋势 / 体检');
freshBoot();
// 必须挑一笔**有日期**的付款：无日期付款在 upsertPayment 里本就会被「请填写付款日期」挡住，测不出 C5
const W = B().projects.find((p) => (p.payments || []).some((x) => x.date));
const wIdx = W.payments.findIndex((x) => x.date);
const w0 = W.payments[wIdx];
const wLen = W.payments.length;
const mpBefore = monthlyPayments(B());
const mKey = String(w0.date).slice(0, 7);
store.voidPayment(W.id, wIdx, true);
const mpAfter = monthlyPayments(B());
near('月度趋势排除作废金额',
  (mpBefore.values[mpBefore.months.indexOf(mKey)] || 0) - (mpAfter.values[mpAfter.months.indexOf(mKey)] || 0),
  w0.amount);
const dupTry = store.upsertPayment(W.id, {
  date: w0.date, method: w0.method, amount: w0.amount, note: '重记', ref: '',
}, -1);
is('作废后同日期同额同方式可重新记（不被自己挡住）', dupTry.ok);
eq('重记走新增而不是 dup 拦截', dupTry.dup, undefined);
eq('重记后流水 +1', W.payments.length, wLen + 1);

// 体检：作废付款即使没有日期也不再报「付款缺少日期」—— 用「增量」判定，不依赖种子里的历史无日期笔数
freshBoot();
// 挑一笔**本来有日期**的付款来清空，否则「本来就没日期」的笔数会污染增减判断
const C = B().projects.find((p) => (p.payments || []).some((x) => x.date));
const ci = C.payments.findIndex((x) => x.date);
const noDateCount = () => (checkup(B()).issues.find((i) => i.code === 'pay-no-date') || {}).count || 0;
const noDateBefore = noDateCount();
C.payments[ci].date = '';
C.payments[ci].void = true;
const noDateVoid = noDateCount();
eq('作废付款缺日期不进体检（人数不增）', noDateVoid, noDateBefore);
C.payments[ci].void = false;
const noDateActive = noDateCount();
eq('恢复为有效后又进体检（+1）', noDateActive, noDateBefore + 1);

section('C5 作废状态可往返（导出「作废」列）');
freshBoot();
const V = B().projects.find((p) => (p.payments || []).length >= 1);
const vAmt = V.payments[0].amount;
store.voidPayment(V.id, 0, true);
const paidV = paidOf(V);
const csvV = payCsv();
const tv = readTable('pay', csvV);
eq('导出含 1 行作废', tv.good.filter((r) => r.voidFlag).length, 1);
const rv = store.importTable('pay', tv.good, 'overwrite');
eq('往返导入：覆盖 88', rv.overwritten, 88);
eq('往返导入：新增 0', rv.imported, 0);
near('往返后已付不变（作废没被复活）', paidOf(V), paidV);
eq('往返后仍为作废', V.payments[0].void, true);

/* ================= 5. C4 批量付款 ================= */
section('C4 分配算法（planBatchPay）');
freshBoot();
const ids3 = B().projects.filter((p) => dueOf(p) > 0).slice(0, 3).map((p) => p.id);
eq('够 3 条待付项目', ids3.length, 3);
const pA = store.planBatchPay(ids3, 10000, 'due');
is('比例分配 ok', pA.ok);
eq('比例分配 3 行', pA.rows.length, 3);
near('比例分配 Σ = 10000', round2(pA.rows.reduce((s, r) => s + r.amount, 0)), 10000);
is('比例分配：待付最多的一项分到最多', Math.max(...pA.rows.map((r) => r.amount))
  === pA.rows[pA.rows.reduce((bi, r, i, a) => (a[bi].due >= r.due ? bi : i), 0)].amount);
eq('比例分配无超付', pA.over, 0);
const pE = store.planBatchPay(ids3, 10000, 'even');
near('均分 Σ = 10000', round2(pE.rows.reduce((s, r) => s + r.amount, 0)), 10000);
eq('均分前两笔相同', pE.rows[0].amount, pE.rows[1].amount);
eq('均分最后一笔吸收分角差', pE.rows[2].amount, round2(10000 - pE.rows[0].amount - pE.rows[1].amount));

// 余数收敛：3 项各 100，分 100
const tinyIds = [];
const tiny = clone(B());
tiny.projects = [1, 2, 3].map((i) => ({
  id: `t${i}`, no: `T000${i}`, cat: '材料费', sub: '材料费', object: '甲',
  date: '2026-01-01', total: 100, discount: 0, remark: `t${i}`,
  details: [{ name: 'x', unit: '项', qty: 1, price: 100, amount: 100, craft: '', note: '', est: '否' }],
  payments: [],
}));
store.state.books.push({ ...tiny, id: 'btiny', name: 'tiny', budget: {}, categories: [], payees: [] });
const prevActive = store.state.activeBookId;
store.state.activeBookId = 'btiny';
tinyIds.push('t1', 't2', 't3');
const pT = store.planBatchPay(tinyIds, 100, 'due');
eq('三分之一分配：33.33 / 33.33 / 33.34',
  pT.rows.map((r) => r.amount).join(' / '), '33.33 / 33.33 / 33.34');
near('三分之一分配 Σ 精确 = 100', round2(pT.rows.reduce((s, r) => s + r.amount, 0)), 100);
const pOver = store.planBatchPay(tinyIds, 400, 'due');
eq('超付被识别', pOver.over, 100);
near('超付时 Σ 仍等于总额', round2(pOver.rows.reduce((s, r) => s + r.amount, 0)), 400);
eq('总额 0 被拒', store.planBatchPay(tinyIds, 0, 'due').ok, false);
eq('无待付项被拒', store.planBatchPay([], 100, 'due').ok, false);
store.state.activeBookId = prevActive;

section('C4 落库与撤销');
freshBoot();
const targets = B().projects.filter((p) => dueOf(p) > 0).slice(0, 3);
const tids = targets.map((p) => p.id);
const dueBefore = round2(targets.reduce((s, p) => s + dueOf(p), 0));
const paidBeforeAll = calc(B()).paid;
const rowsBefore = payRows(B()).length;
const br = store.batchPay(tids, 10000, { mode: 'due', date: '2026-06-01', method: '银行卡', note: '月底结清' });
is('批量付款 ok', br.ok);
eq('新增 3 笔', br.count, 3);
eq('流水行数 +3', payRows(B()).length, rowsBefore + 3);
near('三笔待付合计减少 10000', dueBefore - round2(targets.reduce((s, p) => s + dueOf(p), 0)), 10000);
near('总已付增加 10000', calc(B()).paid - paidBeforeAll, 10000);
is('每笔都带唯一 pid', targets.every((p) => {
  const ids = p.payments.map((x) => x.pid);
  return new Set(ids).size === ids.length && ids.every((x) => PID_RE.test(x));
}));
is('日期 / 方式 / 备注写入正确', targets.every((p) => {
  const last = p.payments[p.payments.length - 1];
  return last.date === '2026-06-01' && last.method === '银行卡' && last.note === '月底结清' && last.void === false;
}));
const undoRes = store.undo();
eq('撤销返回 {ok:true}', undoRes.ok, true);
near('撤销后总已付回到原值', calc(B()).paid, paidBeforeAll);
eq('撤销后流水行数回到原值', payRows(B()).length, rowsBefore);
// undo 会 normalizeBook 重建 projects 对象，targets 里是旧引用 —— 必须按 id 重新取
eq('撤销是一步到位（三笔同时消失）', tids.every((id) => {
  const p = B().projects.find((x) => x.id === id);
  return p && p.payments.every((x) => x.date !== '2026-06-01');
}), true);

section('C4 批量付款不碰作废 / 不虚增');
freshBoot();
const M = B().projects.filter((p) => dueOf(p) > 0).slice(0, 2);
const mIds = M.map((p) => p.id);
const mDue = round2(M.reduce((s, p) => s + dueOf(p), 0));
const mPaid = calc(B()).paid;
const plan = store.planBatchPay(mIds, mDue, 'due');
near('按待付合计一次结清：Σ 等于待付合计', round2(plan.rows.reduce((s, r) => s + r.amount, 0)), mDue);
store.batchPay(mIds, mDue, { mode: 'due' });
near('结清后这两项待付为 0', round2(M.reduce((s, p) => s + dueOf(p), 0)), 0);
near('已付增量 = 待付合计', calc(B()).paid - mPaid, mDue);
eq('这两项状态变已付', M.every((p) => statOf(p).status === 'paid'), true);

/* ================= 6. 汇总 ================= */
lines.push('');
lines.push(`PASS_TOTAL ${pass}`);
lines.push(`FAIL_TOTAL ${fail}`);
console.log(lines.join('\n'));
if (fail) {
  console.log('\n--- 失败明细 ---');
  failures.forEach((f) => console.log(`  · ${f}`));
}
process.exit(fail ? 1 : 0);

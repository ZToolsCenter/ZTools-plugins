/**
 * T02 自验：store 接线（快照 / 付款字段 / 预算同步 / 体检修复）
 * 用法：npx esbuild scripts/verify-t02.mjs --bundle --platform=node --format=esm --define:process.env.NODE_ENV='"development"' --outfile=/tmp/t02.mjs && node /tmp/t02.mjs
 */
import './fake-ls.mjs';
import * as store from '../src/lib/store.js';
import { SNAP_KEY, listSnaps, loadSnaps } from '../src/lib/snapshot.js';
import { calc, sumBudget, checkup, statusOf, todayLocal } from '../src/lib/core.js';

const out = [];
const ok = (label, actual, expected) => {
  const pass = String(actual) === String(expected);
  out.push(`${pass ? 'PASS' : 'FAIL'} ${label}: ${actual}${pass ? '' : ` (期望 ${expected})`}`);
};

const readSnapKey = () => JSON.parse(localStorage.getItem(SNAP_KEY) || '{"v":1,"items":[]}');
const writeSnapKey = (d) => localStorage.setItem(SNAP_KEY, JSON.stringify(d));

/* 1. 冷启动 → 1 条 daily */
ok('boot.ok', store.boot().ok, true);
let snap = readSnapKey();
ok('冷启动 items.length', snap.items.length, 1);
ok('kind', snap.items[0].kind, 'daily');
ok('reason', snap.items[0].reason, 'daily');
ok('stat.items', snap.items[0].stat.items, 71);
ok('stat.payable', snap.items[0].stat.payable, 246055.97);
ok('stat.paid', snap.items[0].stat.paid, 188529.11);
ok('stat.due', snap.items[0].stat.due, 57526.86);
ok('imgDropped（默认无图）', snap.items[0].imgDropped, 0);

/* 2. 同日再启动 → 仍 1 条 */
store.boot();
ok('同日再启动 items.length', readSnapKey().items.length, 1);

/* 3. 把 day 改成昨天再启动 → 2 条 */
const d2 = readSnapKey();
d2.items[0].day = '2000-01-01';
writeSnapKey(d2);
store.boot();
ok('改昨天后 items.length', readSnapKey().items.length, 2);
ok('新条目 day 为今天', readSnapKey().items[1].day, todayLocal());

/* 4. importState → 出现 reason === 'import' 的 pre */
const backup = JSON.parse(JSON.stringify({ books: store.state.books, activeBookId: store.state.activeBookId, templates: [], warnThreshold: 0.8 }));
const rImp = store.importState(backup);
ok('importState.ok', rImp.ok, true);
const preImp = listSnaps().filter((x) => x.reason === 'import');
ok('import 前快照数', preImp.length, 1);
ok('import 前快照 kind', preImp[0].kind, 'pre');

/* 5. 改一条明细金额 → 回滚 → 金额复原 + before-rollback 新增 */
const dailyId = listSnaps().filter((x) => x.kind === 'daily').sort((a, b) => a.ts - b.ts)[0].id;
const target = store.book.value.projects[0];
store.upsertDetail(target.id, { name: 'T02 注入', unit: '项', est: '否', qty: 1, price: 1000, amount: 1000, craft: '', note: '' }, -1);
ok('改后应付 ≠ 基线', store.stats.value.payable !== 246055.97, true);
const rRes = store.restoreSnapshot(dailyId);
ok('restoreSnapshot.ok', rRes.ok, true);
ok('回滚后 payable', store.stats.value.payable, 246055.97);
ok('回滚后 paid', store.stats.value.paid, 188529.11);
ok('回滚后 remain', store.stats.value.remain, 57526.86);
ok('新增 before-rollback 快照', listSnaps().filter((x) => x.reason === 'before-rollback').length, 1);
ok('回滚后 5 秒撤销已清空', store.canUndo(), false);

/* 6. 新增付款不填日期 → 被拦 */
const pid = store.book.value.projects[0].id;
const rPay = store.upsertPayment(pid, { date: '', method: '微信', amount: 100 }, -1);
ok('新增付款无日期 ok === false', rPay.ok, false);
ok('新增付款无日期 msg', rPay.msg, '请填写付款日期');
const payLenBefore = store.book.value.projects.find((p) => p.id === pid).payments.length;
ok('付款条数未变', store.book.value.projects.find((p) => p.id === pid).payments.length, payLenBefore);

/* 6b. 编辑历史无日期记录：允许保留空日期 */
const noDateIdx = store.book.value.projects.flatMap((p) => p.payments.map((py, i) => ({ p, i, py }))).find((x) => !x.py.date);
ok('存在历史无日期付款', !!noDateIdx, true);
const rEdit = store.upsertPayment(noDateIdx.p.id, { date: '', method: noDateIdx.py.method, amount: noDateIdx.py.amount, note: 'T02 补备注', ref: 'PZ-001' }, noDateIdx.i);
ok('编辑无日期记录可保存', rEdit.ok, true);
const edited = store.book.value.projects.find((p) => p.id === noDateIdx.p.id).payments[noDateIdx.i];
ok('日期仍为空', edited.date, '');
ok('备注已写入', edited.note, 'T02 补备注');
ok('凭证号已写入', edited.ref, 'PZ-001');
ok('已付未变', store.stats.value.paid, 188529.11);

/* 7. 88 笔付款 7 个键（v1.6 起多 pid / void）/ 金额合计 */
const allPays = store.book.value.projects.flatMap((p) => p.payments);
ok('付款总笔数', allPays.length, 88);
ok('每笔 7 个键', allPays.every((py) => Object.keys(py).length === 7), true);
const sumPays = Math.round(allPays.reduce((s, py) => s + (+py.amount || 0), 0) * 100) / 100;
ok('付款金额合计', sumPays, 188529.11);

/* 8. setBudget → totalBudget 同步 */
store.setBudget('防水工程', 5000);
ok('setBudget 后 totalBudget === sumBudget', store.book.value.totalBudget, sumBudget(store.book.value));

/* 9. fixCheckup：无 fixable 时不写快照 */
const cntBefore = listSnaps().length;
const rFix0 = store.fixCheckup();
ok('无可修项 ok', rFix0.ok, true);
ok('无可修项 msg', rFix0.msg, '没有可自动修复的问题');
ok('无 fixable 不产生新快照', listSnaps().length, cntBefore);

/* 10. 注入 5 类脏数据 → fixCheckup 前后金额严格相等 */
const b = store.book.value;
b.projects[0].cat = '已删除品类';
b.projects[1].object = '已删除收款方';
b.projects[2].total = 99999;
b.projects[3].cat = '';
b.budget['幽灵品类'] = 3000;
b.totalBudget = 1;
const pre = checkup(b);
out.push(`   注入后命中：${pre.issues.map((i) => i.code).join(', ')}`);
const payBefore = store.stats.value.payable;
const paidBefore = store.stats.value.paid;
const dueBefore = store.stats.value.remain;
const cntBefore2 = listSnaps().length;
const rFix = store.fixCheckup();
ok('fixCheckup.ok', rFix.ok, true);
ok('fix deltas.payable', rFix.deltas.payable, 0);
ok('fix deltas.paid', rFix.deltas.paid, 0);
ok('fix deltas.due', rFix.deltas.due, 0);
ok('修复前后 payable 严格相等', store.stats.value.payable, payBefore);
ok('修复前后 paid 严格相等', store.stats.value.paid, paidBefore);
ok('修复前后 due 严格相等', store.stats.value.remain, dueBefore);
ok('修复产生 1 条 checkup-fix 快照', listSnaps().length, cntBefore2 + 1);
ok('快照 reason', listSnaps()[0].reason, 'checkup-fix');
ok('修复后 fixable', checkup(store.book.value).fixable, 0);
// v1.7 C4：体检新增 payee-name-suspect（只报不改），warnable 不再恒为 1。
// 改为「按 code 断言 + warnable 口径断言」，不锁问题总数（以后加规则不必改测试）。
const postFix = checkup(store.book.value);
out.push(`   修复后剩余问题码：${postFix.issues.map((i) => i.code).join(', ') || '无'}`);
ok('修复后仍含 pay-no-date（缺口数据不被伪造）', postFix.issues.some((i) => i.code === 'pay-no-date'), true);
ok('修复后 warnable = 无修复动作的问题条数', postFix.warnable, postFix.issues.filter((i) => !i.fix).length);
ok('修复后 totalBudget === sumBudget', store.book.value.totalBudget, sumBudget(store.book.value));
const names = checkup(store.book.value).issues.map((i) => i.code);
out.push(`   修复后剩余问题：${names.join(', ') || '无'}`);

/* 11. 快照上限 */
const heavy = { v: 1, items: Array.from({ length: 8 }, (_, i) => ({
  id: `h${i}`, ts: 1000 + i, day: `2020-01-0${i + 1}`, kind: 'daily', reason: 'daily', bytes: 1000,
  imgDropped: 0, stat: {}, data: { books: [{ id: 'x', projects: [] }] },
})) };
writeSnapKey(heavy);
store.snapshotNow('daily', 'daily');
ok('8 份 daily 写入后按上限裁到 7', loadSnaps().items.filter((x) => x.kind === 'daily').length, 7);

const fails = out.filter((l) => l.startsWith('FAIL'));
console.log(out.join('\n'));
console.log(`\n=== ${fails.length ? `${fails.length} 项失败` : '全部通过'} ===`);
if (fails.length) process.exitCode = 1;

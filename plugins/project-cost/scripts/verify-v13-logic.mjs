/**
 * v1.3 逻辑自验（QA 独立回归）：R1 / R3 / R4 / R5 / B1 / C2 / C3 / X1 + 版本收尾。
 *
 * 覆盖六条设计红线：
 *  ① 金额链真源三项字面不变（应付 / 已付 / 待付）；
 *  ② B1 只派生不替换（estTotal / confirmedPayable 无副作用，预警与占用率按 confirmed）；
 *  ③ R4 复制绝不带付款（避免虚增已付）；
 *  ④ R5 批量操作不动任何金额字段；
 *  ⑤ C2 只拦截写入时机，取消后金额不变；
 *  ⑥ X1 只填充数据，落库前有 pushUndo + snapshotNow('pre','import')。
 *
 * 用法：
 *   npx esbuild scripts/verify-v13-logic.mjs --bundle --platform=node --format=esm \
 *     --define:process.env.NODE_ENV='"development"' --outfile=/tmp/v13-logic.mjs && node /tmp/v13-logic.mjs
 */
import './fake-ls.mjs';
import fs from 'node:fs';
import path from 'node:path';
import * as store from '../src/lib/store.js';
import { listSnaps } from '../src/lib/snapshot.js';
import {
  calc, catRows, catBudgetHint, buildAlerts, estAmountOf, confirmedPayableOf,
  payableOf, paidOf, dueOf, round2, nextNo, normDate, statOf, statusText,
} from '../src/lib/core.js';
import { parseDelimited, TABLE_COLS, mapRow, isHeaderRow, alignByHeader } from '../src/lib/parse.js';
import { HEADS, projRows, detailRows, payRows, exportStatementCsv } from '../src/lib/export.js';

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

const ROOT = process.cwd();
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
function freshBoot() {
  try { localStorage.clear(); } catch (_) { /* fake-ls 一定成功 */ }
  const r = store.boot();
  return r;
}
/** 与 ItemSheet.vue 的 `batchRows` 同规则（品名/单位/数量/单价 → 金额 + ok） */
function pastePreview(text) {
  return parseDelimited(text).map((cols) => {
    const name = (cols[0] || '').trim();
    const unit = (cols[1] || '').trim();
    const qty = +((cols[2] ?? '').trim() || 0);
    const price = +((cols[3] ?? '').trim() || 0);
    const amount = round2(qty * price);
    const ok = !!name && qty > 0 && price > 0;
    return { name, unit, qty, price, amount, ok };
  });
}
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvOf = (head, rows) => `\uFEFF${[head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')}`;
/** 把 CSV 文本按「表头对齐 → mapRow」翻译为可导入行（与 SettingsView.onImpFile 同步骤） */
function toImportRows(table, text) {
  const grid = parseDelimited(text);
  const hasHead = isHeaderRow(table, grid[0]);
  const header = hasHead ? grid[0] : null;
  const body = hasHead ? grid.slice(1) : grid;
  const good = [];
  const bad = [];
  body.forEach((cells) => {
    const aligned = header ? alignByHeader(table, header, cells) : cells;
    const r = mapRow(table, aligned);
    if (r.error) bad.push(r);
    else good.push(r);
  });
  return { good, bad, hasHead, grid };
}

/* ================================================================= R1 */
section('R1 明细批量粘贴 — parseDelimited（纯函数）');
eq('TSV 基本解析', JSON.stringify(parseDelimited('a\tb\n1\t2')), JSON.stringify([['a', 'b'], ['1', '2']]));
eq('空行/纯空白行被丢弃', parseDelimited('\n\na\tb\n\n1\t2\n   \n').length, 2);
eq('CRLF 兼容', parseDelimited('a,b\r\n1,2').length, 2);
eq('CSV 引号内含逗号', JSON.stringify(parseDelimited('"砂子, 河沙",方,10,210')[0]),
  JSON.stringify(['砂子, 河沙', '方', '10', '210']));
eq('CSV 双引号转义还原', JSON.stringify(parseDelimited('"a""b",c')[0]), JSON.stringify(['a"b', 'c']));
eq('单元格 trim', JSON.stringify(parseDelimited(' 甲 , 乙 ')[0]), JSON.stringify(['甲', '乙']));
eq('空文本 → []', parseDelimited('').length, 0);
eq('null 安全', parseDelimited(null).length, 0);
eq('只有空白 → []', parseDelimited('   \n\n').length, 0);

const TSV10 = [
  '砂子\t方\t10\t210',
  '水泥\t包\t20\t25.5',
  '红砖\t块\t500\t0.8',
  '腻子\t包\t12\t45',
  '乳胶漆\t桶\t3\t380',
  '瓷砖\tm2\t25\t88',
  '防水涂料\t桶\t2\t460',
  '石膏线\t米\t30\t12',
  '木方\t根\t40\t18.6',
  '钉子\t盒\t5\t12',
].join('\n');
const SUM10 = 8974; // 2100+510+400+540+1140+2200+920+360+744+60
const grid10 = parseDelimited(TSV10);
eq('10 行 4 列 → 10 行', grid10.length, 10);
eq('每行均 4 列', grid10.every((r) => r.length === 4), true);

section('R1 明细批量粘贴 — 预览口径（金额 = 数量 × 单价 / 坏行剔除）');
const preview10 = pastePreview(TSV10);
eq('有效行 10', preview10.filter((r) => r.ok).length, 10);
near('有效合计 = 8974', preview10.reduce((s, r) => s + (r.ok ? r.amount : 0), 0), SUM10);
eq('首行金额 = 10 × 210', preview10[0].amount, 2100);
eq('小数单价 20 × 25.5', preview10[1].amount, 510);

const MIXED = `${TSV10}\n\t方\t5\t100\n沙子2\t方\tabc\t100\n`;
const mixed = pastePreview(MIXED);
eq('混合文本 12 行', mixed.length, 12);
eq('坏行 2 行被标记 ok=false', mixed.filter((r) => !r.ok).length, 2);
eq('缺品名行判坏', mixed[10].ok, false);
eq('数量非数字行判坏', mixed[11].ok, false);
near('坏行不参与合计（仍 8974）', mixed.reduce((s, r) => s + (r.ok ? r.amount : 0), 0), SUM10);

section('R1 明细批量粘贴 — 落库链（upsertDetail 逐条 → 总计/应付联动）');
freshBoot();
{
  const p = store.book.value.projects.find((x) => (x.details || []).length > 0);
  const n0 = p.details.length;
  const sum0 = round2(p.details.reduce((s, d) => s + (+d.amount || 0), 0));
  const payableBook0 = store.stats.value.payable;
  mixed.filter((r) => r.ok).forEach((r) => {
    const ret = store.upsertDetail(p.id, {
      name: r.name, unit: r.unit, est: '否', qty: r.qty, price: r.price, amount: r.amount, craft: '', note: '',
    }, -1);
    if (!ret.ok) eq('upsertDetail 返回 ok', ret.ok, true);
  });
  const p2 = store.book.value.projects.find((x) => x.id === p.id);
  eq('明细条数 +10', p2.details.length, n0 + 10);
  near('费用项总计 = 原合计 + 8974', p2.total, sum0 + SUM10);
  near('账套应付 +8974', store.stats.value.payable, payableBook0 + SUM10);
  eq('坏行未落库（无空品名明细）', p2.details.filter((d) => !d.name).length, 0);
  const amt = p2.details.slice(-10).map((d) => d.amount);
  eq('末 10 条金额 = 数量×单价', JSON.stringify(amt),
    JSON.stringify(preview10.map((r) => r.amount)));
}

/* ================================================================= R3 */
section('R3 品名历史单价联想 — namePriceIndex（取最近一条 / 不落库）');
freshBoot();
{
  const bk = store.book.value;
  const bid = bk.id;
  eq('返回 Map', store.namePriceIndex() instanceof Map, true);
  // 造两条同名历史：旧项目 2020（单价 100）→ 新项目 2026（单价 210）
  store.upsertProject({
    no: 'ZX9001', date: '2020-01-01', due: '', cat: bk.categories[0].name, sub: '材料费',
    remark: 'QA-R3-旧', total: 100, discount: 0, object: '',
  });
  const oldP = store.book.value.projects.find((x) => x.no === 'ZX9001');
  store.upsertDetail(oldP.id, { name: 'QA砂子', unit: '方', est: '否', qty: 1, price: 100, amount: 100, craft: '', note: '' }, -1);
  store.upsertProject({
    no: 'ZX9002', date: '2026-01-01', due: '', cat: bk.categories[0].name, sub: '材料费',
    remark: 'QA-R3-新', total: 210, discount: 0, object: '',
  });
  const newP = store.book.value.projects.find((x) => x.no === 'ZX9002');
  store.upsertDetail(newP.id, { name: 'QA砂子', unit: '方', est: '否', qty: 1, price: 210, amount: 210, craft: '', note: '' }, -1);
  eq('索引已失效重建（项目数变化）', store.book.value.projects.length > 71, true);
  const hit = store.namePriceIndex().get('QA砂子');
  eq('同品名取最近一条的单价', hit.price, 210);
  eq('同品名取最近一条的单位', hit.unit, '方');
  eq('品名首次出现 → 无联想', store.namePriceIndex().get('QA不存在品名'), undefined);
  const seedHit = store.namePriceIndex().get('砂子');
  is('种子台账「砂子」进入索引', !!seedHit);
  // 「索引不落库」的可验证形态：主键里不能出现索引自身的结构（Map 无法序列化 →
  // 若被写进 state 会变成 {} 或抛错），且 state 顶层不得新增 namePrice 一类字段。
  eq('索引不在 state 上（无 namePrice 字段）', Object.keys(store.state).some((k) => /namePrice/i.test(k)), false);
  eq('主键里不含索引结构（namePrice 字样）', /namePrice/i.test(localStorage.getItem(store.KEY) || ''), false);
  eq('切账套不影响 id 基准', store.state.books[0].id, bid);
}

/* ================================================================= B1 */
section('B1 双口径 — 派生量基线（真源三项字面不变）');
freshBoot();
const b1c = store.stats.value;
{
  eq('应付', b1c.payable, 246055.97);
  eq('已付', b1c.paid, 188529.11);
  eq('待付（全口径）', b1c.remain, 57526.86);
  eq('预算合计', b1c.totalBudget, 234688);
  eq('结余', b1c.balance, -11367.97);
  eq('费用项 / 明细 / 付款', `${b1c.count}/${b1c.detailCount}/${b1c.payCount}`, '71/384/88');
  eq('estTotal（预估合计）', b1c.estTotal, 14875);
  eq('confirmedPayable（确定应付）', b1c.confirmedPayable, 231180.97);
  near('confirmedPayable = payable − estTotal', b1c.confirmedPayable, round2(b1c.payable - b1c.estTotal));
  near('待付 = 应付 − 已付（真源同口径）', b1c.remain, round2(b1c.payable - b1c.paid));
  const estDetails = store.book.value.projects.flatMap((p) => (p.details || []).filter((d) => d.est === '是'));
  eq('est=是 明细条数', estDetails.length, 3);
  near('Σ est 明细金额 = estTotal', estDetails.reduce((s, d) => s + (+d.amount || 0), 0), 14875);
  const sumConfirmed = round2(Object.values(b1c.byCat).reduce((s, x) => s + (x.confirmed || 0), 0));
  const sumEst = round2(Object.values(b1c.byCat).reduce((s, x) => s + (x.est || 0), 0));
  near('Σ byCat.confirmed = confirmedPayable', sumConfirmed, 231180.97);
  near('Σ byCat.est = estTotal', sumEst, 14875);
  const rows = catRows(store.book.value);
  eq('catRows 行数', rows.length, 14);
  eq('catRows 每行含 confirmed/est', rows.every((r) => r.confirmed !== undefined && r.est !== undefined), true);
  near('Σ catRows.confirmed = confirmedPayable', round2(rows.reduce((s, r) => s + r.confirmed, 0)), 231180.97);

  // 占用率/差额改按 confirmed（挑一个含预估的品类逐位核对）
  const estCat = Object.keys(b1c.byCat).find((k) => b1c.byCat[k].est > 0 && b1c.byCat[k].budget > 0);
  is('存在既有预算又有预估的品类（用例前提）', !!estCat);
  const row = rows.find((r) => r.name === estCat);
  near(`占用率按 confirmed（${estCat}）`, row.rate, round2((row.confirmed / row.budget) * 100 * 100) / 100, 0.01);
  near(`差额按 confirmed（${estCat}）`, row.diff, round2(row.budget - row.confirmed));
  near(`amount 仍是含预估的应付（${estCat}）`, row.amount, round2(b1c.byCat[estCat].amount));
}

section('B1 双口径 — catBudgetHint 与 calc().byCat 同口径');
{
  const bk = store.book.value;
  const cat = '泥瓦镶贴工程';
  const usedConfirmed = round2(bk.projects.filter((p) => p.cat === cat).reduce((s, p) => s + confirmedPayableOf(p), 0));
  const usedPayable = round2(bk.projects.filter((p) => p.cat === cat).reduce((s, p) => s + payableOf(p), 0));
  const h = catBudgetHint(bk, cat, 8000, '');
  near('used = Σ confirmedPayableOf（确定应付）', h.used, usedConfirmed);
  eq('used ≠ 含预估的应付口径（B1 已切换）', h.used === usedPayable, false);
  near('used 与 calc().byCat.confirmed 一致', h.used, round2(b1c.byCat[cat].confirmed));
  eq('state', h.state, 'over');
  near('over = 本笔后超支额', h.over, round2(Math.max(h.used + 8000 - h.budget, 0)));
  const first = bk.projects.find((p) => p.cat === cat);
  const hEx = catBudgetHint(bk, cat, 8000, first.id);
  near('excludeId 排除自身（按 confirmed）', hEx.used, round2(usedConfirmed - confirmedPayableOf(first)));
}

section('B1 双口径 — 派生函数无副作用（真源零写入）');
{
  const bk = store.book.value;
  const snapBefore = JSON.stringify(bk);
  calc(bk); catRows(bk); buildAlerts(bk); catBudgetHint(bk, '泥瓦镶贴工程', 8000, '');
  estAmountOf(bk.projects[0]); confirmedPayableOf(bk.projects[0]);
  eq('calc/catRows/buildAlerts/catBudgetHint 不 mutate book', JSON.stringify(bk) === snapBefore, true);
  near('单条 confirmedPayableOf = payableOf − estAmountOf',
    confirmedPayableOf(bk.projects[0]), round2(payableOf(bk.projects[0]) - estAmountOf(bk.projects[0])));
  // 导出行仍用真源「应付」（B1 不得替换导出）
  const sample = projRows(bk, statOf, statusText)[0];
  near('导出「应付」列 = payableOf（非确定应付）', sample[8], payableOf(bk.projects[0]));
}

section('B1 双口径 — 预估不触发预警（临界/超支只看确定应付）');
{
  const mk = (amount, est, budget) => ({
    id: 'b', name: 'T', budget: { A: budget }, totalBudget: budget, warnThreshold: 0.8,
    categories: [{ name: 'A', color: '#000', note: '' }], payees: [],
    projects: [{ id: 'p1', no: 'ZX1', date: '2026-01-01', due: '', cat: 'A', sub: '材料费', remark: 'T', object: '', discount: 0, payments: [], details: [{ name: 'd', unit: '', est, qty: 1, price: amount, amount, craft: '', note: '' }] }],
  });
  const onlyEst = mk(1200, '是', 1000); // 全预估、金额超预算
  const cEst = calc(onlyEst);
  eq('全预估：应付含预估 1200', cEst.payable, 1200);
  eq('全预估：确定应付 0', cEst.confirmedPayable, 0);
  eq('全预估：超支品类数 0', cEst.overCount, 0);
  const aEst = buildAlerts(onlyEst);
  eq('全预估：预警 over 0 项', aEst.over.length, 0);
  eq('全预估：预警 near 0 项', aEst.near.length, 0);
  eq('全预估：catBudgetHint 未超支', catBudgetHint(onlyEst, 'A', 0, '').state, 'ok');

  const confirmed = mk(1200, '否', 1000);
  eq('转确定：确定应付 1200', calc(confirmed).confirmedPayable, 1200);
  eq('转确定：超支品类数 1', calc(confirmed).overCount, 1);
  eq('转确定：预警 over 1 项', buildAlerts(confirmed).over.length, 1);

  const nearCase = mk(900, '否', 1000);
  eq('900/1000：临界 near 1 项', buildAlerts(nearCase).near.length, 1);
  eq('900/1000：未超支', buildAlerts(nearCase).over.length, 0);
}

/* ================================================================= C2 */
section('C2 重复检测 — 付款（同日期+同金额+同方式）');
freshBoot();
{
  const bk = store.book.value;
  const p = bk.projects.find((x) => (x.payments || []).length > 0);
  const payIdx = p.payments.length;
  const rec = { date: '2026-05-01', method: '微信', amount: 1234.55 };
  eq('首笔写入 ok', store.upsertPayment(p.id, rec, -1, { force: true }).ok, true);
  eq('付款条数 +1', p.payments.length, payIdx + 1);
  const paidAfterFirst = calc(bk).paid;
  // 「编辑既有记录排除自身」必须在库里只有它一条同值记录时验（否则命中的是别的记录，
  // 属正常判重而非误拦）——因此放在制造第二笔重复之前。
  const editSelf = store.upsertPayment(p.id, rec, payIdx);
  eq('编辑既有记录排除自身', editSelf.ok, true);
  const dup = store.upsertPayment(p.id, rec, -1);
  eq('二次提交命中 dup', dup.dup, true);
  eq('二次提交 ok=false', dup.ok, false);
  is('提示含「疑似重复」', /疑似重复/.test(dup.msg));
  eq('取消（不 force）后条数不变', p.payments.length, payIdx + 1);
  near('取消后已付不变', calc(bk).paid, paidAfterFirst);
  const forced = store.upsertPayment(p.id, rec, -1, { force: true });
  eq('force 可强制写入', forced.ok, true);
  eq('force 后条数 +1', p.payments.length, payIdx + 2);
  const otherMethod = store.upsertPayment(p.id, { ...rec, method: '现金' }, -1);
  eq('不同付款方式不判重', otherMethod.ok, true);
  const noDate = store.upsertPayment(p.id, { date: '', method: '微信', amount: 1 }, -1);
  eq('新增付款无日期仍被拦截', noDate.ok, false);
}

section('C2 重复检测 — 费用项（同收款方+同金额+同备注）');
{
  const bk = store.book.value;
  const p = bk.projects.find((x) => (x.payments || []).length > 0);
  const before = bk.projects.length;
  const payload = {
    no: nextNo(bk.projects), date: '2026-05-02', due: '', cat: p.cat, sub: p.sub,
    remark: p.remark, total: payableOf(p), discount: 0, object: p.object,
  };
  const dup = store.upsertProject(payload);
  eq('命中可疑重复支出', dup.dup, true);
  eq('未 force 不落库', store.book.value.projects.length, before);
  const forced = store.upsertProject(payload, { force: true });
  eq('force 落库', forced.ok, true);
  eq('force 后 +1 条', store.book.value.projects.length, before + 1);
  // 编辑自身：选一条 (object,total,remark) 三元组在台账内唯一的费用项
  const uniq = store.book.value.projects.find((x) => {
    const t = round2(payableOf(x));
    return store.book.value.projects.filter((y) => (y.object || '') === (x.object || '')
      && round2(payableOf(y)) === t && (y.remark || '') === (x.remark || '')).length === 1;
  });
  is('存在三元组唯一的费用项（用例前提）', !!uniq);
  const selfEdit = store.upsertProject({
    id: uniq.id, no: uniq.no, date: uniq.date, due: uniq.due, cat: uniq.cat, sub: uniq.sub,
    remark: uniq.remark, total: uniq.total, discount: uniq.discount, object: uniq.object,
  });
  eq('编辑既有费用项排除自身', selfEdit.ok, true);
}

/* ================================================================= R5 */
section('R5 列表多选批量操作 — 只改标签，不动金额');
freshBoot();
{
  const bk = store.book.value;
  const ids = bk.projects.slice(0, 20).map((x) => x.id);
  const payable0 = store.stats.value.payable;
  const paid0 = store.stats.value.paid;
  const remain0 = store.stats.value.remain;
  const original = JSON.parse(JSON.stringify(ids.map((id) => bk.projects.find((p) => p.id === id))));

  const rCat = store.batchSetCategory(ids, 'QA批量品类');
  eq('批量改品类 ok', rCat.ok, true);
  eq('提示条数', rCat.n, 20);
  eq('20 条品类全部改为新值', bk.projects.filter((p) => ids.includes(p.id) && p.cat === 'QA批量品类').length, 20);
  eq('自动补建品类档案', bk.categories.some((c) => c.name === 'QA批量品类'), true);
  near('应付合计不变', store.stats.value.payable, payable0);

  const rPayee = store.batchSetPayee(ids, 'QA批量收款方');
  eq('批量改收款方 ok', rPayee.ok, true);
  eq('20 条收款方全部改为新值', bk.projects.filter((p) => ids.includes(p.id) && p.object === 'QA批量收款方').length, 20);
  eq('自动补建收款方档案', bk.payees.some((x) => x.name === 'QA批量收款方'), true);

  const rDue = store.batchSetDue(ids, '2026/7/1');
  eq('批量改到期日 ok', rDue.ok, true);
  eq('到期日已归一化', bk.projects.find((p) => p.id === ids[0]).due, '2026-07-01');
  eq('20 条到期日一致', bk.projects.filter((p) => ids.includes(p.id) && p.due === '2026-07-01').length, 20);

  near('三项批量改后应付仍不变', store.stats.value.payable, payable0);
  near('已付不变', store.stats.value.paid, paid0);
  near('待付不变', store.stats.value.remain, remain0);
  eq('明细条数不变', store.stats.value.detailCount, 384);
  eq('付款条数不变', store.stats.value.payCount, 88);
  eq('总计字段未被批量操作改写', JSON.stringify(ids.map((id) => bk.projects.find((p) => p.id === id).total)),
    JSON.stringify(original.map((p) => p.total)));

  const countBefore = bk.projects.length;
  const rDel = store.batchDelete(ids);
  eq('批量删除 ok', rDel.ok, true);
  eq('删除条数', rDel.n, 20);
  eq('列表条数 −20', bk.projects.length, countBefore - 20);
  eq('批量删除可撤销（undo 快照存在）', store.canUndo(), true);
  eq('撤销成功', store.undo().ok, true);
  eq('撤销后条数恢复', store.book.value.projects.length, countBefore);
  near('撤销后应付恢复', store.stats.value.payable, payable0);
  // undo 只回退「最后一次操作」（批量删除）；此前的批量改品类/收款方/到期日应保持，
  // 这是 5 秒撤销的既定语义（一次操作一份快照），不是缺陷。
  eq('撤销后品类保持（undo 只回退最后一次删除）',
    store.book.value.projects.find((p) => p.id === ids[0]).cat, 'QA批量品类');
  eq('撤销后删除项已恢复全部字段', store.book.value.projects.find((p) => p.id === ids[0]).no, original[0].no);

  eq('空选择改品类被拒', store.batchSetCategory([], 'X').ok, false);
  eq('空选择删除被拒', store.batchDelete([]).ok, false);
}

/* ================================================================= R4 */
section('R4 费用项复制 — 含明细 / 跨项目 / 不带付款');
freshBoot();
{
  const srcBookId = store.book.value.id;
  const src = store.book.value.projects.find((x) => (x.details || []).length > 0 && (x.payments || []).length > 0);
  const srcCount = store.book.value.projects.length;
  const srcPaid = round2(paidOf(src));
  const b2 = store.createBook('QA门店B');
  store.switchBook(srcBookId); // copyProject 的源恒为「当前打开项目」

  const targetNo = nextNo(b2.projects);
  const r = store.copyProject(b2.id, src.id, { includeDetails: true });
  eq('复制 ok', r.ok, true);
  eq('返回目标 bookId', r.targetBookId, b2.id);
  const cp = b2.projects[b2.projects.length - 1];
  eq('目标 book 项目数 +1', b2.projects.length, 1);
  eq('编号按目标 nextNo 顺延', cp.no, targetNo);
  eq('明细条数与源一致', cp.details.length, src.details.length);
  near('金额与源一致', cp.total, src.total);
  eq('折扣一致', +(cp.discount || 0), +(src.discount || 0));
  eq('品类/收款方/备注一致', `${cp.cat}|${cp.object}|${cp.remark}`, `${src.cat}|${src.object}|${src.remark}`);
  eq('付款绝不复制', (cp.payments || []).length, 0);
  eq('明细是深拷贝（非同一引用）', cp.details[0] !== src.details[0], true);
  near('目标 book 已付 = 0（未虚增）', calc(b2).paid, 0);
  near('目标 book 待付 = 应付（无付款）', calc(b2).remain, calc(b2).payable);
  eq('源 book 项目数不变', store.book.value.projects.length, srcCount);
  near('源费用项已付不变', paidOf(src), srcPaid);
  const nos = b2.projects.map((x) => x.no);
  eq('目标 book 内编号不重号', new Set(nos).size, nos.length);

  // 含明细关闭
  const r2 = store.copyProject(b2.id, src.id, { includeDetails: false });
  eq('不含明细复制 ok', r2.ok, true);
  const cp2 = b2.projects[b2.projects.length - 1];
  eq('不含明细 → details 为空', cp2.details.length, 0);
  eq('不含明细仍保留费用项字段', cp2.remark, src.remark);
  eq('第二条编号也不重号', new Set(b2.projects.map((x) => x.no)).size, b2.projects.length);

  // 复制到当前项目
  const r3 = store.copyProject(srcBookId, src.id, { includeDetails: true });
  eq('复制到当前项目 ok', r3.ok, true);
  eq('源 book 项目数 +1', store.book.value.projects.length, srcCount + 1);

  // 可撤销（copyProject 内部 pushUndo）：undo 只回退最后一次复制（复制到当前项目那一笔），
  // 之前写进目标 book 的两条仍保留 —— 一次操作一份快照的既定语义。
  store.undo();
  eq('撤销后源 book 项目数恢复', store.book.value.projects.length, srcCount);
  eq('撤销只回退最后一次复制（目标 book 仍有前两条）',
    store.state.books.find((b) => b.id === b2.id).projects.length, 2);
}

/* ================================================================= C3 */
section('C3 收款方对账单 — 聚合口径与列表逐分一致');
freshBoot();
const c3book = store.book.value;
const c3 = calc(c3book);
const payeeName = Object.keys(c3.byPayee).sort((a, b) => c3.byPayee[b].amount - c3.byPayee[a].amount)[0];
const c3items = c3book.projects.filter((p) => (p.object || '') === payeeName)
  .map((p) => ({ id: p.id, no: p.no, remark: p.remark, payable: payableOf(p), paid: paidOf(p), due: dueOf(p) }));
const c3pays = [];
c3book.projects.filter((p) => (p.object || '') === payeeName).forEach((p) => {
  (p.payments || []).forEach((py) => c3pays.push({ no: p.no, remark: p.remark, date: py.date, method: py.method, amount: round2(py.amount), note: py.note, ref: py.ref }));
});
const c3sum = {
  payable: round2(c3items.reduce((s, x) => s + x.payable, 0)),
  paid: round2(c3items.reduce((s, x) => s + x.paid, 0)),
  due: round2(c3items.reduce((s, x) => s + x.due, 0)),
};
{
  is('取到金额最大的收款方（用例前提）', !!payeeName);
  near('费用项应付合计 = calc.byPayee.amount', c3sum.payable, round2(c3.byPayee[payeeName].amount));
  near('已付合计 = calc.byPayee.paid', c3sum.paid, round2(c3.byPayee[payeeName].paid));
  near('待付合计 = 应付 − 已付', c3sum.due, round2(c3sum.payable - c3sum.paid));
  eq('付款流水笔数 = 该项目集付款合计', c3pays.length,
    c3book.projects.filter((p) => (p.object || '') === payeeName).reduce((s, p) => s + (p.payments || []).length, 0));
  near('已付合计 = Σ 付款流水金额', c3sum.paid, round2(c3pays.reduce((s, x) => s + x.amount, 0)));

  // CSV 导出：node 侧打桩 document / URL，捕获 Blob 文本
  const captured = [];
  const origDoc = globalThis.document;
  const origCreate = globalThis.URL.createObjectURL;
  const origRevoke = globalThis.URL.revokeObjectURL;
  globalThis.document = {
    createElement: () => ({ href: '', download: '', style: {}, click() {}, remove() {} }),
    body: { appendChild() {} },
  };
  globalThis.URL.createObjectURL = (blob) => { captured.push(blob); return 'blob:qa'; };
  globalThis.URL.revokeObjectURL = () => {};
  let ret = null;
  let csvBytes = null;
  let csvText = '';
  try {
    ret = exportStatementCsv(payeeName, c3items, c3pays, '2026-10-27');
    csvBytes = new Uint8Array(await captured[0].arrayBuffer());
    csvText = await captured[0].text();
  } finally {
    globalThis.document = origDoc;
    globalThis.URL.createObjectURL = origCreate;
    globalThis.URL.revokeObjectURL = origRevoke;
  }
  eq('导出返回 ok（生成 1 个文件）', captured.length, 1);
  // Blob.text() 按规范会吞掉 UTF-8 BOM，所以查原始字节
  eq('CSV 字节以 UTF-8 BOM 开头',
    [csvBytes[0], csvBytes[1], csvBytes[2]].join(','), '239,187,191');
  is('含「# 费用项」段', csvText.includes('# 费用项'));
  is('含「# 付款流水」段', csvText.includes('# 付款流水'));
  is('含「# 小计」段', csvText.includes('# 小计'));
  is('小计行含三数（应付/已付/待付）',
    csvText.includes([c3sum.payable, c3sum.paid, c3sum.due].join(',')));
  near('返回值应付小计', ret.sumPayable, c3sum.payable);
  near('返回值已付小计', ret.sumPaid, c3sum.paid);
  near('返回值待付小计', ret.sumDue, c3sum.due);
  eq('返回值笔数', `${ret.items}/${ret.pays}`, `${c3items.length}/${c3pays.length}`);
  eq('不写 localStorage（对账单生成即弃）', /对账单/.test(localStorage.getItem(store.KEY) || ''), false);
}

/* ================================================================= X1 */
section('X1 CSV 导入 — 明细表回读（导出 → 改 2 行金额 → 按编号覆盖）');
freshBoot();
{
  const bk = store.book.value;
  const n0 = store.stats.value.detailCount;
  const payable0 = store.stats.value.payable;
  const head = HEADS.detail;
  const rows = detailRows(bk);
  eq('导出明细行数', rows.length, 384);
  const parsed = toImportRows('detail', csvOf(head, rows));
  eq('表头被识别（导出的明细表 12 列）', parsed.hasHead, true);
  eq('全部行通过校验（无坏行）', parsed.bad.length, 0);
  eq('回读行数 = 384', parsed.good.length, 384);
  eq('回读后列数与 TABLE_COLS 一致', Object.keys(parsed.good[0]).length, TABLE_COLS.detail.length);

  // 手改 2 行金额（与 PRD X1 验收「导出 → 手改 2 行金额 → 覆盖导入」一致）
  const mod = parsed.good.slice();
  const target1 = mod[0];
  const target2 = mod[5];
  target1.amount = round2(target1.amount + 100);
  target2.amount = round2(target2.amount + 100);
  const rImp = store.importTable('detail', [target1, target2], 'overwrite');
  eq('覆盖导入 ok', rImp.ok, true);
  eq('覆盖 2 行', rImp.overwritten, 2);
  eq('新增 0 行', rImp.imported, 0);
  eq('明细总条数不变', store.stats.value.detailCount, n0);
  near('应付 +200', store.stats.value.payable, payable0 + 200);
  const p1 = store.book.value.projects.find((x) => x.no === target1.no);
  is('改后的金额已落库', p1.details.some((d) => round2(d.amount) === round2(target1.amount)));
  near('费用项总计由明细链重算', p1.total, round2(p1.details.reduce((s, d) => s + (+d.amount || 0), 0)));

  const rSkip = store.importTable('detail', [target1], 'skip');
  eq('skip 策略：跳过已存在', rSkip.skipped, 1);
  eq('skip 策略：不覆盖', rSkip.overwritten, 0);
  eq('skip 策略：条数不变', store.stats.value.detailCount, n0);

  const newRow = { no: target1.no, name: 'QA-X1-新增明细', unit: '项', qty: 1, price: 777, amount: 777, craft: '', note: '', est: '否' };
  const rAppend = store.importTable('detail', [newRow], 'append');
  eq('append 策略：新增 1 条', rAppend.imported, 1);
  eq('append 后明细 +1', store.stats.value.detailCount, n0 + 1);
  near('append 后应付 +777', store.stats.value.payable, payable0 + 200 + 777);
  const rAppendDup = store.importTable('detail', [newRow], 'append');
  eq('append 去重键（项目号+品名+金额）命中 → 覆盖而非重复新增', rAppendDup.imported, 0);
  eq('append 去重后条数不变', store.stats.value.detailCount, n0 + 1);
  eq('明细行缺项目号 → 跳过', store.importTable('detail', [{ ...newRow, no: 'ZX0000' }], 'append').skipped, 1);
}

section('X1 CSV 导入 — 付款表回读（导出 → 手改金额 → 按编号覆盖）');
freshBoot();
{
  const bk = store.book.value;
  const n0 = store.stats.value.payCount;
  const paid0 = store.stats.value.paid;
  const parsed = toImportRows('pay', csvOf(HEADS.pay, payRows(bk)));
  eq('表头被识别（付款表 10 列）', parsed.hasHead, true);
  eq('导出付款行数', payRows(bk).length, 88);
  // v1.6：无日期付款带上「付款编号」后不再被判坏行 —— 导出→导回真正无损（此前每次都会丢 6 笔）
  eq('回读成功行数（含 6 笔历史无日期）', parsed.good.length, 88);
  eq('坏行 0 行', parsed.bad.length, 0);
  eq('其中 6 笔仍是无日期', parsed.good.filter((x) => !x.date).length, 6);

  // ① 金额未改 → 覆盖命中，条数与已付都不变
  const rSame = store.importTable('pay', [parsed.good[0]], 'overwrite');
  eq('金额未改：覆盖命中 1 笔', rSame.overwritten, 1);
  eq('金额未改：无新增', rSame.imported, 0);
  eq('金额未改：付款条数不变', store.stats.value.payCount, n0);
  near('金额未改：已付不变', store.stats.value.paid, paid0);

  // ② 手改金额（PRD X1 验收场景）→ 必须仍命中原记录覆盖，不得变成新增
  const mod = { ...parsed.good.find((x) => x.date) };
  const origAmount = round2(mod.amount);
  mod.amount = round2(origAmount + 1);
  const rMod = store.importTable('pay', [mod], 'overwrite');
  eq('手改金额：覆盖命中 1 笔（不新增）', rMod.overwritten, 1);
  eq('手改金额：无新增', rMod.imported, 0);
  eq('手改金额：付款条数不变', store.stats.value.payCount, n0);
  near('手改金额：已付只 +1', store.stats.value.paid, paid0 + 1);
}

section('X1 CSV 导入 — 付款表 append / skip 去重键');
freshBoot();
{
  const bk = store.book.value;
  const n0 = store.stats.value.payCount;
  const paid0 = store.stats.value.paid;
  const fresh = { no: bk.projects[0].no, date: '2026-09-09', method: '现金', amount: 10, note: 'QA', ref: 'QA-1' };
  const rAdd = store.importTable('pay', [fresh], 'append');
  eq('付款 append 新增 1 笔', rAdd.imported, 1);
  eq('付款笔数 +1', store.stats.value.payCount, n0 + 1);
  near('已付 +10', store.stats.value.paid, paid0 + 10);
  const rAgain = store.importTable('pay', [fresh], 'append');
  eq('append 同键（项目号+日期+金额）不重复新增', rAgain.imported, 0);
  eq('append 同键转为覆盖', rAgain.overwritten, 1);
  eq('append 同键后条数不变', store.stats.value.payCount, n0 + 1);
  const rSkip = store.importTable('pay', [fresh], 'skip');
  eq('付款 skip 命中同键', rSkip.skipped, 1);
  eq('skip 后条数不变', store.stats.value.payCount, n0 + 1);
  eq('付款行项目号不存在 → 跳过', store.importTable('pay', [{ ...fresh, no: 'ZX0000' }], 'append').skipped, 1);
}

section('X1 CSV 导入 — 付款表覆盖定位（同日多笔 / 同行日期多行 回归）');
freshBoot();
{
  const bk = store.book.value;
  const p = bk.projects[0];
  const D = '2031-01-15'; // 冷门日期，确保该日只有本次造的两笔
  store.upsertPayment(p.id, { date: D, method: '微信', amount: 100 }, -1, { force: true });
  store.upsertPayment(p.id, { date: D, method: '现金', amount: 200 }, -1, { force: true });
  const n0 = store.stats.value.payCount;
  const paid0 = store.stats.value.paid;
  const firstIdx = p.payments.findIndex((x) => normDate(x.date) === D && round2(x.amount) === 100);
  const secondIdx = p.payments.findIndex((x) => normDate(x.date) === D && round2(x.amount) === 200);
  is('同项目同日两笔付款已就位（用例前提）', firstIdx >= 0 && secondIdx >= 0 && firstIdx !== secondIdx);

  // ① 单行子集导入：同日两笔、CSV 只有 1 行且金额被改 → 按实现文档化的「位置定位」命中同日第 1 笔。
  //    ⚠️ 这是位置匹配的固有歧义：一行 CSV 无法说明它指同日两笔中的哪一笔（导出未带付款唯一键）。
  //    真正的验收路径是「整表导出 → 改值 → 整表导回」，见 ②；此处只锁「不新增、条数不变、已付 delta 精确」。
  const r1 = store.importTable('pay', [{ no: p.no, date: D, method: '现金', amount: 205, note: '', ref: '' }], 'overwrite');
  eq('单行子集：命中 1 笔覆盖', r1.overwritten, 1);
  eq('单行子集：无新增', r1.imported, 0);
  eq('单行子集：付款条数不变', store.stats.value.payCount, n0);
  near('单行子集：已付 delta = 205 − 100（不是 +205）', store.stats.value.paid, paid0 + 105);
  eq('单行子集：按位置命中同日第 1 笔', round2(p.payments[firstIdx].amount), 205);
  eq('单行子集：第 2 笔未被动', round2(p.payments[secondIdx].amount), 200);
  lines.push('   note: 同日多笔 + 子集导入存在位置歧义（整表往返不受影响）；建议导出付款表时补一列付款唯一键');

  // ② 同一份 CSV 里两行同日期 → 分别命中第 1、第 2 笔，互不覆盖
  const r2 = store.importTable('pay', [
    { no: p.no, date: D, method: '甲', amount: 111, note: '', ref: '' },
    { no: p.no, date: D, method: '乙', amount: 222, note: '', ref: '' },
  ], 'overwrite');
  eq('CSV 两行同日期：覆盖 2 笔', r2.overwritten, 2);
  eq('CSV 两行同日期：无新增', r2.imported, 0);
  eq('CSV 两行同日期：条数仍不变', store.stats.value.payCount, n0);
  eq('CSV 两行同日期：第 1 笔 = 111', round2(p.payments[firstIdx].amount), 111);
  eq('CSV 两行同日期：第 2 笔 = 222', round2(p.payments[secondIdx].amount), 222);

  // ③ skip：同金额同日期 → 跳过，不重复记账
  const r3 = store.importTable('pay', [{ no: p.no, date: D, method: '甲', amount: 111, note: '', ref: '' }], 'skip');
  eq('skip 同键：跳过 1 笔', r3.skipped, 1);
  eq('skip 同键：无新增', r3.imported, 0);
  eq('skip 同键：条数不变', store.stats.value.payCount, n0);
}

section('X1 CSV 导入 — 费用项表回读（追加 / 覆盖 / 跳过）');
{
  const bk = store.book.value;
  const n0 = store.stats.value.count;
  const payable0 = store.stats.value.payable;
  const parsed = toImportRows('project', csvOf(HEADS.proj, projRows(bk, statOf, statusText)));
  eq('表头被识别（支出表 14 列）', parsed.hasHead, true);
  eq('回读行数 = 71', parsed.good.length, 71);
  eq('回读无坏行', parsed.bad.length, 0);

  const mod = parsed.good.slice();
  mod[0].remark = 'QA-X1-改备注';
  const r = store.importTable('project', [mod[0]], 'overwrite');
  eq('费用项覆盖 ok', r.ok, true);
  eq('费用项条数不变', store.stats.value.count, n0);
  eq('备注已覆盖', store.book.value.projects.find((p) => p.no === mod[0].no).remark, 'QA-X1-改备注');
  near('金额不变（有明细时总计由明细链重算）', store.stats.value.payable, payable0);

  const rSkip = store.importTable('project', [mod[0]], 'skip');
  eq('费用项 skip 命中同项目号', rSkip.skipped, 1);

  const fresh = { no: 'ZX9999', cat: '', sub: '其他', remark: 'QA-X1-新增项', date: '2026-09-09', due: '', total: 0, discount: 0, object: '' };
  const rAdd = store.importTable('project', [fresh], 'append');
  eq('费用项 append 新增 1 条', rAdd.imported, 1);
  eq('费用项条数 +1', store.stats.value.count, n0 + 1);
  const rSetTotal = store.importTable('project', [{ ...fresh, total: 5000 }], 'overwrite');
  eq('无明细项可被覆盖改总计', rSetTotal.overwritten, 1);
  near('应付 +5000（只有该项变动）', store.stats.value.payable, payable0 + 5000);
}

section('X1 CSV 导入 — 落库前快照 / 撤销 / 坏行不落库');
freshBoot();
{
  const bk = store.book.value;
  const n0 = store.stats.value.detailCount;
  const payable0 = store.stats.value.payable;
  const importSnaps = () => listSnaps().filter((x) => x.reason === 'import' && x.kind === 'pre');
  eq('导入前无 import 快照（用例前提）', importSnaps().length, 0);
  const row = {
    no: bk.projects[0].no, name: 'QA-X1-快照用例', unit: '项', qty: 1, price: 500, amount: 500, craft: '', note: '', est: '否',
  };
  const r = store.importTable('detail', [row], 'append');
  eq('导入 ok', r.ok, true);
  eq('明细 +1', store.stats.value.detailCount, n0 + 1);
  near('应付 +500', store.stats.value.payable, payable0 + 500);
  eq('落库前已存 import 快照', importSnaps().length >= 1, true);
  eq('快照 kind 为 pre', importSnaps().every((x) => x.kind === 'pre'), true);
  eq('快照带金额摘要（items=71 / 原应付）', importSnaps()[0].stat.items, 71);
  near('快照摘要应付 = 导入前应付', importSnaps()[0].stat.payable, payable0);
  eq('pushUndo 可撤销', store.canUndo(), true);
  eq('撤销 ok', store.undo().ok, true);
  eq('撤销后明细条数回退', store.stats.value.detailCount, n0);
  near('撤销后应付回退', store.stats.value.payable, payable0);

  // 连续导入 4 次 → pre 快照仍受 3 条上限约束
  for (let i = 0; i < 4; i += 1) {
    store.importTable('detail', [{ ...row, name: `QA-X1-连导${i}` }], 'append');
  }
  eq('pre 快照上限 3 条', importSnaps().length, 3);

  const badRows = toImportRows('detail', 'ZX0001,,项,1,2,2,,,\nZX0001,缺数量,项,1,a,2,,,\n');
  eq('坏行被识别（缺品名/单价非数字）', badRows.bad.length, 2);
  const cntBefore = store.stats.value.detailCount;
  const rBad = store.importTable('detail', badRows.good, 'append');
  eq('全部坏行 → store 拒绝空行数组', rBad.ok, false);
  eq('坏行不落库', store.stats.value.detailCount, cntBefore);
}

section('X1 CSV 导入 — 空表/未知表类型保护');
{
  eq('空 rows 被拒', store.importTable('detail', [], 'append').ok, false);
  eq('未知表类型被拒', store.importTable('nope', [{}], 'append').ok, false);
  eq('mapRow 未知表类型报错', !!mapRow('nope', []).error, true);
  eq('mapRow 项目表缺项目号报错', mapRow('project', ['', 'a', 'b', 'c']).error, '缺少项目号');
  eq('mapRow 付款表缺日期报错', mapRow('pay', ['ZX0001', '', '微信', '10']).error, '缺少付款日期');
  eq('mapRow 付款表非法金额报错', !!mapRow('pay', ['ZX0001', '2026-01-01', '微信', 'abc']).error, true);
  eq('mapRow 金额带千分位可解析', mapRow('detail', ['ZX0001', 'a', '项', '1', '1,200', '1,200']).amount, 1200);
  eq('mapRow 空预估归一为「否」', mapRow('detail', ['ZX0001', 'a', '项', '1', '1', '1', '', '', '']).est, '否');
  eq('mapRow 预估「是」保留', mapRow('detail', ['ZX0001', 'a', '项', '1', '1', '1', '', '', '是']).est, '是');
  eq('无表头时按位置兜底', alignByHeader('detail', ['x', 'y'], ['a', 'b', 'c']).length, 3);
}

/* ================================================================= V */
section('V 版本与打包收尾（设计 §2.2 / §8.4 / T05-⑤）');
{
  const pkg = readJson('package.json');
  const plugin = readJson('plugin.json');
  const rel = fs.existsSync(path.join(ROOT, 'releases')) ? fs.readdirSync(path.join(ROOT, 'releases')) : [];
  const readme = fs.existsSync(path.join(ROOT, 'README.md')) ? fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8') : '';
  eq('package.json 与 plugin.json 版本一致', pkg.version, plugin.version);
  is('版本号为 x.y.z 且 >= 1.3.0', /^\d+\.\d+\.\d+$/.test(pkg.version) && pkg.version >= '1.3.0');
  eq('releases 含当前版本 zpx', rel.includes(`project-cost-${pkg.version}.zpx`), true);
  is('README 有 v1.3 功能段', /v1\.3/.test(readme));
  is('README 提到批量粘贴 / 对账单 / 双口径', /批量粘贴/.test(readme) && /对账单/.test(readme));
}

/* ---------------- 汇总 ---------------- */
console.log(lines.join('\n'));
console.log(`\n=== 通过 ${pass} / 失败 ${fail} / 合计 ${pass + fail} ===`);
if (failures.length) {
  console.log('\n失败清单：');
  failures.forEach((f) => console.log(' - ' + f));
}
if (fail) process.exitCode = 1;

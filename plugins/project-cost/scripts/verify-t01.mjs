/**
 * T01 自验：core 纯函数 + filters + snapshot（不依赖 Vue，node ESM 直接跑）
 * 用法：node scripts/verify-t01.mjs
 */
import { SEED } from '../src/lib/seed.js';
import {
  calc, catRows, sumBudget, syncTotalBudget, catBudgetHint, checkup, round2, payableOf, statusOf,
  confirmedPayableOf,
} from '../src/lib/core.js';
import { filterProjects, hasFilter, filterTag } from '../src/lib/filters.js';
import { pruneTo } from '../src/lib/snapshot.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

function seedBook() {
  return {
    id: 'b_seed',
    name: '自宅装修',
    color: '#A8624C',
    createdAt: 0,
    totalBudget: +SEED.totalBudget || 0,
    budget: clone(SEED.budget || {}),
    projects: clone(SEED.projects || []),
    categories: clone(SEED.categories || []),
    payees: clone(SEED.payees || []),
    warnThreshold: 0.8,
  };
}

const book = seedBook();
const c = calc(book);
const out = [];
const ok = (label, actual, expected) => {
  const pass = String(actual) === String(expected);
  out.push(`${pass ? 'PASS' : 'FAIL'} ${label}: ${actual}${pass ? '' : ` (期望 ${expected})`}`);
  return pass;
};

out.push('== 基线 ==');
ok('费用项', c.count, 71);
ok('明细', c.detailCount, 384);
ok('付款', c.payCount, 88);
ok('品类数', book.categories.length, 14);
ok('预算键数', Object.keys(book.budget).length, 13);
ok('收款方数', book.payees.length, 14);
ok('应付', c.payable, 246055.97);
ok('已付', c.paid, 188529.11);
ok('待付', c.remain, 57526.86);
ok('预算合计', c.totalBudget, 234688);
ok('结余', c.balance, -11367.97);
ok('catRows 行数', catRows(book).length, 14);
ok('sumBudget', sumBudget(book), 234688);

out.push('== checkup 基线（默认台账）==');
const before = JSON.stringify(book);
const r1 = checkup(book);
const r2 = checkup(book);
ok('checkup 不 mutate', JSON.stringify(book) === before, true);
ok('两次结果一致', JSON.stringify(r1) === JSON.stringify(r2), true);
// v1.7 起体检问题**按 code 断言**，不再断言 issues.length / warnable 的字面数字：
// C4 新增 payee-name-suspect、以后还可能有新规则，锁总数会让「加规则」变成「改测试」。
// 强度不降：每条的 count / amount / level / fix 仍逐项钉死。
out.push(`   体检问题码：${r1.issues.map((i) => i.code).join(', ') || '无'}`);
const noDate = r1.issues.find((i) => i.code === 'pay-no-date');
ok('含 pay-no-date', !!noDate, true);
ok('pay-no-date.count', noDate?.count, 6);
ok('pay-no-date.amount', noDate?.amount, 4142);
ok('pay-no-date.level', noDate?.level, 'warn');
ok('pay-no-date.fix', noDate?.fix, null);
// C4（v1.7）：收款方名疑似残缺 —— 只报不改（fix 必须为 null）
const suspect = r1.issues.find((i) => i.code === 'payee-name-suspect');
ok('含 payee-name-suspect（C4 新增规则）', !!suspect, true);
ok('payee-name-suspect.count', suspect?.count, 2);
ok('payee-name-suspect.amount', suspect?.amount, 26780);
ok('payee-name-suspect.level', suspect?.level, 'warn');
ok('payee-name-suspect.fix', suspect?.fix, null);
ok('fixable', r1.fixable, 0);
// warnable 的口径不变：= 没有修复动作的问题条数（不依赖问题总数）
ok('warnable = 无修复动作的问题条数', r1.warnable, r1.issues.filter((i) => !i.fix).length);

out.push('== catBudgetHint（v1.3 B1：used 按「确定应付」）==');
const hint = catBudgetHint(book, '泥瓦镶贴工程', 8000, '');
// v1.3 B1 口径变更：catBudgetHint 的 used 由「应付（含预估）」改成「确定应付」
// （= Σ confirmedPayableOf，与 calc().byCat[k].confirmed 同口径），预警/占用率不再被预估明细抬高。
// 真源 payable 未变，故这里必须对齐 byCat.confirmed，而不是 byCat.amount。
const usedNw = c.byCat['泥瓦镶贴工程'].confirmed;
const amountNw = c.byCat['泥瓦镶贴工程'].amount;
ok('state', hint.state, 'over');
ok('used 与 calc.byCat.confirmed 同口径', hint.used, round2(usedNw));
ok('used 已不等于含预估的应付口径', hint.used === round2(amountNw), false);
ok('over', hint.over, round2(8000 - (25000 - usedNw)));
ok('budget', hint.budget, 25000);
const noBudget = catBudgetHint(book, '其他费用', 100, '');
ok('未设预算 → no-budget', noBudget.state, 'no-budget');
ok('未选品类 → no-cat', catBudgetHint(book, '', 100, '').state, 'no-cat');
// excludeId：排除自身后 used 应减去该条的「确定应付」
const first = book.projects.find((p) => p.cat === '泥瓦镶贴工程');
const hintEx = catBudgetHint(book, '泥瓦镶贴工程', 8000, first.id);
ok('excludeId 排除自身', hintEx.used, round2(usedNw - confirmedPayableOf(first)));

out.push('== pruneTo ==');
const mk = (i, kind = 'daily') => ({ id: `s${i}`, ts: 1000 + i, kind });
const eight = Array.from({ length: 8 }, (_, i) => mk(i));
const pruned = pruneTo(eight);
ok('8 份 daily → 7 份', pruned.length, 7);
ok('淘汰 ts 最小那份', pruned.some((x) => x.id === 's0'), false);
ok('保留最新', pruned.some((x) => x.id === 's7'), true);
const pre4 = [mk(0, 'daily'), mk(1, 'pre'), mk(2, 'pre'), mk(3, 'pre'), mk(4, 'pre')];
const prunedPre = pruneTo(pre4);
ok('4 份 pre → 3 份', prunedPre.filter((x) => x.kind === 'pre').length, 3);
ok('最旧 pre 被淘汰', prunedPre.some((x) => x.id === 's1'), false);
// 总量上限：单条 500KB × 4 = 2MB > 1.5MB
const heavy = Array.from({ length: 4 }, (_, i) => ({ id: `h${i}`, ts: 1000 + i, kind: i === 0 ? 'pre' : 'daily', bytes: 500 * 1024 }));
const prunedHeavy = pruneTo(heavy);
const heavySum = prunedHeavy.reduce((s, x) => s + x.bytes, 0);
ok('超 1.5MB 后先淘汰 daily', prunedHeavy.some((x) => x.id === 'h1'), false);
ok('剩余总量 ≤ 1.5MB', heavySum <= 1.5 * 1024 * 1024, true);

out.push('== filters ==');
ok('无筛选 = 71 条', filterProjects(book.projects, {}).length, 71);
ok('hasFilter({}) === false', hasFilter({}), false);
ok('hasFilter({status}) === true', hasFilter({ status: 'unpaid' }), true);
const unpaid = filterProjects(book.projects, { status: 'unpaid' });
ok('未付条数与 statusOf 一致', unpaid.length, book.projects.filter((p) => statusOf(p) === 'unpaid').length);
ok('关键词筛选命中', filterProjects(book.projects, { query: '瓷砖' }).length > 0, true);
ok('品类筛选', filterProjects(book.projects, { cat: '防水工程' }).length,
  book.projects.filter((p) => p.cat === '防水工程').length);
ok('日期区间', filterProjects(book.projects, { from: '2026-01-01', to: '2026-12-31' }).length,
  book.projects.filter((p) => (p.date || '') >= '2026-01-01' && (p.date || '') <= '2026-12-31').length);
ok('filterTag 空筛选', filterTag({}), '');
ok('filterTag 组合', filterTag({ status: 'unpaid', cat: '防水工程' }), '未付_防水工程');
ok('filterTag 同一年区间', filterTag({ from: '2025-03-01', to: '2025-06-30' }), '3-6月');
ok('filterTag 跨年区间', filterTag({ from: '2025-11-01', to: '2026-02-28' }), '2025-11-01_2026-02-28');
ok('filterTag 去掉非法字符', filterTag({ query: 'a/b c' }), '含abc');

out.push('== syncTotalBudget ==');
const b2 = seedBook();
b2.totalBudget = 1;
syncTotalBudget(b2);
ok('回写 = Σbudget', b2.totalBudget, 234688);

out.push('== checkup 9 类问题码全覆盖 ==');
const dirty = seedBook();
dirty.projects[0].cat = '已删除品类';
dirty.projects[1].object = '已删除收款方';
dirty.projects[2].total = 99999;
dirty.projects[3].cat = '';
dirty.budget['幽灵品类'] = 3000;
dirty.totalBudget = 1;
const r3 = checkup(dirty);
const codes = r3.issues.map((i) => i.code).sort();
out.push(`   命中：${codes.join(', ')}`);
ok('含 cat-missing', codes.includes('cat-missing'), true);
ok('含 orphan-cat', codes.includes('orphan-cat'), true);
ok('含 orphan-payee', codes.includes('orphan-payee'), true);
ok('含 total-drift', codes.includes('total-drift'), true);
ok('含 budget-orphan-cat', codes.includes('budget-orphan-cat'), true);
ok('含 budget-total-drift', codes.includes('budget-total-drift'), true);
ok('含 pay-no-date', codes.includes('pay-no-date'), true);

const fails = out.filter((l) => l.startsWith('FAIL'));
console.log(out.join('\n'));
console.log(`\n=== ${fails.length ? `${fails.length} 项失败` : '全部通过'} ===`);
if (fails.length) process.exitCode = 1;

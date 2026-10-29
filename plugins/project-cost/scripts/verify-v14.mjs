/**
 * v1.4 验证：A1 账龄分桶 + Q3 存储占用/配额预警
 * 运行：npx esbuild scripts/verify-v14.mjs --bundle --platform=node --format=esm \
 *        --define:process.env.NODE_ENV='"development"' --outfile=/tmp/v14.mjs && node /tmp/v14.mjs
 */
import { SEED } from '../src/lib/seed.js';
import {
  calc, agingRows, agingPayees, AGE_BUCKETS, effectiveDue, daysBetween,
  round2, todayLocal, payableOf, dueOf, projectTotal,
} from '../src/lib/core.js';
import { storageUsage, QUOTA_BYTES, WARN_RATIO, byteLen, usageLevel, fmtKB } from '../src/lib/storage.js';

let pass = 0;
let fail = 0;
const fails = [];
const lines = [];   // 供 scripts/verify-all.mjs 解析（每条一行 PASS / FAIL）
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

/* ================= A1：默认台账 ================= */
const TODAY = todayLocal();
const s = calc(SEED);
const age = agingRows(SEED, TODAY);

ok('四桶结构固定', age.buckets.map((b) => b.label), ['0–30 天', '31–60 天', '61–90 天', '90 天以上']);
near('四桶金额之和 = 待付合计', round2(age.buckets.reduce((t, b) => t + b.amount, 0)), s.remain);
near('total 字段 = 待付合计', age.total, s.remain);
ok('桶内笔数之和 = 明细行数', age.buckets.reduce((t, b) => t + b.count, 0), age.items.length);
truthy('有欠款明细', age.items.length > 0);
truthy('最久一笔在 90+ 桶', age.worst.bucket === 'b3' && age.maxDays > 90);
ok('最久逾期天数 = items 首行', age.maxDays, age.items[0].overdue);
truthy('items 按逾期天数降序', age.items.every((it, i) => i === 0 || age.items[i - 1].overdue >= it.overdue));
truthy('每个 item 的桶与逾期天数自洽', age.items.every((it) => {
  const i = it.overdue > 90 ? 3 : it.overdue > 60 ? 2 : it.overdue > 30 ? 1 : 0;
  return AGE_BUCKETS[i].key === it.bucket;
}));
truthy('只含 due > 0 的费用项', age.items.every((it) => it.amount > 0.005));
near('items 金额之和 = total', round2(age.items.reduce((t, it) => t + it.amount, 0)), age.total);
truthy('到期日取 effectiveDue', age.items.every((it) => it.due === effectiveDue(SEED.projects.find((p) => p.id === it.id))));

/* 每个桶的 amount 与 items 中同桶求和一致 */
AGE_BUCKETS.forEach((b) => {
  const sum = round2(age.items.filter((it) => it.bucket === b.key).reduce((t, it) => t + it.amount, 0));
  near(`桶 ${b.label} 金额自洽`, age.buckets.find((x) => x.key === b.key).amount, sum);
});

/* 收款方下钻 */
const payees = agingPayees(SEED, TODAY);
near('收款方欠款之和 = 待付合计', round2(payees.reduce((t, p) => t + p.owe, 0)), age.total);
truthy('收款方按欠款降序', payees.every((p, i) => i === 0 || payees[i - 1].owe >= p.owe));
let drillOk = true;
payees.forEach((p) => {
  const sub = agingRows(SEED, TODAY, p.name);
  if (Math.abs(sub.total - p.owe) > 0.005) drillOk = false;
  if (sub.items.some((it) => it.payee !== p.name)) drillOk = false;
});
truthy('按每个收款方下钻：合计 = 该方欠款且只含该方费用项', drillOk);
const top = payees[0];
const sub0 = agingRows(SEED, TODAY, top.name);
ok('下钻后四桶之和仍 = 该方欠款', round2(sub0.buckets.reduce((t, b) => t + b.amount, 0)), round2(top.owe));

/* ================= A1：构造用例（桶边界）================= */
const mkProj = (id, daysAgo, amount, payee = '甲', extra = {}) => ({
  id, no: id, name: id, object: payee, cat: '其他', date: '2026-01-01',
  due: daysAgo === null ? '' : shift(TODAY, -daysAgo),
  total: amount, discount: 0, details: [], payments: [], ...extra,
});
function shift(day, n) {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const edgeBook = {
  projects: [
    mkProj('E0', -10, 100),   // 到期日在未来 10 天 → 0–30
    mkProj('E30', 30, 100),   // 30 天 → 0–30
    mkProj('E31', 31, 100),   // 31 天 → 31–60
    mkProj('E60', 60, 100),   // 60 天 → 31–60
    mkProj('E61', 61, 100),   // 61 天 → 61–90
    mkProj('E90', 90, 100),   // 90 天 → 61–90
    mkProj('E91', 91, 100),   // 91 天 → 90+
    mkProj('E0PAY', 5, 100, '乙', { payments: [{ date: '2026-02-01', amount: 100 }] }), // 已结清 → 排除
  ],
};
const eb = agingRows(edgeBook, TODAY);
ok('边界：0–30 桶含未到期与 30 天', [eb.buckets[0].count, eb.buckets[0].amount], [2, 200]);
ok('边界：31–60 桶', [eb.buckets[1].count, eb.buckets[1].amount], [2, 200]);
ok('边界：61–90 桶含 90 天', [eb.buckets[2].count, eb.buckets[2].amount], [2, 200]);
ok('边界：90+ 桶只含 91 天', [eb.buckets[3].count, eb.buckets[3].amount], [1, 100]);
ok('边界：已结清项目被排除', eb.items.length, 7);
near('边界：四桶之和 = 待付合计', eb.total, 700);
ok('边界：未到期归 0–30 且 overdue=0', eb.items.find((i) => i.id === 'E0').overdue, 0);

/* 无到期日：按下单日 + 30 天 */
const noDue = { projects: [mkProj('N1', null, 500, '丙', { date: shift(TODAY, -45) })] };
const nd = agingRows(noDue, TODAY);
ok('无到期日按下单日+30 天归桶（45-30=15 → 0–30）', nd.items[0].overdue, 15);
ok('无到期日：有效到期日 = 下单日+30', nd.items[0].due, shift(TODAY, -15));

/* 全空台账不崩 */
const empty = agingRows({ projects: [] }, TODAY);
ok('空台账四桶全 0', empty.buckets.map((b) => b.amount), [0, 0, 0, 0]);
ok('空台账 total=0 且 worst=null', [empty.total, empty.worst], [0, null]);

/* calc 不被 agingRows 污染 */
const before = { payable: s.payable, paid: s.paid, remain: s.remain };
agingRows(SEED, TODAY);
const after = calc(SEED);
ok('agingRows 不修改台账（金额链零变化）', [after.payable, after.paid, after.remain], [before.payable, before.paid, before.remain]);

/* ================= Q3：storageUsage ================= */
function withMockLS(map, fn) {
  const realLS = globalThis.localStorage;
  const realWin = globalThis.window;
  const keys = Object.keys(map);
  const mock = {
    get length() { return keys.length; },
    key: (i) => (i < keys.length ? keys[i] : null),
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); if (!keys.includes(k)) keys.push(k); },
    removeItem: (k) => { delete map[k]; const i = keys.indexOf(k); if (i >= 0) keys.splice(i, 1); },
  };
  globalThis.localStorage = mock;
  globalThis.window = { localStorage: mock };
  try { return fn(); } finally {
    globalThis.localStorage = realLS;
    globalThis.window = realWin;
  }
}

ok('byteLen 按 UTF-16 计（2 字节/字符）', [byteLen('abc'), byteLen(''), byteLen(null)], [6, 0, 0]);
ok('fmtKB 单位换算', [fmtKB(0), fmtKB(1024), fmtKB(1024 * 1024)], ['0.0 KB', '1.0 KB', '1.00 MB']);
ok('usageLevel 分级', [usageLevel(0.1), usageLevel(0.8), usageLevel(0.99), usageLevel(1)], ['ok', 'warn', 'warn', 'over']);

const small = withMockLS({
  ztools_project_cost_v1: 'x'.repeat(100),          // 100 字符 → 200 B + key
  ztools_project_cost_snap_v1: 'y'.repeat(50),
}, () => storageUsage());
const expectSmall = (byteLen('ztools_project_cost_v1') + byteLen('x'.repeat(100)))
  + (byteLen('ztools_project_cost_snap_v1') + byteLen('y'.repeat(50)));
ok('占用字节 = Σ(key+value)×2', small.bytes, expectSmall);
ok('主数据 / 快照分开计', [small.main, small.snap], [
  byteLen('ztools_project_cost_v1') + 200,
  byteLen('ztools_project_cost_snap_v1') + 100,
]);
ok('小占用为 ok 级', small.level, 'ok');
ok('分母默认 5MB', small.quota, QUOTA_BYTES);

/* 80% 预警与 100% 上限：用极小 quota 触发 */
const warn = withMockLS({ a: 'b'.repeat(100) }, () => storageUsage(1000)); // 200B/1000 = 20%
ok('20% 仍为 ok', warn.level, 'ok');
const warn80 = withMockLS({ a: 'b'.repeat(400) }, () => storageUsage(1000)); // 800/1000
ok('80% 触发 warn（变红）', warn80.level, 'warn');
truthy('warn 时 percent ≥ 80', warn80.percent >= 80);
const over = withMockLS({ a: 'b'.repeat(600) }, () => storageUsage(1000));
ok('超 100% 为 over', over.level, 'over');
ok('percent 保留一位小数', typeof over.percent === 'number', true);
near('ratio 与 percent 自洽', over.percent / 100, over.ratio, 0.001);

/* 环境不可用时不 throw */
const broken = withMockLS({}, () => {
  globalThis.window = { get localStorage() { throw new Error('disabled'); } };
  return storageUsage();
});
ok('localStorage 不可用返回 ok:false 且不抛错', [broken.ok, broken.bytes, broken.text], [false, 0, '不可用']);

/* ================= Q3：写入失败 → saveErr → toast ================= */
const store = await import('../src/lib/store.js');
/* 在 mock localStorage 里完成冷启动，避免污染真实环境 */
withMockLS({}, () => { store.boot(); });
ok('saveErr 初始为空', store.saveErr.value, '');
truthy('冷启动后台账可用', !!store.book.value);

/* ① 配额满且无图可删：持久化失败 + 明确文案 */
const quotaFail = withMockLS({}, () => {
  globalThis.localStorage.setItem = () => {
    const e = new Error('quota');
    e.name = 'QuotaExceededError';
    throw e;
  };
  const r = store.persistNow();
  return { r, err: store.saveErr.value };
});
ok('配额满且无可删图片：persistNow 返回 false', quotaFail.r, false);
ok('配额满文案提示导出备份', quotaFail.err, '本地存储已满，请先导出备份再继续录入');
ok('saveErr 可被取走且只取一次', [store.takeSaveErr(), store.saveErr.value], ['本地存储已满，请先导出备份再继续录入', '']);

/* ② 配额满但有凭证图：先删图保全数据，再提示删了几张 */
const dropImg = withMockLS({}, () => {
  let first = true;
  globalThis.localStorage.setItem = (k, v) => {
    if (first) { first = false; const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
    globalThis.__saved = v;
  };
  store.book.value.projects[0].img = 'data:image/png;base64,AAAA';
  const r = store.persistNow();
  return { r, err: store.saveErr.value, dropped: !store.book.value.projects[0].img };
});
ok('有图时降级成功（保全台账）', dropImg.r, true);
truthy('降级时删掉了凭证图', dropImg.dropped);
truthy('降级文案说明已移除图片', /已自动移除 \d+ 张收据图片/.test(dropImg.err));

/* ③ 清理：take 掉错误、恢复默认台账 */
store.takeSaveErr();
truthy('清空后 saveErr 为空', store.saveErr.value === '');

/* ================= 回归：金额链真源未受影响 ================= */
const after2 = calc(SEED);
ok('v1.4 后金额链真源字面不变', [after2.payable, after2.paid, after2.remain], [246055.97, 188529.11, 57526.86]);
ok('v1.4 后预算/结余不变', [after2.totalBudget, after2.balance], [234688, -11367.97]);
ok('v1.4 后 B1 派生不变', [after2.estTotal, after2.confirmedPayable], [14875, 231180.97]);
near('金额链闭合：Σ总计 − Σ优惠 = 应付',
  round2(SEED.projects.reduce((t, p) => t + projectTotal(p), 0) - SEED.projects.reduce((t, p) => t + (+p.discount || 0), 0)),
  after2.payable);
near('待付 = 应付 − 已付（全口径）', round2(after2.payable - after2.paid), after2.remain);
near('账龄总额 = 待付合计（最终口径）', agingRows(SEED, TODAY).total, after2.remain);
ok('单条 dueOf 与账龄口径一致', dueOf(SEED.projects[0]), round2(payableOf(SEED.projects[0]) - (SEED.projects[0].payments || []).reduce((t, x) => t + (+x.amount || 0), 0)));
ok('daysBetween 正常返回整数', daysBetween('2026-01-01', '2026-01-31'), 30);

/* ================= 汇总 ================= */
console.log(lines.join('\n'));
console.log('\n================ v1.4 验证结果 ================');
console.log(`用例 ${pass + fail} · 通过 ${pass} · 失败 ${fail}`);
if (fail) {
  console.log('\n--- 失败明细 ---');
  fails.forEach((f, i) => console.log(`${i + 1}. ${f}`));
  process.exitCode = 1;
} else {
  console.log('ALL PASS ✅');
}

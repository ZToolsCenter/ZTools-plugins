/**
 * K15（v1.9）导出侧自验：术语统一 + 时间戳收窄 + 三条红线。
 *
 * 运行：npx esbuild scripts/verify-k-export.mjs --bundle --platform=node --format=esm \
 *        --define:process.env.NODE_ENV='"development"' --outfile=/tmp/k-export.mjs && node /tmp/k-export.mjs
 *
 * 覆盖：
 *   K15-A 术语统一   HEADS.proj / HEADS.pay 的「支付对象」列改为「收款方」；
 *                   其余列名逐字不变（只允许这 2 处差异）；XLSX 包内无旧词「支付对象」。
 *   K15-B 时间戳收窄 CSV / AllCsv / XLSX 文件名均**不含** `YYYYMMDD-HHmmss`；
 *                   备份 exportJson 文件名**仍含**该段（防撞需求原意）。
 *   K19  两级防撞   `_HHmm` 解决「同日不同时刻」；同文件名再用则自动追加 `_2` / `_3`
 *                   序号，解决「同一分钟内连导」；仍不匹配 STAMP 正则（K15 红线不破）。
 *   红线③          导出→导回 round-trip：付款表 88 行 0 坏行、pid 集合不变；
 *                   费用项表 71 行 0 坏行、明细表 384 行 0 坏行。
 *   红线①②        金额链五项字面不变（应付 246,055.97 / 已付 188,529.11 / 待付 57,526.86 /
 *                   预算 234,688.00 / 结余 −11,367.97）、sumBudget === 234688 且预算键 13 个。
 */
import './fake-ls.mjs';
import { SEED } from '../src/lib/seed.js';
import * as store from '../src/lib/store.js';
import {
  calc, round2, statOf, statusText, sumBudget, payNo,
} from '../src/lib/core.js';
import {
  HEADS, projRows, detailRows, payRows, exportCsv, exportAllCsv, exportXlsx, exportJson,
  localStamp, localHM, resetExportNameSeq,
} from '../src/lib/export.js';
import {
  parseDelimited, mapRow, isHeaderRow, alignByHeader, normalizeHeader, COL_ALIAS, TABLE_COLS,
} from '../src/lib/parse.js';

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

const STAMP_RE = /_\d{8}-\d{6}/; // 文件名里的 _YYYYMMDD-HHmmss 段
const clone = (v) => JSON.parse(JSON.stringify(v));
const SEED_SNAPSHOT = JSON.stringify(SEED);
const freshBoot = () => { try { localStorage.clear(); } catch (_) { /* fake-ls */ } return store.boot(); };
const B = () => store.book.value;
const TODAY = '2026-10-28';

/* node 环境最小 DOM 桩：拦截 download()，收集 (name, blob) */
const captured = [];
let lastBlob = null;
globalThis.URL = {
  createObjectURL: (b) => { lastBlob = b; return 'blob:test'; },
  revokeObjectURL: () => {},
};
globalThis.document = {
  body: { appendChild() {} },
  createElement: () => ({
    href: '', download: '',
    click() { captured.push({ name: this.download, blob: lastBlob }); },
    remove() {},
  }),
};

/* csvCell 与 export.js 同源（导出 / 回读对称） */
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** 把 rows 序列化成「表头 + 数据」的 CSV 文本（模拟用户拿到的导出文件） */
const toCsv = (head, rows) => `${head.join(',')}\n${rows.map((r) => r.map(csvCell).join(',')).join('\n')}`;
/** CSV 文本 → 解析 → 按表头对齐 → mapRow（模拟用户导回） */
const roundTrip = (table, head, rows) => {
  const grid = parseDelimited(toCsv(head, rows));
  is(`${table} 首行被识别为表头行`, isHeaderRow(table, grid[0]));
  return grid.slice(1).map((cells) => mapRow(table, alignByHeader(table, grid[0], cells)));
};

/* ================= 0. 基线零漂移（红线 ①②） ================= */
section('0 基线（K15 改动后仍须字面不变）');
freshBoot();
eq('种子未被测试污染（不打印整份 SEED，避免刷屏）', JSON.stringify(SEED) === SEED_SNAPSHOT, true);
near('应付 246,055.97', calc(B()).payable, 246055.97);
near('已付 188,529.11', calc(B()).paid, 188529.11);
near('待付 57,526.86', calc(B()).remain, 57526.86);
near('预算 234,688.00', calc(B()).totalBudget, 234688);
near('结余 −11,367.97', calc(B()).balance, -11367.97);
near('sumBudget === 234688', sumBudget(B()), 234688);
eq('预算键数 === 13（不许变 14）', Object.keys(B().budget).length, 13);
eq('费用项 71 / 明细 384 / 付款 88',
  [B().projects.length, calc(B()).detailCount, calc(B()).payCount].join(','), '71,384,88');

/* ================= K15-A 术语统一 ================= */
section('K15-A 导出表头术语统一为「收款方」');
const OLD_PROJ = ['项目号', '项目分类', '费用类型', '费用备注', '日期', '到期日', '总计', '优惠', '应付', '已付', '待付', '支付对象', '状态', '凭证'];
const OLD_PAY = ['项目号', '费用备注', '支付对象', '付款日期', '付款方式', '金额', '备注', '凭证号', '付款编号', '作废'];
const OLD_DETAIL = ['项目号', '项目分类', '费用类型', '费用备注', '品名', '单位', '数量', '单价', '金额', '工艺', '备注', '预估'];

// 正向：新词在位
eq('HEADS.proj 第 12 列 = 收款方', HEADS.proj[11], '收款方');
eq('HEADS.pay 第 3 列 = 收款方', HEADS.pay[2], '收款方');
is('HEADS.proj 含「收款方」', HEADS.proj.includes('收款方'));
is('HEADS.pay 含「收款方」', HEADS.pay.includes('收款方'));
// 反向：旧词已清
not('HEADS.proj 不含「支付对象」', HEADS.proj.includes('支付对象'));
not('HEADS.pay 不含「支付对象」', HEADS.pay.includes('支付对象'));
not('三张表任何位置都不含旧词「支付对象」',
  HEADS.proj.concat(HEADS.detail, HEADS.pay).includes('支付对象'));

// 差异钉子：与旧口径相比只允许「支付对象 → 收款方」这 2 处差异，其余逐字一致
eq('HEADS.proj 列数仍为 14', HEADS.proj.length, 14);
eq('HEADS.pay 列数仍为 10', HEADS.pay.length, 10);
eq('HEADS.detail 列数仍为 12', HEADS.detail.length, 12);
eq('HEADS.proj 与旧口径仅第 11 号下标（第 12 列）一处差异',
  HEADS.proj.map((c, i) => (c === OLD_PROJ[i] ? '=' : `#${i}`)).filter((x) => x !== '=').join(','), '#11');
eq('HEADS.pay 与旧口径仅第 2 号下标（第 3 列）一处差异',
  HEADS.pay.map((c, i) => (c === OLD_PAY[i] ? '=' : `#${i}`)).filter((x) => x !== '=').join(','), '#2');
eq('HEADS.detail 与旧口径零差异（一字未动）', HEADS.detail.join(','), OLD_DETAIL.join(','));

// 兼容性前提：别名链（parse.js 未改）
eq('COL_ALIAS 收款方 → 支付对象', COL_ALIAS['收款方'], '支付对象');
eq('normalizeHeader(收款方) = 支付对象', normalizeHeader('收款方'), '支付对象');
eq('normalizeHeader(支付对象) = 支付对象（规范名本就直通）', normalizeHeader('支付对象'), '支付对象');
// 导入规范列在导出列里都能找到（按归一名比对）
is('导入列在导出列里都有（三表，按归一名比对）',
  ['project', 'detail', 'pay'].every((t) => {
    const key = t === 'project' ? 'proj' : t;
    return TABLE_COLS[t].every((c) => HEADS[key].some((h) => normalizeHeader(h) === normalizeHeader(c)));
  }));
// 老文件（表头写旧词）导入不受影响
is('旧词表头仍被识别为表头行', isHeaderRow('project', OLD_PROJ));
is('新词表头也被识别为表头行', isHeaderRow('project', HEADS.proj));
is('付款表新词表头被识别为表头行', isHeaderRow('pay', HEADS.pay));

/* ================= K15-B 时间戳只留给备份 ================= */
section('K15-B/K19 文件名：备份保留完整时间戳；CSV/XLSX 只带 4 位时分防撞');
freshBoot();
const helpers = { statOf, statusText };
eq('localStamp(2026-10-28T11:55:54) = 20261028-115554',
  localStamp(new Date('2026-10-28T11:55:54')), '20261028-115554');
not('相邻两秒时间戳不同（防撞机制本身仍有效）',
  localStamp(new Date('2026-10-28T10:00:00')) === localStamp(new Date('2026-10-28T10:00:01')));

// K19：localHM 形态与注入一致性
eq('localHM(2026-10-28T09:07:00) = 0907', localHM(new Date('2026-10-28T09:07:00')), '0907');
eq('localHM 注入值原样进入文件名（测试确定性来源）', typeof localHM(new Date(0)), 'string');

// 注：每组文件名断言前都要 resetExportNameSeq() —— 去重序号是模块级状态，
// 不重置的话「上一组用过的文件名」会把这一组的期望值顶成 `_2`，用例之间互相污染。
// 1) CSV：干净文件名 + K19 时分防撞后缀
resetExportNameSeq();
captured.length = 0;
exportCsv(B(), TODAY, helpers, null, '', '1430');
is('exportCsv 产生 1 个下载', captured.length === 1);
const csvName = captured[0] && captured[0].name;
eq('CSV 文件名精确值（K19 时分后缀）', csvName, '费用表_自宅装修_2026-10-28_1430.csv');
not('CSV 文件名不含完整时间戳段', STAMP_RE.test(String(csvName)));
is('CSV 文件名仍含「费用表」', String(csvName).includes('费用表'));
not('CSV 文件名不含「支出」', String(csvName).includes('支出'));
// K19 防撞：同日不同时分 → 不同文件名（不再产生浏览器静默的 xxx (1).csv）
captured.length = 0;
exportCsv(B(), TODAY, helpers, null, '', '1431');
is('K19 同日不同时分 → 文件名不同（防撞生效）',
  captured[0].name !== '费用表_自宅装修_2026-10-28_1430.csv', captured[0].name);

// 2) AllCsv：三张表文件名（彼此不同名 → 同一次调用内不会互相加序号）
resetExportNameSeq();
captured.length = 0;
exportAllCsv(B(), TODAY, helpers, null, '', '1430');
await new Promise((r) => setTimeout(r, 900)); // 等 setTimeout 链式下载全部触发
is('exportAllCsv 产生 3 个下载', captured.length === 3);
eq('AllCsv 三个文件名精确值（K19 时分后缀）', captured.map((c) => c.name).join(' | '),
  '费用表_自宅装修_2026-10-28_1430.csv | 明细表_自宅装修_2026-10-28_1430.csv | 付款表_自宅装修_2026-10-28_1430.csv');
not('AllCsv 三张表文件名均不含完整时间戳段', captured.some((c) => STAMP_RE.test(c.name)));

// 3) XLSX：文件名 + 包内表头已是新词
resetExportNameSeq();
captured.length = 0;
exportXlsx(B(), TODAY, helpers, null, '', '1430');
is('exportXlsx 产生 1 个下载', captured.length === 1);
const xlsxName = captured[0] && captured[0].name;
eq('XLSX 文件名精确值（K19 时分后缀）', xlsxName, '项目费用_自宅装修_2026-10-28_1430.xlsx');
not('XLSX 文件名不含完整时间戳段', STAMP_RE.test(String(xlsxName)));
const xlsxText = new TextDecoder('utf-8').decode(new Uint8Array(await captured[0].blob.arrayBuffer()));
is('XLSX 工作表名是「费用表」', xlsxText.includes('<sheet name="费用表"'));
is('XLSX 包内含新词「收款方」', xlsxText.includes('收款方'));
not('XLSX 包内不含旧词「支付对象」', xlsxText.includes('支付对象'));
not('XLSX 任意位置都不含「支出」', xlsxText.includes('支出'));

// 4) 带筛选摘要的 XLSX（tag 在时分之后）
resetExportNameSeq();
captured.length = 0;
exportXlsx(B(), TODAY, helpers, B().projects.slice(0, 5), '未付', '1430');
eq('筛选 XLSX 文件名精确值（tag 在后、无完整时间戳）', captured[captured.length - 1] && captured[captured.length - 1].name,
  '项目费用_自宅装修_2026-10-28_1430_未付.xlsx');

// 5) 备份：时间戳仍在（B4 的原始需求）
captured.length = 0;
const stateSnapshot = {
  books: store.state.books,
  activeBookId: store.state.activeBookId,
  templates: store.state.templates,
  warnThreshold: store.state.warnThreshold,
};
const meta = exportJson(stateSnapshot, B());
is('备份文件名含时间戳段', STAMP_RE.test(meta.name));
is('备份文件名结构 = 项目费用备份_<账套>_<日期>_<时间戳>_71项384明细.json',
  /^项目费用备份_.+_\d{4}-\d{2}-\d{2}_\d{8}-\d{6}_71项384明细\.json$/.test(meta.name));
eq('备份条数 items = 71', meta.items, 71);
eq('备份明细数 details = 384', meta.details, 384);

/* ================= K19 同一分钟内连导两次不再撞名 ================= */
section('K19 同分钟连导：第二份自动加 _2，第三份 _3');
freshBoot();

// 1) CSV：同一个 hm 连导三次 → 三个互不相同的文件名（浏览器不再静默改成 xxx (1).csv）
resetExportNameSeq();
captured.length = 0;
exportCsv(B(), TODAY, helpers, null, '', '1430');
exportCsv(B(), TODAY, helpers, null, '', '1430');
exportCsv(B(), TODAY, helpers, null, '', '1430');
is('同分钟连导 3 次产生 3 个下载', captured.length === 3);
const seqNames = captured.map((c) => c.name);
eq('第 1 次：原名', seqNames[0], '费用表_自宅装修_2026-10-28_1430.csv');
eq('第 2 次：追加 _2', seqNames[1], '费用表_自宅装修_2026-10-28_1430_2.csv');
eq('第 3 次：追加 _3', seqNames[2], '费用表_自宅装修_2026-10-28_1430_3.csv');
eq('三次文件名两两不等', new Set(seqNames).size, 3);

// reset 后序号从头再来（测试隔离）
resetExportNameSeq();
captured.length = 0;
exportCsv(B(), TODAY, helpers, null, '', '1430');
eq('resetExportNameSeq 后回到无序号形态', captured[0].name, '费用表_自宅装修_2026-10-28_1430.csv');

// 不同 hm 互不干扰：各自的计数独立
resetExportNameSeq();
captured.length = 0;
exportCsv(B(), TODAY, helpers, null, '', '1430');
exportCsv(B(), TODAY, helpers, null, '', '1431');
exportCsv(B(), TODAY, helpers, null, '', '1431');
eq('不同 hm 各自独立计数', captured.map((c) => c.name).join(' | '),
  '费用表_自宅装修_2026-10-28_1430.csv | 费用表_自宅装修_2026-10-28_1431.csv | 费用表_自宅装修_2026-10-28_1431_2.csv');
// 筛选摘要不同 → 文件名本就不同，不该被加序号
resetExportNameSeq();
captured.length = 0;
exportCsv(B(), TODAY, helpers, null, '未付', '1430');
exportCsv(B(), TODAY, helpers, null, '已付', '1430');
eq('不同筛选摘要互不重名 → 都不加序号', captured.map((c) => c.name).join(' | '),
  '费用表_自宅装修_2026-10-28_1430_未付.csv | 费用表_自宅装修_2026-10-28_1430_已付.csv');

// 2) XLSX：同样走序号
resetExportNameSeq();
captured.length = 0;
exportXlsx(B(), TODAY, helpers, null, '', '1430');
exportXlsx(B(), TODAY, helpers, null, '', '1430');
eq('XLSX 第 1 次：原名', captured[0].name, '项目费用_自宅装修_2026-10-28_1430.xlsx');
eq('XLSX 第 2 次：追加 _2', captured[1].name, '项目费用_自宅装修_2026-10-28_1430_2.xlsx');

// 3) AllCsv：同一次调用三张表互不重名 → 都不加序号；第二次调用各自 +1
resetExportNameSeq();
captured.length = 0;
exportAllCsv(B(), TODAY, helpers, null, '', '1430');
await new Promise((r) => setTimeout(r, 900));
eq('AllCsv 第 1 次三张表均无序号', captured.map((c) => c.name).join(' | '),
  '费用表_自宅装修_2026-10-28_1430.csv | 明细表_自宅装修_2026-10-28_1430.csv | 付款表_自宅装修_2026-10-28_1430.csv');
captured.length = 0;
exportAllCsv(B(), TODAY, helpers, null, '', '1430');
await new Promise((r) => setTimeout(r, 900));
eq('AllCsv 第 2 次三张表各加 _2', captured.map((c) => c.name).join(' | '),
  '费用表_自宅装修_2026-10-28_1430_2.csv | 明细表_自宅装修_2026-10-28_1430_2.csv | 付款表_自宅装修_2026-10-28_1430_2.csv');

// 4) 反向钉：K19 的序号形态不能把 K15 的「不带完整时间戳」红线打出水面
const allNames = [...seqNames, '费用表_自宅装修_2026-10-28_1430_2.csv', '费用表_自宅装修_2026-10-28_1430_3.csv'];
not('K19 序号文件名均不匹配 STAMP_RE（仍无完整时间戳）', allNames.some((n) => STAMP_RE.test(n)));
is('K19 序号文件名仍含「费用表」', allNames.every((n) => n.includes('费用表')));
not('K19 序号文件名不含「支出」', allNames.some((n) => n.includes('支出')));
not('_1430_2 不是可疑的完整时间戳段', STAMP_RE.test('_1430_2'));

/* ================= 红线③ 导出→导回 round-trip ================= */
section('红线③ 导出→导回（改表头后最容易破的地方）');

// 付款表：88 行 0 坏行、pid 集合不变
freshBoot();
const pidSet = () => JSON.stringify(B().projects
  .reduce((acc, p) => acc.concat((p.payments || []).map((x) => x.pid)), [])
  .slice().sort());
const pidBefore = pidSet();
eq('导回前 pid 总数 = 88', JSON.parse(pidBefore).length, 88);
is('导回前 pid 全是纯 P 号', B().projects.every((p) => (p.payments || []).every((x) => /^P\d{4,}$/.test(x.pid))));
const payBack = roundTrip('pay', HEADS.pay, payRows(B()));
eq('付款表回读 88 行全部成功（0 坏行）', payBack.filter((r) => !r.error).length, 88);
eq('付款表回读坏行数 = 0', payBack.filter((r) => r.error).length, 0);
const payImp = store.importTable('pay', payBack, 'overwrite');
eq('付款表原样导回：覆盖 88 / 新增 0', `${payImp.overwritten},${payImp.imported}`, '88,0');
eq('导回后 pid 集合与导回前完全一致', pidSet(), pidBefore);
near('导回后已付不变 188,529.11', calc(B()).paid, 188529.11);
near('导回后应付不变 246,055.97', calc(B()).payable, 246055.97);
near('导回后待付不变 57,526.86', calc(B()).remain, 57526.86);
eq('付款编号列仍是全号形态（第 9 列）',
  payRows(B()).every((r) => /^[A-Z]{1,4}\d{2,}-P\d{4,}$/.test(r[8])), true);

// 费用项表：71 行 0 坏行
freshBoot();
const projBack = roundTrip('project', HEADS.proj, projRows(B(), statOf, statusText));
eq('费用项表回读 71 行全部成功（0 坏行）', projBack.filter((r) => !r.error).length, 71);
eq('费用项表回读坏行数 = 0', projBack.filter((r) => r.error).length, 0);
// 「收款方」列的值确实落在 object 字段上（不是被当成未知列丢掉）
eq('费用项表回读：收款方列 → object 字段', projBack[0].object, B().projects[0].object);
is('费用项表回读：object 全部非空且与库内一致',
  projBack.every((r, i) => r.object === B().projects[i].object));

// 明细表：384 行 0 坏行
freshBoot();
const detBack = roundTrip('detail', HEADS.detail, detailRows(B()));
eq('明细表回读 384 行全部成功（0 坏行）', detBack.filter((r) => !r.error).length, 384);
eq('明细表回读坏行数 = 0', detBack.filter((r) => r.error).length, 0);

// 老文件（旧表头「支付对象」）导回同样 88 行 0 坏行 —— 向后兼容不能破
freshBoot();
const oldHeadPay = HEADS.pay.map((c) => (c === '收款方' ? '支付对象' : c));
const oldBack = roundTrip('pay', oldHeadPay, payRows(B()));
eq('旧表头（支付对象）付款表回读 88 行 0 坏行', oldBack.filter((r) => !r.error).length, 88);
eq('旧表头导回：覆盖 88 / 新增 0',
  (() => { const r = store.importTable('pay', oldBack, 'overwrite'); return `${r.overwritten},${r.imported}`; })(),
  '88,0');

/* ================= 收尾：红线 ①② 复校 ================= */
section('收尾复校（红线 ①②）');
freshBoot();
near('收尾：应付 246,055.97', calc(B()).payable, 246055.97);
near('收尾：已付 188,529.11', calc(B()).paid, 188529.11);
near('收尾：待付 57,526.86', calc(B()).remain, 57526.86);
near('收尾：预算 234,688.00', calc(B()).totalBudget, 234688);
near('收尾：结余 −11,367.97', calc(B()).balance, -11367.97);
near('收尾：sumBudget === 234688', sumBudget(B()), 234688);
eq('收尾：预算键数仍为 13', Object.keys(B().budget).length, 13);
eq('收尾：费用项 71 / 明细 384 / 付款 88',
  [B().projects.length, calc(B()).detailCount, calc(B()).payCount].join(','), '71,384,88');

/* ================= 汇总 ================= */
lines.push('');
lines.push(`PASS_TOTAL ${pass}`);
lines.push(`FAIL_TOTAL ${fail}`);
console.log(lines.join('\n'));
if (fail) {
  console.log('\n--- 失败明细 ---');
  failures.forEach((f) => console.log(`  · ${f}`));
}
process.exitCode = fail ? 1 : 0;

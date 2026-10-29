/**
 * K12 / K13 / K14 自验（导入导出相关 v1.8 候选点）。
 *
 * 运行：npx esbuild scripts/verify-k-io.mjs --bundle --platform=node --format=esm \
 *        --define:process.env.NODE_ENV='"development"' --outfile=/tmp/k-io.mjs && node /tmp/k-io.mjs
 *
 * 覆盖：
 *   K13 导入别名扩展：COL_ALIAS 新增「付款对象 / 收款人 / 往来单位 / 对方」→ 支付对象；
 *       用「付款对象」表头 parse 得到 收款方(object) 字段、0 坏行；导入可落库。
 *   K12 导出文件名统一为「费用表」：CSV 文件名含「费用表」、不含「支出」；
 *       XLSX 工作表名「支出表」→「费用表」，整包字节无「支出」字样。
 *   K14 备份/导出文件名时间戳防撞：文件名末尾追加 YYYYMMDD-HHmmss；
 *       不同时刻戳不同（防撞）。
 *   三条红线（任一破了就不能发）：
 *     ① 金额链五项字面不变；
 *     ② sumBudget === 234688 且预算键 13 个；
 *     ③ 导出→导回 88 行 0 坏行、pid 集合不变（别名扩展绝不能破坏这条护栏）。
 */
import './fake-ls.mjs';
import { SEED } from '../src/lib/seed.js';
import * as store from '../src/lib/store.js';
import {
  calc, round2, statOf, statusText, sumBudget, payableOf, paidOf, dueOf,
} from '../src/lib/core.js';
import {
  HEADS, payRows, exportJson, exportCsv, exportXlsx, exportAllCsv, localStamp,
} from '../src/lib/export.js';
import {
  parseDelimited, mapRow, isHeaderRow, alignByHeader, normalizeHeader,
  COL_ALIAS, TABLE_COLS,
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

const STAMP_RE = /\d{8}-\d{6}/; // YYYYMMDD-HHmmss
const clone = (v) => JSON.parse(JSON.stringify(v));
const SEED_SNAPSHOT = JSON.stringify(SEED);
const freshBoot = () => { try { localStorage.clear(); } catch (_) { /* fake-ls */ } return store.boot(); };
const B = () => store.book.value;

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

/* csvCell 与 export.js 同源（导出/回读对称） */
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/* ================= 0. 基线零漂移（红线 ①②） ================= */
section('0 基线（改动后仍须字面不变）');
freshBoot();
eq('种子未被测试污染', JSON.stringify(SEED), SEED_SNAPSHOT);
near('应付 246,055.97', calc(B()).payable, 246055.97);
near('已付 188,529.11', calc(B()).paid, 188529.11);
near('待付 57,526.86', calc(B()).remain, 57526.86);
near('预算 234,688.00', calc(B()).totalBudget, 234688);
near('结余 −11,367.97', calc(B()).balance, -11367.97);
near('sumBudget === 234688', sumBudget(B()), 234688);
eq('预算键数 === 13（不许变 14）', Object.keys(B().budget).length, 13);
eq('费用项 71 / 明细 384 / 付款 88',
  [B().projects.length, calc(B()).detailCount, calc(B()).payCount].join(','), '71,384,88');

/* ================= K13 导入别名扩展 ================= */
section('K13 表头别名扩展（COL_ALIAS）');
// 原有两条保持不变
eq('COL_ALIAS 收款方 → 支付对象（原有）', COL_ALIAS['收款方'], '支付对象');
eq('COL_ALIAS 事项 → 费用备注（原有）', COL_ALIAS['事项'], '费用备注');
// 新增别名全部收敛到「支付对象」
eq('COL_ALIAS 付款对象 → 支付对象', COL_ALIAS['付款对象'], '支付对象');
eq('COL_ALIAS 收款人 → 支付对象', COL_ALIAS['收款人'], '支付对象');
eq('COL_ALIAS 往来单位 → 支付对象', COL_ALIAS['往来单位'], '支付对象');
eq('COL_ALIAS 对方 → 支付对象', COL_ALIAS['对方'], '支付对象');
eq('normalizeHeader(付款对象) → 支付对象', normalizeHeader('付款对象'), '支付对象');
eq('normalizeHeader(收款人) → 支付对象', normalizeHeader('收款人'), '支付对象');
eq('normalizeHeader(往来单位) → 支付对象', normalizeHeader('往来单位'), '支付对象');
eq('normalizeHeader(对方) → 支付对象', normalizeHeader('对方'), '支付对象');
eq('未登记列原样返回', normalizeHeader('凭证号'), '凭证号');

// 用「付款对象」表头（替代规范名「支付对象」）自建项目表，能正确映射到 object 字段、0 坏行
const aliasHeader = ['项目号', '项目分类', '费用类型', '费用备注', '日期', '到期日', '总计', '优惠', '付款对象'];
const aliasData = ['ZX9999', '硬装', '主材', '浴室柜', '2026-03-01', '', '1200.50', '0', '泥工-张三'];
const aliasGrid = parseDelimited([aliasHeader.join(','), aliasData.join(',')].join('\n'));
is('别名表头被识别为表头行（≥2 列命中）', isHeaderRow('project', aliasGrid[0]));
const aliasMapped = mapRow('project', alignByHeader('project', aliasGrid[0], aliasGrid[1]));
not('别名 CSV 解析无错误（0 坏行）', aliasMapped.error);
eq('「付款对象」列映射到 object（收款方字段）', aliasMapped.object, '泥工-张三');
eq('「费用备注」列照常映射到 remark', aliasMapped.remark, '浴室柜');
near('「总计」列按位置对齐', aliasMapped.total, 1200.50);

// 其它别名（收款人 / 往来单位 / 对方）放在「支付对象」位置，都落到 object 字段
['收款人', '往来单位', '对方'].forEach((alias) => {
  const h = [...aliasHeader.slice(0, 8), alias];
  const grid = parseDelimited([h.join(','), aliasData.join(',')].join('\n'));
  const row = mapRow('project', alignByHeader('project', grid[0], grid[1]));
  not(`「${alias}」表头解析无错误`, row.error);
  eq(`「${alias}」列映射到 object`, row.object, '泥工-张三');
});

// 别名导入能落库：append 1 条，0 坏行，字段正确
freshBoot();
const impAlias = store.importTable('project', [aliasMapped], 'append');
eq('别名项目表导入 imported = 1', impAlias.imported, 1);
eq('导入后费用项数 72', B().projects.length, 72);
const imported = B().projects.find((p) => p.no === 'ZX9999');
is('导入的新费用项存在', !!imported);
eq('新费用项的 object 即「付款对象」列的值', imported && imported.object, '泥工-张三');
eq('新费用项的 remark 即「费用备注」列的值', imported && imported.remark, '浴室柜');

/* ================= K12 导出文件名统一为「费用表」 ================= */
section('K12 导出文件名统一为「费用表」');
freshBoot();
captured.length = 0;
const helpers = { statOf, statusText };
const TODAY = '2026-10-27';
exportCsv(B(), TODAY, helpers, null, '', '1430');
is('调用 exportCsv 产生了 1 个下载', captured.length === 1);
const csvName = captured[0] && captured[0].name;
is('CSV 文件名含「费用表」', csvName && csvName.includes('费用表'));
not('CSV 文件名不含「支出」', csvName && csvName.includes('支出'));
// K15（v1.9）：时间戳只留给备份；K19（v1.9.x）：CSV / XLSX 只带 4 位时分防同日撞名
not('CSV 文件名不含完整时间戳段（K15）', STAMP_RE.test(String(csvName)));
eq('CSV 文件名精确等值：费用表_<账套>_<today>_<HHmm>.csv（K19）', csvName, `费用表_${B().name}_${TODAY}_1430.csv`);

// XLSX：工作表名「支出表」→「费用表」，整包字节无「支出」字样
captured.length = 0;
exportXlsx(B(), TODAY, helpers);
is('调用 exportXlsx 产生了 1 个下载', captured.length === 1);
const xlsxName = captured[0] && captured[0].name;
not('XLSX 文件名不含「支出」', xlsxName && xlsxName.includes('支出'));
const xlsxBytes = new Uint8Array(await captured[0].blob.arrayBuffer());
const xlsxText = new TextDecoder('utf-8').decode(xlsxBytes);
is('XLSX 工作表名是「费用表」', xlsxText.includes('<sheet name="费用表"'));
not('XLSX 任意位置都不含「支出表」字样', xlsxText.includes('支出表'));
not('XLSX 任意位置都不含「支出」字样', xlsxText.includes('支出'));

// exportAllCsv：项目表文件名前缀「支出表」→「费用表」；K15：三张表均为干净文件名（不带时间戳）
captured.length = 0;
exportAllCsv(B(), TODAY, helpers);
await new Promise((r) => setTimeout(r, 900)); // 等 setTimeout 链式下载全部触发
is('exportAllCsv 产生 3 个下载', captured.length === 3);
is('exportAllCsv 第一张（项目表）文件名含「费用表」', captured[0] && captured[0].name.includes('费用表'));
not('exportAllCsv 项目表文件名不含「支出」', captured[0] && captured[0].name.includes('支出'));
not('exportAllCsv 三张表文件名均不带时间戳段（K15）', captured.some((c) => STAMP_RE.test(c.name)));

/* ================= K14 备份/导出文件名时间戳防撞 ================= */
section('K14 时间戳防撞');
freshBoot();
// 1) localStamp 单元：不同时刻戳不同，且格式精确
eq('localStamp(2026-10-27T14:30:00) = 20261027-143000', localStamp(new Date('2026-10-27T14:30:00')), '20261027-143000');
eq('localStamp(2026-01-02T03:04:05) = 20260102-030405（补零）',
  localStamp(new Date('2026-01-02T03:04:05')), '20260102-030405');
not('相邻两秒时间戳不同（防撞）',
  localStamp(new Date('2026-10-27T10:00:00')) === localStamp(new Date('2026-10-27T10:00:01')));

// 2) 备份文件名含时间戳，且位于日期与「N项」之间，结构稳定
captured.length = 0;
const stateSnapshot = {
  books: store.state.books,
  activeBookId: store.state.activeBookId,
  templates: store.state.templates,
  warnThreshold: store.state.warnThreshold,
};
const meta = exportJson(stateSnapshot, B());
is('备份文件名含「费用」（项目费用备份_…）', meta.name.includes('费用'));
is('备份文件名含时间戳', STAMP_RE.test(meta.name));
not('备份文件名不含「支出」', meta.name.includes('支出'));
const backupNameRe = /^项目费用备份_.+_\d{4}-\d{2}-\d{2}_\d{8}-\d{6}_71项384明细\.json$/;
is('备份文件名结构：…_<日期>_<时间戳>_71项384明细.json', backupNameRe.test(meta.name));

// 3) 再次导出：CSV 文件名仍干净（K15 后不再带时间戳）；备份才靠时间戳去重
const n1 = (() => { captured.length = 0; exportCsv(B(), TODAY, helpers); return captured[0].name; })();
not('再次导出 CSV 文件名不含时间戳（K15）', STAMP_RE.test(n1));
is('再次导出 CSV 文件名含「费用表」', n1.includes('费用表'));
not('再次导出 CSV 文件名不含「支出」', n1.includes('支出'));
is('备份仍与 CSV 不同：只有备份带时间戳',
  STAMP_RE.test(meta.name) && !STAMP_RE.test(n1));

/* ================= 红线③ 导出→导回 88 行 0 坏行、pid 集合不变 ================= */
section('红线③ 导出→导回（含别名护栏不破）');
freshBoot();
// 标准（规范名表头）回读：付款表 88 行 0 坏行
const csvPay = `${HEADS.pay.join(',')}\n${payRows(B()).map((r) => r.map(csvCell).join(',')).join('\n')}`;
const gPay = parseDelimited(csvPay);
const payBack = gPay.slice(1).map((cells) => mapRow('pay', alignByHeader('pay', gPay[0], cells)));
eq('回读付款表 88 行全部成功（0 坏行）', payBack.filter((r) => !r.error).length, 88);
const payImp = store.importTable('pay', payBack, 'overwrite');
eq('付款表原样导回：覆盖 88 / 新增 0', `${payImp.overwritten},${payImp.imported}`, '88,0');
near('导回后已付不变 188,529.11', calc(B()).paid, 188529.11);
eq('导回后 pid 集合仍是纯 P 号（无脏全号）',
  B().projects.every((p) => (p.payments || []).every((x) => /^P\d{4,}$/.test(x.pid))), true);

// 项目表同样 71 行 0 坏行
const csvProj = `${HEADS.proj.join(',')}\n${B().projects.map((p) => {
  const s = statOf(p);
  return [p.no, p.cat, p.sub, p.remark, p.date, p.due, s.total, +p.discount || 0, s.payable, s.paid, s.due,
    p.object, p.status, p.img ? '有' : '无'].map(csvCell).join(',');
}).join('\n')}`;
const gProj = parseDelimited(csvProj);
const projBack = gProj.slice(1).map((cells) => mapRow('project', alignByHeader('project', gProj[0], cells)));
eq('回读费用项表 71 行全部成功（0 坏行）', projBack.filter((r) => !r.error).length, 71);

// K15（v1.9）兼容护栏：导出表头第 3 列已由「支付对象」改为「收款方」，
// 靠 K13 的 `COL_ALIAS['收款方']='支付对象'` + `TABLE_COLS` 规范名仍是「支付对象」，
// 新表头导出→导回仍能对齐。这里显式钉住「新表头回读后 object 字段逐条还原」。
is('K15：导出表头已统一为「收款方」（付款表）', HEADS.pay.includes('收款方'));
is('K15：导出表头已统一为「收款方」（费用项表）', HEADS.proj.includes('收款方'));
eq('K15：新表头（收款方）回读后 object 字段逐条还原（别名归一生效）',
  projBack.every((r, i) => !r.error && r.object === B().projects[i].object), true);

// K13 护栏：用别名（付款对象）表头的付款表也能 round-trip（映射后仍是规范结构）
// 注：K15 后 HEADS.pay 里已是「收款方」，故这里改成替换「收款方」，才真的在测「别名表头 → 规范列」
const aliasPayHeader = HEADS.pay.map((c) => (c === '收款方' ? '付款对象' : c));
const aliasPayCsv = `${aliasPayHeader.join(',')}\n${payRows(B()).map((r) => r.map(csvCell).join(',')).join('\n')}`;
const gA = parseDelimited(aliasPayCsv);
const aBack = gA.slice(1).map((cells) => mapRow('pay', alignByHeader('pay', gA[0], cells)));
eq('别名（付款对象）付款表回读 88 行 0 坏行', aBack.filter((r) => !r.error).length, 88);
eq('别名付款表 importTable 覆盖 88 / 新增 0',
  (() => { const r = store.importTable('pay', aBack, 'overwrite'); return `${r.overwritten},${r.imported}`; })(), '88,0');
near('别名 round-trip 后已付仍 188,529.11', calc(B()).paid, 188529.11);

// 收尾再校一次红线 ①②，确保全程未漂移
near('收尾：应付 246,055.97', calc(B()).payable, 246055.97);
near('收尾：预算 234,688.00', calc(B()).totalBudget, 234688);
eq('收尾：预算键数仍为 13', Object.keys(B().budget).length, 13);

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

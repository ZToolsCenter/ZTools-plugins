/**
 * T05 自验：导出三表一致性 + 付款表 8 列 + 文件名摘要
 *
 * K15（v1.9）同步：
 *   · 付款表第 3 列表头「支付对象」→「收款方」，表头断言按新口径重写（差异只允许这一处）；
 *   · 导出文件名不再带时间戳，两条文件名断言由「放行可选时间戳段的正则」恢复为精确等值。
 * 用法：npx esbuild scripts/verify-t05.mjs --bundle --platform=node --format=esm --outfile=/tmp/t05.mjs && node /tmp/t05.mjs
 * 产出：/tmp/t05-full.xlsx、/tmp/t05-unpaid.xlsx（供 unzip 校验行数）
 */
import fs from 'node:fs';
import { SEED } from '../src/lib/seed.js';
import { statOf, statusText, calc, ensurePayIds, payNo } from '../src/lib/core.js';
import { filterProjects, filterTag } from '../src/lib/filters.js';
import { HEADS, projRows, detailRows, payRows, exportXlsx } from '../src/lib/export.js';

/* --- 最小 DOM 桩：让 download() 能在 node 里跑完并把 Blob 交出来 --- */
const blobs = [];
const els = [];
globalThis.URL.createObjectURL = (blob) => { blobs.push(blob); return 'blob:test'; };
globalThis.URL.revokeObjectURL = () => {};
globalThis.document = {
  body: { appendChild() {} },
  createElement: () => {
    const el = { href: '', download: '', click() {}, remove() {} };
    els.push(el);
    return el;
  },
};

const clone = (v) => JSON.parse(JSON.stringify(v));
const book = {
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
const helpers = { statOf, statusText };
// v1.6：真实路径下 boot() 会经 normalizeBook 给每笔付款补 pid，测试夹具也走同一条规则
book.projects.forEach((p) => ensurePayIds(p.payments));
const out = [];
const ok = (label, actual, expected) => {
  const pass = String(actual) === String(expected);
  out.push(`${pass ? 'PASS' : 'FAIL'} ${label}: ${actual}${pass ? '' : ` (期望 ${expected})`}`);
};

const saveBlob = async (blob, path) => {
  const buf = Buffer.from(await blob.arrayBuffer());
  fs.writeFileSync(path, buf);
  return buf.length;
};

/* ① 付款表表头：10 列；v1.2 追加备注/凭证号，v1.6 追加付款编号/作废。
 *
 * K15（v1.9）：第 3 列「支付对象」→「收款方」（客户要求导出表头与界面术语统一，
 * 推翻 v1.7 C1「导出表头保留原词」的旧决定）。因此「与 v1.1.0 逐字一致」不再成立，
 * 断言拆成两条，强度不降：
 *   ① 逐字等于 K15 后的期望表头（改一个字就红）；
 *   ② 与 v1.1.0 的差异**只有第 3 列这一处**（防止有人顺手改别的列）。 */
const V110_PAY = ['项目号', '费用备注', '支付对象', '付款日期', '付款方式', '金额'];
const K15_PAY6 = ['项目号', '费用备注', '收款方', '付款日期', '付款方式', '金额'];
ok('付款表列数', HEADS.pay.length, 10);
ok('前 6 列表头（K15 术语统一后）', HEADS.pay.slice(0, 6).join(','), K15_PAY6.join(','));
ok('与 v1.1.0 仅第 3 列一处差异（支付对象→收款方）',
  HEADS.pay.slice(0, 6).map((c, i) => (c === V110_PAY[i] ? '=' : `#${i}`)).join(','), '=,=,#2,=,=,=');
ok('v1.2 追加两列', HEADS.pay.slice(6, 8).join(','), '备注,凭证号');
ok('v1.6 追加两列', HEADS.pay.slice(8).join(','), '付款编号,作废');
// K15：术语统一的两条正向/反向钉子
ok('HEADS.pay 含「收款方」', HEADS.pay.includes('收款方'), true);
ok('HEADS.pay 不含「支付对象」', HEADS.pay.includes('支付对象'), false);
ok('HEADS.proj 含「收款方」', HEADS.proj.includes('收款方'), true);
ok('HEADS.proj 不含「支付对象」', HEADS.proj.includes('支付对象'), false);

/* ② 全量三表行数 */
ok('支出表 71 行', projRows(book, statOf, statusText).length, 71);
ok('明细表 384 行', detailRows(book).length, 384);
ok('付款表 88 行', payRows(book).length, 88);
const payRow0 = payRows(book)[0];
ok('付款行 10 个单元格', payRow0.length, 10);
ok('默认台账备注全为空串', payRows(book).every((r) => r[6] === '' && r[7] === ''), true);
// v1.7 C6：付款编号列由「纯 pid（P0001）」改为「付款全号（ZX0024-P0001）」，
// 库里仍只存 pid —— 断言改成「全号形态 + 逐行等于 payNo(项目号, pid)」，强度不降。
ok('付款编号非空且为「项目号-P序号」全号', payRows(book).every((r) => /^[A-Z]{1,4}\d{2,}-P\d{4,}$/.test(r[8])), true);
ok('付款编号逐行 = payNo(项目号, pid)', JSON.stringify(payRows(book).map((r) => r[8])),
  JSON.stringify(book.projects.reduce((acc, p) => acc.concat((p.payments || []).map((py) => payNo(p.no, py.pid))), [])));
ok('默认台账无作废', payRows(book).every((r) => r[9] === '否'), true);

/* ③ 全量 xlsx */
// K19（v1.9.x）：CSV/XLSX 文件名带 4 位时分 `_HHmm` 防同日撞名；测试注入固定值保证确定性
const rFull = exportXlsx(book, '2026-10-26', helpers, null, '', '0930');
ok('全量导出总行数', rFull.rows, 71 + 384 + 88);
ok('全量导出表数', rFull.sheets, 3);
// K15（v1.9）：完整时间戳仍只留给备份 —— 反向钉「不含完整时间戳段」；
// K19：4 位时分防撞后缀属于允许形态（`_0930` 不匹配 STAMP 正则）。
ok('全量文件名（精确，含 K19 时分后缀）', els[els.length - 1].download, '项目费用_自宅装修_2026-10-26_0930.xlsx');
ok('全量文件名不含完整时间戳段', /_\d{8}-\d{6}/.test(els[els.length - 1].download), false);

/* ④ 按筛选导出：unpaid */
const f = { status: 'unpaid' };
const list = filterProjects(book.projects, f);
ok('未付条数 > 0', list.length > 0, true);
const expDetail = list.reduce((s, p) => s + (p.details || []).length, 0);
const expPay = list.reduce((s, p) => s + (p.payments || []).length, 0);
const tag = filterTag(f);
ok('筛选文件名摘要', tag, '未付');
const rScoped = exportXlsx(book, '2026-10-26', helpers, list, tag, '0930');
ok('筛选导出总行数 = 支出+明细+付款', rScoped.rows, list.length + expDetail + expPay);
// K15：完整时间戳只留给备份；K19：4 位时分防撞后缀在 tag 之前
ok('筛选文件名（精确，含 K19 时分后缀）', els[els.length - 1].download, '项目费用_自宅装修_2026-10-26_0930_未付.xlsx');
ok('筛选文件名不含完整时间戳段', /_\d{8}-\d{6}/.test(els[els.length - 1].download), false);
// 该正则对「干净文件名」同样成立（汉字 / 数字 / 下划线 / 连字符 / 点），无需改动
ok('筛选文件名无非法字符', /^[\w\u4e00-\u9fa5.\-]+$/.test(els[els.length - 1].download), true);
out.push(`   未付筛选：${list.length} 条 · 明细 ${expDetail} 行 · 付款 ${expPay} 行`);
const sumPayable = list.reduce((s, p) => s + statOf(p).payable, 0);
ok('支出表应付列求和 = 筛选应付合计', Math.round(projRows({ ...book, projects: list }, statOf, statusText).reduce((s, r) => s + r[8], 0) * 100) / 100,
  Math.round(sumPayable * 100) / 100);

/* ⑤ 组合筛选（状态 + 品类 + 日期区间） */
const f2 = { status: 'unpaid', cat: '防水工程', from: '2026-01-01', to: '2026-12-31' };
ok('组合筛选摘要', filterTag(f2), '未付_防水工程_1-12月');

const main = async () => {
  await saveBlob(blobs[0], '/tmp/t05-full.xlsx');
  await saveBlob(blobs[1], '/tmp/t05-unpaid.xlsx');
  out.push(`   产出：/tmp/t05-full.xlsx (${fs.statSync('/tmp/t05-full.xlsx').size} B) · /tmp/t05-unpaid.xlsx (${fs.statSync('/tmp/t05-unpaid.xlsx').size} B)`);
  out.push(`   EXPECT sheet: full=71/384/88, unpaid=${list.length}/${expDetail}/${expPay}`);
  const fails = out.filter((l) => l.startsWith('FAIL'));
  console.log(out.join('\n'));
  console.log(`\n=== ${fails.length ? `${fails.length} 项失败` : '全部通过'} ===`);
  if (fails.length) process.exitCode = 1;
};
main();

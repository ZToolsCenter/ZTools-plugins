/**
 * v1.8.2 K10（展示精度）+ K14②（密度字号）自验 —— eng-fmt 独占范围。
 *
 * 运行：npx esbuild scripts/verify-k-fmt.mjs --bundle --platform=node --format=esm \
 *        --define:process.env.NODE_ENV='"development"' --outfile=/tmp/k-fmt.mjs && node /tmp/k-fmt.mjs
 *
 * 覆盖：
 *   K10 主数字精度    fmtNum(8000) === '8,000.00'（元 + 千分位 + 2 位小数，全站唯一精度）
 *   K10 无第二精度    src 下不得再出现已废除的万位出口标识符（含注释）；非注释行无「数字+万」
 *   K10 跨视图同口径  概览 / 分析的金额读数一律走 fmt / fmtNum / fmtAbs，同一金额不出现两种量级
 *   K10 无第二入口    金额出口只由 core.js 提供；不得再出现第二个格式化模块（format.js 已按裁决删除）
 *   K14② 大字密度     `[data-density='large']` 块内所有 font-size ≥ 12px
 *   K14② 紧凑不动     紧凑档按用户裁决保持原样（改它会击穿 P1 的 B3 行高/首屏条数），此处只登记不改
 *   三条红线          基线五项字面不变 / sumBudget === 234688 / 预算键 13 个
 *
 * ★ 与任务书的一处**已知偏差**（已回报主理人）：
 *   任务书要求「把紧凑档字号抬到 ≥12px」，但 `src/styles.css` 的 K14② 注释记录了用户裁决：
 *   「紧凑档一个字都不改，另开第三档」——抬到 12px 会让单行 35.92px → 约 38.4px，
 *   击穿 P1 的 B3（首屏 10+ 条 / 单行 ≤38px），而 K14 是 P2。
 *   故 K14② 的正确落点是**新增大字档**（已由并发同事落地），本脚本按裁决后的事实断言。
 */
import './fake-ls.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { SEED } from '../src/lib/seed.js';
import * as store from '../src/lib/store.js';
import { calc, sumBudget, fmt, fmtNum, fmtAbs } from '../src/lib/core.js';
import { DENSITIES, normDensity, getDensity, DENSITY_DEFAULT } from '../src/lib/prefs.js';

const ROOT = process.cwd();
const readSrc = (rel) => readFileSync(path.join(ROOT, 'src', rel), 'utf8');
const cssSrc = readSrc('styles.css');
const overviewSrc = readSrc('views/OverviewView.vue');
const analysisSrc = readSrc('views/AnalysisView.vue');

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

const SEED_SNAPSHOT = JSON.stringify(SEED);
const freshBoot = () => { try { localStorage.clear(); } catch (_) { /* fake-ls */ } return store.boot(); };
const B = () => store.book.value;

/* ---------------- CSS 工具：取某个密度块内的字号 ---------------- */
/** 抽出「选择器含 [data-density='<d>']」的规则里所有 font-size（px） */
function densityFontSizes(css, d) {
  const sizes = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sel = m[1];
    const body = m[2];
    if (sel.includes(`[data-density='${d}']`) || sel.includes(`[data-density="${d}"]`)) {
      (body.match(/font-size:\s*([\d.]+)px/g) || []).forEach((s) => {
        sizes.push(parseFloat(s.replace(/font-size:\s*/, '').replace('px', '')));
      });
    }
  }
  return sizes;
}
/** 源码级反向钉：非注释行里不得出现「数字+万」的硬编码金额 */
const isCommentLine = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);
const wanHits = (src) => src.split('\n')
  .filter((l) => !isCommentLine(l))
  .filter((l) => /[\d.]万/.test(l));
const countOf = (src, re) => (src.match(re) || []).length;

/* ================= 0. 红线基线 ================= */
section('0 红线基线（存储金额值不变 / sumBudget / 预算键数）');
freshBoot();
eq('种子未被测试污染', JSON.stringify(SEED), SEED_SNAPSHOT);
near('红线① 应付 246,055.97', calc(B()).payable, 246055.97);
near('红线① 已付 188,529.11', calc(B()).paid, 188529.11);
near('红线① 待付 57,526.86', calc(B()).remain, 57526.86);
near('红线① 预算 234,688.00', calc(B()).totalBudget, 234688);
near('红线① 结余 −11,367.97', calc(B()).balance, -11367.97);
eq('红线② sumBudget === 234688', sumBudget(B()), 234688);
eq('红线② 预算键 13 个（不许变 14）', Object.keys(B().budget).length, 13);

/* ================= 1. K10 主数字精度 ================= */
section('1 K10 主数字 = 元 + 千分位 + 2 位小数');
eq('fmtNum(8000) === "8,000.00"', fmtNum(8000), '8,000.00');
eq('fmt(8000) === "¥8,000.00"', fmt(8000), '¥8,000.00');
eq('fmt(246055.97) === "¥246,055.97"（百万级仍是元，不换单位）', fmt(246055.97), '¥246,055.97');
eq('fmtNum(246055.97) === "246,055.97"', fmtNum(246055.97), '246,055.97');
eq('fmt(-394.88) 负号在币种前', fmt(-394.88), '-¥394.88');
eq('fmtNum(-394.88) 带符号', fmtNum(-394.88), '-394.88');
eq('fmtAbs(-394.88) 取绝对值', fmtAbs(-394.88), '394.88');
eq('fmt(-0.001) 不出现 -¥0.00', fmt(-0.001), '¥0.00');
eq("fmt('abc') 不抛错 → ¥0.00", fmt('abc'), '¥0.00');
// 同一笔 8000 在任何出口下量级一致（不出现 0.8万 / 8千 之类第二精度）
is('fmt / fmtNum 对 8000 量级一致（都是 8,000.00）',
  fmtNum(8000) === '8,000.00' && fmt(8000) === `¥${fmtNum(8000)}`);
is('fmt(8000) 不含「万」', !/万/.test(fmt(8000)));
is('fmt(246055.97) 不含「万」', !/万/.test(fmt(246055.97)));

/* ================= 2. K10 无第二精度（源码级） ================= */
section('2 K10 反向钉（防第二精度复活）');
// 已废除的万位出口标识符：src 下 0 处（含注释也不许出现）
// 说明：这里用拼装的方式写模式串，避免本脚本自身把该标识符"复活"进仓库。
const BANNED = `${'fmt'}W`;
const srcDir = path.join(ROOT, 'src');
function walkSrc(dir) {
  const acc = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) acc.push(...walkSrc(p));
    else if (/\.(js|vue)$/.test(e.name)) acc.push(p);
  }
  return acc;
}
const srcFiles = walkSrc(srcDir);
is('扫到 src 下的 .js / .vue 源文件（≥ 20 个）', srcFiles.length >= 20);
const srcLines = srcFiles.flatMap((f) => readFileSync(f, 'utf8').split('\n')
  .map((line, i) => ({ f: path.relative(srcDir, f), i: i + 1, line })));
const bannedHits = srcLines.filter((x) => {
  const re = new RegExp(`(^|[^A-Za-z0-9_$.])${BANNED}([^A-Za-z0-9_$]|$)`);
  return re.test(x.line);
});
eq(`src/**/*.{js,vue} 中已废除的万位出口标识符命中 0 处（含注释）`, bannedHits.length, 0);
bannedHits.slice(0, 5).forEach((h) => lines.push(`   命中 ${h.f}:${h.i} ${h.line.trim()}`));
eq('src 非注释代码行中无「数字+万」硬编码金额', srcLines.filter((x) => !isCommentLine(x.line) && /[\d.]万/.test(x.line)).length, 0);

/* ================= 3. 三个金额出口仍由 core.js 单独提供（唯一实现） ================= */
section('3 金额出口：core.js 独立提供三出口，不存在第二个格式化模块');
// 用户裁决（2026-10）：eng-fmt 曾新增 `src/lib/format.js` 作「格式层」，但它只是
// `export { fmt, fmtNum, fmtAbs } from './core.js'` 的纯转发壳，且生产代码无人 import。
// K10 的纪律是「三个出口、唯一实现」——留着它等于开第二个 import 入口，
// 将来有人在 format.js 里加个 fmtShort 不会被当成违规。故已删除该文件，此处钉住
// **不再出现第二个格式化模块**，防止它被重新加回来。
is('core 导出 fmt 是函数', typeof fmt === 'function');
is('core 导出 fmtNum 是函数', typeof fmtNum === 'function');
is('core 导出 fmtAbs 是函数', typeof fmtAbs === 'function');
eq('src 下不存在第二个格式化模块（format.js 已删且不得复活）',
  (() => {
    try { readSrc('lib/format.js'); return true; } catch (_) { return false; }
  })(), false);
eq('src 下无其它文件转发金额出口（防第二个入口漂移）',
  srcLines.filter((x) => /export\s*\{[^}]*\b(fmt|fmtNum|fmtAbs)\b[^}]*\}\s*from/.test(x.line)).length, 0);
eq('fmt(8000) 逐字为 "¥8,000.00"', fmt(8000), '¥8,000.00');
eq('fmtNum(8000) 逐字为 "8,000.00"', fmtNum(8000), '8,000.00');
eq('fmtAbs(-8000) 逐字为 "8,000.00"（取绝对值）', fmtAbs(-8000), '8,000.00');

/* ================= 4. K10 概览 / 分析：同一金额不出现两种量级 ================= */
section('4 K10 概览 / 分析 金额同口径');
// 分析页：命令栏「应付合计」与三张环形图中心必须是同一个精度
is('分析页命令栏用 fmt(s.payable)（元）', analysisSrc.includes('fmt(s.payable)'));
eq('分析页三张环形图中心都用 fmt(…)', countOf(analysisSrc, /:center-value="fmt\(/g), 3);
eq('分析页环形图中心不再有万位出口调用', countOf(analysisSrc, /:center-value="[^"]*万/g), 0);
eq('分析页非注释行无「数字+万」', wanHits(analysisSrc).length, 0);
// 概览页：KPI 主数字 + 现金流提示一律 fmt（元）
is('概览页 KPI 累计应付用 fmt(c.payable)', overviewSrc.includes('fmt(c.payable)'));
is('概览页 KPI 已支付用 fmt(c.paid)', overviewSrc.includes('fmt(c.paid)'));
is('概览页 KPI 待支付用 fmt(c.remain)', overviewSrc.includes('fmt(c.remain)'));
is('概览页 KPI 总预算用 fmt(c.totalBudget)', overviewSrc.includes('fmt(c.totalBudget)'));
is('概览页现金流峰值/逾期也走 fmt(cf.…)', overviewSrc.includes('fmt(cf.peak)') && overviewSrc.includes('fmt(cf.overdue)'));
eq('概览页非注释行无「数字+万」', wanHits(overviewSrc).length, 0);
// 跨页一致性：应付合计在概览与分析都以「元」呈现
is('两页应付合计同口径（都是 fmt → 元）',
  overviewSrc.includes('fmt(c.payable)') && analysisSrc.includes('fmt(s.payable)'));

/* ================= 5. K14② 密度字号 ================= */
section('5 K14② 密度字号下限');
const largeSizes = densityFontSizes(cssSrc, 'large');
const compactSizes = densityFontSizes(cssSrc, 'compact');
is('大字档（large）密度块存在且有字号规则', largeSizes.length > 0);
is('大字档所有 font-size ≥ 12px', largeSizes.every((s) => s >= 12));
const minLarge = largeSizes.length ? Math.min(...largeSizes) : 0;
eq('大字档最小字号 ≥ 12px', minLarge >= 12, true);
lines.push(`  INFO 大字档最小字号: ${minLarge}px`);
lines.push(`  INFO 大字档字号集合: [${[...new Set(largeSizes)].sort((a, b) => a - b).join(', ')}]`);
// 紧凑档：按用户裁决保持原样（改它会击穿 P1 的 B3），只登记、不作为失败项
is('紧凑档（compact）密度块仍在（未被误删）', compactSizes.length > 0);
lines.push(`  INFO 紧凑档字号集合（按裁决保持原样，不改）: [${[...new Set(compactSizes)].sort((a, b) => a - b).join(', ')}]`);
// 默认仍必须是紧凑：K14② 不得改变 B3 的默认口径
eq('密度默认仍是 compact（B3 口径不变）', DENSITY_DEFAULT, 'compact');
eq('DENSITIES 三档 紧凑→舒适→大字', DENSITIES.join(','), 'compact,comfort,large');
eq('normDensity(large) 被接受', normDensity('large'), 'large');
eq('normDensity 非法值仍回落 compact', normDensity('huge'), 'compact');
eq('默认密度读回 compact', getDensity(), 'compact');

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

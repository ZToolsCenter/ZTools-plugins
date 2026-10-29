/**
 * v1.8.1 设置页自验：体检行内「收款方改名 / 合并」+ 存储占用计入撤销栈。
 *
 * 运行（指定唯一 /tmp 路径，避免与并行任务冲突）：
 *   npx esbuild scripts/verify-k-settings.mjs --bundle --platform=node --format=esm \
 *     --define:process.env.NODE_ENV='"development"' --outfile=/tmp/k-settings.mjs && node /tmp/k-settings.mjs
 *
 * 覆盖：
 *   S1 三条红线（金额链五项 / sumBudget===234688 + 13 键 / 导出→导回 88 行 0 坏行 pid 不变）
 *   S2 renamePayee 契约（UI 依赖的地基）：费用项 object + 付款 payee 全改写、0 孤儿、
 *      改完金额链不变、undo 一步回退、体检项随之消失（界面不留旧条目）、空值 / 同名防御
 *   S3 存储占用口径：撤销栈键 ztools_project_cost_undo 被「按键求和」口径计入，
 *      只补差价不重复计，>80% 仍走既有 warn 阈值
 *   S4 版本号单一来源（v1.9.1）：package.json / plugin.json 同号，且设置页页脚
 *      必须是「读 pkg.version」而不是写死字符串
 *
 * 说明：SettingsView.vue 是 .vue 单文件，node 侧无法 import。S3 里那份 `usageWithUndo`
 * 是视图内同名函数的**逐行镜像**（口径与注释同步），断言的是同一套算法与契约。
 */
import './fake-ls.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { SEED } from '../src/lib/seed.js';
import * as store from '../src/lib/store.js';
import {
  calc, sumBudget, checkup, CHECK_CODE, isPayeeNameSuspect,
} from '../src/lib/core.js';
import { exportJson } from '../src/lib/export.js';
import {
  storageUsage, byteLen, usageLevel, QUOTA_BYTES, WARN_RATIO,
} from '../src/lib/storage.js';

/* ---------------- 断言框架（与 verify-k-data.mjs 同构） ---------------- */
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

/* ---------------- 环境桩 ---------------- */
// storage.js 走 window.localStorage：node 下补一个 window，让「按键求和」口径可被测
globalThis.window = { localStorage: globalThis.localStorage };
const captured = [];
globalThis.URL.createObjectURL = (b) => { captured.push(b); return 'blob:test'; };
globalThis.URL.revokeObjectURL = () => {};
globalThis.document = {
  body: { appendChild() {} },
  createElement: () => ({ href: '', download: '', click() {}, remove() {} }),
};

const SEED_SNAPSHOT = JSON.stringify(SEED);
const freshBoot = () => { try { localStorage.clear(); } catch (_) { /* fake-ls */ } return store.boot(); };
const B = () => store.book.value;
const UNDO_KEY = 'ztools_project_cost_undo';

/* =======================================================================
 * S3 用的镜像：SettingsView.vue → usageWithUndo()
 * 与视图内实现逐行一致（含注释里的两条分支），node 侧断言的就是这份算法。
 * ===================================================================== */
function readUndoBytes() {
  try {
    const ls = window.localStorage;
    if (!ls) return 0;
    const v = ls.getItem(UNDO_KEY);
    if (v === null || v === undefined) return 0;
    return byteLen(UNDO_KEY) + byteLen(v);
  } catch (_) {
    return 0;
  }
}
function usageWithUndo(quota = QUOTA_BYTES, injected) {
  // `injected` 仅供本脚本造「前缀口径漏掉该键」的分支用例，视图侧恒为 storageUsage(quota)
  const u = injected || storageUsage(quota);
  const undo = readUndoBytes();
  if (!u || !u.ok) return { ...u, undo };
  const hasKey = (u.keys || []).some((k) => k.key === UNDO_KEY);
  const bytes = hasKey ? u.bytes : u.bytes + undo;
  const main = hasKey ? Math.max(0, u.main - undo) : u.main;
  const ratio = quota > 0 ? bytes / quota : 0;
  const percent = Math.round(ratio * 1000) / 10;
  return {
    ...u, bytes, main, undo, ratio, percent,
    level: usageLevel(ratio),
  };
}
/** 直接按键求和（独立口径，用来交叉校验 storageUsage().bytes 没漏键） */
function sumAllKeys() {
  let n = 0;
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    n += byteLen(k) + byteLen(localStorage.getItem(k) || '');
  }
  return n;
}

/* ================= S1. 三条红线 ================= */
section('S1 三条红线（任何破都不能发）');
freshBoot();
eq('S1 种子未被污染', JSON.stringify(SEED), SEED_SNAPSHOT);
near('红线① 应付 246,055.97', calc(B()).payable, 246055.97);
near('红线① 已付 188,529.11', calc(B()).paid, 188529.11);
near('红线① 待付 57,526.86', calc(B()).remain, 57526.86);
near('红线① 预算 234,688.00', calc(B()).totalBudget, 234688);
near('红线① 结余 −11,367.97', calc(B()).balance, -11367.97);
near('红线② sumBudget === 234688', sumBudget(B()), 234688);
eq('红线② Object.keys(book.budget).length === 13', Object.keys(B().budget).length, 13);

const pidsBefore = JSON.stringify(
  B().projects.flatMap((p) => (p.payments || []).map((py) => py.pid)).sort(),
);
captured.length = 0;
const meta = exportJson(store.state, B());
is('红线③ 导出文件名含 .json', meta.name.includes('.json'));
const backupText = await captured[0].text();
const imp = store.importState(JSON.parse(backupText));
eq('红线③ importState ok', imp.ok, true);
eq('红线③ 导回后付款 88 行', calc(B()).payCount, 88);
eq('红线③ 导回后预算键数仍为 13', Object.keys(B().budget).length, 13);
near('红线③ 导回后应付不变', calc(B()).payable, 246055.97);
const pidsAfter = JSON.stringify(
  B().projects.flatMap((p) => (p.payments || []).map((py) => py.pid)).sort(),
);
eq('红线③ 导回后 pid 集合不变（0 坏行）', pidsBefore, pidsAfter);

/* ================= S2. renamePayee 契约（UI 地基） ================= */
section('S2 体检行内改名 / 合并 —— renamePayee 契约');
freshBoot();
const suspects = [...new Set(
  (B().projects || []).map((p) => p.object).filter((n) => isPayeeNameSuspect(n)),
)];
eq('S2 基线残缺名 2 个', suspects.length, 2);
is('S2 基线含「泥工-」', suspects.includes('泥工-'));
const chk0 = checkup(B());
const iss0 = chk0.issues.find((i) => i.code === CHECK_CODE.PAYEE_NAME_SUSPECT);
is('S2 体检报出 payee-name-suspect', !!iss0);
eq('S2 payee-name-suspect.count = 2', iss0 && iss0.count, 2);
not('S2 该条目无自动修复（fix 为 null，故需行内入口）', iss0 && iss0.fix);

// —— 纯改名：残缺名「泥工-」→「泥工-王师傅」
const OLD = '泥工-';
const NEW = '泥工-王师傅';
const itemsBefore = B().projects.filter((p) => p.object === OLD).length;
is('S2 旧名在费用项中有引用', itemsBefore > 0);
const r1 = store.renamePayee(OLD, NEW);
is('S2 renamePayee ok', r1.ok);
is('S2 返回文案含新名', String(r1.msg).includes(NEW));
eq('S2 注册表新增新名', (B().payees || []).some((p) => p.name === NEW), true);
eq('S2 注册表删除旧名', (B().payees || []).some((p) => p.name === OLD), false);
eq('S2 费用项旧名引用清零', B().projects.filter((p) => p.object === OLD).length, 0);
eq('S2 费用项新名引用数 = 原引用数', B().projects.filter((p) => p.object === NEW).length, itemsBefore);

// 0 孤儿：费用项 object 与付款 payee 都不许再出现旧名 / 不在注册表里的名字
const names = new Set((B().payees || []).map((p) => p.name));
eq('S2 费用项 0 孤儿', B().projects.filter((p) => p.object && !names.has(p.object)).length, 0);
eq('S2 付款 0 孤儿 payee', B().projects
  .flatMap((p) => p.payments || [])
  .filter((py) => py.payee && !names.has(py.payee)).length, 0);
eq('S2 全库再无旧名引用（含付款）', B().projects
  .concat(B().projects.flatMap((p) => p.payments || []))
  .filter((x) => x.object === OLD || x.payee === OLD).length, 0);

// 金额链不变 + 体检重算后旧条目消失（界面不留残留）
near('S2 改名不改应付', calc(B()).payable, 246055.97);
near('S2 改名不改已付', calc(B()).paid, 188529.11);
near('S2 改名不改待付', calc(B()).remain, 57526.86);
near('S2 改名不改预算', calc(B()).totalBudget, 234688);
eq('S2 改名不改预算键数', Object.keys(B().budget).length, 13);
const chk1 = checkup(B());
const iss1 = chk1.issues.find((i) => i.code === CHECK_CODE.PAYEE_NAME_SUSPECT);
eq('S2 体检重算：残缺项计数 2 → 1', iss1 ? iss1.count : 0, 1);
eq('S2 体检不再引用旧名（samples 里无旧名）',
  JSON.stringify(iss1 ? iss1.samples : []).includes(OLD), false);

// 撤销一步回退整次改名
const u1 = store.undo();
is('S2 undo ok', u1.ok);
is('S2 撤销后旧名回到注册表', (B().payees || []).some((p) => p.name === OLD));
eq('S2 撤销后新名消失', (B().payees || []).some((p) => p.name === NEW), false);
eq('S2 撤销后引用归位', B().projects.filter((p) => p.object === OLD).length, itemsBefore);
near('S2 撤销后应付不变', calc(B()).payable, 246055.97);

// —— 合并：残缺名并到已存在的收款方（引用数应相加）
freshBoot();
const from2 = '木工-';
const into2 = (B().payees || []).map((p) => p.name)
  .find((n) => n !== from2 && n !== '泥工-' && !isPayeeNameSuspect(n));
is('S2 找到合并目标', !!into2);
const fromCnt = B().projects.filter((p) => p.object === from2).length;
const intoCnt = B().projects.filter((p) => p.object === into2).length;
const r2 = store.renamePayee(from2, into2);
is('S2 合并 ok', r2.ok);
is('S2 合并文案为「合并到」', String(r2.msg).includes('合并到'));
eq('S2 合并后旧注册表项删除', (B().payees || []).some((p) => p.name === from2), false);
eq('S2 合并后旧名引用清零', B().projects.filter((p) => p.object === from2).length, 0);
eq('S2 合并后目标引用数 = 两方之和', B().projects.filter((p) => p.object === into2).length, fromCnt + intoCnt);
near('S2 合并不改应付', calc(B()).payable, 246055.97);

// —— 防御：空值 / 同名 / 不存在，都应返回 ok:false 且不动数据
freshBoot();
const snapshotBefore = JSON.stringify(B().projects.map((p) => p.object));
not('S2 空新名被拒', store.renamePayee('泥工-', '').ok);
not('S2 空白新名被拒', store.renamePayee('泥工-', '   ').ok);
not('S2 空旧名被拒', store.renamePayee('', '王师傅').ok);
not('S2 同名被拒（不产生脏数据）', store.renamePayee('泥工-', '泥工-').ok);
not('S2 不存在的名被拒', store.renamePayee('根本没这个人', '王师傅').ok);
eq('S2 失败路径不改任何引用', JSON.stringify(B().projects.map((p) => p.object)), snapshotBefore);
near('S2 失败路径不改应付', calc(B()).payable, 246055.97);

// —— 付款 payee 也要被改写（UI 依赖：合并后对账单不能残留旧名）
freshBoot();
const payHost = B().projects.find((p) => p.object === '泥工-');
const payHostId = payHost && payHost.id;
is('S2 找到挂付款的宿主费用项', !!payHost);
payHost.payments.push({ pid: 'test-pay-1', date: '2026-01-05', amount: 10, method: '现金', payee: '泥工-' });
eq('S2 注入付款 payee = 旧名', payHost.payments.filter((x) => x.payee === '泥工-').length, 1);
const r3 = store.renamePayee('泥工-', '泥工-王师傅');
is('S2 带付款的改名 ok', r3.ok);
eq('S2 付款 payee 已改写', payHost.payments.filter((x) => x.payee === '泥工-').length, 0);
eq('S2 付款 payee 新名 1 条', payHost.payments.filter((x) => x.payee === '泥工-王师傅').length, 1);
store.undo();
// 撤销会把 state.books 整体换成反序列化出来的新对象，必须按 id 重新定位，不能沿用旧引用
const payHost2 = B().projects.find((p) => p.id === payHostId);
is('S2 撤销后宿主费用项仍存在', !!payHost2);
eq('S2 撤销后付款 payee 回到旧名', (payHost2?.payments || []).filter((x) => x.payee === '泥工-').length, 1);
eq('S2 撤销后付款不再有新名', (payHost2?.payments || []).filter((x) => x.payee === '泥工-王师傅').length, 0);

/* ================= S3. 存储占用把撤销栈算进去 ================= */
section('S3 存储占用口径（撤销栈计入总占用）');
freshBoot();
store.clearUndo(false);                 // 只清内存，不写键（clearUndo() 会落盘成 "[]"，仍有几十字节）
try { localStorage.removeItem(UNDO_KEY); } catch (_) { /* noop */ }
const base = usageWithUndo();
eq('S3 无撤销栈时 undo = 0', base.undo, 0);
eq('S3 无撤销栈时总量 = 按键求和', base.bytes, sumAllKeys());
eq('S3 storageUsage 自身可用', base.ok, true);

// 造 20 步撤销栈（v1.8 实测可达 ~1.4MB），再校验口径
for (let i = 0; i < 20; i += 1) store.pushUndo();
const rawUndo = localStorage.getItem(UNDO_KEY);
is('S3 撤销栈键已落盘', !!rawUndo);
const undoExpect = byteLen(UNDO_KEY) + byteLen(rawUndo);
const u = usageWithUndo();
eq('S3 undo 字节 = key+value 的 UTF-16 计法', u.undo, undoExpect);
is('S3 撤销栈确实占了不少字节（20 步）', u.undo > 100 * 1024);
// 「按键求和」口径必须包含该键（storage.js 前缀口径已把它算进 main）
const rawUsage = storageUsage();
is('S3 storageUsage().keys 含撤销栈键', (rawUsage.keys || []).some((k) => k.key === UNDO_KEY));
eq('S3 storageUsage().bytes = 按键求和（未漏键）', rawUsage.bytes, sumAllKeys());
// 镜像口径：只拆不叠
eq('S3 总占用不重复计（与 storageUsage().bytes 相同）', u.bytes, rawUsage.bytes);
eq('S3 main 已把撤销栈拆出去', u.main, Math.max(0, rawUsage.main - u.undo));
eq('S3 主 + 快照 + 其它 + 撤销栈 = 总量', u.main + u.snap + u.other + u.undo, u.bytes);
is('S3 覆盖断言：总量 ≥ 撤销栈字节', u.bytes >= u.undo);
// 与「不含撤销栈」的口径对比：多出来的部分应正好等于撤销栈
const noUndo = sumAllKeys() - u.undo;
eq('S3 去掉撤销栈后总量差值 = 撤销栈字节', u.bytes - noUndo, u.undo);

// 分支：若前缀口径哪天漏掉该键（keys 里没有），必须把字节补进总量
const leaked = {
  ok: true, bytes: 1000, quota: QUOTA_BYTES, ratio: 1000 / QUOTA_BYTES, percent: 0,
  level: 'ok', main: 1000, snap: 0, other: 0, keys: [], keyCount: 0,
};
const patched = usageWithUndo(QUOTA_BYTES, leaked);
const undoNow = readUndoBytes();
eq('S3 漏键分支：总量补上撤销栈', patched.bytes, 1000 + undoNow);
eq('S3 漏键分支：main 不重复扣减', patched.main, 1000);
eq('S3 漏键分支：undo 字段仍准确', patched.undo, undoNow);

// 阈值不变：>80% 变红（warn），且撤销栈能把总量推过线
eq('S3 WARN_RATIO 仍为 0.8', WARN_RATIO, 0.8);
eq('S3 usageLevel(0.79) = ok', usageLevel(0.79), 'ok');
eq('S3 usageLevel(0.80) = warn（>80% 变红提示导出备份）', usageLevel(0.8), 'warn');
eq('S3 usageLevel(1.00) = over', usageLevel(1), 'over');
// 合成用例：主数据 79%（不告警），加上撤销栈后越线 —— 证明「撤销栈算进去」会真实改变告警态。
// 这里刻意走「keys 里没有该键」的补差分支，配额用真实 5MB，避免比例失真到 over。
// 反推一个「刚好在 80% 线下」的主数据体量：加上真实撤销栈后落在 81%（warn，非 over）
const fake79 = Math.max(0, Math.round(QUOTA_BYTES * 0.81) - readUndoBytes());
const over80 = usageWithUndo(QUOTA_BYTES, {
  ok: true, bytes: fake79, quota: QUOTA_BYTES, level: 'ok', main: fake79, snap: 0, other: 0, keys: [],
});
const undoForOver = readUndoBytes();
const ratioWithUndo = (fake79 + undoForOver) / QUOTA_BYTES;
eq('S3 合成用例 bytes 含撤销栈', over80.bytes, fake79 + undoForOver);
eq('S3 合成用例 ratio 含撤销栈', Math.round(over80.ratio * 1000) / 1000, Math.round(ratioWithUndo * 1000) / 1000);
eq('S3 不加撤销栈时仍在 80% 线下 = ok', usageLevel(fake79 / QUOTA_BYTES), 'ok');
eq('S3 加上撤销栈后越线 → warn（>80% 变红提示导出备份）', over80.level, 'warn');
near('S3 合成用例 ratio ≈ 0.81', over80.ratio, 0.81, 0.002);
is('S3 撤销栈占比（真实 20 步）> 5% 配额', undoForOver / QUOTA_BYTES > 0.05);

// 清理：撤销栈清空后，占用应回落且不再单列
store.clearUndo(false);
try { localStorage.removeItem(UNDO_KEY); } catch (_) { /* noop */ }
const cleaned = usageWithUndo();
eq('S3 清空撤销栈后 undo = 0', cleaned.undo, 0);
eq('S3 清空后总量 = 按键求和', cleaned.bytes, sumAllKeys());

/* ---------------- S4 版本号单一来源（v1.9.1） ---------------- */
section('S4 版本号单一来源（v1.9.1）');
/* 背景：v1.9.0 只改了 package.json / plugin.json、漏了 SettingsView.vue 里写死的那行
   「v1.9.0」，设置页一直显示 v1.8.2，四个 UI 套件（v13/v14/v15/v16-ui）当场转红。
   修法：页脚改成读 package.json。这一节是源码级站岗，防止以后又被改回硬编码。 */
// 注意：esbuild 打包后 import.meta.url 指向 /tmp 里的产物，不能用它推仓库根。
// 编排器 verify-all.mjs 已用 cwd=仓库根 启动 node（其他套件读 src/styles.css 也靠这个），
// 这里同样以 process.cwd() 为准。
const S4_ROOT = process.cwd();
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(S4_ROOT, rel), 'utf8'));
const pkgJ = readJson('package.json');
const plugJ = readJson('plugin.json');
const svSrc = fs.readFileSync(path.join(S4_ROOT, 'src/views/SettingsView.vue'), 'utf8');
const footerLine = svSrc.split('\n').find((l) => l.includes('ZTools 插件版')) || '';

eq('S4 package.json 与 plugin.json 版本号一致', plugJ.version, pkgJ.version);
is('S4 版本号是合法 x.y.z', /^\d+\.\d+\.\d+$/.test(pkgJ.version));
is('S4 版本号非占位 0.0.0', pkgJ.version !== '0.0.0');
is('S4 设置页从 package.json 取版本（const appVersion = pkg.version）', /const appVersion = pkg\.version;/.test(svSrc));
is('S4 页脚用插值渲染 v{{ appVersion }}', /v\{\{\s*appVersion\s*\}\}/.test(svSrc));
is('S4 页脚行不再写死 vN.N.N', footerLine.length > 0 && !/v\d+\.\d+\.\d+/.test(footerLine));

/* ================= S4 见上一节（版本号单一来源，源码级站岗） ================= */

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

/**
 * v1.8 数据层与设置（需求池 2.9）自验：K1 / K2 / K9 / K11 / K13 + 三条红线。
 *
 * 运行（指定唯一 /tmp 路径，避免与 v17 冲突）：
 *   npx esbuild scripts/verify-k-data.mjs --bundle --platform=node --format=esm \
 *     --define:process.env.NODE_ENV='"development"' --outfile=/tmp/k-data.mjs && node /tmp/k-data.mjs
 *
 * 覆盖：
 *   K1  撤销栈落盘 / 刷新警告  —— pushUndo 落独立键、boot 恢复、canUndo 可用、
 *                                体积预算封顶（Q19）+ undoBytes() 与实测键大小一致
 *   K2  自动备份到文件        —— 配置读写（**默认开启/周**）、日志增删+上限、真实下载（stub document）、
 *                                首启只告知不下载（Q19: first-run-notice）
 *   K9  收款方改名 / 合并      —— renamePayee 改写 items+payments、0 孤儿、撤销可回滚
 *   K11 催收门槛可配          —— book.remindThreshold 驱动 overdueGroups，不改金额链
 *   K13 导入别名标注          —— COL_ALIAS 识别（纯展示，逻辑在 parse，本脚本仅作 sanity）
 *   红线 ① 金额链五项字面不变
 *   红线 ② sumBudget===234688 且 Object.keys(book.budget).length===13
 *   红线 ③ 导出→导回 88 行 0 坏行、pid 集合不变
 *
 * 注：K13 的别名 MAP 由 parse.js 实现（未改），本脚本只断言 COL_ALIAS 契约与 normalizeHeader 行为。
 */
import './fake-ls.mjs';
import { SEED } from '../src/lib/seed.js';
import * as store from '../src/lib/store.js';
import {
  calc, sumBudget, overdueGroups, OVERDUE_MIN_AMOUNT,
} from '../src/lib/core.js';
import { normalizeHeader, COL_ALIAS } from '../src/lib/parse.js';
import { exportJson } from '../src/lib/export.js';
import {
  getAutoBackup, setAutoBackup, getAutoBackupLog, addAutoBackupLog, clearAutoBackupLog,
  getLastAutoBackup, setLastAutoBackup, AUTO_BACKUP_MAX,
  getAutoBackupNoticed, setAutoBackupNoticed, AUTO_BACKUP_NOTICED_KEY,
  AUTO_BACKUP_KEY, AUTO_BACKUP_LAST_KEY,
} from '../src/lib/prefs.js';

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

/* ---------------- 环境桩 ---------------- */
const clone = (v) => JSON.parse(JSON.stringify(v));
const SEED_SNAPSHOT = JSON.stringify(SEED);
const freshBoot = () => { try { localStorage.clear(); } catch (_) { /* fake-ls */ } return store.boot(); };
const B = () => store.book.value;
const UNDO_KEY = 'ztools_project_cost_undo'; // K1 落盘键（store 内部契约）

// 浏览器下载桩：让 exportJson / doAutoBackupNow 在 node 下能跑（收集 Blob 读内容）
const captured = [];
globalThis.URL.createObjectURL = (b) => { captured.push(b); return 'blob:test'; };
globalThis.URL.revokeObjectURL = () => {};
globalThis.document = {
  body: { appendChild() {} },
  createElement: () => ({ href: '', download: '', click() {}, remove() {} }),
};

/* ================= K1. 撤销栈落盘 / 刷新警告 ================= */
section('K1 撤销栈落盘 / 刷新警告（P0）');
freshBoot();
store.clearUndo();
eq('K1 初始栈空', store.undoDepth(), 0);
not('K1 初始 canUndo=false', store.canUndo());
store.pushUndo();
const rawK1 = localStorage.getItem(UNDO_KEY);
is('K1 撤销栈已写入独立键', !!rawK1);
eq('K1 落盘内容含 1 步', JSON.parse(rawK1).length, 1);
// 模拟「刷新」：内存清空但保留 localStorage，重新 boot 应恢复
store.clearUndo(false);
eq('K1 刷新瞬间内存栈空', store.undoDepth(), 0);
store.boot();
is('K1 重新启动后撤销仍可用（canUndo）', store.canUndo());
eq('K1 重新启动后步数恢复为 1', store.undoDepth(), 1);
const rK1 = store.undo();
is('K1 刷新后撤销一步成功', rK1.ok);
// 20 步仍是硬上限（体积预算是叠加的第二重约束，两者取严；不锁死具体步数）
store.clearUndo();
for (let i = 0; i < 25; i += 1) store.pushUndo();
const n25 = store.undoDepth();
record(n25 >= 1 && n25 <= 20, 'K1 步数不超 20 步硬上限', n25, '1..20');
is('K1 上限内 canUndo=true', store.canUndo());

/* -------- K1-Q19（v1.8.1）：撤销栈按体积预算封顶 -------- */
section('K1-Q19 撤销栈体积预算（P0，配额守卫）');
freshBoot();
store.clearUndo();
const BASE_PROJECTS = B().projects.length;
/**
 * 实测独立键的字节数 —— **UTF-16 口径**（与 src/lib/storage.js 的 byteLen 同口径）。
 * localStorage 配额按 UTF-16 code unit 计；若用 UTF-8 会低估「键名与数字为主」的账套约 2 倍，
 * 800KB 预算会被真实开销悄悄吃穿，守卫形同虚设。
 */
const keyBytes = () => {
  const raw = localStorage.getItem(UNDO_KEY) || '';
  return raw.length * 2;
};
store.pushUndo();
const singleStepBytes = keyBytes();
is('Q19 单步快照 > 0 字节', singleStepBytes > 0);
lines.push(`INFO 当前数据量下单步快照 = ${singleStepBytes} B（${(singleStepBytes / 1024).toFixed(1)} KB）`);
// ① 连 push 25 次：落盘键字节数必须 ≤ 预算 + 单步余量，且至少保住 1 步
store.clearUndo();
for (let i = 0; i < 25; i += 1) store.pushUndo();
const q19Depth = store.undoDepth();
const q19Bytes = keyBytes();
record(q19Depth >= 1 && q19Depth <= 20, 'Q19 内存仍有可撤步数（≥1 且 ≤20）', q19Depth, '1..20');
/* v1.8.1 裁决：**内存深度**与**落盘配额**解耦 ——
   内存仍是 v1.7 已验收的 20 步（A3 语义一字不改），字节预算只裁剪「落盘子集」。
   下面两条就是该裁决的钉子：谁再把预算压回内存栈，它们立刻变红。 */
eq('Q19 内存步数仍为 v1.7 已验收的 20 步（预算不得压内存栈）', q19Depth, 20);
const q19Persisted = JSON.parse(localStorage.getItem(UNDO_KEY) || '[]').length;
record(q19Persisted >= 1 && q19Persisted < q19Depth,
  'Q19 落盘子集被预算裁剪（1 ≤ 盘上步数 < 内存步数）', q19Persisted, `1..${q19Depth - 1}`);
record(
  q19Bytes <= store.UNDO_BYTES_BUDGET + singleStepBytes,
  'Q19 落盘键字节数 ≤ 预算 800KB + 单步余量',
  `${q19Bytes} B ≤ ${store.UNDO_BYTES_BUDGET + singleStepBytes} B`,
  `≤ ${store.UNDO_BYTES_BUDGET + singleStepBytes}`,
);
record(q19Bytes <= store.UNDO_BYTES_BUDGET || q19Depth === 1,
  'Q19 字节数未超预算（或已退到只剩 1 步，符合「至少保留最新 1 步」）',
  `${q19Bytes} B / depth=${q19Depth}`, `≤ ${store.UNDO_BYTES_BUDGET}`);
// ② undoBytes() 必须与实测键大小严格一致
eq('Q19 undoBytes() === 实测独立键字节数', store.undoBytes(), q19Bytes);
lines.push(`INFO 20 步预算裁剪后：有效可撤步数 = ${q19Depth}，撤销栈实际占用 = ${q19Bytes} B（${(q19Bytes / 1024).toFixed(1)} KB，` +
  `占 5MB 配额 ${((q19Bytes / (5 * 1024 * 1024)) * 100).toFixed(1)}%）`);
// ③ 裁剪后再模拟「刷新」：restoreUndoStack 恢复出来的栈仍受同一预算约束、且大小不反弹
const restored = store.restoreUndoStack();
// 刷新只能恢复**盘上**那几步，故恢复深度 = 落盘步数（< 内存 20 步）—— 这是明确取舍，不是缺陷
eq('Q19 刷新后恢复深度 == 落盘步数（< 内存 20 步，取舍可见）', restored, q19Persisted);
eq('Q19 刷新后 undoBytes 不反弹', store.undoBytes(), q19Bytes);
record(keyBytes() <= store.UNDO_BYTES_BUDGET + singleStepBytes,
  'Q19 刷新后落盘键仍 ≤ 预算 + 单步余量', keyBytes(), `≤ ${store.UNDO_BYTES_BUDGET + singleStepBytes}`);
// ④ 裁剪后逐级回退：预算砍掉的是**最旧**的步，保留下来的每一步仍须真的可退
let backSteps = 0;
while (store.canUndo() && backSteps < 50) {
  const r = store.undo();
  if (r.ok) backSteps += 1; else break;
}
eq('Q19 能逐级回退的步数 == 刷新后恢复深度', backSteps, restored);
not('Q19 退到底后 canUndo=false', store.canUndo());
eq('Q19 退到底后费用项条数回到基线', B().projects.length, BASE_PROJECTS);
eq('Q19 退到底后 undoBytes 为空栈「[]」的 4 字节（UTF-16）', store.undoBytes(), 4);
lines.push(`INFO 实际逐级回退步数 = ${backSteps}`);
// ⑤ 无论数据量多大，都至少保住最新 1 步；离开确认依赖 canUndo（App.vue beforeunload 据此弹窗）
store.clearUndo();
store.pushUndo();
is('Q19 单步场景 canUndo=true（绝不把自己挤掉）', store.canUndo());
is('K1 有可撤步骤时 canUndo=true（列表常驻「撤销」按钮据此可用）', store.canUndo());
store.clearUndo();
eq('Q19 清空后 undoBytes = 4（空栈「[]」，UTF-16）', store.undoBytes(), 4);
not('K1 清空后 canUndo=false', store.canUndo());
// 公开签名稳定（A2 依赖）
eq('K1 pushUndo 是函数', typeof store.pushUndo, 'function');
eq('K1 undo 是函数', typeof store.undo, 'function');
eq('K1 canUndo 是函数', typeof store.canUndo, 'function');
eq('K1 undoDepth 是函数', typeof store.undoDepth, 'function');
eq('K1 clearUndo 是函数', typeof store.clearUndo, 'function');
eq('K1 undoBytes 是函数', typeof store.undoBytes, 'function');
eq('K1 restoreUndoStack 是函数', typeof store.restoreUndoStack, 'function');

/* ================= K2. 自动备份到文件 ================= */
section('K2 自动备份到文件（P0）');
freshBoot();
// ★ v1.8.1：默认配置由「关闭」改为「开启 + 周」
eq('K2 默认配置：未写过任何偏好时 enabled=true', getAutoBackup().enabled, true);
eq('K2 默认配置：period=week', getAutoBackup().period, 'week');
// 损坏 / 非法偏好也要落回「开启 + 周」
localStorage.setItem(AUTO_BACKUP_KEY, '{{not json');
eq('K2 偏好损坏时 enabled 回落 true', getAutoBackup().enabled, true);
eq('K2 偏好损坏时 period 回落 week', getAutoBackup().period, 'week');
localStorage.removeItem(AUTO_BACKUP_KEY);
// 显式关闭过的用户必须保留「关」（不能被新默认值偷偷打开）
setAutoBackup({ enabled: false, period: 'week' });
eq('K2 显式关闭后 enabled=false', getAutoBackup().enabled, false);
setAutoBackup({ enabled: true, period: 'month' });
eq('K2 配置 enabled 写回', getAutoBackup().enabled, true);
eq('K2 配置 period=month 写回', getAutoBackup().period, 'month');
setAutoBackup({ enabled: false, period: 'week' });
eq('K2 关闭后 enabled=false', getAutoBackup().enabled, false);
eq('K2 回落 period=week', getAutoBackup().period, 'week');
localStorage.removeItem(AUTO_BACKUP_KEY); // 回到「默认开启」态供下面的 maybeAutoBackup 用例用
// 日志增删 + 上限
clearAutoBackupLog();
eq('K2 初始日志空', getAutoBackupLog().length, 0);
for (let i = 0; i < 10; i += 1) addAutoBackupLog({ ts: Date.now() + i, size: 1000 + i, name: `b${i}.json` });
eq('K2 日志上限 = AUTO_BACKUP_MAX(8)', getAutoBackupLog().length, AUTO_BACKUP_MAX);
is('K2 日志按时间倒序（最新在前）', getAutoBackupLog()[0].name === 'b9.json');
clearAutoBackupLog();
// 真实备份：stub document 下触发 exportJson 下载并记日志
freshBoot();
captured.length = 0;
const rK2 = store.doAutoBackupNow();
is('K2 立即备份 ok', rK2.ok);
eq('K2 下载了 1 个文件', captured.length, 1);
eq('K2 日志新增 1 条', getAutoBackupLog().length, 1);
is('K2 日志记录文件名', !!getAutoBackupLog()[0] && getAutoBackupLog()[0].name.includes('.json'));
is('K2 日志记录大小 > 0', getAutoBackupLog()[0].size > 0);
clearAutoBackupLog();
// maybeAutoBackup：无 DOM（真·SSR / node）分支应跳过、不抛。这里临时摘掉 document 桩才是真无 DOM。
setAutoBackup({ enabled: true, period: 'week' });
setAutoBackupNoticed(true); // 越过首启闸门，才能验证 no-dom 这条分支本身
const docStub = globalThis.document;
globalThis.document = null;  // 临时构造真·无 DOM（`typeof document` 仍 'object'，故走 `!document` 判假）
captured.length = 0;
const rNoDom = store.maybeAutoBackup();
globalThis.document = docStub; // 立刻还原桩，绝不污染后续用例
eq('K2 无 DOM 环境 maybeAutoBackup 跳过', rNoDom.skipped, true);
eq('K2 无 DOM 环境 reason = no-dom', rNoDom.reason, 'no-dom');
eq('K2 无 DOM 环境零下载', captured.length, 0);

/* -------- K2-Q19（v1.8.1）：默认开启后「首启只告知、不下载」 -------- */
section('K2-Q19 首启只告知不下载（P0，防 headless 被下载卡死）');
freshBoot();
try { localStorage.removeItem(AUTO_BACKUP_NOTICED_KEY); } catch (_) { /* fake-ls */ }
captured.length = 0;
eq('Q19 默认自动备份已开启', getAutoBackup().enabled, true);
eq('Q19 默认周期为 week', getAutoBackup().period, 'week');
not('Q19 首次启动前未告知过', getAutoBackupNoticed());
const rFirst = store.maybeAutoBackup();
eq('Q19 首启 maybeAutoBackup 返回 skipped', rFirst.skipped, true);
eq('Q19 首启 reason = first-run-notice', rFirst.reason, 'first-run-notice');
eq('Q19 首启不 ok（没备份）', rFirst.ok, false);
eq('Q19 **首启零下载**（不会卡死 UI 套件）', captured.length, 0);
eq('Q19 首启后标记已置为「已告知」', getAutoBackupNoticed(), true);
eq('Q19 首启未写周备份时间戳', getLastAutoBackup(), 0);
eq('Q19 首启未记日志', getAutoBackupLog().length, 0);
// 关卡式回归：headless 每次清 localStorage 重跑 → 永远停在首启 → 永远不下载
freshBoot();
captured.length = 0;
const rFresh = store.maybeAutoBackup();
eq('Q19 再清 localStorage 重跑仍是 first-run-notice', rFresh.reason, 'first-run-notice');
eq('Q19 重跑仍零下载', captured.length, 0);
// 第二次启动（标记已置住）→ 走到真实备份分支（stub document 下应下载并记日志）
// 注意：setLastAutoBackup(0) 会被 prefs 归一化为「现在」，要模拟「从未备份」必须删键
setAutoBackupNoticed(true);
localStorage.removeItem(AUTO_BACKUP_LAST_KEY);
eq('Q19 前置：清掉周备份时间戳，模拟「从未备份」', getLastAutoBackup(), 0);
clearAutoBackupLog();
captured.length = 0;
const rSecond = store.maybeAutoBackup();
is('Q19 已告知后走到真实备份分支 ok', rSecond.ok);
eq('Q19 真实备份下载了 1 个文件', captured.length, 1);
eq('Q19 真实备份记录了日志', getAutoBackupLog().length, 1);
is('Q19 真实备份写了周时间戳', getLastAutoBackup() > 0);
// 同一周期内重复调用不重复下载
captured.length = 0;
const rInPeriod = store.maybeAutoBackup();
eq('Q19 同周期内不重复备份', rInPeriod.reason, 'in-period');
eq('Q19 同周期内零下载', captured.length, 0);
// 显式关闭时优先级高于首启告知
localStorage.removeItem(AUTO_BACKUP_NOTICED_KEY);
setAutoBackup({ enabled: false, period: 'week' });
captured.length = 0;
const rOff = store.maybeAutoBackup();
eq('Q19 显式关闭时 reason = disabled', rOff.reason, 'disabled');
eq('Q19 显式关闭时不置已告知标记', getAutoBackupNoticed(), false);
eq('Q19 显式关闭时零下载', captured.length, 0);
// 收尾：恢复默认态
clearAutoBackupLog();
localStorage.removeItem(AUTO_BACKUP_KEY);
try { localStorage.removeItem(AUTO_BACKUP_NOTICED_KEY); } catch (_) { /* fake-ls */ }

/* ================= K9. 收款方改名 / 合并 ================= */
section('K9 收款方改名 / 合并（P1）');
freshBoot();
const K9_OLD = '泥工-';
const K9_NEW = '泥工-王师傅';
const k9BeforeItems = B().projects.filter((p) => p.object === K9_OLD).length;
is('K9 旧名「泥工-」在费用项中有引用', k9BeforeItems > 0);
const rK9 = store.renamePayee(K9_OLD, K9_NEW);
is('K9 renamePayee 返回 ok', rK9.ok);
eq('K9 注册表新增新名', (B().payees || []).some((p) => p.name === K9_NEW), true);
eq('K9 注册表删除旧名', (B().payees || []).some((p) => p.name === K9_OLD), false);
eq('K9 所有引用旧名的费用项已更新为新名', B().projects.filter((p) => p.object === K9_OLD).length, 0);
eq('K9 新名引用数 = 原引用数', B().projects.filter((p) => p.object === K9_NEW).length, k9BeforeItems);
// 0 孤儿：所有非空的 project.object 都在注册表里
const k9Names = new Set((B().payees || []).map((p) => p.name));
const k9Orphans = B().projects.filter((p) => p.object && !k9Names.has(p.object));
eq('K9 改名后费用项无孤儿引用', k9Orphans.length, 0);
// 付款（如有 payee 字段）也同步
const k9PayOrphans = B().projects
  .flatMap((p) => p.payments || [])
  .filter((py) => py.payee && !k9Names.has(py.payee));
eq('K9 付款无孤儿 payee', k9PayOrphans.length, 0);
// 金额链不变
near('K9 不改应付', calc(B()).payable, 246055.97);
near('K9 不改待付', calc(B()).remain, 57526.86);
// 撤销一次即回滚整次改名
store.undo();
is('K9 撤销后旧名回到注册表', (B().payees || []).some((p) => p.name === K9_OLD));
eq('K9 撤销后新名消失', (B().payees || []).some((p) => p.name === K9_NEW), false);
eq('K9 撤销后引用归旧名', B().projects.filter((p) => p.object === K9_OLD).length, k9BeforeItems);
// 合并：把「木工-」并入已存在的「泥工-」
const k9MergeFrom = '木工-';
const k9MergeInto = (B().payees || []).find((p) => p.name !== k9MergeFrom && p.name !== '泥工-')?.name || '门窗-阳业';
const k9MergeBefore = B().projects.filter((p) => p.object === k9MergeFrom).length;
const k9IntoBefore = B().projects.filter((p) => p.object === k9MergeInto).length;
const rMerge = store.renamePayee(k9MergeFrom, k9MergeInto);
is('K9 合并返回 ok', rMerge.ok);
eq('K9 合并后旧名注册表项删除', (B().payees || []).some((p) => p.name === k9MergeFrom), false);
eq('K9 合并后旧名引用全部归并', B().projects.filter((p) => p.object === k9MergeFrom).length, 0);
eq('K9 合并后目标引用数 = 原两方之和', B().projects.filter((p) => p.object === k9MergeInto).length, k9MergeBefore + k9IntoBefore);

/* ================= K11. 催收门槛可配 ================= */
section('K11 催收门槛可配（P2）');
freshBoot();
eq('K11 默认 remindThreshold=100', B().remindThreshold, 100);
eq('K11 常量 OVERDUE_MIN_AMOUNT 仍=100（缺省回退）', OVERDUE_MIN_AMOUNT, 100);
// 阈值 500：ZX0016（0.46）不再进 severeMain，>500 仍提醒
B().remindThreshold = 500;
const og500 = overdueGroups(B());
is('K11 阈值500 severeMain 每笔 ≥ 500', og500.severeMain.every((x) => x.amount >= 500));
eq('K11 阈值500 ZX0016 不在 severeMain', og500.severeMain.some((x) => x.no === 'ZX0016'), false);
eq('K11 阈值500 severe 全量仍为 5（口径不变）', og500.severe.length, 5);
is('K11 阈值500 smallList 含 ZX0016', og500.smallList.some((x) => x.no === 'ZX0016'));
// 阈值 100（默认）：ZX0016 在 smallList
B().remindThreshold = 100;
const og100 = overdueGroups(B());
is('K11 阈值100 ZX0016 在 smallList', og100.smallList.some((x) => x.no === 'ZX0016'));
// 阈值 0 / 负数：非法 → 回落 100
B().remindThreshold = 0;
is('K11 阈值0 回落 100（ZX0016 在 smallList）', overdueGroups(B()).smallList.some((x) => x.no === 'ZX0016'));
B().remindThreshold = -50;
is('K11 负阈值回落 100（ZX0016 在 smallList）', overdueGroups(B()).smallList.some((x) => x.no === 'ZX0016'));
// 红线：不改金额链 / 预算键
near('K11 不改应付', calc(B()).payable, 246055.97);
near('K11 不改已付', calc(B()).paid, 188529.11);
eq('K11 不改预算键数', Object.keys(B().budget).length, 13);
near('K11 sumBudget 仍 234688', sumBudget(B()), 234688);

/* ================= K13. 导入别名标注（sanity） ================= */
section('K13 导入表头别名标注（仅 sanity）');
eq('K13 COL_ALIAS 收款方→支付对象', COL_ALIAS['收款方'], '支付对象');
eq('K13 COL_ALIAS 事项→费用备注', COL_ALIAS['事项'], '费用备注');
eq('K13 normalizeHeader(收款方)=支付对象', normalizeHeader('收款方'), '支付对象');
eq('K13 normalizeHeader(事项)=费用备注', normalizeHeader('事项'), '费用备注');
eq('K13 未登记列原样返回', normalizeHeader('项目号'), '项目号');

/* ================= 红线 invariants ================= */
section('红线 invariants（任何破都不能发）');
freshBoot();
eq('种子未被测试污染', JSON.stringify(SEED), SEED_SNAPSHOT);
near('红线① 应付 246,055.97', calc(B()).payable, 246055.97);
near('红线① 已付 188,529.11', calc(B()).paid, 188529.11);
near('红线① 待付 57,526.86', calc(B()).remain, 57526.86);
near('红线① 预算 234,688.00', calc(B()).totalBudget, 234688);
near('红线① 结余 −11,367.97', calc(B()).balance, -11367.97);
near('红线② sumBudget === 234688', sumBudget(B()), 234688);
eq('红线② Object.keys(book.budget).length === 13（不许变 14）', Object.keys(B().budget).length, 13);

// 红线③ 导出→导回 88 行 0 坏行、pid 集合不变
const pidsBefore = JSON.stringify(
  B().projects.flatMap((p) => (p.payments || []).map((py) => py.pid)).sort(),
);
captured.length = 0;
const meta = exportJson(store.state, B());
is('红线③ 导出文件名含 .json', meta.name.includes('.json'));
const backupText = await captured[0].text();
const parsed = JSON.parse(backupText);
const imp = store.importState(parsed);
eq('红线③ importState ok', imp.ok, true);
eq('红线③ 导回后付款 88 行', calc(B()).payCount, 88);
eq('红线③ 导回后预算键数仍为 13', Object.keys(B().budget).length, 13);
near('红线③ 导回后应付不变', calc(B()).payable, 246055.97);
const pidsAfter = JSON.stringify(
  B().projects.flatMap((p) => (p.payments || []).map((py) => py.pid)).sort(),
);
eq('红线③ 导回后 pid 集合不变', pidsBefore, pidsAfter);

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

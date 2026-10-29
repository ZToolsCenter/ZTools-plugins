/**
 * v1.9.x 第三轮评审 P1+P2 落地自验：K17 / K18 / K19 / K20 / K23（逻辑层）。
 *
 * 运行（指定唯一 /tmp 路径，避免与其它套件冲突）：
 *   npx esbuild scripts/verify-k18k23.mjs --bundle --platform=node --format=esm \
 *     --define:process.env.NODE_ENV='"development"' --outfile=/tmp/k18k23.mjs && node /tmp/k18k23.mjs
 *
 * 覆盖：
 *   K17 图表字号下限回退  —— donutValSize 既有档位逐字不变（9px 下限维持），
 *                            新 min 参数只抬不降（大字档 12）且默认值零影响；
 *   K18 重做（redo）      —— undo→redo 状态往返逐字节一致、深度计数、
 *                            新动作清空重做栈（开岔语义）、clearUndo 连带清重做、
 *                            落盘独立键 REDO_KEY 且 restore 恢复（刷新语义）、
 *                            redo 后仍可 undo（双向可达）；
 *   K19 同日导出防撞      —— hm 注入参数进入文件名、localHM 形态（精确断言在 verify-k-export）；
 *   K20 偏好进备份        —— exportJson 产物搭载 prefs.density、importState 恢复合法值、
 *                            老备份（无 prefs 字段）不改变本机偏好、快照 payload 搭载 + 回滚恢复；
 *   K23 改名/合并影响预览 —— renamePayeeImpact 与 renamePayee 同口径（纯函数不落库）：
 *                            受影响费用项数 / 应付合计 / 付款笔数与金额 / merged 标记 /
 *                            非法入参返回 null；预览数与实际迁移数一致。
 * 红线 ①② 金额链五项 + 预算键 13 个（本套件内不动金额，只验证不变）。
 */
import './fake-ls.mjs';
import { SEED } from '../src/lib/seed.js';
import * as store from '../src/lib/store.js';
import { donutValSize, sumBudget, payableOf } from '../src/lib/core.js';
import { exportJson } from '../src/lib/export.js';
import { getDensity, setDensity, DENSITY_KEY } from '../src/lib/prefs.js';

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

/* ---------------- 环境桩 ---------------- */
const clone = (v) => JSON.parse(JSON.stringify(v));
const REDO_KEY = 'ztools_project_cost_redo';
const UNDO_KEY = 'ztools_project_cost_undo';
const freshBoot = () => { try { localStorage.clear(); } catch (_) { /* fake-ls */ } return store.boot(); };
const B = () => store.book.value;

// 浏览器下载桩：让 exportJson 在 node 下能跑（收集 Blob 读内容 + 收集 anchor 的文件名）
const captured = [];
const anchors = [];
globalThis.URL.createObjectURL = (b) => { captured.push(b); return 'blob:test'; };
globalThis.URL.revokeObjectURL = () => {};
globalThis.document = {
  body: { appendChild() {} },
  createElement: () => {
    const a = { href: '', download: '', click() {}, remove() {} };
    anchors.push(a);
    return a;
  },
};

/* ================= K17 图表字号下限回退 ================= */
section('K17 图表字号下限：donutValSize 既有档位逐字不变，min 参数只抬不降');
// 既有断言（与 verify-k-ui 完全同值）：min 缺省 = 9，行为零变化
eq('donutValSize(6, 112) → 13.5', donutValSize(6, 112), 13.5);
eq('donutValSize(11, 112) → 11', donutValSize(11, 112), 11);
eq('donutValSize(14, 112) → 9（9px 下限仍在）', donutValSize(14, 112), 9);
eq('donutValSize(11, 96) 小环 → 9', donutValSize(11, 96), 9);
// min 参数：只抬不降
eq('min=12：长金额档 9 → 12（大字档诉求）', donutValSize(14, 112, 12), 12);
eq('min=12：中档 11 → 12', donutValSize(11, 112, 12), 12);
eq('min=12：高档 13.5 不被压低', donutValSize(6, 112, 12), 13.5);
eq('min=8：不会把既有档位拉低（只抬不降）', donutValSize(14, 112, 8), 9);
eq('min=0/脏输入：回落默认 9', donutValSize(14, 112, 0), 9);

/* ================= K18 重做 ================= */
section('K18 redo：undo→redo 状态往返、深度、开岔清栈、落盘恢复');
freshBoot();
store.clearUndo();
// 三个可观测动作：改第一条费用项的 remark（两次改名便于区分）。
// ⚠️ undo/redo 会**替换** state.books 里的对象 —— 断言一律用 id 现查（旧引用会失联）。
const pid0 = B().projects[0].id;
const remarkOf = () => B().projects.find((x) => x.id === pid0).remark;
store.pushUndo();
B().projects.find((x) => x.id === pid0).remark = 'K18-第一步';
store.pushUndo();
B().projects.find((x) => x.id === pid0).remark = 'K18-第二步';
eq('两次动作后可撤 2 步', store.undoDepth(), 2);
not('尚未撤销时无可重做', store.canRedo());
eq('可重做 0 步', store.redoDepth(), 0);

const r1 = store.undo();
is('第 1 次 undo ok', r1.ok);
eq('undo 后 remark 回到第一步', remarkOf(), 'K18-第一步');
eq('撤销后可重做 1 步', store.redoDepth(), 1);
is('REDO_KEY 已落盘（非空数组）', JSON.parse(localStorage.getItem(REDO_KEY)).length === 1);

const r2 = store.redo();
is('redo ok', r2.ok);
eq('redo 后 remark 回到第二步', remarkOf(), 'K18-第二步');
eq('redo 后可重做 0 步', store.redoDepth(), 0);
eq('redo 后仍可撤销 2 步（双向可达）', store.undoDepth(), 2);
not('重做用尽后 canRedo=false', store.canRedo());
is('没有可重做时 redo 返回 ok:false', store.redo().ok === false);

// 撤到中间 → 开新岔 → 重做栈清空（标准 redo 语义）
store.undo(); // 回到第一步
eq('撤到第一步，可重做 1 步', store.redoDepth(), 1);
store.pushUndo();
B().projects.find((x) => x.id === pid0).remark = 'K18-分岔新世界';
eq('新动作后重做栈清空', store.redoDepth(), 0);
not('开岔后 canRedo=false', store.canRedo());
store.undo();
eq('分岔动作也可撤销', remarkOf(), 'K18-第一步');

// 落盘恢复：模拟「刷新」（清内存栈、按盘重放）
const diskUndo = localStorage.getItem(UNDO_KEY);
const diskRedo = localStorage.getItem(REDO_KEY);
is('盘上有撤销栈', Array.isArray(JSON.parse(diskUndo)) && JSON.parse(diskUndo).length > 0);
store.clearUndo(false); // 只清内存（persist=false：盘上保留，模拟刷新瞬间）
eq('内存清空后 undoDepth=0', store.undoDepth(), 0);
eq('内存清空后 redoDepth=0', store.redoDepth(), 0);
eq('restoreUndoStack 恢复盘上撤销栈', store.restoreUndoStack() > 0, true);
eq('restoreRedoStack 恢复盘上重做栈', store.restoreRedoStack() > 0, true);
is('恢复后 canRedo=true', store.canRedo());
const r3 = store.redo();
is('恢复后的 redo 可用', r3.ok);
eq('恢复后 redo 回到分岔新世界', remarkOf(), 'K18-分岔新世界');

// clearUndo 连带清重做（防「清数据→重做」复活整套数据）
store.clearUndo();
eq('clearUndo 后 redoDepth=0', store.redoDepth(), 0);
eq('clearUndo 落盘重做栈为空数组', localStorage.getItem(REDO_KEY), '[]');
not('clearUndo 后 canRedo=false', store.canRedo());

/* ================= K19 同日导出防撞（文件名注入） ================= */
section('K19 hm 注入参数进入 CSV/XLSX 文件名');
freshBoot();
captured.length = 0;
const helpers = { statOf: (p) => store.stats, statusText: () => '' };
// 直接从 export 引函数（避免拖整个 store 依赖），文件名断言的精确值在 verify-k-export
const { exportCsv: csvFn, exportXlsx: xlsxFn, localHM } = await import('../src/lib/export.js');
eq('localHM(10:05) = 1005', localHM(new Date(2026, 9, 28, 10, 5)), '1005');
eq('localHM(23:59) = 2359（补零）', localHM(new Date(2026, 9, 28, 23, 59)), '2359');
captured.length = 0;
anchors.length = 0;
csvFn(B(), '2026-10-28', { statOf: () => ({}), statusText: () => '' }, null, '', '0815');
eq('CSV 文件名含注入的时分段', anchors[anchors.length - 1].download, `费用表_${B().name}_2026-10-28_0815.csv`);
anchors.length = 0;
xlsxFn(B(), '2026-10-28', { statOf: () => ({}), statusText: () => '' }, null, '', '0815');
eq('XLSX 文件名含注入的时分段', anchors[anchors.length - 1].download, `项目费用_${B().name}_2026-10-28_0815.xlsx`);

/* ================= K20 偏好进备份 ================= */
section('K20 exportJson 搭载 prefs.density + importState 恢复 + 老备份不动本机偏好');
freshBoot();
setDensity('large');
eq('前置：本机密度已是大字', getDensity(), 'large');
captured.length = 0;
exportJson(store.state, B());
const backupText = await captured[captured.length - 1].text();
const backupData = JSON.parse(backupText);
is('备份 JSON 顶层含 prefs 字段', backupData.prefs && typeof backupData.prefs === 'object');
eq('备份搭载的 density = large', backupData.prefs.density, 'large');
is('账本字段 books 仍在顶层（结构兼容）', Array.isArray(backupData.books));

// 导回（老备份：无 prefs 字段）→ 本机偏好不变
setDensity('compact');
const oldBackup = JSON.parse(backupText);
delete oldBackup.prefs;
const imp1 = store.importState(oldBackup);
is('导入老备份 ok', imp1.ok);
eq('老备份不带 prefs → 本机偏好保持 compact', getDensity(), 'compact');

// 导回新备份 → 密度恢复 large
const imp2 = store.importState(backupData);
is('导入新备份 ok', imp2.ok);
eq('新备份把密度恢复为 large（搭载恢复）', getDensity(), 'large');
eq('densityLive 信号同步（图表/抽屉消费方感知）', (await import('../src/lib/prefs.js')).densityLive.value, 'large');

// 非法 density 值归一为 compact（不写脏偏好）
const dirty = JSON.parse(backupText);
dirty.prefs.density = 'huge';
setDensity('comfort');
store.importState(dirty);
eq('非法 density 归一为 compact', getDensity(), 'compact');

// 快照搭载 + 回滚恢复
setDensity('large');
const snap = store.snapshotNow('pre', 'k20-test');
is('快照写入 ok', snap.ok);
setDensity('compact');
const snaps = store.snapshotList();
const restored = store.restoreSnapshot(snaps[0].id);
is('回滚 ok', restored.ok);
eq('回滚把搭载的密度一并恢复为 large', getDensity(), 'large');

/* ================= K23 改名/合并影响预览 ================= */
section('K23 renamePayeeImpact 与落库同口径（纯函数不落库）');
freshBoot();
// 造数据：把「自宅装修」台账前三项归到新收款方「K23甲方」
const bk = B();
const targets = bk.projects.slice(0, 3);
const prePayable = targets.reduce((s, p) => s + payableOf(p), 0);
targets.forEach((p) => { p.object = 'K23甲方'; });
// 其中第一项补两笔付款（一笔挂旧收款方、一笔挂新收款方）
const pFirst = targets[0];
pFirst.payments.push({ pid: 'P9001', date: '2026-10-28', method: '微信', amount: 500, note: '', ref: '', void: false, payee: 'K23甲方' });
pFirst.payments.push({ pid: 'P9002', date: '2026-10-28', method: '微信', amount: 300, note: '', ref: '', void: false, payee: '别的收款方' });
bk.payees.push({ name: 'K23甲方', contact: '', note: '' });
bk.payees.push({ name: 'K23乙方', contact: '', note: '' });

const pv = store.renamePayeeImpact('K23甲方', 'K23乙方');
is('有效入参 → 返回预览对象', pv !== null);
eq('受影响费用项 = 3', pv.projects, 3);
eq('应付合计与逐项求和一致', pv.payable, Math.round(prePayable * 100) / 100);
eq('受影响付款流水 = 1（只算 payee===旧名）', pv.payCount, 1);
eq('受影响付款金额 = 500', pv.payAmount, 500);
not('新名已存在 → merged=true（合并语义）', !pv.merged);
is('旧名在注册表', pv.inRegistry);

// 预览数 === 实际迁移数（同口径的核心承诺）
const refsOf = () => JSON.stringify({
  o: B().projects.map((p) => p.object),
  py: B().projects.flatMap((p) => (p.payments || []).map((x) => x.payee)),
});
const before = refsOf();
store.renamePayee('K23甲方', 'K23乙方');
const afterObj = refsOf();
eq('实际迁移的 object 数 = 预览数', JSON.parse(afterObj).o.filter((x) => x === 'K23乙方').length, pv.projects);
eq('实际迁移的 payee 数 = 预览数', JSON.parse(afterObj).py.filter((x) => x === 'K23乙方').length, pv.payCount);
eq('另一收款方的付款不受影响', JSON.parse(afterObj).py.filter((x) => x === '别的收款方').length, 1);
store.undo(); // 撤销改名（K9 契约仍成立；undo 换代后必须现查，不能用旧引用）
eq('改名可一步撤销', refsOf(), before);

// 非法入参 → null（调用方不渲染预览行）
eq('空原名 → null', store.renamePayeeImpact('', 'x'), null);
eq('空新名 → null', store.renamePayeeImpact('x', ''), null);
eq('同名 → null', store.renamePayeeImpact('x', 'x'), null);

/* ================= 红线 ①② 本套件不动金额，收尾复核 ================= */
section('红线收尾：金额链与预算键未被本套件改动破坏');
freshBoot();
const c = store.stats.value;
eq('红线① 应付 246055.97', Math.round(c.payable * 100) / 100, 246055.97);
eq('红线① 已付 188529.11', Math.round(c.paid * 100) / 100, 188529.11);
eq('红线① 待付 57526.86', Math.round(c.remain * 100) / 100, 57526.86);
eq('红线② 预算键 13 个', Object.keys(B().budget).length, 13);
eq('红线② sumBudget = 234688', Math.round(sumBudget(B()) * 100) / 100, 234688);

console.log(lines.join('\n'));
console.log(`\n通过 ${pass} / 失败 ${fail}`);
if (failures.length) { console.log('\n失败明细:'); for (const f of failures) console.log('  - ' + f); }
process.exit(fail ? 1 : 0);

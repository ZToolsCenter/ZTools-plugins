<script setup>
import { computed, onMounted, ref, reactive, watch } from 'vue';
import {
  state, book, stats, resetActiveBook, importState, detectLegacy, importLegacy,
  KEY, persistNow, snapshotNow, snapshotList, restoreSnapshot, fixCheckup, importTable,
  fmtSnapTime, REASON_TEXT, setBookMeta, maybeAutoBackup, doAutoBackupNow, renamePayee,
  renamePayeeImpact, undoVersion,
} from '../lib/store';
import {
  fmt, fmtNum, todayLocal, statOf, statusText, checkup, sumBudget,
  isPayeeNameSuspect, CHECK_CODE,
} from '../lib/core';
import { parseDelimited, TABLE_COLS, mapRow, isHeaderRow, alignByHeader, normalizeHeader } from '../lib/parse';
import {
  storageUsage, fmtKB, byteLen, usageLevel, QUOTA_BYTES, WARN_RATIO,
} from '../lib/storage';
import { ignoredCount, clearIgnore, refreshIgnore, ignoreState } from '../lib/alertIgnore';
import { exportJson, exportXlsx, exportCsv, exportAllCsv } from '../lib/export';
import {
  getLastBackup, setLastBackup,
  getAutoBackup, setAutoBackup, getAutoBackupLog, clearAutoBackupLog,
} from '../lib/prefs';
import { toast, closeDrawer, ui } from '../lib/ui';
import Icon from '../components/Icon.vue';
// 页脚版本号直接读 package.json —— 杜绝「改了两个 json、漏了写死的那行」再次发生。
// esbuild / vite 都能内联 JSON 导入，验证套件里同样生效（verify-k-settings 有断言守着）。
import pkg from '../../package.json';

const appVersion = pkg.version;
const s = stats;
const fileRef = ref(null);
const legacy = ref(detectLegacy());
const threshold = computed({
  get: () => Math.round((book.value?.warnThreshold || 0.8) * 100),
  set: (v) => {
    if (!book.value) return;
    const n = Math.min(Math.max(+v || 80, 1), 100);
    book.value.warnThreshold = n / 100;
    persistNow();
  },
});

/* M3：到期日推算天数（只作用于「没填到期日」的费用项） */
const dueDays = computed({
  get: () => book.value?.dueDays || 30,
  set: (v) => {
    const r = setBookMeta({ dueDays: v });
    if (r.ok) persistNow();
  },
});

/* ---------------- K11（v1.8）逾期催收门槛 ----------------
 * 只影响逾期催收横幅的「门槛」（待付 ≥ 该值才进催收主列表），其它金额计算一个字不变。 */
const remindThreshold = computed({
  get: () => Math.round(book.value?.remindThreshold || 100),
  set: (v) => {
    if (!book.value) return;
    const n = Math.max(0, Math.round(+v || 0));
    book.value.remindThreshold = n;
    persistNow();
  },
});

/* ---------------- K2（v1.8）自动备份 ----------------
 * 开关 + 周期（周/月）存本机偏好（prefs），不进账本；周期边界由 store.maybeAutoBackup 判定。 */
const autoCfg = reactive(getAutoBackup());
const autoPeriod = computed({
  get: () => autoCfg.period,
  set: (v) => { autoCfg.period = v === 'month' ? 'month' : 'week'; setAutoBackup({ ...autoCfg }); },
});
function setAutoEnabled(v) {
  autoCfg.enabled = !!v;
  setAutoBackup({ ...autoCfg });
  toast(autoCfg.enabled ? '已开启自动备份' : '已关闭自动备份');
}
const autoLog = ref(getAutoBackupLog());
function refreshAutoLog() { autoLog.value = getAutoBackupLog(); }
function autoSizeText(bytes) {
  const n = +bytes || 0;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}
function doManualAutoBackup() {
  const r = doAutoBackupNow();
  refreshAutoLog();
  if (r.ok) toast(`已备份：${r.name}`);
  else toast(r.msg || '自动备份失败');
}
function doClearAutoLog() {
  clearAutoBackupLog();
  refreshAutoLog();
  toast('已清空自动备份记录');
}

/* ---------------- K13（v1.8）导入表头别名标注 ----------------
 * 当某表头被 COL_ALIAS 识别映射（如「收款方」→「支付对象」）时，预览显示「已识别为 X」标签。
 * 别名 MAP 本身由 parse.js 实现，本视图只做展示，不改 parse。 */
const impHeader = ref(null);
const impAliasTags = computed(() => {
  if (!impHeader.value || !Array.isArray(impHeader.value)) return [];
  return impHeader.value
    .map((cell) => {
      const c = String(cell || '').trim();
      const mapped = normalizeHeader(c);
      return mapped !== c ? { raw: c, mapped } : null;
    })
    .filter(Boolean);
});

/* M1：今日预警忽略状态（只影响横幅，角标计数仍保留） */
const ignored = computed(() => (ignoreState.date === todayLocal() ? ignoredCount() : 0));
function doClearIgnore() {
  clearIgnore();
  toast('已恢复今日提醒');
}

const helpers = { statOf, statusText };

/* ---------------- 存储占用（Q3） ----------------
 * v1.8.1：把撤销栈键 `ztools_project_cost_undo` 单列，并**保证**计入总占用。
 *
 * 为什么不 import `store.undoBytes()`：该函数由并行任务新增（可能还没落地），
 * 跨任务 import 会在对方合入前直接编译失败（"undoBytes is not exported by store.js"）。
 * 这里改为直接按 localStorage 键读取，字节口径与 storage.js 完全一致
 * （UTF-16：key 与 value 各 `str.length * 2` 字节），零耦合、无第二套数字。
 */
const UNDO_KEY = 'ztools_project_cost_undo';

/** 读撤销栈键占用（键不存在 / 环境不可用 → 0，永不 throw） */
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

/**
 * 在 `storageUsage()` 的既有口径上补撤销栈：**只补差价、绝不重复计**。
 * storage.js 的前缀口径已把 UNDO_KEY 算进 `main`（前缀 `ztools_project_cost` 且不含 `_snap`），
 * 所以这里把它从 `main` 里拆出来单列展示；若哪天前缀口径漏掉它（`keys` 里没有该键），
 * 则把字节补进总量。两条分支都保证「主数据 + 快照 + 撤销栈」恒被覆盖。
 * @param {number} quota 配额字节数
 * @returns {object} storageUsage 的结构 + `undo` 字段
 */
function usageWithUndo(quota = QUOTA_BYTES) {
  const u = storageUsage(quota);
  const undo = readUndoBytes();
  if (!u || !u.ok) return { ...u, undo };
  const hasKey = (u.keys || []).some((k) => k.key === UNDO_KEY);
  const bytes = hasKey ? u.bytes : u.bytes + undo;
  const main = hasKey ? Math.max(0, u.main - undo) : u.main;
  const ratio = quota > 0 ? bytes / quota : 0;
  const percent = Math.round(ratio * 1000) / 10; // 一位小数，与 storage.js 同口径
  return {
    ...u,
    bytes,
    main,
    undo,
    ratio,
    percent,
    level: usageLevel(ratio),   // 阈值不变：<80% ok / ≥80% warn / ≥100% over
    text: `${fmtKB(bytes)} / ${fmtKB(quota)}`,
  };
}

const store = ref(usageWithUndo());
const storeColor = computed(() => (store.value.level === 'ok' ? 'var(--muted)'
  : store.value.level === 'warn' ? 'var(--accent)' : 'var(--danger)'));
const storeBarPct = computed(() => Math.min(100, Math.max(0, store.value.ratio * 100)));
function refreshStore() {
  store.value = usageWithUndo();
}
/**
 * 撤销栈一变，占用数字要跟着变：pushUndo / undo / redo / clearUndo 都会重写 `UNDO_KEY`，
 * 但那些都是 store 里的**纯动作**，Vue 追踪不到，必须借 store 的全局信号 `undoVersion` 驱动重算
 * （同 eng-uiverify 修「撤销/重做按钮不刷新」的思路：视图只读得到 `undoVersion.value`）。
 */
watch(undoVersion, () => refreshStore());
function doRefreshStore() {
  refreshStore();
  toast(`已刷新：${store.value.text}`);
}

/* ---------------- 历史版本（Q1） ---------------- */
const snaps = ref([]);

function refreshSnaps() {
  snaps.value = snapshotList();
  // Q3：快照/回滚/导入都会改变 localStorage 占用，顺手一起刷新
  if (typeof refreshStore === 'function') refreshStore();
}

/** 「立即备份」：手动插一条 daily 记录（同样受 7 份 / 1.5MB 上限约束） */
function doSnapNow() {
  const r = snapshotNow('daily', 'manual');
  refreshSnaps();
  toast(r.ok ? '已备份当前数据' : (r.msg || '备份失败'));
}

function doRestore(snap) {
  const t = fmtSnapTime(snap.ts);
  // eslint-disable-next-line no-alert
  if (!window.confirm(`回滚到 ${t} 的快照？\n\n当前数据会先自动存一份「回滚前」快照，可再回滚回来。`)) return;
  const r = restoreSnapshot(snap.id);
  if (!r.ok) {
    toast(r.msg || '回滚失败');
    return;
  }
  // 抽屉可能停在一条已被回滚删除的费用项上（project 会变 null，footer 读数会崩）
  closeDrawer();
  ui.selId = '';
  refreshSnaps();
  refreshCheckup();
  toast(r.msg);
  if (r.snapWarn) setTimeout(() => toast(r.snapWarn), 600);
}

/* ---------------- 数据体检（Q2） ---------------- */
const issues = ref([]);
const checkOpen = ref(false);
const fixable = ref(0);
const warnable = ref(0);

function refreshCheckup() {
  if (!book.value) {
    issues.value = [];
    fixable.value = 0;
    warnable.value = 0;
    return;
  }
  const r = checkup(book.value);
  issues.value = r.issues;
  fixable.value = r.fixable;
  warnable.value = r.warnable;
  // 残缺项已被改完（或已不存在）时收起行内操作条，避免操作条引用一个已被改掉的名字
  if (!r.issues.some((i) => i.code === SUSPECT_CODE)) payeeFix.open = false;
}

const budgetTotal = computed(() => sumBudget(book.value));

const checkSummary = computed(() => {
  if (!issues.value.length) return '✓ 未发现问题';
  const firstWarn = issues.value.find((i) => !i.fix);
  return [
    `${warnable.value} 类提示`,
    firstWarn ? `${firstWarn.count} ${firstWarn.unit}${firstWarn.title}` : '',
    `${fixable.value} 类可修复`,
  ].filter(Boolean).join(' · ');
});

function toggleCheckup() {
  if (!checkOpen.value) refreshCheckup();
  else closePayeeFix(); // 收起体检时一并收起行内操作条
  checkOpen.value = !checkOpen.value;
}

function doFix(code) {
  const r = fixCheckup([code]);
  refreshCheckup();
  refreshSnaps();
  if (r.ok === false) {
    toast(r.msg || '修复失败');
    return;
  }
  toast(r.msg || '已修复');
  // 若未来出现会动金额的修复码，明确告知差额（本批恒为 0）
  if (r.deltas && r.deltas.payable !== 0) {
    setTimeout(() => toast(`应付 ${fmt(s.value.payable - r.deltas.payable)} → ${fmt(s.value.payable)}`), 600);
  }
}

/* ---------------- 体检：收款方残缺项「改名 / 合并」（v1.8.1） ----------------
 * 背景：C4（v1.7）的 payee-name-suspect 一直「只报不改」——用户看到「收款方名疑似残缺」
 * 却没有任何入口，只能自己去「收款方档案」里猜。这里在体检行内补一个折叠操作条，
 * 直接调 store.renamePayee()（会全局改写费用项 object 与付款 payee 并维护注册表，0 孤儿）。
 *
 * 不新增列、不新增页签：操作条只在展开体检后、且该项存在时才渲染。
 */
const SUSPECT_CODE = CHECK_CODE.PAYEE_NAME_SUSPECT;
/** 行内操作条状态：open 控制折叠；from = 要改的残缺名；to = 合并目标 */
const payeeFix = reactive({ open: false, from: '', to: '' });

/** 当前账套里所有「疑似残缺」的收款方名（去重，按出现顺序） */
const suspectNames = computed(() => {
  const b = book.value;
  if (!b) return [];
  const out = [];
  (b.projects || []).forEach((p) => {
    const n = String(p.object || '').trim();
    if (n && isPayeeNameSuspect(n) && !out.includes(n)) out.push(n);
  });
  return out;
});

/** 合并目标：账套已登记的收款方，排除当前选中的残缺名自身 */
const payeeTargets = computed(() => {
  const b = book.value;
  if (!b) return [];
  const out = [];
  (b.payees || []).forEach((p) => {
    const n = String(p.name || '').trim();
    if (n && n !== payeeFix.from && !out.includes(n)) out.push(n);
  });
  return out;
});

/** 选中某个残缺名后，默认落在第一个可选目标上（用户仍可改） */
function pickDefaultTarget() {
  payeeFix.to = payeeTargets.value[0] || '';
}

function openPayeeFix() {
  if (!suspectNames.value.length) {
    toast('当前没有被判为残缺的收款方名');
    return;
  }
  payeeFix.from = suspectNames.value[0];
  pickDefaultTarget();
  payeeFix.open = true;
}

function closePayeeFix() {
  payeeFix.open = false;
}

function togglePayeeFix() {
  if (payeeFix.open) closePayeeFix();
  else openPayeeFix();
}

/** K23：改名 / 合并影响预览（与落库同口径的纯函数；from/to 无效时为 null，不显示预览行） */
const payeeFixImpact = computed(() => {
  const from = String(payeeFix.from || '').trim();
  const to = String(payeeFix.to || '').trim();
  return (from && to && from !== to) ? renamePayeeImpact(from, to) : null;
});

/** 应用改名 / 合并；任何失败都要有明确 toast，绝不静默 */
function applyPayeeFix() {
  const from = String(payeeFix.from || '').trim();
  const to = String(payeeFix.to || '').trim();
  if (!from) {
    toast('请先选择要改名的收款方');
    return;
  }
  if (!to) {
    toast('请选择「合并到」的目标收款方');
    return;
  }
  if (from === to) {
    // 防御：与目标同名时不做任何改动（store 侧也会拒绝，这里先拦住避免脏数据）
    toast('目标与原名相同，未做改动');
    return;
  }
  const r = renamePayee(from, to);
  if (!r || r.ok === false) {
    toast((r && r.msg) || '改名失败');
    return;
  }
  toast(r.msg, { undo: true });
  refreshCheckup();   // 立刻重算，界面不留已消失的旧条目
  refreshStore();     // 改名会改写主数据，占用随之变化
  // 还有别的残缺名就顺势停在下一个，没有就收起操作条
  const rest = suspectNames.value.filter((n) => n !== from);
  if (rest.length) {
    payeeFix.from = rest[0];
    pickDefaultTarget();
  } else {
    closePayeeFix();
  }
}

onMounted(() => {
  refreshIgnore();      // M1：跨天复位（昨天忽略的不影响今天）
  refreshSnaps();
  refreshCheckup();
  refreshStore();
  refreshAutoLog();     // K2：拉取自动备份日志
});

/* ---------------- 导出 / 导入 ---------------- */
/**
 * B4：上次备份时间（独立 localStorage 键，不进账本）。
 * 只做「提示」，**不做自动落盘** —— 没有后端就不能静默写文件，
 * 假装备份过比不备份更危险，所以这里只负责把日期摆在用户眼前。
 */
const lastBackupAt = ref(getLastBackup());
const BACKUP_WARN_DAYS = 7;
const backupState = computed(() => {
  const ts = lastBackupAt.value;
  if (!ts) return { warn: true, text: '从未导出过备份，建议立即导出' };
  const days = Math.floor(Math.max(0, Date.now() - ts) / 86400000);
  if (days >= BACKUP_WARN_DAYS) return { warn: true, text: `已 ${days} 天未备份，建议立即导出备份` };
  if (days === 0) return { warn: false, text: '今天已备份' };
  return { warn: false, text: `上次备份 ${days} 天前` };
});

function doExportJson() {
  const r = exportJson(state, book.value);
  lastBackupAt.value = setLastBackup(Date.now());
  toast(`已导出 ${r.name}`);
}
function doExportXlsx() {
  const r = exportXlsx(book.value, todayLocal(), helpers);
  toast(`已导出 Excel：${r.sheets} 张表 / ${r.rows} 行`);
}
function doExportCsv() {
  exportCsv(book.value, todayLocal(), helpers);
  toast('已导出费用表 CSV');
}
function doExportAllCsv() {
  exportAllCsv(book.value, todayLocal(), helpers);
  toast('已导出 3 份 CSV');
}

async function onFile(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const text = await f.text();
    const data = JSON.parse(text);
    const r = importState(data);
    toast(r.msg || '导入完成');
    if (r.snapWarn) setTimeout(() => toast(r.snapWarn), 600);
    refreshSnaps();
    refreshCheckup();
  } catch (_) {
    toast('文件格式不正确，需为 JSON 备份');
  }
  e.target.value = '';
}

function doLegacy(key) {
  const r = importLegacy(key);
  legacy.value = detectLegacy();
  toast(r.msg);
  if (r.snapWarn) setTimeout(() => toast(r.snapWarn), 600);
  refreshSnaps();
  refreshCheckup();
}

/* ---------------- X1 CSV 导入（三表回读） ----------------
 * 流程：选表类型 → 选文件 → parseDelimited → 按表头对齐 → mapRow 校验 →
 *       预览前 5 行 + 错误行 → 选冲突策略 → importTable（内部 pushUndo + snapshotNow('pre','import')）。
 * 只填充数据，不另存总额：明细 → 总计 → 应付链由 store 现算，不产生第二真源。 */
const IMP_TABLES = [
  { v: 'project', t: '费用项' },
  { v: 'detail', t: '明细' },
  { v: 'pay', t: '付款' },
];
const IMP_STRATEGY = [
  { v: 'append', t: '追加' },
  { v: 'overwrite', t: '按编号覆盖' },
  { v: 'skip', t: '跳过已存在' },
];
const impRef = ref(null);
const impTable = ref('detail');
const impStrategy = ref('append');
const impFileName = ref('');
const impRows = ref([]);
const impErrors = ref([]);

const impCols = computed(() => TABLE_COLS[impTable.value] || []);

/** 去重键提示（与设计 §5.7 / PRD #8 一致） */
const impKeyHint = computed(() => {
  if (impTable.value === 'project') return '按「项目号」匹配';
  if (impTable.value === 'detail') return '明细按「项目号 + 品名 + 金额」去重';
  // v1.6：付款有唯一键后不再依赖「日期 + 金额」猜行，同日多笔也能精确覆盖
  return '付款优先按「付款编号」定位；无编号时按「项目号 + 日期 + 金额」去重';
});

function resetImport() {
  impFileName.value = '';
  impRows.value = [];
  impErrors.value = [];
  impHeader.value = null; // K13：清掉遗留的别名标注
}

/** 预演一行（表格里看不到全貌时给一眼摘要） */
function previewText(r) {
  if (impTable.value === 'project') return `${r.no} · ${r.remark} · 总计 ${fmtNum(r.total)} · ${r.object || '无对象'}`;
  if (impTable.value === 'detail') return `${r.no} · ${r.name} · ${r.qty ?? '—'} × ${r.price ?? '—'} = ${fmtNum(r.amount)}`;
  return `${r.no} · ${r.date} · ${r.method} · ${fmtNum(r.amount)}${r.pid ? ` · ${r.pid}` : ''}${r.voidFlag ? ' · 作废' : ''}`;
}

async function onImpFile(e) {
  const f = e.target.files?.[0];
  e.target.value = ''; // 允许重复选同一个文件
  if (!f) return;
  resetImport();
  impFileName.value = f.name;
  let text = '';
  try {
    text = await f.text();
  } catch (_) {
    toast('文件读取失败，请重试');
    return;
  }
  const grid = parseDelimited(text);
  if (!grid.length) {
    toast('文件里没有可解析的内容');
    return;
  }
  const table = impTable.value;
  // ① 有表头就先按中文列名对齐：导出的 CSV 列更多、顺序不同，纯按位置映射会错列
  const hasHead = isHeaderRow(table, grid[0]);
  const header = hasHead ? grid[0] : null;
  impHeader.value = header; // K13：记下原始表头，供预览标注别名
  const body = hasHead ? grid.slice(1) : grid;
  const good = [];
  const bad = [];
  body.forEach((cells, i) => {
    const aligned = header ? alignByHeader(table, header, cells) : cells;
    const r = mapRow(table, aligned);
    if (r.error) bad.push({ line: i + (hasHead ? 2 : 1), msg: r.error, raw: cells.join(' | ') });
    else good.push(r);
  });
  impRows.value = good;
  impErrors.value = bad;
  if (!good.length) toast(bad.length ? `没有可导入的行（${bad.length} 行格式有误）` : '文件里没有数据行');
}

function doImportTable() {
  if (!impRows.value.length) {
    toast('没有可导入的有效行');
    return;
  }
  // store.importTable 内部：pushUndo() + snapshotNow('pre','import') 双保险
  const r = importTable(impTable.value, impRows.value, impStrategy.value);
  if (r.ok === false) {
    toast(r.msg || '导入失败');
    return;
  }
  toast(r.msg);
  if (r.snapWarn) setTimeout(() => toast(r.snapWarn), 600);
  resetImport();
  refreshSnaps();
  refreshCheckup();
}

function doReset(seed) {
  const msg = seed ? '将当前项目恢复为默认台账（覆盖现有数据）？' : '将清空当前项目的全部预算、费用项、档案？';
  // eslint-disable-next-line no-alert
  if (!window.confirm(`${msg}\n\n此操作可用底部提示中的「撤销」回退，也会存一份「历史版本」快照。`)) return;
  const r = resetActiveBook(seed);
  toast(seed ? '已恢复默认台账' : '已清空当前项目', { undo: true });
  if (r && r.snapWarn) setTimeout(() => toast(r.snapWarn), 600);
  refreshSnaps();
  refreshCheckup();
}

const counts = computed(() => ({
  projects: s.value.count,
  details: s.value.detailCount,
  payments: s.value.payCount,
  cats: (book.value?.categories || []).length,
  payees: (book.value?.payees || []).length,
}));
</script>

<template>
  <div class="pane" data-view="settings">
    <div class="content">
      <div class="card">
        <div class="sec-head" data-card-head="overview"><span class="bar" />数据概况</div>
        <div class="kpi-strip" style="grid-template-columns: repeat(3, minmax(0, 1fr))">
          <div class="kpi sky"><div class="k">费用项</div><div class="v">{{ counts.projects }}</div><div class="s">{{ counts.details }} 条明细</div></div>
          <div class="kpi ok"><div class="k">付款</div><div class="v">{{ counts.payments }}</div><div class="s">笔流水</div></div>
          <div class="kpi"><div class="k">档案</div><div class="v">{{ counts.cats }} / {{ counts.payees }}</div><div class="s">品类 / 收款方</div></div>
        </div>
        <div class="divider" />
        <div class="kv"><span>累计应付</span><b>{{ fmt(s.payable) }}</b></div>
        <div class="kv"><span>已支付</span><b>{{ fmt(s.paid) }}</b></div>
        <div class="kv"><span>待支付</span><b :style="{ color: s.remain > 0 ? 'var(--accent)' : 'var(--ok)' }">{{ fmt(s.remain) }}</b></div>
        <div class="divider" />
        <div class="kv">
          <span>存储占用</span>
          <b class="num" :style="{ color: storeColor, fontSize: '11.5px' }">{{ store.ok ? store.text : '不可用' }}</b>
        </div>
        <div class="st-bar"><i :style="{ width: storeBarPct + '%', background: storeColor }" /></div>
        <div class="row" style="gap: 6px">
          <span
            class="mini"
            :style="{ color: store.level === 'ok' ? 'var(--muted)' : 'var(--danger)', flex: 1, minWidth: 0 }"
          >
            <template v-if="store.level === 'ok'">已用 {{ store.percent }}% · 主数据 {{ fmtKB(store.main) }} · 快照 {{ fmtKB(store.snap) }}<template v-if="store.undo > 0"> · 撤销栈 {{ fmtKB(store.undo) }}</template></template>
            <template v-else-if="store.level === 'warn'">{{ store.percent }}% 接近上限（{{ Math.round(WARN_RATIO * 100) }}% 预警），请先「导出 JSON 备份」再继续录入</template>
            <template v-else>已达上限，写入将被拒绝 —— 请立即导出 JSON 备份并精简数据</template>
          </span>
          <button class="link" @click="doRefreshStore">刷新</button>
        </div>
        <div class="kv"><span>存储键</span><b style="font-weight: 500; font-size: 10.5px; color: var(--muted)">localStorage · {{ KEY }}</b></div>
        <!-- v1.8.1：撤销栈单列（此字节数已计入上方总占用，此处只是拆出来让用户看得见） -->
        <div class="kv" data-store-undo-row>
          <span>撤销栈</span>
          <b class="num" style="font-weight: 500; font-size: 10.5px; color: var(--muted)">{{ fmtKB(store.undo) }} · {{ UNDO_KEY }}</b>
        </div>
      </div>

      <div class="card">
        <div class="sec-head">
          <span class="bar" />历史版本
          <span class="spacer" />
          <button class="btn sm" @click="doSnapNow"><Icon name="download" :size="11" />立即备份</button>
        </div>
        <div v-if="snaps.length" class="snap-list">
          <div v-for="snap in snaps" :key="snap.id" class="snap-row">
            <span class="snap-time num">{{ fmtSnapTime(snap.ts) }}</span>
            <span class="snap-kind" :class="snap.kind">{{ REASON_TEXT[snap.reason] || snap.reason }}</span>
            <span class="grow mini">
              {{ snap.stat.items }} 项 · {{ fmtNum(snap.stat.payable) }}<span v-if="snap.imgDropped"> · 不含 {{ snap.imgDropped }} 张凭证图</span>
            </span>
            <button class="link" @click="doRestore(snap)">回滚</button>
          </div>
        </div>
        <div v-else class="mini">还没有历史版本，下次启动会自动备份一份。</div>
        <div class="mini" style="margin-top: 5px">
          仅备份账目数据（不含凭证图）。单日一份，保留 7 天，另存 3 份操作前快照；回滚前会自动再存一份。
        </div>
      </div>

      <div class="card">
        <div class="sec-head">
          <span class="bar" />数据体检
          <span class="spacer" />
          <button class="btn sm" @click="refreshCheckup"><Icon name="check" :size="11" />重新体检</button>
        </div>
        <div class="row check-sum" @click="toggleCheckup">
          <span class="grow" :class="issues.length ? 'mini' : 'mini ok'">{{ checkSummary }}</span>
          <span class="mini">{{ checkOpen ? '收起' : '展开' }}</span>
        </div>
        <div class="mini" style="margin-top: 2px">
          应付 {{ fmt(s.payable) }} · 预算合计 {{ fmt(budgetTotal) }}
        </div>
        <div v-if="checkOpen && issues.length" class="iss-list">
          <div v-for="it in issues" :key="it.code" class="iss-row" :data-check-code="it.code">
            <div class="row" style="gap: 6px">
              <span class="grow" style="font-size: 11.5px; color: var(--ink-2)">{{ it.title }}</span>
              <span class="mini num">{{ it.count }} {{ it.unit }}</span>
              <span v-if="it.amount" class="mini num">涉及 {{ fmtNum(it.amount) }}</span>
              <button v-if="it.fix" class="link" @click="doFix(it.code)">{{ it.fixLabel }}</button>
              <!-- v1.8.1：残缺名此前「只报不改」，这里给行内改名 / 合并入口 -->
              <button
                v-else-if="it.code === SUSPECT_CODE"
                class="link" data-payee-fix-toggle
                @click="togglePayeeFix"
              >{{ payeeFix.open ? '收起' : '改名 / 合并' }}</button>
            </div>
            <div class="mini">{{ it.note }}</div>
            <!-- 行内操作条：折叠态，不新增列 / 页签；两项 select + 应用约 380px，738px 内容区内不挤 -->
            <div
              v-if="it.code === SUSPECT_CODE && payeeFix.open && suspectNames.length"
              class="payee-fix" data-payee-fix
            >
              <div class="row" style="gap: 5px; flex-wrap: wrap">
                <span class="mini" style="flex: none; color: var(--muted)">残缺名</span>
                <select v-model="payeeFix.from" class="mini-select" style="max-width: 104px" data-payee-fix-from>
                  <option v-for="n in suspectNames" :key="n" :value="n">{{ n }}</option>
                </select>
                <span class="mini" style="flex: none; color: var(--muted)">合并到</span>
                <select v-model="payeeFix.to" class="mini-select" style="max-width: 118px" data-payee-fix-to>
                  <option v-for="n in payeeTargets" :key="n" :value="n">{{ n }}</option>
                </select>
                <button
                  class="btn sm primary" data-payee-fix-apply
                  :disabled="!payeeFix.from || !payeeFix.to"
                  @click="applyPayeeFix"
                >应用</button>
                <button class="link" @click="closePayeeFix">取消</button>
              </div>
              <div class="mini" style="margin-top: 3px">
                共 {{ suspectNames.length }} 个残缺名；应用后所有费用项与付款的引用同步改写，金额不变，可用底部「撤销」一步回退。
              </div>
              <!-- K23：影响预览（与 PayeeForm 共用 store.renamePayeeImpact 的口径） -->
              <div v-if="payeeFixImpact" class="mini" style="margin-top: 3px" data-payee-fix-preview>
                本次将迁移 <b class="num">{{ payeeFixImpact.projects }}</b> 个费用项（应付 {{ fmt(payeeFixImpact.payable) }}）
                · 改写 <b class="num">{{ payeeFixImpact.payCount }}</b> 笔付款的收款方
                · {{ payeeFixImpact.merged ? `「${payeeFix.to}」档案已存在，将合并为一份` : '将按新名建档（无孤儿引用）' }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="sec-head"><span class="bar" />导出</div>
        <div class="grid2">
          <button class="btn" @click="doExportXlsx"><Icon name="download" :size="13" />Excel（3 表）</button>
          <button class="btn" @click="doExportJson"><Icon name="download" :size="13" />JSON 备份</button>
          <button class="btn" @click="doExportCsv"><Icon name="download" :size="13" />费用表 CSV</button>
          <button class="btn" @click="doExportAllCsv"><Icon name="download" :size="13" />全量 CSV</button>
        </div>
        <div class="mini" style="margin-top: 7px">Excel 内含支出 / 明细 / 付款三张工作表，金额列按数字写入，可直接参与公式；JSON 为完整备份（含多账套）。</div>
        <!-- B4：备份提醒。warn = 从未备份 / 超过 7 天；不自动下载，只催 -->
        <div class="row" style="margin-top: 6px" data-backup-line>
          <span
            class="mini" data-backup-status
            :style="{ color: backupState.warn ? 'var(--warn)' : 'var(--muted)' }"
          >{{ backupState.text }}</span>
        </div>
        <div class="mini" style="margin-top: 2px">数据仅存本机，请自行备份</div>
      </div>

      <div class="card">
        <div class="sec-head">
          <span class="bar" />自动备份
          <span class="spacer" />
          <label class="switch" style="font-size: 11px; color: var(--muted)">
            <input type="checkbox" :checked="autoCfg.enabled" @change="setAutoEnabled($event.target.checked)" />
            <span class="track"><span class="knob" /></span>
            {{ autoCfg.enabled ? '已开启' : '已关闭' }}
          </label>
        </div>
        <div class="row" style="gap: 6px; flex-wrap: wrap">
          <span class="mini">周期</span>
          <select v-model="autoPeriod" class="mini-select">
            <option value="week">每周</option>
            <option value="month">每月</option>
          </select>
          <span class="grow" />
          <button class="btn sm" @click="doManualAutoBackup"><Icon name="download" :size="11" />立即备份</button>
        </div>
        <div class="mini" style="margin-top: 6px">
          开启后，每到{{ autoPeriod === 'month' ? '月初' : '周一' }}自动导出一份 JSON 备份到下载文件夹（复用「导出 JSON 备份」同一机制）。仅本机偏好，不进账本。
        </div>
        <div v-if="autoLog.length" class="imp-list" style="margin-top: 6px">
          <div v-for="(e, i) in autoLog" :key="i" class="imp-line">
            {{ fmtSnapTime(e.ts) }} · {{ autoSizeText(e.size) }}<span v-if="e.name" class="ellipsis" style="color: var(--muted)"> · {{ e.name }}</span>
          </div>
        </div>
        <div v-else class="mini" style="margin-top: 6px">还没有自动备份记录。</div>
        <div v-if="autoLog.length" class="row" style="margin-top: 5px">
          <span class="grow" />
          <button class="link" @click="doClearAutoLog">清空记录</button>
        </div>
      </div>

      <div class="card">
        <div class="sec-head"><span class="bar" />导入与搬家</div>
        <div class="grid2">
          <button class="btn" @click="fileRef.click()"><Icon name="upload" :size="13" />导入 JSON</button>
          <button class="btn" :disabled="!legacy.length" @click="doLegacy(legacy[0].key)">
            <Icon name="upload" :size="13" />从网页版导入
          </button>
        </div>
        <input ref="fileRef" type="file" accept=".json,application/json" hidden @change="onFile" />
        <div v-if="legacy.length" class="legacy">
          <div v-for="l in legacy" :key="l.key" class="legacy-row">
            <span class="tag" style="background: var(--sky-soft); color: var(--sky)">{{ l.key.replace('renovation_cost_', '') }}</span>
            <span class="grow mini">{{ l.books }} 个项目 · {{ l.projects }} 个费用项</span>
            <button class="link" @click="doLegacy(l.key)">导入</button>
          </div>
          <div class="mini" style="margin-top: 4px">导入为新增项目，不覆盖现有数据。</div>
        </div>
        <div v-else class="mini" style="margin-top: 7px">
          未检测到网页版数据。插件与浏览器存储不同源，跨端搬家请用网页版「导出 JSON 备份」后，在此「导入 JSON」。
        </div>
      </div>

      <!-- X1 CSV 导入（三表回读） -->
      <div class="card">
        <div class="sec-head">
          <span class="bar" />CSV 导入
          <span class="spacer" />
          <span v-if="impFileName" class="hint ellipsis" style="max-width: 180px" :title="impFileName">{{ impFileName }}</span>
        </div>
        <div class="row" style="gap: 6px; flex-wrap: wrap">
          <div class="seg">
            <button
              v-for="t in IMP_TABLES" :key="t.v"
              :class="{ on: impTable === t.v }"
              @click="impTable = t.v; resetImport()"
            >{{ t.t }}</button>
          </div>
          <span class="grow" />
          <button class="btn sm" @click="impRef.click()"><Icon name="upload" :size="11" />选择 CSV</button>
        </div>
        <input ref="impRef" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden @change="onImpFile" />
        <div class="mini" style="margin-top: 5px">
          列顺序：{{ impCols.join(' / ') }}
        </div>
        <div class="mini">
          有表头时按列名自动对齐（多余列忽略），无表头则按上面顺序取列；格式错误的行会被列出且不落库。
        </div>

        <!-- K13（v1.8）：导入表头被 COL_ALIAS 识别映射时，显示「已识别为 X」标签 -->
        <div v-if="impAliasTags.length" class="row" style="gap: 5px; flex-wrap: wrap; margin-top: 5px">
          <span class="mini" style="color: var(--muted)">表头识别：</span>
          <span
            v-for="t in impAliasTags" :key="t.raw"
            class="tag" style="background: var(--sky-soft); color: var(--sky); font-size: 9.5px"
            :title="`表头「${t.raw}」已识别为「${t.mapped}」`"
          >{{ t.raw }} 已识别为 {{ t.mapped }}</span>
        </div>

        <template v-if="impRows.length || impErrors.length">
          <div class="divider" />
          <div class="row" style="gap: 6px; flex-wrap: wrap">
            <span class="mini">冲突策略</span>
            <select v-model="impStrategy" class="mini-select">
              <option v-for="s in IMP_STRATEGY" :key="s.v" :value="s.v">{{ s.t }}</option>
            </select>
            <span class="grow" />
            <span class="mini">可导入 <b class="num" style="color: var(--ok)">{{ impRows.length }}</b></span>
            <span v-if="impErrors.length" class="mini">错误 <b class="num" style="color: var(--danger)">{{ impErrors.length }}</b></span>
            <button class="btn sm primary" :disabled="!impRows.length" @click="doImportTable">确认导入</button>
          </div>
          <div class="mini" style="margin-top: 3px">{{ impKeyHint }}</div>
          <div v-if="impRows.length" class="imp-list">
            <div v-for="(r, i) in impRows.slice(0, 5)" :key="'ok' + i" class="imp-line">{{ previewText(r) }}</div>
            <div v-if="impRows.length > 5" class="mini">…另有 {{ impRows.length - 5 }} 行未展示</div>
          </div>
          <div v-if="impErrors.length" class="imp-list err">
            <div v-for="(e, i) in impErrors.slice(0, 5)" :key="'bad' + i" class="imp-line">
              第 {{ e.line }} 行：{{ e.msg }}<span v-if="e.raw"> · {{ e.raw }}</span>
            </div>
            <div v-if="impErrors.length > 5" class="mini">…另有 {{ impErrors.length - 5 }} 行错误未展示</div>
          </div>
        </template>
        <div class="mini" style="margin-top: 6px">
          导入前会自动存一份「历史版本」快照并支持撤销；只填充数据，不另存总额（明细 → 总计 → 应付链不变）。
        </div>
      </div>

      <div class="card">
        <div class="sec-head"><span class="bar" />预算临界预警</div>
        <div class="row">
          <input v-model.number="threshold" class="input" type="number" min="1" max="100" step="5" style="width: 76px" />
          <span class="mini">% — 品类使用率达到该比例且未超支时，顶部提示</span>
        </div>
        <div v-if="ignored" class="row" style="margin-top: 7px">
          <span class="mini" style="flex: 1; min-width: 0">今日已忽略 {{ ignored }} 类提醒（角标仍显示条数）</span>
          <button class="link" @click="doClearIgnore">恢复</button>
        </div>
      </div>

      <div class="card">
        <div class="sec-head"><span class="bar" />逾期催收门槛</div>
        <div class="row">
          <input v-model.number="remindThreshold" class="input" type="number" min="0" step="10" style="width: 90px" />
          <span class="mini">元 — 仅影响逾期催收横幅：待付 <b>≥ 该值</b> 才进催收主列表，更小的折叠成「另有 N 笔小额逾期」。<b>不改任何金额计算</b>。</span>
        </div>
        <div class="mini" style="margin-top: 6px">
          默认 100 元（与历史一致）。只调展示分组，顶部预警条与统计口径完全不变。
        </div>
      </div>

      <div class="card">
        <div class="sec-head"><span class="bar" />到期日推算</div>
        <div class="row">
          <input v-model.number="dueDays" class="input" type="number" min="1" max="365" step="1" style="width: 76px" />
          <span class="mini">天 — 只作用于<b>未填到期日</b>的费用项（下单日 + N 天）；工时不同就改这里，如 7 天结填 7、月结 45 天填 45</span>
        </div>
        <div class="mini" style="margin-top: 6px">
          当前「{{ book.name }}」按<b>下单日 + {{ dueDays }} 天</b>推算；已填到期日的费用项不受影响，逾期与账龄判断同步使用该口径。
        </div>
      </div>

      <div class="card">
        <div class="sec-head"><span class="bar" />快捷键</div>
        <div class="keys">
          <div><kbd>⌘K</kbd><kbd>/</kbd><span>聚焦搜索</span></div>
          <div><kbd>N</kbd><span>新增费用项</span></div>
          <div><kbd>J</kbd><kbd>K</kbd><span>上下移动选中</span></div>
          <div><kbd>Enter</kbd><span>打开选中项</span></div>
          <div><kbd>1</kbd>–<kbd>6</kbd><span>切换分区</span></div>
          <div><kbd>Esc</kbd><span>关闭抽屉 / 清空筛选</span></div>
        </div>
      </div>

      <div class="card">
        <div class="sec-head"><span class="bar" />危险操作</div>
        <div class="grid2">
          <button class="btn" @click="doReset(true)">恢复默认台账</button>
          <button class="btn danger" @click="doReset(false)">清空当前项目</button>
        </div>
        <div class="mini" style="margin-top: 7px">仅作用于「{{ book.name }}」，其他项目不受影响。</div>
      </div>

      <!-- 版本号**不再硬编码** —— 直接读 package.json，见上方 `appVersion`。
           历史教训：v1.9.0 只改了 package.json / plugin.json、漏了这行写死的字符串，
           设置页一直显示 v1.8.2，四个 UI 套件（v13/v14/v15/v16-ui）当场转红。
           verify-k-settings 有一条源码级断言守着这里必须是 `pkg.version`。 -->
      <div class="mini center" style="margin: 14px 0 4px">
        项目费用管理 · ZTools 插件版 v{{ appVersion }} · 数据仅存本机
      </div>
    </div>
  </div>
</template>

<style scoped>
/* flex 列布局：让 .content（flex:1 + min-height:0 + overflow-y:auto）真正成为唯一的纵向滚动层。
   缺 display:flex 时 .content 会按内容高度撑开（页面 8 张卡片约 1150px）并被 .main 的
   overflow:hidden 裁掉，底部卡片无法滚到 —— 加两张卡片后必须修，否则新卡片下方的既有
   卡片（导出 / 导入 / 快捷键 / 危险操作）会彻底看不见。 */
.pane { display: flex; flex-direction: column; height: 100%; min-height: 0; }
/* Q3 存储占用条：6px 细条，与预算条同视觉语言 */
.st-bar {
  height: 6px;
  margin: 5px 0 4px;
  border-radius: 3px;
  background: var(--surface-3);
  overflow: hidden;
}
.st-bar > i { display: block; height: 100%; border-radius: 3px; transition: width .25s ease; }
.legacy { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
/* X1 CSV 导入：预览/错误行各自限高滚动，设置页始终只有一层滚动条 */
.mini-select {
  height: 24px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
  color: var(--ink-2);
  font-size: 11.5px;
  font-family: inherit;
  padding: 0 4px;
  max-width: 122px;
}
.mini-select:focus { outline: none; border-color: var(--accent); }
.imp-list {
  margin-top: 6px;
  max-height: 92px;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface-2);
  padding: 4px 7px;
}
.imp-list.err { background: var(--danger-soft); border-color: var(--danger); }
.imp-line {
  font-size: 10.5px;
  line-height: 1.65;
  color: var(--ink-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.imp-list.err .imp-line { color: var(--danger); }
.legacy-row { display: flex; align-items: center; gap: 6px; }
.keys { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 10px; font-size: 11.5px; color: var(--ink-2); }
.keys > div { display: flex; align-items: center; gap: 4px; }
/* 历史版本：10 条上限，固定高度内滚动，保证设置页只有一层滚动条 */
.snap-list { max-height: 190px; overflow-y: auto; display: flex; flex-direction: column; }
.snap-row { display: flex; align-items: center; gap: 6px; padding: 3px 0; font-size: 11px; }
.snap-time { color: var(--ink-2); font-variant-numeric: tabular-nums; flex: none; }
.snap-kind {
  flex: none;
  font-size: 9.5px;
  padding: 0 4px;
  border-radius: 4px;
  background: var(--surface-3);
  color: var(--muted);
}
.snap-kind.pre { background: var(--sky-soft); color: var(--sky); }
/* 数据体检：展开态自身滚动，不撑破 618px */
.check-sum { cursor: pointer; }
.check-sum .mini.ok { color: var(--ok); }.iss-list { max-height: 200px; overflow-y: auto; margin-top: 5px; display: flex; flex-direction: column; gap: 5px; }
.iss-row { border-top: 1px solid var(--line); padding-top: 5px; }
.iss-row:first-child { border-top: none; padding-top: 0; }
/* v1.8.1 体检行内「改名 / 合并」操作条：折叠态卡片，内部 flex-wrap，
   738px 内容区内一行放得下（残缺名 104 + 合并到 118 + 应用 48 + 取消 28 + 标签约 90 ≈ 390px） */
.payee-fix {
  margin-top: 4px;
  padding: 5px 7px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface-2);
}
.payee-fix .mini-select { height: 22px; font-size: 11px; }
/* K2 自动备份开关 */
.switch { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; user-select: none; }
.switch input { display: none; }
.switch .track {
  width: 30px; height: 17px; border-radius: 9px; background: var(--surface-3);
  position: relative; transition: background .2s ease; flex: none;
}
.switch .knob {
  position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, .3); transition: left .2s ease;
}
.switch input:checked + .track { background: var(--accent); }
.switch input:checked + .track .knob { left: 15px; }
kbd {
  display: inline-block;
  min-width: 16px;
  text-align: center;
  border: 1px solid var(--line);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--surface-2);
  padding: 0 3px;
  font-size: 10px;
  font-family: ui-monospace, Menlo, monospace;
  color: var(--ink-2);
}
</style>

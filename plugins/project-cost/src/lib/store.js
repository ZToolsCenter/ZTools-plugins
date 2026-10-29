import { reactive, computed, watch, ref } from 'vue';
import { SEED } from './seed';
/** K2（v1.8）：自动备份配置 / 日志（独立键，不进账本）。 */
import {
  getAutoBackup, getLastAutoBackup, setLastAutoBackup, addAutoBackupLog,
  getAutoBackupNoticed, setAutoBackupNoticed,
  // K16/K20（v1.9.x）：密度信号恢复（备份搭载的偏好导回时用它落库）
  getDensity, setDensity, normDensity,
} from './prefs';
/** K2（v1.8）：复用 exportJson 走同一套下载机制（ZTools 无文件系统 API，落浏览器下载目录）。 */
import { exportJson } from './export';
import {
  calc, uid, PALETTE, normDate, round2, detailSum, syncTotalFromDetails,
  payableOf, dueOf, nextNo, todayLocal, fmt,
  sumBudget, syncTotalBudget, checkup,
  estAmountOf, confirmedPayableOf, nextPid, ensurePayIds,
  normNoPrefix, payPidOf,
} from './core';
import {
  saveSnapshot, listSnaps, readSnapshot, maybeDailySnapshot as maybeDaily, fmtSnapTime, REASON_TEXT,
} from './snapshot';

/** 插件独立命名空间，与网页版 localStorage 互不覆盖 */
const KEY = 'ztools_project_cost_v1';
/** K1（v1.8）：撤销栈独立持久化键。与 `KEY`（主数据）/ `SNAP_KEY`（快照）三者分离，
 *  避免 deep watch → persist 的死循环，也不与 7 日快照抢 5MB 配额。 */
const UNDO_KEY = 'ztools_project_cost_undo';
/** K18（v1.9.x）：重做栈独立持久化键。与撤销栈同构、同预算（800KB 落盘子集），见下方 redo 段。 */
const REDO_KEY = 'ztools_project_cost_redo';
/** v1.0 时期的键名（插件原名「装修费用管理」）：首次启动自动搬迁，用户数据不丢 */
const PREV_KEYS = ['ztools_renovation_cost_v1'];
/** 网页版历史键：用于「从网页版导入」搬家 */
export const LEGACY_KEYS = ['renovation_cost_v8', 'renovation_cost_v7', 'renovation_cost_v6'];

const clone = (v) => JSON.parse(JSON.stringify(v));
const round2local = round2;

export const state = reactive({
  books: [],
  activeBookId: '',
  templates: [],
  warnThreshold: 0.8,
});

/* ---------------- 账套 ---------------- */
export const book = computed(
  () => state.books.find((b) => b.id === state.activeBookId) || state.books[0] || null,
);

export const stats = computed(() => calc(book.value));

function nextBookColor() {
  const used = new Set(state.books.map((b) => b.color));
  return PALETTE.find((c) => !used.has(c)) || PALETTE[state.books.length % PALETTE.length];
}

export function mkBook(name = '新项目', data = {}) {
  return {
    id: uid(),
    name,
    color: data.color || nextBookColor(),
    createdAt: Date.now(),
    totalBudget: +data.totalBudget || 0,
    budget: clone(data.budget || {}),
    projects: clone(data.projects || []),
    categories: clone(data.categories || []),
    payees: clone(data.payees || []),
    warnThreshold: data.warnThreshold || 0.8,
    dueDays: +data.dueDays > 0 ? Math.min(365, Math.max(1, Math.round(+data.dueDays))) : 30, // M3
    area: +data.area > 0 ? +data.area : 0,                                                 // A4（0 = 未填）
    noPrefix: normNoPrefix(data.noPrefix),                                                 // C6：编号前缀（缺省 ZX）
    remindThreshold: +data.remindThreshold > 0 ? Math.round(+data.remindThreshold) : 100, // K11：催收门槛（缺省 100）
  };
}

export function normalizeBook(b) {
  if (!b) return b;
  b.projects = Array.isArray(b.projects) ? b.projects : [];
  b.categories = Array.isArray(b.categories) ? b.categories : [];
  b.payees = Array.isArray(b.payees) ? b.payees : [];
  b.budget = b.budget && typeof b.budget === 'object' ? b.budget : {};
  // v1.5 项目档案字段：老数据补默认值（dueDays 缺省 30，与历史「下单日 + 30 天」口径一致）
  if (!(+b.dueDays > 0)) b.dueDays = 30;
  b.dueDays = Math.min(365, Math.max(1, Math.round(+b.dueDays)));
  if (!(+b.area > 0)) b.area = 0;
  // C6：编号前缀缺省补 ZX；老账套不带这个字段也照旧发 ZX 号
  b.noPrefix = normNoPrefix(b.noPrefix);
  // K11：催收门槛缺省回退 100（与 core.OVERDUE_MIN_AMOUNT 一致），只影响逾期催收横幅
  b.remindThreshold = +b.remindThreshold > 0 ? Math.round(+b.remindThreshold) : 100;
  b.projects.forEach((p) => {
    p.date = normDate(p.date);
    p.due = normDate(p.due);
    p.details = Array.isArray(p.details) ? p.details : [];
    p.payments = Array.isArray(p.payments) ? p.payments : [];
    p.payments.forEach((py) => {
      py.date = normDate(py.date);
      /**
       * C6：把付款编号洗成**纯净 pid**。历史版本若有人把「付款全号」（`ZX0024-P0001`）
       * 手填进编号列，这里先剥前缀再交给 `ensurePayIds` —— 否则它会被判成非法号、
       * 重发一个新号，导致历史导出文件再也对不上这一笔。
       */
      py.pid = payPidOf(py.pid);
      // v1.2 新增字段：用 == null 同时兜住 undefined 与 null（不用 ||，避免把 0 变成 ''）
      if (py.note == null) py.note = '';
      if (py.ref == null) py.ref = '';
      // v1.6 C5：作废标记统一为布尔（老数据缺省 false，绝不写进金额计算之外的语义）
      py.void = py.void === true;
    });
    /**
     * v1.6 K1：付款唯一键回填（规则集中在 `core.ensurePayIds`，此处只调用）。
     * 只在「缺失 / 格式非法 / 项目内重复」时补号，合法且唯一的编号一律保留。
     */
    ensurePayIds(p.payments);
    if (!p.id) p.id = uid();
  });
  return b;
}

/* ---------------- 持久化 ---------------- */
let saveTimer = null;
let lastError = '';

/**
 * Q3：最近一次「保存降级 / 失败」的原因（空 = 一切正常）。
 * 与 `lastError` 的区别：这是响应式的，供 App.vue 监听后弹 toast 并 `takeSaveErr()` 取走；
 * `lastError` 保留为同步读取口（设置页可直接展示）。
 * **只在出错时赋值，成功不清空** —— 避免「失败后紧跟一次成功」把提示吃掉。
 */
export const saveErr = ref('');
export function takeSaveErr() {
  const m = saveErr.value;
  if (m) saveErr.value = '';
  return m;
}

export function persistNow() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    lastError = '';
    persistUndo(); // K1：主数据落盘时一并落撤销栈（撤销栈只是便利功能，写失败静默）
    return true;
  } catch (e) {
    const quota = e && (e.name === 'QuotaExceededError' || /quota/i.test(e.name || e.message || ''));
    if (quota) {
      // 配额满：优先丢弃收据图片，保全结构化台账
      let dropped = 0;
      state.books.forEach((b) => (b.projects || []).forEach((p) => {
        if (p && p.img) { delete p.img; dropped += 1; }
      }));
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
        lastError = `本地存储已满，已自动移除 ${dropped} 张收据图片以保全数据`;
        saveErr.value = lastError;
        return true;
      } catch (_) { /* 落到下面 */ }
      lastError = '本地存储已满，请先导出备份再继续录入';
      saveErr.value = lastError;
      return false;
    }
    lastError = '保存失败：' + (e?.message || e);
    saveErr.value = lastError;
    return false;
  }
}

export function schedulePersist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 240);
}

/* ---------------- 装载 ---------------- */
function seedBook() {
  return normalizeBook(mkBook('自宅装修', clone(SEED)));
}

function bootInner() {
  let raw = null;
  let carried = '';
  try { raw = localStorage.getItem(KEY); } catch (_) { /* 忽略 */ }
  if (!raw) {
    // 从 1.0 版键名冷启动：沿用原数据，成功后清理旧键
    for (const k of PREV_KEYS) {
      try { raw = localStorage.getItem(k); } catch (_) { raw = null; }
      if (raw) { carried = k; break; }
    }
  }
  const dropCarried = () => {
    if (!carried) return;
    try { localStorage.removeItem(carried); } catch (_) { /* 忽略 */ }
  };
  if (raw) {
    try {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.books) && d.books.length) {
        state.books = d.books.map(normalizeBook);
        state.templates = Array.isArray(d.templates) ? d.templates : [];
        state.warnThreshold = d.warnThreshold || 0.8;
        state.activeBookId = d.activeBookId;
        if (!state.books.find((b) => b.id === state.activeBookId)) {
          state.activeBookId = state.books[0].id;
        }
        if (carried) { persistNow(); dropCarried(); }
        return { ok: true, carried: !!carried };
      }
      if (d && Array.isArray(d.projects)) {
        // 平铺旧数据 → 单账套
        const b = normalizeBook(mkBook('默认项目', d));
        state.books = [b];
        state.activeBookId = b.id;
        persistNow();
        dropCarried();
        return { ok: true, migrated: true };
      }
    } catch (_) {
      try { localStorage.setItem(`${KEY}_corrupt_${Date.now()}`, raw); } catch (__) { /* 忽略 */ }
      return { ok: false, corrupt: true };
    }
  }
  const b = seedBook();
  state.books = [b];
  state.activeBookId = b.id;
  persistNow();
  return { ok: true, seeded: true };
}

/**
 * 启动入口：先装载（`bootInner` 保留原有全部搬迁逻辑），成功后写当日日快照。
 * 数据损坏（`ok === false`）时不写 —— 免得把垃圾存成"保险"。
 * 快照失败静默，绝不影响启动。
 */
export function boot() {
  const r = bootInner();
  if (r && r.ok) {
    try { maybeDaily(snapshotPayload()); } catch (_) { /* 快照失败不影响启动 */ }
  }
  restoreUndoStack(); // K1：无论 ok 与否都尝试恢复撤销栈（失败静默归零）
  restoreRedoStack(); // K18：重做栈同样恢复（与撤销栈是同一段历史的两半）
  return r;
}

watch(state, schedulePersist, { deep: true });

/* ---------------- 撤销（A3 / v1.7：20 步环形栈；v1.8.1：叠加体积预算） ---------------- */
/**
 * 撤销栈：存**序列化快照字符串**（不是对象），这样才能按「字符数 / 字节数」控体积。
 * 三条上线，逐条从**最旧的**(`shift()`) 丢弃，三者取严：
 *  ① 步数上限 `UNDO_MAX` = 20 步（A3 既有行为，保持不变）
 *  ② 总字符上限 `UNDO_MAX_CHARS` = 2,000,000（v1.7 既有兜底，防极端单步快照撑爆堆）
 *  ③ 落盘字节预算 `UNDO_BYTES_BUDGET` = 800KB（本次新增，见下方注释）
 * 无论如何**至少保留最新 1 步** —— 否则用户刚做的那一步自己就把自己挤掉了。
 */
const UNDO_MAX = 20;
const UNDO_MAX_CHARS = 2000000;
/**
 * 撤销栈独立键占用的字节上限（800KB）。
 *
 * 取值理由：浏览器给插件的 localStorage 配额约 **5MB**，而这版还额外塞进了两样常驻大户
 * —— `KEY` 主数据（实测 ≈114KB）+ `ztools_project_cost_snapshots_*` 七日快照（Q1）。
 * 实测单步快照（71 费用项 / 384 明细 / 88 付款）≈ **72KB**，若沿用旧的「固定 20 步」，
 * 落盘栈就是 20×72KB ≈ **1440KB ≈ 配额 28%**；数据量涨到 3 倍时单步 ≈216KB，
 * 20 步 ≈ 4321KB，直接顶满 5MB —— 而本应用配额写满时会**静默删收据图片字段保数据**，
 * 再放大撤销栈等于给用户丢数据装加速器。
 * 因此取 **800KB ≈ 5MB 的 16%**：留够主数据 + Q1 快照 + 未来账套正文的余量，
 * 折合当前数据量，**盘上**能保留约 10 步（内存仍为 20 步，见 `persistSlice`）。
 */
export const UNDO_BYTES_BUDGET = 800 * 1024;
let undoStack = [];
/** 与 `undoStack` **一一对应**的「该项落盘后的 UTF-16 字节数」，用于 O(n) 增量算总量 */
let undoItemBytes = [];
/* ---------------- K18（v1.9.x）重做栈 ----------------
 * 与撤销栈完全同构（存序列化快照字符串 + 平行字节数组）：
 *  · `undo()` 撤销前先把**当前状态**压入重做栈 —— redo 才有东西可放；
 *  · `pushUndo()`（新动作）清空重做栈 —— 撤销后开了岔，旧「未来」作废（标准 redo 语义）；
 *  · `redo()` 重做前先把当前状态压回撤销栈 —— redo 之后仍能 undo；
 *  · 落盘走独立键 `REDO_KEY`，与撤销栈共用同一条 800KB 字节预算（各自独立计算，
 *    合计最坏 ≈1.6MB ≈ 配额 31% —— 撤销/重做都是便利功能，Q19 的降级纪律照旧适用）。 */
let redoStack = [];
let redoItemBytes = [];

/**
 * 字节数：**UTF-16 为准**（与 `src/lib/storage.js` 的 `byteLen` 同口径）。
 *
 * 为什么不用 UTF-8：localStorage 的配额是按 UTF-16 code unit（多数浏览器 2 字节/字符）计的。
 * 用 UTF-8 判定，对「键名与数字为主」的账套会**低估约 2 倍**（ASCII 在 UTF-8 只占 1 字节、
 * 在配额里却占 2 字节），800KB 的预算会被真实开销悄悄吃穿，保护形同虚设。
 * 统一到 UTF-16 后，设置页「存储占用」显示的数字 = 配额的真实消耗，两者不会再打架。
 * @param {string} s
 * @returns {number}
 */
function byteLen(s) {
  return String(s).length * 2;
}

/** 丢掉最旧的一步（栈标的两个数组同步 shift，绝不单独改其中一个） */
function dropOldest(stack, bytes) {
  stack.shift();
  bytes.shift();
}

/** 通用裁剪（步数 / 字符两条上限，至少保留最新 1 步）。撤销栈与重做栈共用同一套上限。 */
function trimWithin(stack, bytes) {
  while (stack.length > UNDO_MAX) dropOldest(stack, bytes);
  let chars = 0;
  for (let i = 0; i < stack.length; i += 1) chars += stack[i].length;
  while (chars > UNDO_MAX_CHARS && stack.length > 1) {
    chars -= stack[0].length;
    dropOldest(stack, bytes);
  }
}

/**
 * 只裁剪**内存栈**，依据步数 / 字符两条既有上限，且**至少保留最新 1 步**。
 *
 * 注意：`UNDO_BYTES_BUDGET` 这条字节预算**不在这里生效** —— v1.8.1 的取舍是
 * 「内存深度」与「落盘配额」解耦：
 *   · 内存仍保留 v1.7 已验收的 **20 步**（A3 语义一字不改，一次会话内可连撤 20 步）；
 *   · 字节预算只作用于**落盘**那一层（见 `persistSlice()`）。
 * 若把预算压到内存栈上，`undoDepth()` 会被削到 10 步，等于无声退化掉 v1.7 的验收项
 * —— 这是当初实测踩到的坑，勿再改回。
 */
function trimUndo() {
  // ① 步数上限 ② 字符上限（既有兜底）—— 抽到 trimWithin，重做栈共用
  trimWithin(undoStack, undoItemBytes);
}

/**
 * 落盘子集：从**最新**一端往回累计，取「仍在字节预算内」的最大后缀。
 * 只影响落盘，**不动内存栈**（内存仍 20 步）。
 *
 * 字节口径与 `JSON.stringify(数组)` 的真实产物一致：栈里每项本身已是 JSON 字符串，
 * 再被数组序列化时会做二次转义，而 `undoItemBytes[i]` 存的正是**转义后**的长度，
 * 因此「各项之和 + (k-1) 个逗号 + 两个中括号」就是真实落盘大小，无需反复 stringify。
 * @returns {{arr: Array, bytes: number}}
 */
/**
 * 落盘子集（K18 起为通用形态）：从**最新**一端往回累计，取「仍在字节预算内」的最大后缀。
 * 只影响落盘，**不动内存栈**（内存仍 20 步）。
 *
 * 字节口径与 `JSON.stringify(数组)` 的真实产物一致：栈里每项本身已是 JSON 字符串，
 * 再被数组序列化时会做二次转义，而 `undoItemBytes[i]` 存的正是**转义后**的长度，
 * 因此「各项之和 + (k-1) 个逗号 + 两个中括号」就是真实落盘大小，无需反复 stringify。
 * @returns {{arr: Array, bytes: number}}
 */
function sliceWithinBudget(stack, itemBytes) {
  const n = stack.length;
  let sum = 0;
  let take = 0;
  for (let i = n - 1; i >= 0; i -= 1) {
    const next = take + 1;
    const total = sum + (itemBytes[i] || 0) + (next - 1) + 2; // +逗号 +'[' +']'
    if (take > 0 && total > UNDO_BYTES_BUDGET) break;
    sum += (itemBytes[i] || 0);
    take = next;
  }
  return { arr: stack.slice(n - take), bytes: take ? sum + (take - 1) + 2 : 2 };
}

function persistSlice() {
  return sliceWithinBudget(undoStack, undoItemBytes);
}

/**
 * K1（v1.8）：把撤销栈序列化落盘（独立键 `UNDO_KEY`）。
 * v1.8.1：落盘的是 `persistSlice()` —— 内存 20 步，盘上只装得下多少装多少，
 * 因此**刷新后能恢复的步数可能少于 20**（当前数据约 10 步），属明确取舍而非缺陷。
 * 配额满 / 隐私模式 / 序列化失败一律静默 —— 撤销栈只是便利功能，绝不能因为它把主数据保存搞挂。
 */
function persistUndo() {
  try {
    localStorage.setItem(UNDO_KEY, JSON.stringify(persistSlice().arr));
  } catch (_) { /* 静默 */ }
}

/** K18：重做栈落盘（与 persistUndo 同纪律：失败静默，绝不影响主数据）。 */
function persistRedo() {
  try {
    localStorage.setItem(REDO_KEY, JSON.stringify(sliceWithinBudget(redoStack, redoItemBytes).arr));
  } catch (_) { /* 静默 */ }
}

/** 当前 state 的撤销/重做快照字符串（undo / redo 共用，字段与 pushUndo 完全一致） */
function historySnapshotStr() {
  return JSON.stringify({
    books: state.books,
    activeBookId: state.activeBookId,
    templates: state.templates,
  });
}

/**
 * K18-UI（v1.9.x）：撤销 / 重做栈的**版本号**（全局 ref 信号）。
 *
 * 为什么需要它：`canUndo() / undoDepth() / canRedo() / redoDepth()` 全是**纯函数**，
 * 读的是模块内的普通数组（`undoStack` / `redoStack`），Vue 追踪不到它们的变化。
 * 视图里原先写 `computed(() => { void book.value; return canUndo(); })`，想借 `book`
 * 触发重算 —— 但改一条费用项备注时 `book` 这个 computed 的依赖（`state.books` 数组
 * **身份**、`state.activeBookId`）一个都没变，它根本不会重算，于是按钮停在旧值：
 * 实测栈里已经有 2 步了，「撤销」按钮仍然是灰的、title 还写着「没有可撤销的操作」，
 * 点了没有任何反应；只有切页 / 重开抽屉让组件重新挂载，读到的才是新值。
 * （纯逻辑层的 verify-k18k23.mjs 一个用例都测不出来 —— 它直接调函数，不经过界面。）
 *
 * 故补一个全局 ref —— 与 `prefs.densityLive` 同一套路：全局信号 + 唯一写入口。
 * 任何改动栈结构的地方都 bump 一下，视图的 computed 借它失效重算。
 * 声明位置必须早于下面所有 bump 点，否则会撞 TDZ。
 */
export const undoVersion = ref(0);
/** 唯一自增口：栈结构一变就调（push / undo / redo / clear / restore）。 */
function bumpUndoVersion() { undoVersion.value += 1; }

/**
 * K1（v1.8）：启动时从独立键恢复撤销栈（纯内存态，不碰 `state`）。
 * 失败（键缺失 / 损坏 / 非数组）一律静默归零，绝不 throw。
 * @returns {number} 恢复后的可撤步数
 */
export function restoreUndoStack() {
  try {
    const raw = localStorage.getItem(UNDO_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        // 过滤脏数据（历史版本可能有非字符串项），再套双上限
        const clean = arr.filter((x) => typeof x === 'string');
        undoStack = clean;
        undoItemBytes = clean.map((x) => byteLen(JSON.stringify(x)));
        trimUndo();
      }
    }
  } catch (_) { undoStack = []; undoItemBytes = []; }
  // 两个数组长度必须严格对齐，任何一处失步都以后者为准重建（自愈，避免残留脏字节数）
  if (undoItemBytes.length !== undoStack.length) {
    undoStack = [];
    undoItemBytes = [];
  }
  bumpUndoVersion();
  return undoStack.length;
}

/**
 * 记录一次「可撤销的用户动作」。
 * 调用纪律：**一次用户动作只能调一次**（例如 CatForm 的「改品类 + 改预算」必须合并成一次）。
 * K1：每次 push 同步把整栈落盘（启动后可恢复）。
 * v1.8.1：入栈后按「20 步 / 200 万字符」两条上限裁剪**内存**栈，再落盘；
 *   落盘另按 800KB（UTF-16）字节预算只持久化「装得下的最新若干步」（见 `persistSlice`），
 *   因此 localStorage 里永远看不到超限的大栈，而内存里仍保 20 步可连撤。
 * @returns {boolean} 是否成功入栈（序列化失败 = false）
 */
export function pushUndo() {
  try {
    // K18：新动作 = 撤销后开了岔，旧「未来」作废（标准 redo 语义）。空栈时不清不落盘（免白写 '[]'）
    if (redoStack.length) {
      redoStack = [];
      redoItemBytes = [];
      persistRedo();
    }
    const snap = JSON.stringify({
      books: state.books,
      activeBookId: state.activeBookId,
      templates: state.templates,
    });
    undoStack.push(snap);
    undoItemBytes.push(byteLen(JSON.stringify(snap)));
    trimUndo();  // 从最旧的丢，至少留最新 1 步
    persistUndo(); // K1：落盘
    bumpUndoVersion();
    return true;
  } catch (_) { bumpUndoVersion(); return false; }
}
export function canUndo() { return undoStack.length > 0; }
/** 当前可撤步数（供「已撤销（还可退 N 步）」文案用） */
export function undoDepth() { return undoStack.length; }
/**
 * 撤销栈**实际落盘**占用的字节数（UTF-16 口径）。
 * 注意是「盘上有多少」而非「内存有多少」—— 设置页「存储占用」必须展示前者。
 *
 * 这里用 `JSON.stringify` **实测**而非 `persistSlice().bytes` 的估算值：
 * 估算是为了裁剪时能 O(n) 快速判定（每次 push 都要跑），会有几字节级漂移；
 * 而展示给用户的数字必须与 `ztools_project_cost_undo` 键的真实内容严格相等，
 * 否则用户会看到「占用显示」与「实际配额」对不上 —— 正是本次要治的毛病。
 * 该函数只在设置页刷新时调用，一次 stringify 的开销可以接受。
 * @returns {number}
 */
export function undoBytes() { return byteLen(JSON.stringify(persistSlice().arr)); }
/**
 * 清空整个栈：回滚快照 / 清空数据之后，旧撤销已无意义。
 * K18：撤销与重做是**同一段历史的两半** —— 撤销栈清空时重做栈必然失效，一并清空
 * （否则「清空数据 → 重做」会把刚删掉的数据整套复活，等于绕过了所有确认）。
 * @param {boolean} [persist=true] 是否同步清掉落盘的栈。绝大多数调用（回滚 / 导入 / 清空）
 *   都应清掉落盘栈；测试可用 `false` 只清内存、保留 localStorage 以模拟「刷新后恢复」。
 */
export function clearUndo(persist = true) {
  undoStack = [];
  undoItemBytes = [];
  redoStack = [];
  redoItemBytes = [];
  if (persist) { persistUndo(); persistRedo(); }
  bumpUndoVersion();
}

/**
 * K18：启动时从独立键恢复重做栈（与 restoreUndoStack 同一套容错：损坏/非数组静默归零）。
 * 重做栈跨刷新恢复的意义比撤销栈弱（刷新前通常刚做过 undo 才有 redo 可言），
 * 但 K1 的契约是「刷新不丢历史」，redo 是同一段历史的另一半，一并恢复。
 * @returns {number} 恢复后的可重做步数
 */
export function restoreRedoStack() {
  try {
    const raw = localStorage.getItem(REDO_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        const clean = arr.filter((x) => typeof x === 'string');
        redoStack = clean;
        redoItemBytes = clean.map((x) => byteLen(JSON.stringify(x)));
        trimWithin(redoStack, redoItemBytes);
      }
    }
  } catch (_) { redoStack = []; redoItemBytes = []; }
  if (redoItemBytes.length !== redoStack.length) {
    redoStack = [];
    redoItemBytes = [];
  }
  bumpUndoVersion();
  return redoStack.length;
}

/**
 * 撤销一步。
 * @returns {{ok: boolean, left: number}} `left` = 撤完之后**还剩**多少步可撤
 *   - 无可撤：`{ ok: false, left: 0 }`
 *   - 成功：`{ ok: true, left: undoStack.length }`
 *   - 反序列化失败：`{ ok: false, left: undoStack.length }`（这一步已 pop，不再回填）
 */
export function undo() {
  if (!undoStack.length) return { ok: false, left: 0 };
  try {
    const d = JSON.parse(undoStack.pop());
    undoItemBytes.pop(); // 与 undoStack 同步出栈（算字节永不失步）
    // K18：撤销成功才把当前状态压入重做栈（先 parse 后压栈 —— parse 失败时
    // 状态没变过，不该留下一条「重做到当前态」的垃圾步）。与 pushUndo 同构，
    // 但**绝不走 pushUndo()**（那会清空重做栈，恰好把刚要保存的未来抹掉）。
    const cur = historySnapshotStr();
    redoStack.push(cur);
    redoItemBytes.push(byteLen(JSON.stringify(cur)));
    trimWithin(redoStack, redoItemBytes);
    state.books = d.books.map(normalizeBook);
    state.activeBookId = d.activeBookId;
    state.templates = d.templates || [];
    persistNow();
    persistRedo();
    bumpUndoVersion();
    return { ok: true, left: undoStack.length };
  } catch (_) {
    // 反序列化失败：这一步已被 pop（字节数也要跟着出栈），不再回填
    if (undoItemBytes.length > undoStack.length) undoItemBytes.pop();
    bumpUndoVersion();
    return { ok: false, left: undoStack.length };
  }
}

/* ---------------- K18（v1.9.x）重做 ---------------- */
export function canRedo() { return redoStack.length > 0; }
/** 当前可重做步数（供「已重做（还可进 N 步）」文案用） */
export function redoDepth() { return redoStack.length; }

/**
 * 重做一步。
 * 语义与 undo() 严格镜像：
 *  · 把当前状态压回**撤销栈**（trimUndo 同款上限）→ redo 之后仍可撤销；
 *  · 从重做栈弹出最近一次 undo 前的状态并恢复；
 *  · `left` = 重做完成后**还剩**多少步可重做。
 * 反序列化失败时该步已 pop 不回填，返回 ok:false（与 undo 同纪律）。
 */
export function redo() {
  if (!redoStack.length) return { ok: false, left: 0 };
  try {
    const cur = historySnapshotStr();
    undoStack.push(cur);
    undoItemBytes.push(byteLen(JSON.stringify(cur)));
    trimUndo();
    const d = JSON.parse(redoStack.pop());
    redoItemBytes.pop();
    state.books = d.books.map(normalizeBook);
    state.activeBookId = d.activeBookId;
    state.templates = d.templates || [];
    persistNow(); // 内部 persistUndo —— 撤销栈的新一层一并落盘
    persistRedo();
    bumpUndoVersion();
    return { ok: true, left: redoStack.length };
  } catch (_) {
    if (redoItemBytes.length > redoStack.length) redoItemBytes.pop();
    bumpUndoVersion();
    return { ok: false, left: redoStack.length };
  }
}

/* ---------------- 快照（薄胶水，payload 由 state 组装） ---------------- */
/**
 * 组快照载荷：结构与 `importState(data)` 入参、`exportJson(state)` 产物同构，
 * 所以一份快照既能回滚，也能当 JSON 备份用。
 * ⚠️ 只读 state、不写 state：`snapshotNow` 绝不参与 `persistNow` 链路。
 * K20：搭载 `prefs: { density }`（界面偏好）—— 偏好不进 state（「密度不进账本」不变），
 * 只搭快照 / 备份的车走，回滚时一并恢复；缺省（老快照）维持本机现状。
 */
function snapshotPayload() {
  return {
    books: state.books,
    activeBookId: state.activeBookId,
    templates: state.templates,
    warnThreshold: state.warnThreshold,
    prefs: { density: getDensity() },
  };
}

/**
 * K20：从快照 / 备份载荷恢复搭载的界面偏好。
 * 只认**合法**的 density 值（normDensity 把非法值归一为 compact —— 但「载荷里没写 prefs」
 * 与「载荷明确写了 compact」都应维持/落到合法态，故用 hasOwnProperty 语义区分）：
 * 载荷没带 prefs 字段 → 什么都不动（老备份不改变本机偏好）。
 * 永不 throw：偏好恢复失败不影响主数据回滚。
 * @param {object|undefined} prefs 载荷上的 prefs 字段
 */
function restorePrefsFromPayload(prefs) {
  if (!prefs || typeof prefs !== 'object' || !('density' in prefs)) return;
  try { setDensity(normDensity(prefs.density)); } catch (_) { /* 静默 */ }
}

/**
 * 写一份快照。永不 throw，永不改动主数据。
 * @param {'daily'|'pre'} kind
 * @param {string} reason 见 snapshot.js 的 REASON_TEXT
 * @returns {{ok: boolean, msg?: string}}
 */
export function snapshotNow(kind = 'pre', reason = 'manual') {
  try {
    return saveSnapshot(kind, reason, snapshotPayload());
  } catch (_) {
    return { ok: false, msg: '快照写入失败' };
  }
}

/** 设置页「历史版本」列表（摘要，不含 data） */
export function snapshotList() {
  try { return listSnaps(); } catch (_) { return []; }
}

/**
 * 一键回滚。回滚范围 = books / activeBookId / templates / warnThreshold（**不含 theme**）。
 * 回滚前先存一份 `before-rollback` 快照，二次误操作也能退。
 * @param {string} id 快照 id
 */
export function restoreSnapshot(id) {
  const snap = readSnapshot(id);
  if (!snap) return { ok: false, msg: '快照不可用，可能已损坏' };
  const guard = snapshotNow('pre', 'before-rollback');
  state.books = snap.data.books.map(normalizeBook);
  state.templates = Array.isArray(snap.data.templates) ? snap.data.templates : [];
  state.warnThreshold = snap.data.warnThreshold || 0.8;
  state.activeBookId = state.books.some((b) => b.id === snap.data.activeBookId)
    ? snap.data.activeBookId
    : state.books[0].id;
  restorePrefsFromPayload(snap.data.prefs); // K20：回滚一并恢复搭载的界面偏好
  clearUndo();
  persistNow();
  const r = { ok: true, msg: `已回滚到 ${fmtSnapTime(snap.ts)} 的快照`, stat: snap.stat };
  if (guard && guard.ok === false && guard.msg) r.snapWarn = guard.msg;
  return r;
}

/* ---------------- 档案补全 ---------------- */
export function nextColor() {
  const used = new Set((book.value?.categories || []).map((c) => c.color));
  return PALETTE.find((c) => !used.has(c)) || PALETTE[(book.value?.categories || []).length % PALETTE.length];
}
export function ensureCategory(name) {
  const n = (name || '').trim();
  if (!n || !book.value) return '';
  if (!book.value.categories.find((c) => c.name === n)) {
    book.value.categories.push({ name: n, color: nextColor(), note: '' });
  }
  return n;
}
export function ensurePayee(name) {
  const n = (name || '').trim();
  if (!n || !book.value) return '';
  if (!book.value.payees.find((p) => p.name === n)) {
    book.value.payees.push({ name: n, contact: '', note: '' });
  }
  return n;
}
export function syncFromProjects() {
  if (!book.value) return;
  book.value.projects.forEach((p) => {
    if (p.cat) ensureCategory(p.cat);
    if (p.object) ensurePayee(p.object);
  });
}

/* ---------------- 品名历史单价索引（R3，内存态，不落库） ----------------
 * 全局遍历所有 book 的明细，按品名记录「最近一次」的单位与单价（项目按 date 降序遍历，先遇到即最近）。
 * 惰性构建 + 失效信号：books 的 id 与项目数变化即重建。索引只读，不进 state。 */
let _nameIdx = null;
let _nameIdxSig = '';

export function namePriceIndex() {
  const books = state.books || [];
  const sig = books.map((b) => `${b.id}:${(b.projects || []).length}`).join('|');
  if (_nameIdx && _nameIdxSig === sig) return _nameIdx;
  const idx = new Map();
  const all = [];
  books.forEach((b) => (b.projects || []).forEach((p) => all.push(p)));
  // 项目按 date 降序：先遇到的同品名即「最近一条」
  all.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  all.forEach((p) => {
    (p.details || []).forEach((d) => {
      const nm = (d.name || '').trim();
      if (!nm) return;
      if (!idx.has(nm)) idx.set(nm, { unit: d.unit || '', price: +d.price || 0 });
    });
  });
  _nameIdx = idx;
  _nameIdxSig = sig;
  return idx;
}

/* ---------------- 账套操作 ---------------- */
export function switchBook(id) {
  if (!id || id === state.activeBookId) return;
  if (state.books.some((b) => b.id === id)) state.activeBookId = id;
}
export function createBook(name = '新项目', init = {}) {
  const b = mkBook(name, init);
  state.books.push(b);
  state.activeBookId = b.id;
  return b;
}
export function renameBook(id, name) {
  const b = state.books.find((x) => x.id === id);
  if (!b) return;
  b.name = (name || '').trim() || b.name;
}

/**
 * M3 / A4：项目档案字段（`dueDays` 到期日推算天数、`area` 建筑面积）。
 * - dueDays：1–365，非法值回落 30（与历史口径一致）
 * - area：> 0 才生效，0 / 空 = 未填（单方造价指标随之隐藏）
 * 只改元数据，不动任何金额与费用项。
 */
export function setBookMeta(patch = {}, id = '') {
  const b = id ? state.books.find((x) => x.id === id) : book.value;
  if (!b) return { ok: false, msg: '项目不存在' };
  // A3：项目存在才入栈（不存在时不该白占一格）
  pushUndo();
  if (patch.dueDays != null) {
    const n = Math.round(+patch.dueDays || 0);
    b.dueDays = n > 0 ? Math.min(365, Math.max(1, n)) : 30;
  }
  if (patch.area != null) {
    const a = +patch.area || 0;
    b.area = a > 0 ? Math.round(a * 100) / 100 : 0;
  }
  /**
   * C6：编号前缀 1–4 位大写字母。只影响**之后新建**费用项的号，绝不批量重编号 ——
   * 编号是与外部对账单对齐的业务身份，静默重排会直接把历史文件全打乱。
   */
  if (patch.noPrefix != null) {
    b.noPrefix = normNoPrefix(patch.noPrefix);
  }
  return { ok: true, msg: '' };
}
export function deleteBook(id) {
  if (state.books.length <= 1) return { ok: false, msg: '至少保留一个项目' };
  const i = state.books.findIndex((x) => x.id === id);
  if (i < 0) return { ok: false, msg: '项目不存在' };
  const [removed] = state.books.splice(i, 1);
  if (state.activeBookId === id) state.activeBookId = state.books[0].id;
  return { ok: true, msg: `已删除「${removed.name}」` };
}

/* ---------------- 模板 ---------------- */
export function saveTemplate(name) {
  const n = (name || '').trim();
  if (!n) return { ok: false, msg: '请先输入模板名称' };
  const b = book.value;
  if (!b) return { ok: false, msg: '当前没有可保存的项目' };
  state.templates.push({
    id: uid(),
    name: n,
    budget: clone(b.budget || {}),
    categories: clone(b.categories || []),
    payees: clone(b.payees || []),
  });
  return { ok: true, msg: `已保存模板「${n}」` };
}
export function applyTemplate(id, name) {
  const t = state.templates.find((x) => x.id === id);
  if (!t) return { ok: false, msg: '模板不存在' };
  const b = createBook(name || `${t.name} 副本`, {
    budget: t.budget,
    categories: t.categories,
    payees: t.payees,
  });
  return { ok: true, msg: `已按模板新建「${b.name}」`, id: b.id };
}
export function deleteTemplate(id) {
  state.templates = state.templates.filter((x) => x.id !== id);
}

/* ---------------- 费用项 ---------------- */
/**
 * 同收款方 + 同金额 + 同备注 即视为疑似重复费用项（C2）。
 * 编辑自身（`id` 排除）不算重复。
 */
function dupProjectExists(bk, payload, id) {
  return (bk?.projects || []).find((p) =>
    p.id !== id &&
    (p.object || '') === (payload.object || '') &&
    round2(payableOf(p)) === round2((+payload.total || 0) - (+payload.discount || 0)) &&
    (p.remark || '') === (payload.remark || '')) || null;
}

export function upsertProject(payload, opts = {}) {
  if (!book.value) return { ok: false, msg: '没有可用项目' };
  const list = book.value.projects;
  const dup = list.find((p) => p.no === payload.no && p.id !== payload.id);
  if (dup) return { ok: false, msg: `项目号「${payload.no}」已存在` };
  // C2：疑似重复费用项检测（非 force 时拦截，由视图二次确认）
  if (!opts.force) {
    const dupp = dupProjectExists(book.value, payload, payload.id);
    if (dupp) {
      return { ok: false, dup: true, msg: '疑似重复费用项（同收款方+同金额+同备注），仍要保存？' };
    }
  }

  /**
   * A3：入栈点放在**所有校验之后、改 state 之前** —— 校验失败直接 return 时不占撤销栈，
   * 否则用户点三次「保存」全被拦下，却要按三次 Ctrl+Z 才回到原位。
   */
  pushUndo();

  let target;
  let wasEdit = false;
  if (payload.id) {
    target = list.find((p) => p.id === payload.id);
    if (target) {
      wasEdit = true;
      Object.assign(target, payload);
    }
  }
  if (!target) {
    target = { ...payload, id: payload.id || uid(), payments: [], details: [] };
    list.push(target);
  }
  // 有明细时，总计以明细为准，忽略手填
  if (target.details && target.details.length) syncTotalFromDetails(target);
  ensurePayee(target.object);
  return { ok: true, msg: wasEdit ? '已更新' : '已保存', id: target.id };
}

export function cloneProject(id) {
  const src = book.value?.projects.find((p) => p.id === id);
  if (!src) return null;
  return {
    no: nextNo(book.value.projects),
    date: todayLocal(),
    due: '',
    cat: src.cat,
    sub: src.sub,
    remark: src.remark,
    total: src.total,
    discount: src.discount,
    object: src.object,
  };
}

/**
 * R4 费用项复制（含明细 / 跨项目）：直接落库，返回落库结果。
 * 复制范围严格限定为「费用项字段 + 明细」，付款绝不复制（付款是真实资金动作，复制会虚增已付）。
 * 编号按目标项目 `nextNo` 顺延，不与源/其他项重号。
 * @param {string} targetBookId 目标账套 id（为空或不存在则落到当前账套）
 * @param {string} sourceId 源费用项 id（恒为当前打开项目）
 * @param {{includeDetails?: boolean}} opts includeDetails 默认 true
 */
export function copyProject(targetBookId, sourceId, { includeDetails = true } = {}) {
  const src = book.value?.projects.find((p) => p.id === sourceId);
  if (!src) return { ok: false, msg: '源费用项不存在' };
  const target = state.books.find((b) => b.id === targetBookId) || book.value;
  if (!target) return { ok: false, msg: '目标项目不存在' };
  pushUndo();
  const copy = {
    id: uid(),
    no: nextNo(target.projects), // ★ 按目标项目 nextNo 顺延，不重号
    date: todayLocal(),
    due: '',
    cat: src.cat || '',
    sub: src.sub || '材料费',
    remark: src.remark || '',
    total: +src.total || 0,
    discount: +src.discount || 0,
    object: src.object || '',
    details: includeDetails ? clone(src.details || []) : [], // ★ 明细可带
    payments: [], // ★ 付款绝不复制（R4 决策）
  };
  target.projects.push(copy);
  ensurePayee(copy.object);
  persistNow();
  return { ok: true, msg: `已复制到「${target.name}」`, targetBookId: target.id, id: copy.id };
}

export function removeProject(id) {
  if (!book.value) return;
  pushUndo();
  book.value.projects = book.value.projects.filter((p) => p.id !== id);
}

/* ---------------- R5 列表多选批量操作（不动任何金额字段） ---------------- */
/** 薄胶水：包装一次撤销 + 持久化，供各 batch 动作复用 */
function withUndo(fn) {
  pushUndo();
  const r = fn();
  persistNow();
  return r;
}

/** 批量改品类（only 标签字段，金额不变） */
export function batchSetCategory(ids, cat) {
  if (!book.value) return { ok: false, msg: '没有可用项目' };
  const set = new Set(ids);
  if (!set.size) return { ok: false, msg: '未选择任何费用项' };
  withUndo(() => {
    book.value.projects.forEach((p) => { if (set.has(p.id)) p.cat = cat; });
    ensureCategory(cat);
  });
  return { ok: true, msg: `已改 ${set.size} 条品类`, n: set.size };
}

/** 批量改收款方（同步 ensurePayee） */
export function batchSetPayee(ids, payee) {
  if (!book.value) return { ok: false, msg: '没有可用项目' };
  const set = new Set(ids);
  if (!set.size) return { ok: false, msg: '未选择任何费用项' };
  withUndo(() => {
    book.value.projects.forEach((p) => { if (set.has(p.id)) p.object = payee; });
    ensurePayee(payee);
  });
  return { ok: true, msg: `已改 ${set.size} 条收款方`, n: set.size };
}

/** 批量改到期日（normDate 归一化） */
export function batchSetDue(ids, due) {
  if (!book.value) return { ok: false, msg: '没有可用项目' };
  const set = new Set(ids);
  if (!set.size) return { ok: false, msg: '未选择任何费用项' };
  const norm = normDate(due);
  withUndo(() => {
    book.value.projects.forEach((p) => { if (set.has(p.id)) p.due = norm; });
  });
  return { ok: true, msg: `已改 ${set.size} 条到期日`, n: set.size };
}

/** 批量删除（整批一次撤销） */
export function batchDelete(ids) {
  if (!book.value) return { ok: false, msg: '没有可用项目' };
  const set = new Set(ids);
  const n = (book.value.projects || []).filter((p) => set.has(p.id)).length;
  if (!n) return { ok: false, msg: '未选择任何费用项' };
  withUndo(() => {
    book.value.projects = book.value.projects.filter((p) => !set.has(p.id));
  });
  return { ok: true, msg: `已删除 ${n} 个费用项`, n };
}

/* ---------------- 明细 ---------------- */
/**
 * 新增 / 编辑一条明细。
 * @param {object} opts `{ noUndo: true }` = 整批循环调用时由调用方统一入栈（一次动作只算 1 步）
 */
export function upsertDetail(projectId, detail, index = -1, opts = {}) {
  const p = book.value?.projects.find((x) => x.id === projectId);
  if (!p) return { ok: false, msg: '项目已不存在' };
  if (!opts.noUndo) pushUndo();
  p.details = p.details || [];
  const rec = { ...detail, amount: round2local(detail.amount) };
  if (index >= 0) p.details[index] = rec;
  else p.details.push(rec);
  syncTotalFromDetails(p);
  return { ok: true, msg: index >= 0 ? '明细已更新' : '明细已保存' };
}
export function removeDetail(projectId, index) {
  const p = book.value?.projects.find((x) => x.id === projectId);
  if (!p) return;
  pushUndo();
  p.details.splice(index, 1);
  syncTotalFromDetails(p);
}
export function detailSumOf(projectId) {
  const p = book.value?.projects.find((x) => x.id === projectId);
  return p ? round2local(detailSum(p)) : 0;
}

/* ---------------- 付款 ---------------- */
/**
 * 同项目 + 同日期 + 同金额 + 同方式 即视为疑似重复付款（C2）。
 * 编辑自身（`index` 排除）不算重复。
 */
function dupPaymentExists(bk, projectId, rec, index) {
  const p = (bk?.projects || []).find((x) => x.id === projectId);
  if (!p) return null;
  return (p.payments || []).find((py, i) =>
    i !== index &&
    // C5：作废的付款不再拦截 ——「记错了 → 作废 → 重新记一笔」是最常见的正确流程，
    // 若把作废记录也算重复，用户会被自己的历史挡住。
    !py.void &&
    py.date === normDate(rec.date) &&
    round2(py.amount) === round2(rec.amount) &&
    (py.method || '') === (rec.method || '')) || null;
}

export function upsertPayment(projectId, rec, index = -1, opts = {}) {
  const p = book.value?.projects.find((x) => x.id === projectId);
  if (!p) return { ok: false, msg: '项目已不存在' };
  p.payments = p.payments || [];
  const prev = index >= 0 ? p.payments[index] : null;
  const item = {
    // K1：编号是身份，不是序号 —— 编辑不动它；新增才发号
    pid: payPidOf(prev?.pid) || nextPid(p.payments),
    date: normDate(rec.date) || '',
    method: rec.method || '微信',
    amount: round2local(rec.amount),
    note: String(rec.note || '').trim(),
    ref: String(rec.ref || '').trim(),
    // C5：编辑一笔已作废的付款保持作废态（要恢复必须显式点「恢复」，避免误改“复活”一笔已对账的款）
    void: prev ? prev.void === true : rec.void === true,
  };
  // 新增付款日期必填：权威拦截放在 store，不只靠视图（视图可绕开）
  if (!item.date && index < 0) return { ok: false, msg: '请填写付款日期' };
  // C2：疑似重复付款检测（非 force 时拦截，由视图二次确认）
  if (!opts.force) {
    const dup = dupPaymentExists(book.value, projectId, rec, index);
    if (dup) {
      return { ok: false, dup: true, msg: `疑似重复付款（${fmt(item.amount)} / ${item.date}），仍要记录？` };
    }
  }
  // A3：入栈点放在重复检测 / 日期校验之后 —— 被拦下的录入不该占撤销栈
  pushUndo();
  if (index >= 0) p.payments[index] = item;
  else p.payments.push(item);
  return { ok: true, msg: item.amount < 0 ? '退款已记录' : '付款已记录' };
}
export function removePayment(projectId, index) {
  const p = book.value?.projects.find((x) => x.id === projectId);
  if (!p) return;
  pushUndo();
  p.payments.splice(index, 1);
}

/**
 * C5 作废 / 恢复。
 * 作废 ≠ 删除：记录仍在流水里（灰显）、仍保留编号与凭证号，只是不再计入已付。
 * 这样对银行流水时能回答「那笔 5,000 是记错了还是真没付」——删除会把这个答案一起删掉。
 * @param {boolean} flag true = 作废，false = 恢复
 */
export function voidPayment(projectId, index, flag = true) {
  const p = book.value?.projects.find((x) => x.id === projectId);
  const py = p?.payments?.[index];
  if (!py) return { ok: false, msg: '付款记录已不存在' };
  if ((py.void === true) === (flag === true)) return { ok: true, msg: '' };
  pushUndo();
  py.void = flag === true;
  return {
    ok: true,
    msg: py.void ? `已作废 ${fmt(py.amount)}，不计入已付（可恢复）` : `已恢复 ${fmt(py.amount)}，重新计入已付`,
  };
}

/**
 * C4 分配计算（**纯函数，不落库**）。
 *
 * 预览与落库共用同一份算法，避免「预览说 3,333.33、实际写 3,333.34」这类漂移。
 * 分配规则：金额一次性分摊到所选费用项，**最后一行吸收分角差额**，
 * 因此 Σ分配恒等于总额（不会出现「三笔加起来差一分」）。
 *  · mode='due'  按各费用项待付比例分摊（默认；对应「按欠款多少给钱」的真实场景）
 *  · mode='even' 均分
 * 允许总额超出待付合计（超付是合法事实）：此时按同比例放大，不静默截断。
 *
 * @param {string[]} projectIds 费用项 id 列表
 * @param {number} total 付款总额
 * @param {'due'|'even'} mode
 */
export function planBatchPay(projectIds, total, mode = 'due') {
  const amt = round2local(total);
  const list = (projectIds || [])
    .map((id) => book.value?.projects.find((x) => x.id === id))
    .filter(Boolean)
    .map((p) => ({ id: p.id, no: p.no, remark: p.remark, due: Math.max(dueOf(p), 0) }))
    .filter((x) => x.due > 0);
  const sumDue = round2local(list.reduce((s, x) => s + x.due, 0));
  if (!list.length) return { ok: false, msg: '所选费用项没有待付金额', amt, sumDue, rows: [], over: 0 };
  if (!(amt > 0)) return { ok: false, msg: '请输入大于 0 的付款总额', amt, sumDue, rows: [], over: 0 };

  let left = amt;
  const rows = list.map((x, i) => {
    const v = i === list.length - 1
      ? round2local(left)
      : (mode === 'even' ? round2local(amt / list.length) : round2local((amt * x.due) / sumDue));
    left = round2local(left - v);
    return { ...x, amount: v };
  });
  return { ok: true, amt, sumDue, rows, over: round2local(amt - sumDue) > 0.005 ? round2local(amt - sumDue) : 0 };
}

/**
 * C4 批量登记付款：按 `planBatchPay` 的分配结果，一次落库多条付款（整批一次撤销）。
 * @param {{mode?:'due'|'even', date?:string, method?:string, note?:string}} opts
 */
export function batchPay(projectIds, total, opts = {}) {
  const plan = planBatchPay(projectIds, total, opts.mode === 'even' ? 'even' : 'due');
  if (!plan.ok) return { ok: false, msg: plan.msg };
  const items = plan.rows.filter((r) => r.amount !== 0);
  if (!items.length) return { ok: false, msg: '分配金额全为 0，请检查总额' };

  const date = normDate(opts.date) || todayLocal();
  const method = opts.method || '微信';
  const note = String(opts.note || '').trim();

  pushUndo(); // 整批一次撤销
  items.forEach((r) => {
    const p = book.value.projects.find((x) => x.id === r.id);
    if (!p) return;
    p.payments = p.payments || [];
    p.payments.push({
      pid: nextPid(p.payments),
      date,
      method,
      amount: r.amount,
      note,
      ref: '',
      void: false,
    });
  });
  return {
    ok: true,
    msg: `已登记 ${items.length} 笔付款，合计 ${fmt(plan.amt)}${plan.over ? `（超付 ${fmt(plan.over)}）` : ''}`,
    count: items.length,
    amount: plan.amt,
    over: plan.over,
  };
}

/** 可付余额（编辑既有记录时把该笔金额加回；作废的付款本就不在已付里，不加回） */
export function availOf(projectId, editingIndex = -1) {
  const p = book.value?.projects.find((x) => x.id === projectId);
  if (!p) return 0;
  const py = editingIndex >= 0 ? p.payments?.[editingIndex] : null;
  const exist = py && !py.void ? (+py.amount || 0) : 0;
  return round2local(dueOf(p) + exist);
}

/* ---------------- 品类 / 收款方 ---------------- */
/**
 * 写预算的内部实现（**不自己入栈**，由调用方决定「这次算几步」）。
 * - `> 0` 才写键；`0` / 空 / 负 = 删除键（与 v1.6 一致，绝不写 0，保住「13 个键」口径）
 */
function applyBudget(bk, name, value) {
  const v = +value || 0;
  if (v > 0) bk.budget[name] = v;
  else delete bk.budget[name];
  // 写时同步派生缓存，避免 book.totalBudget 长期漂移导致体检天天报警
  syncTotalBudget(bk);
}

/**
 * 新增 / 编辑品类。
 * A3：`budget` 为可选入参 —— 品类表单里「改名 + 改预算」是**一个用户动作**，
 * 必须一次落库、只入栈一次；否则用户按一次 Ctrl+Z 只会撤掉预算，品类名还留着。
 * @param {string} prevName 原品类名（新增时传 ''）
 * @param {{name: string, color?: string, note?: string, budget?: number|string}} form
 */
export function upsertCategory(prevName, { name, color, note, budget } = {}) {
  const cats = book.value.categories;
  const n = (name || '').trim();
  if (!n) return { ok: false, msg: '请填写品类名称' };
  if (prevName && prevName !== n && cats.find((c) => c.name === n)) {
    return { ok: false, msg: '已存在同名品类' };
  }
  // A3：校验全过之后才入栈，且整个「改名 + 迁移预算键 + 写新预算」只算 1 步
  pushUndo();
  if (prevName) {
    const c = cats.find((x) => x.name === prevName);
    if (c) Object.assign(c, { name: n, color, note: note || '' });
    if (prevName !== n) {
      book.value.projects.forEach((p) => { if (p.cat === prevName) p.cat = n; });
      if (book.value.budget[prevName] !== undefined) {
        book.value.budget[n] = book.value.budget[prevName];
        delete book.value.budget[prevName];
      }
    }
  } else {
    cats.push({ name: n, color, note: note || '' });
  }
  // 表单里带的预算：改名之后用**新名**落键（旧名已在上面迁移过）
  if (budget !== undefined && budget !== '') applyBudget(book.value, n, budget);
  // 改名迁移完 budget 键后对齐派生缓存（值不变，仅为让 totalBudget 不长期漂移）
  syncTotalBudget(book.value);
  return { ok: true, msg: '已保存' };
}
export function removeCategory(name) {
  pushUndo();
  book.value.categories = book.value.categories.filter((c) => c.name !== name);
  delete book.value.budget[name];
}
export function usageOfCategory(name) {
  return (book.value?.projects || []).filter((p) => p.cat === name).length;
}
/** 改单个品类预算（预算页直接编辑走这里，一步一格） */
export function setBudget(name, value) {
  if (!book.value) return;
  pushUndo();
  applyBudget(book.value, name, value);
}

export function upsertPayee(prevName, { name, contact, note }) {
  const list = book.value.payees;
  const n = (name || '').trim();
  if (!n) return { ok: false, msg: '请填写名称' };
  if (prevName && prevName !== n && list.find((p) => p.name === n)) {
    return { ok: false, msg: '已存在同名收款方' };
  }
  // A3：校验通过后入栈（改名会连带迁移所有费用项的收款方字段，必须能一步撤回）
  pushUndo();
  if (prevName) {
    const p = list.find((x) => x.name === prevName);
    if (p) Object.assign(p, { name: n, contact: contact || '', note: note || '' });
    if (prevName !== n) book.value.projects.forEach((x) => { if (x.object === prevName) x.object = n; });
  } else {
    list.push({ name: n, contact: contact || '', note: note || '' });
  }
  return { ok: true, msg: '已保存' };
}
export function removePayee(name) {
  pushUndo();
  book.value.payees = book.value.payees.filter((p) => p.name !== name);
}
export function usageOfPayee(name) {
  return (book.value?.projects || []).filter((p) => p.object === name).length;
}

/* ---------------- K9（v1.8）收款方改名 / 合并 ----------------
 * 收款方**始终是字符串字段**（`project.object` / 付款 `payee`），绝不改成实体 ——
 * 明细 `byPayee`、导出「收款方」列、对账单都按字符串读取，改实体会牵一发动全身。
 * 因此改名只在「字符串引用层」做全局替换，并同步维护 `book.payees` 注册表供档案 UI 用。
 *
 * 两种语义合并进一个入口：
 *  · 新名不存在  → 纯改名：注册表项改名 + 迁移所有引用（0 孤儿）
 *  · 新名已存在  → 合并：把旧名下的引用全归到已有新名，删掉旧注册表项
 */
export function renamePayee(oldName, newName) {
  const old = String(oldName || '').trim();
  const next = String(newName || '').trim();
  if (!old) return { ok: false, msg: '原收款方名不可为空' };
  if (!next) return { ok: false, msg: '新收款方名不可为空' };
  if (old === next) return { ok: false, msg: '新名与原名相同' };
  if (!book.value) return { ok: false, msg: '没有可用项目' };

  const src = book.value.payees.find((p) => p.name === old);
  const target = book.value.payees.find((p) => p.name === next);
  // 旧名既不在注册表、也没在任何费用项里引用 → 无事可做
  if (!src && !book.value.projects.some((p) => p.object === old)) {
    return { ok: false, msg: `未找到名为「${old}」的收款方` };
  }

  // 一次用户动作只算 1 步撤销
  pushUndo();

  if (target) {
    // 合并：旧引用全部归到已存在的 target 名下，删掉旧注册表项（无孤儿）
    book.value.projects.forEach((p) => { if (p.object === old) p.object = next; });
    book.value.projects.forEach((p) => (p.payments || []).forEach((py) => {
      if (py.payee === old) py.payee = next;
    }));
    if (src) book.value.payees = book.value.payees.filter((p) => p.name !== old);
  } else if (src) {
    // 纯改名：注册表项改名 + 迁移所有引用
    src.name = next;
    book.value.projects.forEach((p) => { if (p.object === old) p.object = next; });
    book.value.projects.forEach((p) => (p.payments || []).forEach((py) => {
      if (py.payee === old) py.payee = next;
    }));
  } else {
    // 旧名只在费用项里被引用（注册表缺失）：补建新注册表项并迁移引用
    book.value.payees.push({ name: next, contact: '', note: '' });
    book.value.projects.forEach((p) => { if (p.object === old) p.object = next; });
    book.value.projects.forEach((p) => (p.payments || []).forEach((py) => {
      if (py.payee === old) py.payee = next;
    }));
  }
  persistNow();
  return { ok: true, msg: `已将「${old}」${target ? '合并到' : '改名为'}「${next}」` };
}

/**
 * K23（v1.9.x）收款方改名 / 合并的**影响预览**（纯函数，绝不落库）。
 *
 * 背景（第三轮评审⑧）：改名/合并会全局改写费用项 object 与付款 payee，但界面只说
 * 「已保存」，用户不知道这一下动了多少数据。预览与落库**共用同一套口径**
 * （`project.object === old` + 付款 `payee === old`），保证「预览说几条、实际就迁几条」。
 *
 * @param {string} oldName 原名
 * @param {string} newName 新名（已存在 = 合并语义）
 * @returns {null|{projects: number, payable: number, payCount: number, payAmount: number,
 *   merged: boolean, inRegistry: boolean, targetExists: boolean}}
 *   - null = 入参不可预览（空名 / 同名 / 无账套），调用方不展示预览行
 *   - projects   受影响费用项数（object === old）
 *   - payable    这些费用项的应付合计（renamePayee 不改金额，预览给出量级）
 *   - payCount / payAmount 受影响付款流水笔数 / 金额合计（含作废流水 —— 改名确实会改写它们）
 *   - merged     新名已在注册表 → 合并语义（旧档案项将被移除）
 *   - inRegistry 旧名在注册表（不在 = 档案缺失，renamePayee 会补建新项，0 孤儿）
 */
export function renamePayeeImpact(oldName, newName) {
  const old = String(oldName || '').trim();
  const next = String(newName || '').trim();
  if (!old || !next || old === next || !book.value) return null;
  const affected = (book.value.projects || []).filter((p) => p.object === old);
  let payCount = 0;
  let payAmount = 0;
  (book.value.projects || []).forEach((p) => (p.payments || []).forEach((py) => {
    if (py.payee === old) { payCount += 1; payAmount += +py.amount || 0; }
  }));
  return {
    projects: affected.length,
    payable: round2(affected.reduce((s, p) => s + payableOf(p), 0)),
    payCount,
    payAmount: round2(payAmount),
    merged: (book.value.payees || []).some((p) => p.name === next),
    inRegistry: (book.value.payees || []).some((p) => p.name === old),
  };
}

/* ---------------- 数据 ---------------- */
export function resetActiveBook(toSeed = false) {
  const b = book.value;
  if (!b) return { ok: false };
  pushUndo();
  // 破坏性操作前强制存快照（跨会话可回滚）
  const snap = snapshotNow('pre', toSeed ? 'restore-default' : 'reset');
  if (toSeed) {
    const s = normalizeBook(mkBook(b.name, clone(SEED)));
    b.budget = s.budget;
    b.projects = s.projects;
    b.categories = s.categories;
    b.payees = s.payees;
    syncTotalBudget(b);
  } else {
    b.budget = {};
    b.projects = [];
    b.categories = [];
    b.payees = [];
    syncTotalBudget(b);
  }
  persistNow();
  const r = { ok: true };
  if (snap && snap.ok === false && snap.msg) r.snapWarn = snap.msg;
  return r;
}

/** 导入完整备份 {books,templates,...} */
export function importState(data) {
  if (!data || !Array.isArray(data.books) || !data.books.length) {
    return { ok: false, msg: '备份文件里没有账套数据' };
  }
  pushUndo();
  const snap = snapshotNow('pre', 'import');
  state.books = data.books.map(normalizeBook);
  state.books.forEach(syncTotalBudget);
  state.templates = Array.isArray(data.templates) ? data.templates : [];
  state.warnThreshold = data.warnThreshold || state.warnThreshold;
  state.activeBookId = state.books.some((b) => b.id === data.activeBookId)
    ? data.activeBookId
    : state.books[0].id;
  restorePrefsFromPayload(data.prefs); // K20：导入备份时恢复搭载的界面偏好（老备份没有则不动）
  persistNow();
  const r = { ok: true, msg: `已导入 ${state.books.length} 个项目` };
  if (snap && snap.ok === false && snap.msg) r.snapWarn = snap.msg;
  return r;
}

/** 从网页版 localStorage 搬家 */
export function detectLegacy() {
  const found = [];
  LEGACY_KEYS.forEach((k) => {
    let raw = null;
    try { raw = localStorage.getItem(k); } catch (_) { return; }
    if (!raw) return;
    try {
      const d = JSON.parse(raw);
      const count = Array.isArray(d?.books)
        ? d.books.reduce((s, b) => s + (b.projects || []).length, 0)
        : (d?.projects || []).length;
      found.push({ key: k, projects: count, books: Array.isArray(d?.books) ? d.books.length : 1 });
    } catch (_) { found.push({ key: k, projects: -1, books: 0 }); }
  });
  return found;
}

export function importLegacy(key) {
  let raw = null;
  try { raw = localStorage.getItem(key); } catch (_) { return { ok: false, msg: '无法读取' }; }
  if (!raw) return { ok: false, msg: '该版本没有数据' };
  let d;
  try { d = JSON.parse(raw); } catch (_) { return { ok: false, msg: '数据解析失败' }; }

  const incoming = [];
  if (Array.isArray(d?.books) && d.books.length) {
    d.books.forEach((b) => incoming.push(normalizeBook(mkBook(b.name || '导入项目', {
      ...b,
      color: b.color,
    }))));
  } else if (Array.isArray(d?.projects)) {
    incoming.push(normalizeBook(mkBook('网页版数据', d)));
  } else {
    return { ok: false, msg: '没有可导入的账套' };
  }
  incoming.forEach((b) => { b.name = b.name || '网页版数据'; });
  // 追加式导入，但仍是破坏性语义（数据量级会翻倍），导入前存档
  pushUndo();
  const snap = snapshotNow('pre', 'import-legacy');
  state.books = [...state.books, ...incoming];
  incoming.forEach((b) => syncTotalBudget(b));
  state.activeBookId = incoming[0].id;
  persistNow();
  const total = incoming.reduce((s, b) => s + b.projects.length, 0);
  const r = { ok: true, msg: `已导入 ${incoming.length} 个项目 / ${total} 个费用项`, count: total };
  if (snap && snap.ok === false && snap.msg) r.snapWarn = snap.msg;
  return r;
}

/* ---------------- X1 CSV 导入（三表回读） ----------------
 * 只填充数据，不重算或另存总额；明细→总计→应付链不变。
 * 落库前 pushUndo() + snapshotNow('pre','import') 双保险可回滚。
 * @param {'project'|'detail'|'pay'} table 表类型
 * @param {Array<object>} rows 已由 parse.mapRow 映射并校验过的对象数组
 * @param {'append'|'overwrite'|'skip'} strategy 冲突策略
 */
export function importTable(table, rows, strategy = 'append') {
  if (!book.value) return { ok: false, msg: '没有可用项目' };
  if (!Array.isArray(rows) || !rows.length) return { ok: false, msg: '没有可导入的行' };
  pushUndo();
  snapshotNow('pre', 'import'); // 落库前存档可回滚
  const b = book.value;
  let imported = 0;
  let overwritten = 0;
  let skipped = 0;

  if (table === 'project') {
    rows.forEach((r) => {
      const exist = b.projects.find((p) => p.no === r.no);
      if (exist) {
        if (strategy === 'skip') { skipped += 1; return; }
        Object.assign(exist, {
          cat: r.cat || exist.cat,
          sub: r.sub || exist.sub,
          remark: r.remark || exist.remark,
          date: normDate(r.date) || exist.date,
          due: normDate(r.due) || exist.due,
          total: (r.total === '' || r.total == null) ? exist.total : +r.total,
          discount: (r.discount === '' || r.discount == null) ? exist.discount : +r.discount,
          object: r.object || exist.object,
        });
        if (exist.details && exist.details.length) syncTotalFromDetails(exist);
        ensurePayee(exist.object);
        overwritten += 1;
      } else {
        b.projects.push({
          id: uid(),
          no: r.no || nextNo(b.projects),
          date: normDate(r.date),
          due: normDate(r.due),
          cat: r.cat || '',
          sub: r.sub || '材料费',
          remark: r.remark || '',
          total: +r.total || 0,
          discount: +r.discount || 0,
          object: r.object || '',
          details: [],
          payments: [],
        });
        ensurePayee(r.object);
        imported += 1;
      }
    });
  } else if (table === 'detail') {
    /**
     * 明细行定位规则（与 PRD #8 / 设计 §5.7 对齐，但避开两个坑）：
     *  · 去重键是「项目号 + 品名 + 金额」，可 `overwrite` 若真按含金额的键匹配，
     *    用户手改金额后就会匹配不上 → 变成新增，条数变化，违反 T05-②「条数不变」。
     *  · 只按「项目号 + 品名」匹配又会把同一项目里的同名明细全部折叠到第一条上，
     *    直接吞掉数据（实测 384 条明细会少掉近 9 千元应付）。
     * 因此 overwrite 用「同项目 + 同品名的第 k 次出现」定位（导出→改值→导回时顺序稳定，
     * 条数与行内位置都不变）；append / skip 仍按 (项目号+品名+金额) 去重。
     */
    const occ = new Map(); // key = 项目号|品名 → 已处理过的次数
    rows.forEach((r) => {
      const p = b.projects.find((x) => x.no === r.no);
      if (!p) { skipped += 1; return; }
      p.details = p.details || [];
      const nameKey = `${r.no}|${r.name || ''}`;
      const k = occ.get(nameKey) || 0;
      occ.set(nameKey, k + 1);
      const amount = round2(+r.amount || 0);
      let exist = null;
      if (strategy === 'overwrite') {
        const same = p.details.filter((d) => (d.name || '') === (r.name || ''));
        exist = same[k] || null;
      } else {
        exist = p.details.find((d) => (d.name || '') === (r.name || '')
          && round2(+d.amount || 0) === amount) || null;
      }
      if (exist) {
        if (strategy === 'skip') { skipped += 1; return; }
        Object.assign(exist, {
          name: r.name || exist.name,
          unit: r.unit || exist.unit,
          qty: (r.qty === '' || r.qty == null) ? exist.qty : +r.qty,
          price: (r.price === '' || r.price == null) ? exist.price : +r.price,
          amount,
          craft: r.craft || exist.craft,
          note: r.note || exist.note,
          est: r.est || exist.est,
        });
        overwritten += 1;
      } else {
        p.details.push({
          name: r.name,
          unit: r.unit || '',
          est: r.est || '否',
          qty: (r.qty === '' || r.qty == null) ? null : +r.qty,
          price: (r.price === '' || r.price == null) ? null : +r.price,
          amount,
          craft: r.craft || '',
          note: r.note || '',
        });
        imported += 1;
      }
      syncTotalFromDetails(p);
    });
  } else if (table === 'pay') {
    /**
     * 付款行定位规则（v1.6 起以「付款编号」为首选）：
     *  · **有合法编号且命中** → 直接定位。这是唯一能区分「同项目同日期多笔」的方式，
     *    也是 X1「导出 → 手改金额 → 按编号覆盖」不再虚增已付的根本保证。
     *  · 无编号（v1.5 及更早的导出文件、用户自建表）→ 退回 v1.3 的位置/金额规则：
     *    append / skip 按「项目号 + 付款日期 + 金额」去重，overwrite 按「同项目同日期第 k 次出现」。
     *    ⚠️ 金额绝不能进 overwrite 的主匹配键 —— 改金额即失配会走成新增，把同一笔款记两遍。
     */
    const occ = new Map(); // key = 项目号|付款日期 → 已处理次数（仅无编号行使用）
    const used = new Set(); // 本次导入已消费掉的付款对象，避免同一行被匹配两次
    rows.forEach((r) => {
      const p = b.projects.find((x) => x.no === r.no);
      if (!p) { skipped += 1; return; }
      p.payments = p.payments || [];
      const date = normDate(r.date);
      const amount = round2(+r.amount || 0);
      const key = `${date}|${amount}`;
      /**
       * C6：三策略本身一行不改，只在入口把编号洗成纯净 pid。
       * `mapRow` 已经剥过一次，这里是**第二道闸**：任何绕过解析层直接调 `importTable` 的调用
       * （脚本 / 后续批量导入）也不会把全号写进库。
       */
      const pid = payPidOf(r.pid);

      let exist = null;
      // ① 唯一键优先
      if (pid) {
        exist = p.payments.find((py) => py.pid === pid && !used.has(py)) || null;
      }
      // ② 无编号时退回旧规则
      if (!exist) {
        if (strategy === 'overwrite') {
          const occKey = `${r.no}|${date}`;
          const k = occ.get(occKey) || 0;
          occ.set(occKey, k + 1);
          const same = p.payments.filter((py) => normDate(py.date) === date);
          exist = same[k] && !used.has(same[k]) ? same[k] : null;
          // 兜底：没有第 k 条时，退化为「同日期 + 同金额且未被本次消费」的那一条，仍避免重复记账
          if (!exist) {
            exist = p.payments.find((py) => !used.has(py)
              && normDate(py.date) === date
              && round2(+py.amount || 0) === amount) || null;
          }
        } else {
          exist = p.payments.find((py) => !used.has(py)
            && `${normDate(py.date)}|${round2(+py.amount || 0)}` === key) || null;
        }
      }

      if (exist) {
        if (strategy === 'skip') { skipped += 1; return; }
        used.add(exist);
        Object.assign(exist, {
          date,
          amount,
          method: r.method || exist.method,
          note: r.note || exist.note,
          ref: r.ref || exist.ref,
        });
        // C5：导入可以「把某笔标为作废」，但**绝不**把本地的作废款改回有效 ——
        // 静默复活一笔已对账的款比少改一次危险得多。恢复请走界面。
        if (r.voidFlag) exist.void = true;
        overwritten += 1;
      } else {
        const item = {
          pid: nextPid(p.payments),
          date,
          method: r.method || '微信',
          amount,
          note: r.note || '',
          ref: r.ref || '',
          void: r.voidFlag === true,
        };
        p.payments.push(item);
        used.add(item);
        imported += 1;
      }
    });
  } else {
    return { ok: false, msg: '未知表类型' };
  }

  persistNow();
  return {
    ok: true,
    msg: `导入 ${imported} 条（覆盖 ${overwritten} / 跳过 ${skipped}）`,
    imported,
    overwritten,
    skipped,
  };
}

/**
 * 一键修复体检问题。
 *
 * 关键不变量：本批所有 fix 动作都**不改变** payable / paid / due（见设计稿 1.2 不变量表），
 * 因此文案是「金额未变动」，`deltas` 正常恒为 0；非 0 说明出现了预期外的修复码。
 *
 * ⚠️ 修复动作一律**重新全量遍历** `book.projects` / `Object.keys(book.budget)`，
 * 绝不使用 `issue.samples`（只有 3 条，用了就只能修 3 条）。
 *
 * @param {string[]|null} codes 只修指定问题码；null = 全部可修项
 */
export function fixCheckup(codes = null) {
  if (!book.value) return { ok: false, msg: '没有可用项目' };
  const before = checkup(book.value);
  const targets = before.issues.filter((i) => i.fix && (!codes || codes.includes(i.code)));
  // 没有可修项时不写快照 —— 避免挤占仅有的 3 个 pre 槽
  if (!targets.length) return { ok: true, msg: '没有可自动修复的问题' };

  snapshotNow('pre', 'checkup-fix');

  const payBefore = round2(calc(book.value).payable);
  const paidBefore = round2(calc(book.value).paid);
  const dueBefore = round2(calc(book.value).remain);
  const budBefore = sumBudget(book.value);
  const codeList = targets.map((i) => i.code);

  // ① 品类档案类
  if (codeList.includes('cat-missing')) ensureCategory('未分类');
  if (codeList.includes('orphan-cat')) {
    book.value.projects.forEach((p) => { if (p.cat) ensureCategory(p.cat); });
  }
  if (codeList.includes('budget-orphan-cat')) {
    Object.keys(book.value.budget).forEach((name) => { ensureCategory(name); });
  }
  // ② 收款方档案
  if (codeList.includes('orphan-payee')) {
    book.value.projects.forEach((p) => { if (p.object) ensurePayee(p.object); });
  }
  // ③ 总计缓存对齐（有明细时应付本来就取明细，金额不受影响）
  if (codeList.includes('total-drift')) {
    book.value.projects.forEach((p) => syncTotalFromDetails(p));
  }
  // ④ 遗留字段对齐（恒在最后；其余 fix 不碰 budget）
  syncTotalBudget(book.value);
  persistNow();

  const after = calc(book.value);
  return {
    ok: true,
    msg: `已修复 ${targets.length} 类问题，金额未变动`,
    codes: codeList,
    deltas: {
      payable: round2(after.payable - payBefore),
      paid: round2(after.paid - paidBefore),
      due: round2(after.remain - dueBefore),
      totalBudget: round2(sumBudget(book.value) - budBefore),
    },
  };
}

/* ---------------- K2（v1.8）自动备份 ----------------
 * 到周期边界（周初 / 月初）触发一次 JSON 下载（复用 exportJson / 浏览器下载机制；
 * ZTools 无文件系统 API，落下载文件夹即可），并记一条「时间 + 大小」日志供设置页展示。
 * 周期判定：以「当前周期 key」是否变化为准（周 = ISO 周，月 = YYYY-MM），
 * 跨过边界才备份一次，绝不在同一周期内重复下文件。 */

/** 算出某日期所属周期 key（周 / 月）。越界 / 非法输入回退到当前。 */
function periodKey(period, date = new Date()) {
  const d = (date instanceof Date && !Number.isNaN(date.getTime())) ? date : new Date();
  const y = d.getFullYear();
  if (period === 'month') {
    return `${y}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  // 周：ISO 周（周一为一周起点）。公式取自标准 ISO-8601 周号算法。
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** 真正执行一次备份（下载 + 记日志 + 更新 last 时间戳）。永不 throw。 */
function doAutoBackup() {
  try {
    // 先算字节大小（用于日志展示），再走 exportJson 触发下载
    const payload = {
      books: state.books,
      activeBookId: state.activeBookId,
      templates: state.templates,
      warnThreshold: state.warnThreshold,
    };
    const json = JSON.stringify(payload, null, 2);
    let size = 0;
    try { size = new TextEncoder().encode(json).length; } catch (_) { size = json.length; }

    const meta = exportJson(state, book.value); // 复用同一套下载机制
    if (!meta || !meta.name) return { ok: false, msg: '备份导出失败' };
    addAutoBackupLog({ ts: Date.now(), size, name: meta.name });
    setLastAutoBackup(Date.now());
    return { ok: true, name: meta.name, size };
  } catch (e) {
    return { ok: false, msg: '自动备份失败：' + (e?.message || e) };
  }
}

/**
 * 周期边界检查：启用且跨过周期边界才备份，否则跳过。
 * 无 DOM（node 测试 / SSR）环境直接跳过，绝不下载。
 * @returns {{ok: boolean, skipped?: boolean, reason?: string, name?: string, size?: number}}
 */
export function maybeAutoBackup() {
  let cfg;
  // prefs.getAutoBackup 永不 throw，这里的兜底只为防御引用异常；默认值与 prefs 保持一致
  try { cfg = getAutoBackup(); } catch (_) { cfg = { enabled: true, period: 'week' }; }
  if (!cfg || !cfg.enabled) return { ok: false, skipped: true, reason: 'disabled' };
  /**
   * 首次启动「只告知、不下载」闸门（周期判定前的一道闸）。
   *
   * 用意：自动备份已改为**默认开启**（prefs.AUTO_BACKUP_DEFAULT），若这里直接放行，
   * 任何首次启动都会立刻触发一次真实 JSON 下载 —— 而 headless 回归脚本每次都清 localStorage
   * 重跑，等于每次都「首次启动」→ 每次都下载。上一版就有 5 个 UI 套件被下载动作 / 文件对话框
   * 卡死。加这道闸后：
   *   · 真实用户：第 1 次打开仅置位标记（App.vue 据此提示一次），第 2 次起按周期真实备份；
   *   · 回归脚本：永远停在「首启」，永远不会触发下载，套件不再被卡。
   * 两全，且不需要 App.vue 改任何代码。
   */
  if (!getAutoBackupNoticed()) {
    try { setAutoBackupNoticed(true); } catch (_) { /* 静默：最坏结果只是再告知一次 */ }
    return { ok: false, skipped: true, reason: 'first-run-notice' };
  }
  if (typeof document === 'undefined' || !document) {
    return { ok: false, skipped: true, reason: 'no-dom' };
  }
  const now = Date.now();
  const curKey = periodKey(cfg.period, new Date(now));
  const last = getLastAutoBackup();
  const lastKey = last ? periodKey(cfg.period, new Date(last)) : '';
  if (last && lastKey === curKey) return { ok: false, skipped: true, reason: 'in-period' };
  return doAutoBackup();
}

/** 手动「立即备份」：无视周期边界强制下载一次（设置页按钮用）。 */
export function doAutoBackupNow() {
  if (typeof document === 'undefined' || !document) {
    return { ok: false, msg: '当前环境不支持下载' };
  }
  return doAutoBackup();
}

export { KEY, payableOf, dueOf, fmt, fmtSnapTime, REASON_TEXT };

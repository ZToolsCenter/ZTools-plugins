<script setup>
import { computed, ref, watch, nextTick } from 'vue';
import { book, batchSetCategory, batchSetPayee, batchSetDue, batchDelete, batchPay, planBatchPay, canUndo, undo, undoDepth, canRedo, redo, redoDepth, undoVersion } from '../lib/store';
import { statOf, fmtNum, fmtAbs, todayLocal, statusText } from '../lib/core';
import { filterProjectsWithHits, hasFilter, filterTag, sortProjects } from '../lib/filters';
import { exportXlsx } from '../lib/export';
import { ui, openDrawer, toast, clearListFilters } from '../lib/ui';
import { densityLive } from '../lib/prefs';
import { useListNav } from '../lib/nav';
import ItemRow from '../components/ItemRow.vue';
import DensityChip from '../components/DensityChip.vue';
import Icon from '../components/Icon.vue';

const STATUS = [
  { v: '', t: '全部' },
  { v: 'unpaid', t: '未付' },
  { v: 'part', t: '部分付' },
  { v: 'paid', t: '已付' },
];

const showDate = ref(false);
const sortKey = ref('date');   // date | no | amount

/* K22：密度 chip 与直达菜单收进 DensityChip 组件（prefs 为唯一真源，列表/图表/抽屉共用）。 */

const cats = computed(() => (book.value?.categories || []).map((c) => c.name));

/** 筛选条件快照：唯一真源是 ui（跨分区保留），过滤逻辑唯一真源是 filters.js */
const f = computed(() => ({
  query: ui.query,
  cat: ui.filterCat,
  status: ui.filterStatus,
  from: ui.filterDateFrom,
  to: ui.filterDateTo,
}));

/**
 * B1：筛选 + 命中提示一次算完（唯一真源仍是 `filters.js`，这里不另拼 haystack）。
 * 搜索**不影响排序**：排序键还是 date / no / amount 三档，与 v1.6 一致。
 */
const matched = computed(() => filterProjectsWithHits(book.value?.projects || [], f.value));
const hits = computed(() => matched.value.hits);
const fieldHits = computed(() => matched.value.fieldHits);

/**
 * K8：搜索命中导航。navIndex 指向「当前定位到的命中行」在可见列表中的位置；
 * 命中顺序 = 当前筛选+排序后的可见行顺序（与用户看到的列表一致）。
 */
const navIndex = ref(-1);
function scrollToNav() {
  nextTick(() => {
    const el = document.querySelector('.item.nav');
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
  });
}
function nextHit() {
  if (!rows.value.length) return;
  navIndex.value = navIndex.value + 1 >= rows.value.length ? 0 : navIndex.value + 1;
  scrollToNav();
}
function prevHit() {
  if (!rows.value.length) return;
  navIndex.value = navIndex.value - 1 < 0 ? rows.value.length - 1 : navIndex.value - 1;
  scrollToNav();
}
function resetNav() { navIndex.value = -1; }

/**
 * K14：撤销按钮。canUndo/undo 是纯函数（非 ref），借 book 变化触发重算。
 *  K21：tooltip 带上「可撤销 N 步」（步数来自 undoDepth()，同样借 book 触发重算）。
 *  K18：重做按钮同款；redo 后步数也随 book 变化刷新。
 *  ⚠️ K18-UI 实测修正：只写 `void book.value` **不够** —— 改一条费用项备注时
 *  `book` 这个 computed 的依赖（`state.books` 数组身份 / `activeBookId`）没变，
 *  它不会重算，按钮会一直停在旧值（栈里已有 2 步仍是灰的、点了没反应）。
 *  必须再借全局信号 `undoVersion`（store 里任何栈变化都会 +1）才会实时刷新。
 */
const canUndoNow = computed(() => { void undoVersion.value; void book.value; return canUndo(); });
const canRedoNow = computed(() => { void undoVersion.value; void book.value; return canRedo(); });
const undoSteps = computed(() => { void undoVersion.value; void book.value; return undoDepth(); });
const redoSteps = computed(() => { void undoVersion.value; void book.value; return redoDepth(); });
function doUndo() {
  const r = undo();
  toast(r.ok ? '已撤销上一步' : '没有可撤销的操作');
}
function doRedo() {
  const r = redo();
  toast(r.ok ? '已重做上一步' : '没有可重做的操作');
}
const rows = computed(() => sortProjects(matched.value.rows, sortKey.value).map((p) => ({ p, st: statOf(p) })));
// 关键词或结果集变化时回到「未定位」状态，避免导航指针指向错位。
// 必须放在 rows 之后：watch 注册时会立即求值一次取旧值，写在 rows 声明前会撞 TDZ
// （ReferenceError: Cannot access 'rows' before initialization）。
watch(() => [ui.query, rows.value.length], resetNav);

const sumPayable = computed(() => rows.value.reduce((s, x) => s + x.st.payable, 0));
const sumDue = computed(() => rows.value.reduce((s, x) => s + Math.max(x.st.due, 0), 0));

const hasDate = computed(() => !!(ui.filterDateFrom || ui.filterDateTo));
const filtered = computed(() => hasFilter(f.value));

/** 按当前筛选导出：三张表共用同一个作用域，结构上不可能对不上 */
function doExportScope() {
  const scoped = filtered.value;
  const list = scoped ? rows.value.map((x) => x.p) : null;
  if (scoped && !list.length) {
    toast('当前筛选没有匹配的费用项，请调整后再导出');
    return;
  }
  const tag = scoped ? filterTag(f.value) : '';
  const r = exportXlsx(book.value, todayLocal(), { statOf, statusText }, list, tag);
  toast(scoped ? `已导出筛选结果 ${list.length} 条 / ${r.rows} 行` : `已导出全部 ${r.rows} 行`);
}

function openItem(p) {
  ui.selId = p.id;
  openDrawer({ type: 'item', id: p.id });
}

/**
 * B1：点「命中：砂子 ×2」直接进抽屉并定位到那条明细（`focusName`）。
 * 只命中单位/工艺/备注的行不会有提示（见 filters.js 注释），所以这里 `hit.name` 一定非空；
 * 仍然做一次兜底 —— 万一哪天提示规则变了，也只是「不定位」，不会送 undefined 进抽屉。
 */
function openHit(p, hit) {
  ui.selId = p.id;
  openDrawer({ type: 'item', id: p.id, focusName: hit?.name || '' });
}
function openNew() {
  openDrawer({ type: 'item', mode: 'edit', id: null });
}
/** 清除筛选：与 Esc 走同一个出口，保证两处行为一致 */
function clearAll() {
  clearListFilters();
}

useListNav(() => rows.value, (id) => {
  const hit = rows.value.find((x) => x.p.id === id);
  if (hit) openItem(hit.p);
});

/* ---------------- R5 多选与批量操作 ----------------
 * 多选态用 ui.selectedIds（内存态），与导航态 ui.selId 解耦，互不干扰。 */
const selectedCount = computed(() => ui.selectedIds.length);
/** 当前可见行是否全部已选（决定「全选 / 取消全选」按钮文案） */
const allSelected = computed(() => rows.value.length > 0 && rows.value.every((x) => ui.selectedIds.includes(x.p.id)));
const payees = computed(() => (book.value?.payees || []).map((p) => p.name));
const batchCat = ref('');
const batchPayee = ref('');
const batchDue = ref('');
const showBatchCat = ref(false);
const showBatchPayee = ref(false);
const showBatchDue = ref(false);
/* C4 批量付款：预览与落库共用 planBatchPay（同一份算法），预览不会与结果漂移 */
const showBatchPay = ref(false);
const payTotal = ref('');
const payMode = ref('due');
const payDate = ref('');
const payPlan = computed(() => planBatchPay(ui.selectedIds, +payTotal.value || 0, payMode.value));
const payRowCount = computed(() => payPlan.value.rows.filter((r) => r.amount !== 0).length);

let lastIndex = -1;
function deselect(id) {
  const i = ui.selectedIds.indexOf(id);
  if (i >= 0) ui.selectedIds.splice(i, 1);
}
function selectId(id) {
  if (!ui.selectedIds.includes(id)) ui.selectedIds.push(id);
}
/** Shift 连选基于当前可见行（rows 排序后）；纯选择不打开抽屉、不影响导航 */
function toggleSelect(id, shift) {
  const ids = rows.value.map((x) => x.p.id);
  const i = ids.indexOf(id);
  if (shift && lastIndex >= 0) {
    const [a, b] = [Math.min(lastIndex, i), Math.max(lastIndex, i)];
    const range = ids.slice(a, b + 1);
    const allOn = range.every((x) => ui.selectedIds.includes(x));
    range.forEach((x) => (allOn ? deselect(x) : selectId(x)));
  } else if (ui.selectedIds.includes(id)) {
    deselect(id);
  } else {
    selectId(id);
  }
  lastIndex = i;
}
function clearSelection() {
  ui.selectedIds = [];
  lastIndex = -1;
  showBatchCat.value = false;
  showBatchPayee.value = false;
  showBatchDue.value = false;
  showBatchPay.value = false;
  payTotal.value = '';
}

/** 全选 / 取消全选：作用域 = 当前筛选 + 排序后的可见行（与 Shift 连选同口径） */
function toggleSelectAll() {
  const ids = rows.value.map((x) => x.p.id);
  if (!ids.length) return;
  const allOn = ids.every((id) => ui.selectedIds.includes(id));
  ui.selectedIds = allOn ? [] : ids.slice();
  lastIndex = allOn ? -1 : ids.length - 1;
}

function applyBatchCat() {
  if (!batchCat.value) { showBatchCat.value = false; return; }
  const r = batchSetCategory(ui.selectedIds, batchCat.value);
  if (r.ok) toast(r.msg);
  clearSelection();
}
function applyBatchPayee() {
  if (!batchPayee.value) { showBatchPayee.value = false; return; }
  const r = batchSetPayee(ui.selectedIds, batchPayee.value);
  if (r.ok) toast(r.msg);
  clearSelection();
}
function applyBatchDue() {
  if (!batchDue.value) { showBatchDue.value = false; return; }
  const r = batchSetDue(ui.selectedIds, batchDue.value);
  if (r.ok) toast(r.msg);
  clearSelection();
}
function applyBatchDelete() {
  if (!ui.selectedIds.length) return;
  // eslint-disable-next-line no-alert
  if (!window.confirm(`确认删除选中的 ${ui.selectedIds.length} 个费用项？此操作可在提示中撤销。`)) return;
  const r = batchDelete(ui.selectedIds);
  if (r.ok) toast(r.msg, { undo: true });
  clearSelection();
}

/* ---------------- C4 批量付款 ---------------- */
function openBatchPay() {
  showBatchPay.value = true;
  payDate.value = todayLocal();
  payMode.value = 'due';
  // 预填「待付合计」：最常见的一次性结清场景，用户只需确认
  payTotal.value = payPlan.value.sumDue ? String(payPlan.value.sumDue) : '';
}
function applyBatchPay() {
  if (!payPlan.value.ok) return toast(payPlan.value.msg);
  const r = batchPay(ui.selectedIds, +payTotal.value || 0, { mode: payMode.value, date: payDate.value });
  if (!r.ok) return toast(r.msg);
  toast(r.msg, { undo: true });
  clearSelection();
}
</script>

<template>
  <div class="pane" data-view="items">
    <div class="command">
      <label class="search">
        <Icon name="search" />
        <input v-model="ui.query" class="search-input" placeholder="搜索费用备注 / 品名 / 收款方 / 项目号…" data-search />
        <span class="kbd">⌘K</span>
      </label>
    </div>

    <div class="filters">
      <div class="seg" data-filter-chips>
        <button
          v-for="s in STATUS" :key="s.v"
          :class="{ on: ui.filterStatus === s.v }"
          @click="ui.filterStatus = s.v"
        >{{ s.t }}</button>
      </div>
      <select v-model="ui.filterCat" class="mini-select">
        <option value="">全部品类</option>
        <option v-for="c in cats" :key="c" :value="c">{{ c }}</option>
      </select>
      <select v-model="sortKey" class="mini-select" title="排序" data-sort>
        <option value="date">按日期</option>
        <option value="no">按项目号</option>
        <option value="amount">按金额</option>
        <option value="due">按待付</option>
        <option value="duedate">按到期日</option>
        <option value="payee">按收款方</option>
      </select>
      <button class="chip" :class="{ on: hasDate }" @click="showDate = !showDate">日期</button>
      <!-- K8 命中导航：只在有关键词时出现，无搜索时不占工具栏 -->
      <template v-if="ui.query && rows.length">
        <button class="chip" data-nav-prev title="上一条命中" @click="prevHit">↑</button>
        <button class="chip" data-nav-next title="下一条命中" @click="nextHit">↓</button>
        <span class="mini" data-nav-count>{{ navIndex >= 0 ? navIndex + 1 : 0 }}/{{ rows.length }}</span>
      </template>
      <span class="grow" />
      <!-- K22（v1.9.x）：密度 chip → 直达三档菜单（说明常驻可见，不再只靠悬停 title） -->
      <DensityChip />
      <button v-if="filtered" class="link" @click="clearAll">清除筛选</button>
    </div>

    <div v-if="showDate" class="date-row">
      <input v-model="ui.filterDateFrom" type="date" class="input" />
      <span class="mini">至</span>
      <input v-model="ui.filterDateTo" type="date" class="input" />
    </div>

    <div class="list-head">
      <span>{{ rows.length }} 条</span>
      <span class="grow" />
      <span>应付 <b class="num">{{ fmtNum(sumPayable) }}</b></span>
      <span style="opacity: .45">/</span>
      <span>待付 <b class="num" :style="{ color: sumDue > 0 ? 'var(--accent)' : 'var(--muted)' }">{{ fmtNum(sumDue) }}</b></span>
      <button class="btn sm ghost" data-undo-btn :disabled="!canUndoNow" :title="canUndoNow ? `撤销上一步（⌘Z）· 可撤销 ${undoSteps} 步` : '没有可撤销的操作'" @click="doUndo">撤销</button>
      <button class="btn sm ghost" data-redo-btn :disabled="!canRedoNow" :title="canRedoNow ? `重做上一步（⇧⌘Z）· 可重做 ${redoSteps} 步` : '没有可重做的操作'" @click="doRedo">重做</button>
      <button class="btn sm" :disabled="!rows.length" @click="doExportScope">
        <Icon name="download" :size="11" />{{ filtered ? '导出筛选' : '导出' }}
      </button>
    </div>

    <div class="content flush list-scroll">
      <div class="list" :data-density="densityLive">
        <ItemRow
          v-for="(x, i) in rows" :key="x.p.id"
          :item="x.p" :stat="x.st"
          :selected="ui.selId === x.p.id"
          selectable
          :checked="ui.selectedIds.includes(x.p.id)"
          :hit="hits.get(x.p.id) || null"
          :hit-fields="fieldHits.get(x.p.id) || null"
          :nav="navIndex === i"
          @open="openItem(x.p)"
          @edit="openItem(x.p)"
          @hit="openHit(x.p, $event)"
          @pay="openDrawer({ type: 'item', id: x.p.id, mode: 'pay' })"
          @toggle="toggleSelect"
        />
      </div>
      <div v-if="!rows.length" class="empty">
        <b>没有匹配的费用项</b>
        换个关键词，或点「清除筛选」查看全部
      </div>
      <div v-if="rows.length" class="list-foot mini">
        <span><b style="color: var(--ink-2)">{{ rows.length }}</b> 条 · 键盘 <span class="kbd">J</span><span class="kbd">K</span> 移动、<span class="kbd">Enter</span> 打开</span>
      </div>
    </div>

    <!-- R5 批量操作条：固定在列表下方（flex 兄弟节点，不覆盖内容、不新增列宽） -->
    <div class="batch-bar" :class="{ on: selectedCount > 0, paying: showBatchPay }" data-batch>
      <template v-if="!selectedCount">
        <span class="mini">勾选左侧方框可批量操作（Shift 连选）</span>
        <span class="grow" />
        <button class="link" :disabled="!rows.length" @click="toggleSelectAll">{{ allSelected ? '取消全选' : '全选本页' }}</button>
      </template>
      <template v-else>
        <span class="batch-n">已选 <b class="num">{{ selectedCount }}</b></span>
        <span class="grow" />
        <template v-if="showBatchCat">
          <select v-model="batchCat" class="mini-select">
            <option value="">选择品类…</option>
            <option v-for="c in cats" :key="c" :value="c">{{ c }}</option>
          </select>
          <button class="btn sm primary" :disabled="!batchCat" @click="applyBatchCat">应用</button>
          <button class="btn sm ghost" @click="showBatchCat = false">取消</button>
        </template>
        <template v-else-if="showBatchPayee">
          <select v-model="batchPayee" class="mini-select">
            <option value="">选择收款方…</option>
            <option v-for="p in payees" :key="p" :value="p">{{ p }}</option>
          </select>
          <button class="btn sm primary" :disabled="!batchPayee" @click="applyBatchPayee">应用</button>
          <button class="btn sm ghost" @click="showBatchPayee = false">取消</button>
        </template>
        <template v-else-if="showBatchDue">
          <input v-model="batchDue" type="date" class="input" style="width: 130px; padding: 3px 6px" />
          <button class="btn sm primary" :disabled="!batchDue" @click="applyBatchDue">应用</button>
          <button class="btn sm ghost" @click="showBatchDue = false">取消</button>
        </template>
        <template v-else-if="showBatchPay">
          <!-- C4：一次给同一个工长的多笔款，按待付比例或均分自动拆行 -->
          <div class="bp">
            <div class="bp-row">
              <span class="mini">付款总额</span>
              <input v-model="payTotal" type="number" step="0.01" min="0" class="input bp-amt" data-autofocus />
              <select v-model="payMode" class="mini-select">
                <option value="due">按待付比例</option>
                <option value="even">均分</option>
              </select>
              <input v-model="payDate" type="date" class="input bp-date" />
              <span class="grow" />
              <button class="btn sm primary" :disabled="!payPlan.ok" @click="applyBatchPay">
                登记 {{ payRowCount }} 笔
              </button>
              <button class="btn sm ghost" @click="showBatchPay = false">取消</button>
            </div>
            <div class="bp-row mini">
              <span v-if="payPlan.ok">
                待付合计 <b class="num">{{ fmtNum(payPlan.sumDue) }}</b>
                · 分配后各笔待付见下
                <b v-if="payPlan.over" style="color: var(--warn)"> · 超付 {{ fmtAbs(payPlan.over) }}</b>
              </span>
              <span v-else style="color: var(--warn)">{{ payPlan.msg }}</span>
            </div>
            <div v-if="payPlan.ok" class="bp-chips">
              <span v-for="r in payPlan.rows" :key="r.id" class="bp-chip" :title="r.remark">
                {{ r.no }} <b class="num">{{ fmtNum(r.amount) }}</b>
              </span>
            </div>
          </div>
        </template>
        <template v-else>
          <button class="btn sm" @click="showBatchCat = true">改品类</button>
          <button class="btn sm" @click="showBatchPayee = true">改收款方</button>
          <button class="btn sm" @click="showBatchDue = true">改到期日</button>
          <button class="btn sm" @click="openBatchPay">批量付款</button>
          <button class="btn sm danger" @click="applyBatchDelete">删除</button>
          <!-- 全选/取消全选放在已选态分支里才可达：全选后 selectedCount>0，若只写在空态分支，
               勾满后再也点不到「取消全选」 -->
          <button class="link" @click="toggleSelectAll">{{ allSelected ? '取消全选' : '全选本页' }}</button>
          <button class="btn sm ghost" @click="clearSelection">清空</button>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.pane { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.filters {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--line);
  flex: none;
}
.mini-select {
  height: 24px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
  color: var(--ink-2);
  font-size: 11.5px;
  font-family: inherit;
  padding: 0 4px;
  max-width: 108px;
}
.mini-select:focus { outline: none; border-color: var(--accent); }
.date-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--line);
  background: var(--surface-2);
  flex: none;
}
.date-row .input { width: auto; flex: 1; padding: 4px 6px; font-size: 11.5px; }
.list-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-size: 10.5px;
  color: var(--muted);
  border-bottom: 1px solid var(--line);
  background: var(--surface-2);
  flex: none;
}
.list-head b { color: var(--ink); font-weight: 700; }
.list-scroll { flex: 1; min-height: 0; overflow-y: auto; }
.list-foot { padding: 8px 12px 14px; }
/* R5 批量操作条：flex 兄弟节点固定在 pane 底部，不覆盖滚动区、不新增列宽 */
.batch-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  padding: 6px 12px;
  border-top: 1px solid var(--line);
  background: var(--surface-2);
  min-height: 36px;
}
.batch-bar.on { background: var(--accent-soft); }
/* C4：付款面板要占满整条，故让批量条换行（列表区 flex:1，会自行让出高度） */
.batch-bar.paying { flex-wrap: wrap; align-items: flex-start; }
.bp { width: 100%; display: flex; flex-direction: column; gap: 5px; }
.bp-row { display: flex; align-items: center; gap: 6px; }
.bp-amt { width: 108px; padding: 3px 6px; text-align: right; font-variant-numeric: tabular-nums; }
.bp-date { width: 128px; padding: 3px 6px; }
.bp-chips { display: flex; flex-wrap: wrap; gap: 4px; max-height: 44px; overflow-y: auto; }
.bp-chip {
  border: 1px solid var(--line);
  background: var(--surface);
  border-radius: 5px;
  padding: 1px 5px;
  font-size: 10px;
  color: var(--ink-2);
  font-variant-numeric: tabular-nums;
}
.bp-chip b { color: var(--ink); font-weight: 700; }
.batch-n { font-size: 11.5px; color: var(--ink-2); white-space: nowrap; }
.batch-n b { color: var(--accent); font-weight: 800; }
.batch-bar .link:disabled { opacity: 0.45; cursor: not-allowed; }
.kbd {
  display: inline-block;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0 3px;
  font-size: 9.5px;
  color: var(--muted);
  margin: 0 1px;
}
</style>

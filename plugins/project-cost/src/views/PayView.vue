<script setup>
import { computed, ref } from 'vue';
import { book, stats, canUndo, undo, undoDepth, canRedo, redo, redoDepth, undoVersion } from '../lib/store';
import { statOf, fmt, fmtAbs, fmtNum, payableOf, paidOf, dueOf, statusOf, overdueGroups } from '../lib/core';
import { ui, openDrawer, toast } from '../lib/ui';
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
const showPayee = ref(true);

/**
 * M2：逾期分级。全部走 `overdueGroups`（与顶部预警、账龄页同一口径：
 * `effectiveDue` + 账本推算天数），不在视图里另算一套「raw p.due < today」，
 * 否则填了下单日却没填到期日的费用项会被漏算。
 * 提到 `rows` 之前声明：排序要用它的「逾期天数」，避免 computed 之间出现声明顺序上的空档。
 */
const od = computed(() => overdueGroups(book.value));
const overdue = computed(() => od.value.count);

/** B2（v1.7）排序：逾期天数（默认）/ 待付金额 / 项目号，三级兜底 */
const SORTS = [
  { v: 'days', t: '逾期天数' },
  { v: 'due', t: '待付金额' },
  { v: 'no', t: '项目号' },
];
const paySort = ref('days');
/** 折叠行状态：默认收起，点一下展开小额逾期 */
const showSmall = ref(false);

/** id → 逾期天数（未逾期 = 0）。只用于排序，不参与任何金额计算。 */
const daysById = computed(() => {
  const m = new Map();
  od.value.all.forEach((x) => m.set(x.id, x.days));
  return m;
});

const rows = computed(() => {
  const days = daysById.value;
  const list = (book.value?.projects || [])
    .filter((p) => payableOf(p) > 0 || (p.payments || []).length > 0)
    .filter((p) => !ui.payFilter || statusOf(p) === ui.payFilter)
    .map((p) => ({ p, st: statOf(p), days: days.get(p.id) || 0 }));
  /**
   * 三级兜底：主键由下拉决定，其余两键按固定优先级补齐，保证**任意两行都有确定的先后**
   * （否则同额同天数的行会在每次重排时抖动，用户会以为列表在乱跳）。
   *   days → 逾期天数↓ → 待付↓ → 项目号↑
   *   due  → 待付↓   → 逾期天数↓ → 项目号↑
   *   no   → 项目号↑ → 逾期天数↓ → 待付↓
   */
  const byDays = (a, b) => b.days - a.days;
  const byDue = (a, b) => b.st.due - a.st.due;
  const byNo = (a, b) => (a.p.no || '').localeCompare(b.p.no || '');
  const cmp = paySort.value === 'due'
    ? (a, b) => byDue(a, b) || byDays(a, b) || byNo(a, b)
    : paySort.value === 'no'
      ? (a, b) => byNo(a, b) || byDays(a, b) || byDue(a, b)
      : (a, b) => byDays(a, b) || byDue(a, b) || byNo(a, b);
  return list.sort(cmp);
});

const sum = computed(() => {
  let payable = 0; let paid = 0; let due = 0; let payCount = 0; let voidCount = 0;
  rows.value.forEach((x) => {
    payable += x.st.payable; paid += x.st.paid; due += x.st.due;
    // C5：作废流水单列计数，不混进「N 笔流水」（否则与已付金额对不上）
    (x.p.payments || []).forEach((py) => (py.void ? (voidCount += 1) : (payCount += 1)));
  });
  return { payable, paid, due, payCount, voidCount };
});

const owing = computed(() => {
  const c = stats.value;
  return Object.keys(c.byPayee || {})
    .map((n) => ({ name: n, ...c.byPayee[n], owe: Math.round((c.byPayee[n].amount - c.byPayee[n].paid) * 100) / 100 }))
    .filter((o) => o.owe > 0.5)
    .sort((a, b) => b.owe - a.owe)
    .slice(0, 6);
});
const maxOwe = computed(() => Math.max(...owing.value.map((o) => o.owe), 1));

/** C3：按收款方生成对账单（只读聚合抽屉，不写任何数据） */
function openStatement(name) {
  openDrawer({ type: 'statement', payee: name });
}

useListNav(() => rows.value, (id) => openDrawer({ type: 'item', id }));

/* ---------------- K16/K21/K22（v1.9.x）：密度 + 撤销/重做入口 ----------------
 * K16：付款页此前是唯一没接密度的列表（容器不带 data-density），大字档在这里不生效 ——
 *       现在与列表页同款：`.list` 挂 densityLive，ItemRow 的三套栅格自动生效。
 * K21：撤销入口原来只有列表页一处（评审⑥「入口单点」），这里补上；tooltip 带步数。
 * K18：重做按钮同款（⇧⌘Z）。 */
/* ⚠️ K18-UI：必须借全局信号 undoVersion —— 只靠 `void book.value` 在改备注这类
 * 原地修改下不会失效（book 的依赖没变），按钮会停在旧值。详见 store.js 的 undoVersion 注释。 */
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
</script>

<template>
  <div class="pane" data-view="pay">
    <div class="content">
      <div class="kpi-strip">
        <div class="kpi warn" data-kpi-pay="due">
          <div class="k">待支付</div>
          <!-- C2：付款页 3 张 KPI 主数字一律到分（同屏「N 笔 · 23,784.34」已是分精度，区块内只允许一种精度） -->
          <div class="v">{{ fmt(Math.max(sum.due, 0)) }}</div>
          <div class="s">{{ sum.due < 0 ? '含超付 ' + fmtAbs(sum.due) : overdue ? `含逾期 ${overdue} 笔` : '无逾期' }}</div>
        </div>
        <div class="kpi ok" data-kpi-pay="paid">
          <div class="k">已支付</div>
          <div class="v">{{ fmt(sum.paid) }}</div>
          <div class="s">{{ sum.payCount }} 笔流水<template v-if="sum.voidCount">（作废 {{ sum.voidCount }}）</template></div>
        </div>
        <div class="kpi sky" data-kpi-pay="payable">
          <div class="k">应付</div>
          <div class="v">{{ fmt(sum.payable) }}</div>
          <div class="s">{{ rows.length }} 个费用项</div>
        </div>
        <div class="kpi" data-kpi-pay="rate">
          <div class="k">完成度</div>
          <div class="v">{{ sum.payable > 0 ? Math.round((sum.paid / sum.payable) * 100) : 0 }}%</div>
          <div class="s">按当前筛选</div>
        </div>
      </div>

      <!-- M2：超 30 天置顶，催款顺序一眼可见 -->
      <div v-if="od.severe.length" class="card od-card">
        <div class="sec-head">
          <span class="bar" />超 30 天 · 优先催收
          <span class="spacer" />
          <span class="hint">{{ od.severe.length }} 笔 · {{ fmtNum(od.severeAmount) }}</span>
        </div>
        <div class="od-list" :class="{ open: showSmall }" data-overdue-main>
          <div
            v-for="x in od.severeMain" :key="x.id"
            class="od-row"
            :title="`${x.payee || '未指定'} · 到期 ${x.due}`"
            @click="openDrawer({ type: 'item', id: x.id })"
          >
            <span class="od-days num">{{ x.days }} 天</span>
            <span class="nm ellipsis">{{ x.remark || x.name || x.no || '未命名' }}</span>
            <span class="grow" />
            <span class="od-amt num">{{ fmtNum(x.amount) }}</span>
            <span class="od-who ellipsis">{{ x.payee || '未指定' }}</span>
          </div>
          <!-- C3：小额逾期折叠。门槛（100 元）在 core.OVERDUE_MIN_AMOUNT，视图不再判断一次。
               计数与合计仍是全量：卡片右上角「5 笔 · 23,784.34」= 4 笔主列表 + 1 笔小额。 -->
          <template v-if="od.smallList.length">
            <template v-if="showSmall">
              <div
                v-for="x in od.smallList" :key="x.id"
                class="od-row small"
                :title="`${x.payee || '未指定'} · 到期 ${x.due}`"
                @click="openDrawer({ type: 'item', id: x.id })"
              >
                <span class="od-days num">{{ x.days }} 天</span>
                <span class="nm ellipsis">{{ x.remark || x.name || x.no || '未命名' }}</span>
                <span class="od-amt num">{{ fmtNum(x.amount) }}</span>
                <span class="od-who ellipsis">{{ x.payee || '未指定' }}</span>
              </div>
            </template>
            <button class="link od-more" data-od-small @click="showSmall = !showSmall">
              另有 {{ od.smallList.length }} 笔小额逾期（合计 {{ fmtNum(od.smallSum) }}）· {{ showSmall ? '收起' : '展开' }}
            </button>
          </template>
        </div>
        <div v-if="od.normal.length" class="mini" style="margin-top: 6px">
          另有 {{ od.normal.length }} 笔逾期 1–30 天（合计 {{ fmtNum(od.amount - od.severeAmount) }}），见下方列表
        </div>
      </div>

      <div class="card">
        <div class="sec-head">
          <span class="bar" />按收款方待付
          <span class="spacer" />
          <button class="link" @click="showPayee = !showPayee">{{ showPayee ? '收起' : '展开' }}</button>
        </div>
        <template v-if="showPayee">
          <div v-if="!owing.length" class="mini">🎉 所有收款方均已结清，无欠款。</div>
          <div v-else class="rank">
            <div v-for="o in owing" :key="o.name" class="rank-row with-act">
              <span class="nm" :title="o.name">{{ o.name }}</span>
              <div class="prog"><i :style="{ width: (o.owe / maxOwe * 100) + '%', background: 'var(--danger)' }" /></div>
              <span class="vb" style="color: var(--danger)">{{ fmtNum(o.owe) }}</span>
              <button class="link" :title="`生成「${o.name}」对账单`" @click="openStatement(o.name)">对账单</button>
            </div>
          </div>
        </template>
      </div>

      <div class="list-head">
        <div class="seg">
          <button
            v-for="s in STATUS" :key="s.v"
            :class="{ on: ui.payFilter === s.v }"
            @click="ui.payFilter = s.v"
          >{{ s.t }}</button>
        </div>
        <span class="grow" />
        <select v-model="paySort" class="mini-select" title="排序" data-pay-sort>
          <option v-for="s in SORTS" :key="s.v" :value="s.v">{{ s.t }}</option>
        </select>
        <!-- K22：密度直达菜单（与列表页同一组件、同一偏好键） -->
        <DensityChip />
        <button class="btn sm ghost" data-undo-btn :disabled="!canUndoNow" :title="canUndoNow ? `撤销上一步（⌘Z）· 可撤销 ${undoSteps} 步` : '没有可撤销的操作'" @click="doUndo">撤销</button>
        <button class="btn sm ghost" data-redo-btn :disabled="!canRedoNow" :title="canRedoNow ? `重做上一步（⇧⌘Z）· 可重做 ${redoSteps} 步` : '没有可重做的操作'" @click="doRedo">重做</button>
        <span class="mini">点条目记录付款</span>
      </div>

      <!-- K16：密度容器（与列表页同款）；大字档下付款流水行同步放大 -->
      <div class="list" :data-density="densityLive" style="margin: 0 -12px">
        <ItemRow
          v-for="x in rows" :key="x.p.id"
          :item="x.p" :stat="x.st" mode="pay"
          :selected="ui.selId === x.p.id"
          @open="openDrawer({ type: 'item', id: x.p.id })"
          @pay="openDrawer({ type: 'item', id: x.p.id, mode: 'pay' })"
        />
      </div>
      <div v-if="!rows.length" class="empty"><b>没有付款记录</b>先登记费用项，再记录付款</div>
    </div>
  </div>
</template>

<style scoped>
/* flex 列布局：让 .content（flex:1 + min-height:0 + overflow-y:auto）成为唯一纵向滚动层。
   缺 display:flex 时 .content 按内容高度撑开（88 笔付款约 4900px）并被 .main 的
   overflow:hidden 裁掉，列表无法滚动 —— 与 ItemsView / AnalysisView 的写法对齐。 */
.pane { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.list-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0 6px;
}
/* C3 对账单入口：在原有 3 列后追加一列按钮（不挤压排行条，名称列略收 4px） */
.rank-row.with-act { grid-template-columns: 88px minmax(0, 1fr) 74px auto; }

/* M2 逾期置顶：天数徽标 + 名称 + 金额 + 收款方，四列固定，行高 24px，最多 4 行后内部滚动 */
.od-card { border-left: 3px solid var(--danger); }
/* 收起态正好容纳 4 行（基线 ≥100 的 severe 恰为 4 笔）；展开小额后放宽上限，仍保留内部滚动 */
.od-list { display: flex; flex-direction: column; gap: 2px; max-height: 108px; overflow-y: auto; }
.od-list.open { max-height: 190px; }
.od-row {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  padding: 3px 4px;
  border-radius: 5px;
  cursor: pointer;
}
.od-row:hover { background: var(--surface-2); }
.od-days {
  font-size: 10px;
  font-weight: 800;
  color: var(--danger);
  background: var(--danger-soft, rgba(200, 60, 60, 0.1));
  border-radius: 4px;
  padding: 1px 0;
  text-align: center;
}
.od-amt { font-size: 11.5px; font-weight: 700; color: var(--ink); }
.od-who { font-size: 10.5px; color: var(--muted); max-width: 72px; text-align: right; }

/* C3 小额逾期：与主列表同栅格（保证展开后各列仍对齐），徽标降饱和，视觉上明示「次要」 */
.od-row.small .od-days { color: var(--muted); background: var(--surface-3); }
.od-row.small .od-amt { color: var(--ink-2); font-weight: 600; }
.od-row .nm { font-size: 11.5px; color: var(--ink); min-width: 0; }

/* 折叠行：文字 chip（不是按钮块），左侧对齐，不参与栅格 */
.od-more {
  align-self: flex-start;
  margin-top: 2px;
  padding: 2px 2px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--accent);
  background: none;
  border: 0;
  cursor: pointer;
}
.od-more:hover { text-decoration: underline; }

/* B2 排序下拉：窄版，融进 .list-head 而不撑高这一行 */
.mini-select {
  width: auto;
  max-width: 96px;
  height: 22px;
  padding: 0 18px 0 6px;
  font-size: 11px;
  font-family: inherit;
  color: var(--ink-2);
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 6px;
  cursor: pointer;
}
.mini-select:hover { border-color: var(--line-strong); }
.mini-select:focus { outline: none; border-color: var(--accent); box-shadow: var(--ring); }
</style>

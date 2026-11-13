<script setup lang="ts">
/**
 * 唯一页面：内联页头 / KPI / 工具栏（不单独抽组件），只把表格与弹窗组装起来。
 * 数据流：api（宿主能力）→ store 三张表（数据）→ hooks（业务编排）→ 本页与纯渲染组件。
 */
import { onMounted, onUnmounted, ref } from 'vue';
import MappingTable from '../components/MappingTable.vue';
import MappingDialog from '../components/MappingDialog.vue';
import GroupDialog from '../components/GroupDialog.vue';
import MigrateDialog from '../components/MigrateDialog.vue';
import ProgressDialog from '../components/ProgressDialog.vue';
import { useDashboard } from '../hooks/useDashboard';
import { useMigration } from '../hooks/useMigration';
import useDialog from '../hooks/useDialog';
import * as envApi from '../api/env';
import { FilterEnum, ViewModeEnum } from '../utils/enums';
import type { MappingRowVM } from '../hooks/useDashboard';

const dashboard = useDashboard();
const migration = useMigration();
const groupDialog = useDialog({ title: '分组管理' });

// 模板直接使用解构后的顶层绑定（ref/computed 自动解包）
const {
  loading, error, filter, viewMode, selectedIds, collapsed, editorVisible,
  visibleGroups, flatRows, kpi, filterCounts, selectedItemIds, allVisibleChecked, visibleIndeterminate, hasSelection,
  init, refresh, setFilter, setView, toggleRow, toggleAllVisible, clearSelection, toggleCollapse,
  openAdd, openEdit, removeMapping, createGroup, renameGroup, toggleGroup, removeGroup,
} = dashboard;

// ── 表格事件 ──
function onRowAction(row: MappingRowVM): void {
  void migration.runRowAction(row);
}
function onRemove(id: string): void {
  if (window.confirm('仅删除这条映射配置，不会删除磁盘上的任何文件/目录。确认删除？')) removeMapping(id);
}
function batchMigrate(): void {
  migration.openConfirm(selectedItemIds.value);
}

// ── 宿主窗口高度自适应（clamp 480~900） ──
const rootRef = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;

// 说明：页面内部的自适应（百分比 / grid / flex / clamp / 媒体查询）全部由纯 CSS 完成，不用 JS 测量。
// 这里唯一的 JS 是 ZTools 宿主协议——插件运行在宿主 webview 中，其外层面板像素高度只能通过
// setExpendHeight 主动上报，CSS 无法替代。同步执行、不做动画/延时；相同高度直接跳过，避免宿主反复 resize。
let lastHostHeight = -1;
function syncHostHeight(): void {
  const el = rootRef.value;
  if (!el) return;
  const next = Math.min(900, Math.max(480, el.scrollHeight + 32));
  if (next === lastHostHeight) return;
  lastHostHeight = next;
  envApi.setViewHeight(next);
}

onMounted(async () => {
  await init();
  syncHostHeight();
  // 仅监听「内容高度」变化（行数/折叠/筛选导致），视口宽度变化由 CSS 自适应，不经过这里
  resizeObserver = new ResizeObserver(syncHostHeight);
  if (rootRef.value) resizeObserver.observe(rootRef.value);
  envApi.onEnter(() => {
    void refresh();
  });
});

onUnmounted(() => {
  resizeObserver?.disconnect();
});
</script>

<template>
  <div ref="rootRef" class="page">
    <!-- 页头 -->
    <header class="page-head">
      <div class="ph-left">
        <h1 class="ph-title">目录迁移助手</h1>
        <span class="ph-sub">把系统盘目录迁移到其他盘，以 Junction 链接保持程序无感知运行</span>
      </div>
      <div class="ph-actions">
        <button class="btn ghost" @click="groupDialog.openDialog()">分组管理</button>
        <button class="btn ghost" :disabled="loading" @click="refresh">
          <span class="ico-refresh" :class="{ spinning: loading }">↻</span> 刷新
        </button>
        <button class="btn primary" @click="openAdd()">＋ 添加映射</button>
      </div>
    </header>

    <!-- KPI -->
    <section class="kpi-row">
      <div class="kpi-card">
        <span class="kpi-label">全部目录</span>
        <span class="kpi-value num">{{ kpi.total }}</span>
      </div>
      <div class="kpi-card ok">
        <span class="kpi-label">已迁移</span>
        <span class="kpi-value num">{{ kpi.linked }}</span>
      </div>
      <div class="kpi-card warn">
        <span class="kpi-label">待处理</span>
        <span class="kpi-value num">{{ kpi.pending + kpi.conflict }}</span>
      </div>
      <div class="kpi-card accent">
        <span class="kpi-label">预计节省 C 盘</span>
        <span class="kpi-value num">{{ kpi.saveSizeFormatted }}</span>
      </div>
    </section>

    <!-- 工具栏 -->
    <section class="toolbar">
      <div class="tb-left">
        <div class="seg">
          <button :class="{ active: viewMode === ViewModeEnum.Grouped }" @click="setView(ViewModeEnum.Grouped)">按组</button>
          <button :class="{ active: viewMode === ViewModeEnum.Flat }" @click="setView(ViewModeEnum.Flat)">平铺</button>
        </div>
      </div>

      <div class="tb-right">
        <div class="filters">
          <button
            v-for="f in [
              { key: FilterEnum.All, label: '全部' },
              { key: FilterEnum.Pending, label: '待处理' },
              { key: FilterEnum.Linked, label: '已迁移' },
              { key: FilterEnum.Conflict, label: '异常' },
            ]"
            :key="f.key"
            class="chip"
            :class="{ active: filter === f.key }"
            @click="setFilter(f.key)"
          >
            {{ f.label }}
            <span class="chip-count num">{{ filterCounts[f.key] }}</span>
          </button>
        </div>

        <label v-if="hasSelection" class="batch-bar">
          <span class="num">已选 {{ selectedIds.size }}</span>
          <button class="btn sm primary" @click="batchMigrate">批量迁移</button>
          <button class="btn sm ghost" @click="clearSelection">取消选择</button>
        </label>
      </div>
    </section>

    <!-- 表格 -->
    <MappingTable
      :groups="visibleGroups"
      :flat-rows="flatRows"
      :view-mode="viewMode"
      :collapsed="collapsed"
      :selected="selectedIds"
      :loading="loading"
      :error="error"
      :all-checked="allVisibleChecked"
      :indeterminate="visibleIndeterminate"
      @select="toggleRow"
      @select-all="toggleAllVisible"
      @toggle-group="toggleCollapse"
      @group-add="openAdd"
      @row-action="onRowAction"
      @edit="openEdit"
      @remove="onRemove"
      @retry="refresh"
    />

    <!-- 弹窗 -->
    <MappingDialog :open="editorVisible" />

    <GroupDialog
      :open="groupDialog.visible.value"
      :groups="dashboard.groups.value"
      @close="groupDialog.closeDialog()"
      @create="createGroup"
      @rename="renameGroup"
      @toggle="toggleGroup"
      @remove="removeGroup"
    />

    <MigrateDialog
      :open="migration.confirmVisible.value"
      :preview="migration.preview.value"
      @close="migration.closeConfirm()"
      @confirm="(o) => void migration.confirmMigrate(o)"
    />

    <ProgressDialog
      :open="migration.progressVisible.value"
      :running="migration.running.value"
      :preview="migration.preview.value"
      :logs="migration.runLogs.value"
      :current-phase="migration.currentPhase.value"
      :current-item="migration.currentItem.value"
      :progress-info="migration.progressInfo.value"
      @close="migration.closeProgress()"
      @cancel="migration.cancelMigration()"
    />
  </div>
</template>

<style scoped>
.page {
  /* 纯 CSS 流体：横向内边距随视口百分比缩放，无 JS 测量 */
  padding: clamp(12px, 2.2vh, 20px) clamp(12px, 2vw, 24px) clamp(16px, 2.6vh, 24px);
  display: flex; flex-direction: column; gap: clamp(10px, 1.4vw, 14px);
  width: 100%; max-width: 1180px; margin: 0 auto;
}

/* 页头 */
.page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.ph-left { display: flex; flex-direction: column; gap: 3px; }
.ph-title { font-size: var(--fs-xl); font-weight: 750; color: var(--ink-1); letter-spacing: -0.01em; }
.ph-sub { font-size: var(--fs-xs); color: var(--ink-3); }
.ph-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ico-refresh { display: inline-block; }
.ico-refresh.spinning { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* KPI */
.kpi-row {
  display: grid;
  /* min(150px,100%) 保证极窄屏不溢出；列数与列宽纯由容器宽度决定 */
  grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr));
  gap: clamp(8px, 1vw, 10px);
}
.kpi-card {
  background: var(--bg); border: 1px solid var(--border); border-radius: var(--r);
  padding: clamp(10px, 1.4vw, 13px) clamp(12px, 1.6vw, 16px);
  display: flex; flex-direction: column; gap: 4px;
  box-shadow: var(--shadow-card); position: relative; overflow: hidden;
}
.kpi-card::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--ink-3); opacity: 0.35; }
.kpi-card.ok::before { background: var(--ok-ink); }
.kpi-card.warn::before { background: var(--warn-ink); }
.kpi-card.accent::before { background: var(--accent); }
.kpi-label { font-size: var(--fs-xs); color: var(--ink-3); }
.kpi-value { font-size: var(--fs-xxl); font-weight: 750; color: var(--ink-1); line-height: 1.1; }

/* 工具栏 */
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.tb-left { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.filters { display: flex; gap: 6px; flex-wrap: wrap; }
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px; border-radius: var(--r-pill); font-size: var(--fs-sm);
  border: 1px solid var(--border-strong); background: var(--bg); color: var(--ink-2);
  /* 只过渡颜色，不过渡布局属性，缩放即时无补间 */
  transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.chip:hover { border-color: var(--accent); color: var(--accent-ink); }
.chip.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.chip-count { font-size: 11px; opacity: 0.75; }
.tb-right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.batch-bar { display: inline-flex; align-items: center; gap: 8px; font-size: var(--fs-sm); color: var(--ink-2); }
.seg { display: inline-flex; border: 1px solid var(--border-strong); border-radius: var(--r-control); overflow: hidden; }
.seg button { padding: 5px 12px; font-size: var(--fs-sm); background: var(--bg); color: var(--ink-2); }
.seg button + button { border-left: 1px solid var(--border-strong); }
.seg button.active { background: var(--accent-soft); color: var(--accent-ink); font-weight: 600; }

@media (max-width: 767px) {
  .page { padding: 14px 12px 20px; }
  .page-head { align-items: stretch; }
  .ph-actions { width: 100%; }
  .ph-actions .btn { flex: 1; }
}
@media (max-width: 479px) {
  .kpi-row { grid-template-columns: repeat(2, 1fr); }
  .toolbar { align-items: stretch; }
  .tb-left, .tb-right { width: 100%; justify-content: space-between; }
}
</style>

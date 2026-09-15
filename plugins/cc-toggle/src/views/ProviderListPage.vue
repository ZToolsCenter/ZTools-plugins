<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
  import { useDraggable } from 'vue-draggable-plus';
  import { useProviders } from '../composables/useProviders';
  import { useBalance } from '../composables/useBalance';
  import { useWidgets } from '../composables/useWidgets';
  import { getSkillNest } from '../composables/shared';
  import TabBar from '../components/common/TabBar.vue';
  import ProviderCard from '../components/provider/ProviderCard.vue';
  import ProviderForm from '../components/provider/ProviderForm.vue';

  const message = useMessage();
  const {
    providers,
    activeTab,
    loadProviders,
    switchProvider,
    saveProvider,
    deleteProvider,
    sortProviders,
    copyProvider,
    getFullProvider
  } = useProviders();
  const { views: balanceViews, thresholdFor, init, dispose, refreshOne } = useBalance();
  const { isStatusOpen, toggleStatus, refresh: refreshWidgetState } = useWidgets();
  const showForm = ref(false),
    editingId = ref(null),
    formInitialData = ref(null);

  const currentProvider = computed(() => providers.value.find(p => p.isCurrent));
  const otherProviders = computed(() => providers.value.filter(p => !p.isCurrent));

  // ── 其他供应商卡片拖拽排序 ──
  const gridEl = ref(null);
  const gridList = ref([]);
  let dragSnapshot = [];
  let dragging = false;
  let escPressed = false;

  function restoreGridOrder(): void {
    const map = new Map(providers.value.map(p => [p.id, p]));
    gridList.value = dragSnapshot.map(id => map.get(id)).filter(Boolean);
  }

  function persistSort(): void {
    const cur = currentProvider.value;
    const curId = cur ? cur.id : null;
    const oldFullIds = providers.value.map(p => p.id);
    const oldOtherIds = oldFullIds.filter(id => id !== curId);
    const newOtherIds = gridList.value.map(p => p.id);
    // 顺序无变化：不落库
    if (oldOtherIds.join(',') === newOtherIds.join(',')) return;

    const newFullIds = [];
    if (!curId) {
      newFullIds.push(...newOtherIds);
    } else {
      // 以旧完整顺序为骨架，把网格段替换为新顺序；当前激活项保持在其原索引位
      const curIdx = oldFullIds.indexOf(curId);
      let oi = 0;
      oldFullIds.forEach((id, i) => {
        if (i === curIdx) {
          newFullIds.push(curId);
        } else {
          newFullIds.push(newOtherIds[oi++]);
        }
      });
    }
    if (!sortProviders(newFullIds)) {
      message.error('排序保存失败');
    }
  }

  const draggable = useDraggable(gridEl, gridList, {
    immediate: false,
    animation: 150,
    draggable: '.drag-grid-item',
    forceFallback: true,
    ghostClass: 'drag-ghost',
    chosenClass: 'drag-chosen',
    dragClass: 'drag-following',
    fallbackClass: 'drag-following',
    revertOnSpill: true,
    onStart: () => {
      dragging = true;
      escPressed = false;
      dragSnapshot = gridList.value.map(p => p.id);
    },
    onEnd: evt => {
      dragging = false;
      const noChange = evt.newIndex === evt.oldIndex && evt.from === evt.to;
      if (escPressed || noChange) {
        escPressed = false;
        restoreGridOrder();
        return;
      }
      persistSort();
    }
  });

  // 网格渲染/重建后初始化或重建拖拽（v-if 使元素可能销毁重建）
  watch(
    otherProviders,
    val => {
      gridList.value = val.slice();
      if (!val.length) return;
      nextTick(() => {
        if (gridEl.value) draggable.start();
      });
    },
    { immediate: true }
  );

  function onGridKeydown(e): void {
    if (e.key === 'Escape' && dragging) escPressed = true;
  }

  // FLIP 动画状态
  const flipStyle = ref({});
  const isFlipping = ref(false);

  onMounted(() => {
    loadProviders();
    init();
    refreshWidgetState();
    document.addEventListener('keydown', onGridKeydown);
  });

  let flipTimer = null;
  onUnmounted(() => {
    if (flipTimer) clearTimeout(flipTimer);
    document.removeEventListener('keydown', onGridKeydown);
    dispose();
  });

  function onAdd() {
    editingId.value = null;
    formInitialData.value = null;
    showForm.value = true;
  }
  function onEdit(id) {
    // 代理运行中禁止编辑已激活供应商：保存不会重写 CLI 配置，改动不生效，避免误导
    const p = providers.value.find(x => x.id === id);
    if (p?.isCurrent && getSkillNest().getProxyStatus?.(activeTab())?.running) {
      message.warning('代理运行中，已激活供应商不可编辑，请先停止代理');
      return;
    }
    editingId.value = id;
    formInitialData.value = getFullProvider(id);
    showForm.value = true;
  }
  function onSave(data) {
    if (editingId.value) {
      data.id = editingId.value;
      data.sortOrder = providers.value.find(p => p.id === editingId.value)?.sortOrder || 0;
    }
    saveProvider(data);
    showForm.value = false;
    editingId.value = null;
  }

  function onCopy(id) {
    const r = copyProvider(id);
    if (r.success) message.success('已复制 ' + r.name);
    else message.warning(r.error);
  }

  function onDelete(id) {
    deleteProvider(id);
  }

  function onBalanceRefresh(id) {
    refreshOne(activeTab(), id);
  }

  function onWidgetToggle() {
    const r = toggleStatus();
    if (r && r.success === false) message.error(r.error || '小组件打开失败');
  }

  function onSwitch(id, event) {
    const r = switchProvider(id);
    if (r?.success) message.success('已切换到 ' + r.providerName);
    if (!event) return r;

    const clickedCard = event.currentTarget.closest('.provider-card') || event.currentTarget;
    const firstRect = clickedCard.getBoundingClientRect();

    nextTick(() => {
      const heroEl = document.querySelector('.hero-card .provider-card');
      if (!heroEl) return;
      const { left, top } = heroEl.getBoundingClientRect();

      flipStyle.value = {
        transform: `translate(${firstRect.left - left}px, ${firstRect.top - top}px)`,
        transition: 'none'
      };
      isFlipping.value = true;

      requestAnimationFrame(() => {
        flipStyle.value = { transform: 'translate(0, 0)', transition: 'transform 0.3s ease-out' };
        flipTimer = setTimeout(() => {
          isFlipping.value = false;
          flipStyle.value = {};
        }, 300);
      });
    });
  }
</script>

<template>
  <div class="page">
    <div class="tab-bar-wrap">
      <TabBar />
    </div>
    <div class="page-body">
      <div class="page-header">
        <n-text depth="3" style="font-size: 14px; font-weight: 500"
          >{{ providers.length }} 个供应商</n-text
        >
        <n-button type="primary" size="small" @click="onAdd">+ 添加供应商</n-button>
      </div>

      <n-empty v-if="providers.length === 0" description="暂无供应商配置" style="padding: 60px 0">
        <template #extra>
          <n-text depth="3" style="font-size: 13px">点击「+ 添加供应商」开始</n-text>
        </template>
      </n-empty>

      <template v-else>
        <div
          class="hero-card"
          :class="{ 'is-flipping': isFlipping }"
          :style="isFlipping ? flipStyle : {}"
        >
          <ProviderCard
            v-if="currentProvider"
            :key="currentProvider.id"
            :provider="currentProvider"
            compact
            :show-widget="true"
            :widget-open="isStatusOpen"
            :balance="balanceViews[currentProvider.id]"
            :low-threshold="thresholdFor(currentProvider)"
            @switch="onSwitch"
            @edit="onEdit"
            @copy="onCopy"
            @delete="onDelete"
            @refresh="onBalanceRefresh"
            @widget="onWidgetToggle"
          />
        </div>

        <div v-if="gridList.length" class="providers-section">
          <div class="section-label">
            <n-text depth="3">其他供应商</n-text>
            <n-tag size="tiny" :bordered="false" round>{{ gridList.length }}</n-tag>
          </div>
          <div ref="gridEl" class="drag-grid">
            <div v-for="p in gridList" :key="p.id" class="drag-grid-item">
              <ProviderCard
                :provider="p"
                compact
                :balance="balanceViews[p.id]"
                :low-threshold="thresholdFor(p)"
                @switch="onSwitch"
                @edit="onEdit"
                @copy="onCopy"
                @delete="onDelete"
                @refresh="onBalanceRefresh"
              />
            </div>
          </div>
        </div>
      </template>
    </div>

    <ProviderForm
      :visible="showForm"
      :initial-data="formInitialData"
      @close="showForm = false"
      @save="onSave"
    />
  </div>
</template>

<style scoped>
  .page {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .tab-bar-wrap {
    padding: 0 10px;
    flex-shrink: 0;
    background: var(--bg-hover);
    border-bottom: 1px solid var(--border);
  }
  .page-body {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 12px 20px 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 36px;
    padding: 0 10px;
  }

  /* ── Inactive providers section ── */
  .providers-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .section-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-muted);
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }

  /* ── Draggable grid（其他供应商） ── */
  .drag-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .drag-grid-item {
    min-width: 0;
    height: 100%;
  }
  .drag-grid-item :deep(.provider-card) {
    cursor: grab;
  }
  .drag-grid-item :deep(.provider-card:hover) {
    cursor: grab !important;
  }
  :deep(.drag-chosen) {
    cursor: grabbing !important;
  }
  :deep(.drag-ghost) {
    opacity: 0.4;
  }
  :deep(.drag-following) {
    opacity: 1 !important;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    cursor: grabbing !important;
    z-index: 10000;
  }

  /* ── Hero card FLIP ── */

  .hero-card {
    will-change: transform, opacity;
  }
  .hero-card.is-flipping {
    z-index: 10;
    pointer-events: none;
  }
  :deep(.hero-card .compact-bottom) {
    padding-top: 3px;
  }
</style>

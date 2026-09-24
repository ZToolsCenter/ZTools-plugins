<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import FloatingZoom from "../components/FloatingZoom.vue";
import { useGlocalConfirmDialog } from "../components/useGlocalConfirmDialog";

import SplitResizer from "./components/SplitResizer.vue";
import ContextMenu from "./components/ContextMenu.vue";
import FinderFooter from "./components/FinderFooter.vue";
import FinderResultList from "./components/FinderResultList.vue";
import FinderSidebar from "./components/FinderSidebar.vue";
import SettingsDrawer from "./components/SettingsDrawer.vue";
import FinderPreviewPane from "./components/FinderPreviewPane.vue";

import { useContextMenu } from "./composables/useContextMenu";
import { useFinderCategories } from "./composables/useFinderCategories";
import { useFinderEnterAction } from "./composables/useFinderEnterAction";
import { useFinderFocus } from "./composables/useFinderFocus";
import { useFinderKeyboard } from "./composables/useFinderKeyboard";
import { useFinderQuery } from "./composables/useFinderQuery";
import { useFinderSearch } from "./composables/useFinderSearch";
import { useFinderSettings } from "./composables/useFinderSettings";
import { usePersistStorage } from "./composables/usePersistStorage";
import { useResultActions } from "./composables/useResultActions";
import { useSubInput } from "./composables/useSubInput";
import type { FinderCategory, FinderResult, SelectionMode } from "./core/finderLogic";
import { useEverything } from "./composables/useEverything";

const PAGE_SIZE = 30;
const MAX_RESULTS = 600;

const footerSortMenuOpen = ref(false);

const {
  everythingStatus,
  everythingReady,
  everythingPending,
  ensureEverythingReady,
  stopEverythingStatusPolling,
} = useEverything({ runSearch: () => finderSearch.runSearch() });

const {
  previewEnabled,
  sortMode,
  matchPathEnabled,
  resultListWidth,
  setResultListWidth,
  sidebarWidth,
  setSidebarWidth,
} = usePersistStorage();

const MIN_SIDEBAR_WIDTH = 48;
const DEFAULT_SIDEBAR_WIDTH = 64;
const isResizingSidebar = ref(false);

const MIN_LIST_WIDTH = 220;
const DEFAULT_LIST_WIDTH = 315;
const isResizingList = ref(false);

function onSidebarWidthUpdate(width: number) {
  setSidebarWidth(width, false);
}

function onSidebarWidthChange(width: number) {
  setSidebarWidth(width, true);
}

function getSidebarMaxWidth(): number {
  const minMainSpace = previewEnabled.value ? resultListWidth.value + 160 : 200;
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(260, window.innerWidth - minMainSpace));
}

function onResultListWidthUpdate(width: number) {
  setResultListWidth(width, false);
}

function onResultListWidthChange(width: number) {
  setResultListWidth(width, true);
}

function getResultListMaxWidth(): number {
  return Math.max(MIN_LIST_WIDTH, window.innerWidth - sidebarWidth.value - 260);
}

const { bindSubInput, focusSubInput } = useSubInput({
  onInput: queueSearch,
});

const { releaseFinderFocus } = useFinderFocus(focusSubInput);
const {
  activeCategoryId,
  activeCategory,
  enabledCategories,
  allCategories,
  selectCategory,
  cycleCategory,
  handleReorderCategories,
  handleResetCategoryOrder,
  handleAddCustomCategory,
  handleUpdateCustomCategory,
  handleRemoveCustomCategory,
  handleSetCategoryEnabled,
} = useFinderCategories();
const { showSettingsDrawer, openSettingsDrawer, closeSettingsDrawer } = useFinderSettings({
  focusSubInput,
});
const { buildFilteredEverythingQuery, prefixFilter, queryText } = useFinderQuery();
const isFolderQuery = computed(() => /(?:^|\s)folder:/i.test(buildFilteredEverythingQuery()));
const finderSearch = useFinderSearch({
  pageSize: PAGE_SIZE,
  maxResults: MAX_RESULTS,
  sortMode,
  matchPathEnabled,
  buildQuery: buildFilteredEverythingQuery,
  queryKeyword: () => queryText.value,
});

const resultStatusText = computed(() => {
  if (!everythingReady.value) return everythingStatus.value.message;
  return finderSearch.isLoading.value ? "搜索中..." : finderSearch.statusText.value;
});
const resultLoading = computed(() => finderSearch.isLoading.value || everythingPending.value);

const contextMenu = useContextMenu();
const confirmDialog = useGlocalConfirmDialog();
const resultActions = useResultActions({
  onTrashed: (fullPaths) => {
    finderSearch.removeResultsByPaths(fullPaths);
  },
});

useFinderEnterAction({
  activePath: finderSearch.activePath,
  search: finderSearch.runSearch,
});

function isNavigationBlocked() {
  return (
    showSettingsDrawer.value ||
    footerSortMenuOpen.value ||
    contextMenu.visible.value ||
    confirmDialog.state.open
  );
}

useFinderKeyboard({
  isNavigationBlocked,
  closeTransientOverlays: contextMenu.close,
  focusSubInput,
  moveSelection: finderSearch.moveSelection,
  cycleCategory: (direction) => {
    cycleCategory(direction);
    releaseFinderFocus();
  },
  openSelection: () => resultActions.open(finderSearch.selectedItems.value),
  showSelectionInFolder: () => resultActions.showInFolder(finderSearch.selectedItems.value),
  scrollSelectedIntoView: finderSearch.scrollSelectedIntoView,
});

watch([() => activeCategory.value.id, () => activeCategory.value.rule], () => {
  if (!everythingReady.value) return;

  finderSearch.resetVisibleCount();
  finderSearch.clearSelection();
  finderSearch.runSearch();
});

watch([sortMode, matchPathEnabled], () => {
  if (!everythingReady.value) return;

  finderSearch.resetVisibleCount();
  finderSearch.runSearch();
});

onMounted(() => {
  bindSubInput();
  void ensureEverythingReady();
  window.ztools.onPluginOut(closeTransientState);
});

onUnmounted(() => {
  stopEverythingStatusPolling();
});

function queueSearch() {
  if (!everythingReady.value) {
    void ensureEverythingReady();
    return;
  }

  finderSearch.queueSearch();
}

// 退出插件时，重置状态
function closeTransientState(isKill = false) {
  contextMenu.close();
  closeSettingsDrawer({ restoreFocus: false });
  confirmDialog.cancel();
  window.services.everything.handlePluginOut(isKill);
}

function selectItem(item: FinderResult, mode?: SelectionMode) {
  finderSearch.selectItem(item, mode);
  releaseFinderFocus();
}

function setActiveCategory(category: FinderCategory) {
  selectCategory(category);
  releaseFinderFocus();
}
</script>

<template>
  <main
    class="finder-shell"
    :class="{ 'preview-open': previewEnabled, 'is-resizing': isResizingList || isResizingSidebar }"
    :style="{
      '--sidebar-width': `${sidebarWidth}px`,
      '--result-list-width': `${resultListWidth}px`,
    }"
  >
    <div class="finder-sidebar-pane">
      <FinderSidebar
        :categories="enabledCategories"
        :active-category-id="activeCategoryId"
        @select="setActiveCategory"
        @open-settings="openSettingsDrawer"
      />
      <SplitResizer
        :model-value="sidebarWidth"
        :min="MIN_SIDEBAR_WIDTH"
        :max="getSidebarMaxWidth"
        :default-width="DEFAULT_SIDEBAR_WIDTH"
        title="拖动调整侧边栏宽度，双击恢复默认"
        @update:model-value="onSidebarWidthUpdate"
        @change="onSidebarWidthChange"
        @resizing-change="isResizingSidebar = $event"
      />
    </div>

    <section class="finder-main">
      <FinderResultList
        :visible-results="finderSearch.visibleResults.value"
        :active-path="finderSearch.activePath.value"
        :selected-paths="finderSearch.selectedPaths.value"
        :selected-items="finderSearch.selectedItems.value"
        :is-loading="resultLoading"
        :status-text="resultStatusText"
        :prefix="prefixFilter"
        :preview-open="previewEnabled"
        :is-folder-query="isFolderQuery"
        :actions="resultActions"
        @near-bottom="finderSearch.growVisibleCount"
        @select="selectItem"
        @context-menu="contextMenu.open"
        @open="(item) => resultActions.open([item])"
      />
      <SplitResizer
        v-if="previewEnabled"
        :model-value="resultListWidth"
        :min="MIN_LIST_WIDTH"
        :max="getResultListMaxWidth"
        :default-width="DEFAULT_LIST_WIDTH"
        title="拖动调整列表宽度，双击恢复默认"
        @update:model-value="onResultListWidthUpdate"
        @change="onResultListWidthChange"
        @resizing-change="isResizingList = $event"
      />
    </section>

    <FinderFooter
      class="finder-footer-bar"
      :everything-total="finderSearch.everythingTotal.value"
      @request-input-focus="focusSubInput"
      @sort-menu-open-change="footerSortMenuOpen = $event"
    />

    <FloatingZoom
      v-if="previewEnabled"
      class="finder-preview-zoom"
      expand-label="放大预览"
      collapse-label="还原预览"
      floating-label="悬浮预览窗口"
      placeholder="预览已放大显示"
    >
      <FinderPreviewPane :active-item="finderSearch.activeItem" @context-menu="contextMenu.open" />
    </FloatingZoom>

    <SettingsDrawer
      :open="showSettingsDrawer"
      :categories="allCategories"
      :match-path-enabled="matchPathEnabled"
      @close="closeSettingsDrawer"
      @add-category="handleAddCustomCategory"
      @update-category="handleUpdateCustomCategory"
      @remove-category="handleRemoveCustomCategory"
      @set-category-enabled="handleSetCategoryEnabled"
      @set-match-path-enabled="matchPathEnabled = $event"
      @reorder-categories="handleReorderCategories"
      @reset-category-order="handleResetCategoryOrder"
    />

    <ContextMenu
      :visible="contextMenu.visible.value"
      :x="contextMenu.x.value"
      :y="contextMenu.y.value"
      :items="contextMenu.items.value"
      @select="contextMenu.select"
    />

    <ConfirmDialog
      :open="confirmDialog.state.open"
      :title="confirmDialog.state.title"
      :message="confirmDialog.state.message"
      :confirm-text="confirmDialog.state.confirmText"
      :cancel-text="confirmDialog.state.cancelText"
      :danger="confirmDialog.state.danger"
      @confirm="confirmDialog.accept"
      @cancel="confirmDialog.cancel"
    />
  </main>
</template>

<style scoped>
.finder-shell {
  --sidebar-width: 64px;
  --result-list-width: 315px;

  display: grid;
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) 32px;
  height: 100vh;
  min-height: 0;
  max-height: 100vh;
  overflow: hidden;
  background: #2f3133;
  color: #f5f7fa;
  font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
  user-select: none;
}

.finder-shell.is-resizing {
  cursor: col-resize !important;
  user-select: none !important;
}

.finder-shell.preview-open {
  grid-template-columns: var(--sidebar-width) var(--result-list-width) minmax(0, 1fr);
}

.finder-sidebar-pane {
  position: relative;
  z-index: 20;
  grid-column: 1;
  grid-row: 1 / -1;
  min-width: 0;
  min-height: 0;
  max-height: 100%;
  overflow: visible;
  display: flex;
}

.finder-sidebar-pane :deep(.finder-sidebar) {
  flex: 1;
  min-width: 0;
  width: 100%;
}

.finder-main {
  position: relative;
  z-index: 10;
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
  min-height: 0;
  max-height: 100%;
  overflow: visible;
}

.finder-preview-zoom {
  grid-column: 3;
  grid-row: 1;
}

.finder-footer-bar {
  position: relative;
  z-index: 25;
  grid-column: 2 / -1;
  grid-row: 2;
  min-width: 0;
}

.preview-open .finder-main {
  border-right: 1px solid #47494c;
}

@media (prefers-color-scheme: light) {
  .finder-shell {
    background: #f4f6f8;
    color: #1f2328;
  }

  .preview-open .finder-main {
    border-right-color: #d5dbe3;
  }
}

@media (max-width: 760px) {
  .finder-shell {
    grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  }

  .finder-shell.preview-open {
    grid-template-columns: var(--sidebar-width) var(--result-list-width) minmax(0, 1fr);
  }
}

@media (max-width: 560px) {
  .finder-shell {
    grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  }

  .finder-shell.preview-open {
    grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  }
}
</style>

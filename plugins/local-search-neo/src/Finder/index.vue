<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import FloatingZoom from "../components/FloatingZoom.vue";
import { useGlocalConfirmDialog } from "../components/useGlocalConfirmDialog";

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
import type { FinderCategory } from "./core/finderLogic";
import { useEverything } from "./composables/useEverything";

const PAGE_SIZE = 30;
const MAX_RESULTS = 600;

const footerSortMenuOpen = ref(false);

const {
  everythingStatus,
  everythingReady,
  everythingPending,
  ensureEverythingReady,
  startEverythingStatusPolling,
  stopEverythingStatusPolling,
} = useEverything({ runSearch: () => finderSearch.runSearch() });

const { previewEnabled, sortMode, matchPathEnabled } = usePersistStorage();

const { bindSubInput, syncSubInputValue, focusSubInput } = useSubInput({
  onInput: queueSearch,
});

const { releaseFinderFocus } = useFinderFocus(focusSubInput);
const {
  activeCategoryId,
  activeCategory,
  enabledCategories,
  allCategories,
  selectCategory,
  handleAddCustomCategory,
  handleUpdateCustomCategory,
  handleRemoveCustomCategory,
  handleSetCategoryEnabled,
} = useFinderCategories();
const { showSettingsDrawer, openSettingsDrawer, closeSettingsDrawer } = useFinderSettings({
  focusSubInput,
});
const { buildFilteredEverythingQuery } = useFinderQuery();
const isFolderQuery = computed(() => /(?:^|\s)folder:/i.test(buildFilteredEverythingQuery()));
const finderSearch = useFinderSearch({
  pageSize: PAGE_SIZE,
  maxResults: MAX_RESULTS,
  sortMode,
  matchPathEnabled,
  buildQuery: buildFilteredEverythingQuery,
});

const resultStatusText = computed(() => {
  if (!everythingReady.value) return everythingStatus.value.message;
  return finderSearch.isLoading.value ? "搜索中..." : finderSearch.statusText.value;
});
const resultLoading = computed(() => finderSearch.isLoading.value || everythingPending.value);

const contextMenu = useContextMenu();
const confirmDialog = useGlocalConfirmDialog();
const resultActions = useResultActions({
  onTrashed: (fullPath) => {
    finderSearch.removeResultByPath(fullPath);
    finderSearch.runSearch();
  },
});

useFinderEnterAction({
  selectedPath: finderSearch.selectedPath,
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
  openSelection: () => resultActions.open(finderSearch.selectedItem.value),
  showSelectionInFolder: () => {
    const selectedItem = finderSearch.selectedItem.value;
    if (selectedItem) resultActions.showInFolder(selectedItem);
  },
  scrollSelectedIntoView: finderSearch.scrollSelectedIntoView,
});

watch(
  [() => activeCategory.value.id, () => activeCategory.value.rule, sortMode, matchPathEnabled],
  () => {
    if (!everythingReady.value) return;

    finderSearch.resetVisibleCount();
    finderSearch.runSearch();
  },
);

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

function selectItem(item: { fullPath?: string }) {
  finderSearch.selectedPath.value = item.fullPath ?? "";
  releaseFinderFocus();
}

function setActiveCategory(category: FinderCategory) {
  selectCategory(category);
  releaseFinderFocus();
}
</script>

<template>
  <main class="finder-shell" :class="{ 'preview-open': previewEnabled }">
    <FinderSidebar
      :categories="enabledCategories"
      :active-category-id="activeCategoryId"
      @select="setActiveCategory"
      @open-settings="openSettingsDrawer"
    />

    <section class="finder-main">
      <FinderResultList
        :visible-results="finderSearch.visibleResults.value"
        :selected-path="finderSearch.selectedPath.value"
        :is-loading="resultLoading"
        :status-text="resultStatusText"
        :preview-open="previewEnabled"
        :is-folder-query="isFolderQuery"
        :actions="resultActions"
        @near-bottom="finderSearch.growVisibleCount"
        @select="selectItem"
        @context-menu="contextMenu.open"
        @open="resultActions.open(finderSearch.selectedItem.value)"
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
      <FinderPreviewPane
        :selected-item="finderSearch.selectedItem"
        @context-menu="contextMenu.open"
      />
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
  --result-list-width: 315px;

  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) 42px;
  height: 100vh;
  min-height: 0;
  max-height: 100vh;
  overflow: hidden;
  background: #2f3133;
  color: #f5f7fa;
  font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
  user-select: none;
}

.finder-shell.preview-open {
  grid-template-columns: 64px var(--result-list-width) minmax(0, 1fr);
}

.finder-sidebar {
  grid-row: 1 / -1;
}

.finder-main {
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
  grid-column: 2 / -1;
  grid-row: 2;
  min-width: 0;
}

.preview-open .finder-main {
  border-right: 1px solid #1f2022;
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
    --result-list-width: 270px;

    grid-template-columns: 60px minmax(0, 1fr);
  }

  .finder-shell.preview-open {
    grid-template-columns: 60px var(--result-list-width) minmax(0, 1fr);
  }
}

@media (max-width: 560px) {
  .finder-shell {
    grid-template-columns: 56px minmax(0, 1fr);
  }

  .finder-shell.preview-open {
    grid-template-columns: 56px minmax(0, 1fr);
  }
}
</style>

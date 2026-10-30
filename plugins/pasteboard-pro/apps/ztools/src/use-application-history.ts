import { computed, ref, shallowReactive, type Ref } from "vue";
import { PinboardSchema, type PasteItem, type Pinboard } from "@pasteboard-pro/core";
import type { ListOrders } from "../preload/list-order-store";
import { createHistoryRefresh } from "./history-refresh";
import { HistoryPager } from "./history-pager";
import { SearchInputScheduler } from "./search-input-scheduler";
import { createPasteboardState } from "./state";
import { assignmentItemIds } from "./pinboard-assignment";
import { applyListOrder, listOrderScope, reorderItemGroupIds, type ListReorderRequest } from "./list-order";
import { filterSmartPinboardItems, isSmartPinboardId } from "./smart-pinboards";
import type { PinboardReorderRequest } from "./use-pinboard-reorder";
import type { ApplicationWindowContext } from "./application-window-context";

export function useApplicationHistory(
  context: ApplicationWindowContext,
  status: Ref<string>,
  clearPasteStack: () => Promise<void>,
) {
  const { edge, shortcutPlatform, params, panelMode } = context;
  // State methods replace snapshots; avoid proxying every field of 10,000 records.
  const state = shallowReactive(
    createPasteboardState({
      items: [],
      dockEdge: edge,
      shortcutPlatform,
    }),
  );
  const pinboards = ref<Pinboard[]>([]);
  const query = ref("");
  const pagedHistory = window.pasteboardPro?.searchHistoryPage !== undefined;
  const historyTotal = ref(0);
  const hasMoreHistory = ref(false);
  const queryPending = ref(false);
  const searchScheduler = new SearchInputScheduler(() => {
    if (pagedHistory) return loadPagedHistory(false).catch(reportHistoryError);
    state.setQuery(query.value);
    queryPending.value = false;
    state.restoreSelection(visibleItems.value.map((item) => item.id));
  });
  const activePinboardId = ref<string>();
  const listOrders = ref<ListOrders>({});
  const listOrderSaving = ref(false);
  const previewItemId = ref<string>();
  let reorderedLatestItemId: string | undefined;
  function suppressReorderLatestFocus(itemId: string): void {
    reorderedLatestItemId = itemId;
    window.setTimeout(() => {
      if (reorderedLatestItemId === itemId) reorderedLatestItemId = undefined;
    }, 0);
  }

  async function loadDevelopmentFixtures(): Promise<void> {
    if (!import.meta.env.DEV) return;
    const { historyFixture, pinboardFixture } = await import(
      "@pasteboard-pro/contract-fixtures"
    );
    state.replaceItems(historyFixture);
    pinboards.value = pinboardFixture.map((pinboard) => structuredClone(pinboard));
  }

  const visibleItems = computed(() => {
    if (queryPending.value) return [];
    const items = state.visibleItems;
    if (pagedHistory) return items;
    const pinboardId = activePinboardId.value;
    const filtered = pinboardId === undefined
      ? items
      : isSmartPinboardId(pinboardId)
        ? filterSmartPinboardItems(items, pinboardId)
        : items.filter((item) => item.pinboardId === pinboardId);
    const scope = listOrderScope(pinboardId);
    return applyListOrder(filtered, listOrders.value[scope] ?? []);
  });
  const reorderEnabled = computed(
    () => query.value.trim().length === 0 && visibleItems.value.length > 1 && !listOrderSaving.value,
  );
  const previewItem = computed(() =>
    visibleItems.value.find((item) => item.id === previewItemId.value),
  );
  const focusedItem = computed<PasteItem | undefined>(() => {
    const itemId = state.selection.focus ?? state.selection.selected[0];
    return visibleItems.value.find((item) => item.id === itemId);
  });

  function updateQuery(value: string): void {
    if (value === query.value) return;
    query.value = value;
    queryPending.value = true;
    state.clearSelection();
    if (pagedHistory) {
      // Reject old replies immediately; coalesce only the next actual search.
      historyPager?.invalidate();
      state.replaceResolvedItems([]);
      hasMoreHistory.value = false;
    }
    searchScheduler.schedule();
    if (value.length === 0) searchScheduler.flush();
  }

  function selectItem(itemId: string, extend: boolean, toggle: boolean): void {
    if (extend) {
      state.extendSelectionTo(
        itemId,
        visibleItems.value.map((item) => item.id),
      );
    } else if (toggle) {
      state.toggleSelection(itemId);
    } else {
      state.replaceSelection(itemId);
    }
    if (state.pasteStack.itemIds.length > 0) {
      void clearPasteStack();
    }
  }

  function focusLatestItem(itemId: string): void {
    if (reorderedLatestItemId === itemId) {
      reorderedLatestItemId = undefined;
      return;
    }
    if (query.value.trim().length > 0 || activePinboardId.value !== undefined) return;
    if (visibleItems.value.some((item) => item.id === itemId)) {
      state.replaceSelection(itemId);
    }
  }

  const loadLegacyHistory = createHistoryRefresh(
    async () => window.pasteboardPro?.searchHistory("", 10_000),
    (history) => {
      if (history !== undefined) {
        state.replaceItems(history.items);
        state.restoreSelection(visibleItems.value.map((item) => item.id));
        status.value = `已载入 ${history.total} 条记录`;
      }
    },
  );

  function createPager(): HistoryPager | undefined {
    if (!pagedHistory) return undefined;
    return new HistoryPager(
      request => window.pasteboardPro!.searchHistoryPage!(request),
      page => {
        state.replaceResolvedItems(page.items);
        queryPending.value = false;
        state.restoreSelection(page.items.map(item => item.id));
        historyTotal.value = page.total;
        hasMoreHistory.value = page.nextCursor !== undefined;
        status.value = `已载入 ${page.items.length} / ${page.total} 条记录`;
      },
    );
  }
  const historyPager = createPager();
  function reportHistoryError(error: unknown): void {
    queryPending.value = false;
    status.value = error instanceof Error ? error.message : "历史加载失败";
  }
  function loadPagedHistory(preserveCount = true): Promise<void> {
    searchScheduler.cancel();
    return historyPager!.refresh({
      query: query.value,
      ...(activePinboardId.value === undefined ? {} : { pinboardId: activePinboardId.value }),
      orderedIds: [...(listOrders.value[listOrderScope(activePinboardId.value)] ?? [])],
    }, preserveCount).catch(error => { queryPending.value = false; throw error; });
  }
  async function loadHistory(): Promise<void> {
    if (!pagedHistory) { searchScheduler.flush(); return loadLegacyHistory(); }
    if (panelMode === "preview" || panelMode === "editor") {
      const id = params.get("itemId");
      const item = id === null ? undefined : await window.pasteboardPro?.getHistoryItem?.(id, params.get("fingerprint") ?? undefined);
      state.replaceResolvedItems(item === undefined ? [] : [item]);
      return;
    }
    await loadPagedHistory();
  }
  function loadMoreHistory(): void {
    if (queryPending.value || !hasMoreHistory.value) return;
    void historyPager?.loadMore().catch(reportHistoryError);
  }

  function onHistoryChanged(): void {
    void loadHistory().then(() => {
      if (status.value.includes("正在同步历史") || status.value.includes("正在载入")) {
        status.value = "截图已存入历史并写入剪贴板";
      }
    }).catch((error: unknown) => {
      status.value = error instanceof Error ? error.message : "历史加载失败";
    });
  }

  function selectPinboard(pinboardId: string | undefined): void {
    activePinboardId.value = pinboardId;
    if (pagedHistory) { void loadPagedHistory(false).catch(reportHistoryError); return; }
    searchScheduler.flush();
    state.restoreSelection(visibleItems.value.map((item) => item.id));
  }

  async function reorderVisibleItems(value: ListReorderRequest): Promise<void> {
    if (!reorderEnabled.value) return;
    const scope = listOrderScope(activePinboardId.value);
    const currentIds = visibleItems.value.map((item) => item.id);
    const nextIds = reorderItemGroupIds(
      currentIds,
      value.sourceIds,
      value.targetId,
      value.position,
    );
    if (nextIds.every((id, index) => id === currentIds[index])) return;
    const previousOrders = listOrders.value;
    if (
      activePinboardId.value === undefined &&
      nextIds[0] !== undefined &&
      nextIds[0] !== currentIds[0]
    ) {
      suppressReorderLatestFocus(nextIds[0]);
    }
    listOrders.value = { ...previousOrders, [scope]: nextIds };
    state.restoreSelection(nextIds);
    listOrderSaving.value = true;
    try {
      const saved = pagedHistory
        ? await window.pasteboardPro?.reorderHistory?.(value, activePinboardId.value)
        : await window.pasteboardPro?.saveListOrder(scope, nextIds);
      if (saved !== undefined) listOrders.value = saved;
      if (pagedHistory) await loadPagedHistory();
      status.value = "列表顺序已保存";
    } catch (error) {
      if (
        activePinboardId.value === undefined &&
        currentIds[0] !== undefined &&
        currentIds[0] !== nextIds[0]
      ) {
        suppressReorderLatestFocus(currentIds[0]);
      }
      listOrders.value = previousOrders;
      state.restoreSelection(visibleItems.value.map((item) => item.id));
      status.value = error instanceof Error ? error.message : "列表排序保存失败";
    } finally {
      listOrderSaving.value = false;
    }
  }

  async function loadPinboards(): Promise<void> {
    const values = await window.pasteboardPro?.listPinboards();
    if (values !== undefined) {
      pinboards.value = values.map((value) => PinboardSchema.parse(value));
      if (
        activePinboardId.value !== undefined &&
        !isSmartPinboardId(activePinboardId.value) &&
        !pinboards.value.some((pinboard) => pinboard.id === activePinboardId.value)
      ) {
        selectPinboard(undefined);
      }
    }
  }

  async function createPinboard(name: string): Promise<void> {
    try {
      await window.pasteboardPro?.createPinboard(name, "#6F61EA");
      await loadPinboards();
      status.value = `已创建分组：${name}`;
    } catch (error) {
      status.value = error instanceof Error ? error.message : "创建分组失败";
    }
  }

  async function renamePinboard(id: string, name: string): Promise<void> {
    try {
      await window.pasteboardPro?.renamePinboard(id, name);
      await loadPinboards();
      status.value = `已重命名分组：${name}`;
    } catch (error) {
      status.value = error instanceof Error ? error.message : "重命名分组失败";
    }
  }

  async function updatePinboardColor(id: string, color: string): Promise<void> {
    try {
      await window.pasteboardPro?.updatePinboardColor(id, color);
      await loadPinboards();
      status.value = "已更新分组颜色";
    } catch (error) {
      status.value = error instanceof Error ? error.message : "更新分组颜色失败";
    }
  }

  async function reorderPinboard({ id, beforeId, afterId }: PinboardReorderRequest): Promise<void> {
    const ids = new Set(pinboards.value.map((pinboard) => pinboard.id));
    if (!ids.has(id) || beforeId === id || afterId === id ||
      (beforeId !== undefined && !ids.has(beforeId)) ||
      (afterId !== undefined && !ids.has(afterId))) return;
    try {
      await window.pasteboardPro?.movePinboard(id, beforeId, afterId);
      await loadPinboards();
      status.value = "已调整分组顺序";
    } catch (error) {
      status.value = error instanceof Error ? error.message : "调整分组顺序失败";
    }
  }

  async function deletePinboard(id: string): Promise<void> {
    const pinboard = pinboards.value.find((candidate) => candidate.id === id);
    if (pinboard === undefined) return;
    context.interaction.nativeDialogOpen = true;
    let confirmed = false;
    try {
      confirmed = window.confirm(
        `删除分组“${pinboard.name}”？其中内容会保留在全部历史。`,
      );
    } finally {
      window.setTimeout(() => {
        context.interaction.nativeDialogOpen = false;
      }, 250);
    }
    if (!confirmed) return;
    try {
      const result = await window.pasteboardPro?.deletePinboard(id);
      if (activePinboardId.value === id) activePinboardId.value = undefined;
      await Promise.all([loadPinboards(), loadHistory()]);
      status.value = `已删除分组，保留 ${result?.unassignedItems ?? 0} 项历史`;
    } catch (error) {
      status.value = error instanceof Error ? error.message : "删除分组失败";
    }
  }

  async function assignPinboard(
    pinboardId: string | undefined,
    draggedItemId: string,
  ): Promise<void> {
    const itemIds = assignmentItemIds(state.selection.selected, draggedItemId);
    try {
      await window.pasteboardPro?.assignItemsToPinboard(itemIds, pinboardId);
      await loadHistory();
      status.value =
        pinboardId === undefined
          ? `已将 ${itemIds.length} 项移出分组`
          : `已将 ${itemIds.length} 项加入分组`;
    } catch (error) {
      status.value = error instanceof Error ? error.message : "分组移动失败";
    }
  }


  return {
    state, pinboards, query, pagedHistory, historyTotal, hasMoreHistory, queryPending,
    activePinboardId, listOrders, previewItemId, visibleItems, reorderEnabled, previewItem, focusedItem,
    updateQuery, selectItem, focusLatestItem, selectPinboard, reorderVisibleItems,
    loadDevelopmentFixtures, loadHistory, loadMoreHistory, loadPinboards, reportHistoryError,
    createPinboard, renamePinboard, updatePinboardColor, reorderPinboard, deletePinboard, assignPinboard,
    onHistoryChanged,
    flushSearch: () => searchScheduler.flush(),
    whenSearchIdle: () => historyPager?.whenIdle(),
    loadMoreForNavigation: () => historyPager?.loadMore(),
    dispose: () => { searchScheduler.dispose(); historyPager?.dispose(); },
  };
}
export type ApplicationHistory = ReturnType<typeof useApplicationHistory>;

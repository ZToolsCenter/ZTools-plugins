import { computed, nextTick, onUnmounted, ref, type Ref } from "vue";
import {
  filterResultsExcludingPaths,
  getMatchPathQueryPlan,
  getNextSelectedPath,
  getNextVisibleCount,
  getRangeSelectedPaths,
  getRestoredSelectedPath,
  mergeResultsByMatchPathPriority,
  type FinderResult,
  type FinderSortMode,
  type SelectionMode,
} from "../core/finderLogic";
import { logger } from "../core/logger";

interface UseFinderSearchOptions {
  pageSize: number;
  maxResults: number;
  buildQuery: () => string;
  queryKeyword?: () => string;
  sortMode: Ref<FinderSortMode>;
  matchPathEnabled: Ref<boolean>;
}

export interface RunSearchOptions {
  preserveSelection?: boolean;
}

export function useFinderSearch({
  pageSize,
  maxResults,
  buildQuery,
  queryKeyword,
  sortMode,
  matchPathEnabled,
}: UseFinderSearchOptions) {
  const results = ref<FinderResult[]>([]);
  const everythingTotal = ref(0);
  const visibleCount = ref(pageSize);
  const activePath = ref("");
  const selectedPaths = ref<string[]>([]);
  const statusText = ref("输入关键字开始搜索");
  const isLoading = ref(false);
  const visibleResults = computed(() => results.value.slice(0, visibleCount.value));
  const activeItem = computed(() =>
    results.value.find((item) => item.fullPath === activePath.value),
  );
  const selectedItems = computed<FinderResult[]>(() => {
    if (selectedPaths.value.length === 0) {
      return activeItem.value ? [activeItem.value] : [];
    }
    const pathSet = new Set(selectedPaths.value);
    return results.value.filter((item) => pathSet.has(item.fullPath));
  });

  let searchTimer: number | undefined;
  let searchSequence = 0;

  onUnmounted(clearSearchTimer);

  function scrollSelectedIntoView() {
    const index = visibleResults.value.findIndex((item) => item.fullPath === activePath.value);
    if (index < 0) return;

    document.querySelector(`[data-result-index="${index}"]`)?.scrollIntoView({
      block: "nearest",
    });
  }

  const onSelectionRestored = scrollSelectedIntoView;

  function queueSearch() {
    if (searchTimer) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => runSearch(), 60);
  }

  function runSearch(options: RunSearchOptions = {}) {
    clearSearchTimer();
    searchSequence += 1;
    const everythingQuery = buildQuery();
    const currentSortMode = sortMode.value;
    const currentKeyword = queryKeyword ? queryKeyword() : "";
    const queryPlan = getMatchPathQueryPlan(matchPathEnabled.value, currentKeyword);

    if (!window.services.everything.isAvailable()) {
      results.value = [];
      everythingTotal.value = 0;
      statusText.value = "Everything addon 不可用";
      return;
    }

    isLoading.value = true;
    visibleCount.value = pageSize;

    try {
      const searchStart = performance.now();
      if (queryPlan.mode === "dual") {
        const nameResult = window.services.everything.query(
          everythingQuery,
          maxResults,
          currentSortMode,
          false,
        );
        const matchPathResult = window.services.everything.query(
          everythingQuery,
          maxResults,
          currentSortMode,
          true,
        );
        results.value = mergeResultsByMatchPathPriority(
          nameResult.items,
          matchPathResult.items,
        ).slice(0, maxResults);
        everythingTotal.value = matchPathResult.total;
      } else {
        const queryResult = window.services.everything.query(
          everythingQuery,
          maxResults,
          currentSortMode,
          queryPlan.matchPath,
        );
        results.value = queryResult.items;
        everythingTotal.value = queryResult.total;
      }
      logger.perf("Everything 检索", performance.now() - searchStart, {
        query: everythingQuery,
        mode: queryPlan.mode,
        total: everythingTotal.value,
        loaded: results.value.length,
      });
      updateResultStatus();
      restoreSelection(options);
    } catch (error: unknown) {
      logger.warn("Everything 检索失败:", error);
      results.value = [];
      everythingTotal.value = 0;
      statusText.value = error instanceof Error ? error.message : "搜索失败";
    } finally {
      isLoading.value = false;
    }
  }

  function updateResultStatus() {
    const loadedCount = results.value.length;

    if (loadedCount === 0) {
      statusText.value = "没有找到结果";
      return;
    }

    statusText.value = `已加载 ${loadedCount} / ${everythingTotal.value} 个结果`;
  }

  function restoreSelection(options: RunSearchOptions = {}) {
    const currentPath = activePath.value;
    const activePathExists = results.value.some((item) => item.fullPath === currentPath);

    if (options.preserveSelection && currentPath && !activePathExists) {
      nextTick(() => onSelectionRestored?.());
      return;
    }

    activePath.value = getRestoredSelectedPath(results.value, currentPath);
    selectedPaths.value = activePath.value ? [activePath.value] : [];
    nextTick(() => onSelectionRestored?.());
  }

  function selectItem(item: FinderResult, mode: SelectionMode = "single") {
    const targetPath = item.fullPath ?? "";
    if (!targetPath) return;

    if (mode === "toggle") {
      if (selectedPaths.value.includes(targetPath)) {
        selectedPaths.value = selectedPaths.value.filter((p) => p !== targetPath);
        if (activePath.value === targetPath) {
          activePath.value = selectedPaths.value[selectedPaths.value.length - 1] ?? "";
        }
      } else {
        selectedPaths.value = [...selectedPaths.value, targetPath];
        activePath.value = targetPath;
      }
    } else if (mode === "range") {
      const visiblePaths = visibleResults.value.map((r) => r.fullPath);
      const anchor = activePath.value || visiblePaths[0] || targetPath;
      selectedPaths.value = getRangeSelectedPaths(visiblePaths, anchor, targetPath);
    } else {
      activePath.value = targetPath;
      selectedPaths.value = [targetPath];
    }
  }

  function clearSelection() {
    activePath.value = "";
    selectedPaths.value = [];
  }

  function removeResultsByPaths(fullPaths: string[]) {
    const beforeLength = results.value.length;
    results.value = filterResultsExcludingPaths(results.value, fullPaths);
    if (results.value.length === beforeLength) return;

    clearSelection();
    everythingTotal.value = Math.max(
      0,
      everythingTotal.value - (beforeLength - results.value.length),
    );
    updateResultStatus();
  }

  function moveSelection(direction: -1 | 1) {
    const paths = results.value.map((item) => item.fullPath);
    const nextPath = getNextSelectedPath(paths, activePath.value, direction);
    if (!nextPath) return;

    activePath.value = nextPath;
    selectedPaths.value = [nextPath];
    const nextIndex = results.value.findIndex((item) => item.fullPath === nextPath);
    if (nextIndex >= visibleCount.value - 4) {
      visibleCount.value = getNextVisibleCount(visibleCount.value, results.value.length, pageSize);
    }
  }

  function growVisibleCount() {
    visibleCount.value = getNextVisibleCount(visibleCount.value, results.value.length, pageSize);
  }

  function resetVisibleCount() {
    visibleCount.value = pageSize;
  }

  function clearSearchTimer() {
    if (searchTimer) window.clearTimeout(searchTimer);
  }

  return {
    results,
    everythingTotal,
    visibleCount,
    activePath,
    activeItem,
    selectedPaths,
    selectedItems,
    statusText,
    isLoading,
    visibleResults,
    queueSearch,
    runSearch,
    restoreSelection,
    updateResultStatus,
    selectItem,
    clearSelection,
    removeResultsByPaths,
    moveSelection,
    growVisibleCount,
    resetVisibleCount,
    clearSearchTimer,
    scrollSelectedIntoView,
  };
}

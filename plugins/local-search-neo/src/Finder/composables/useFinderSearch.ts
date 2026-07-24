import { computed, nextTick, onUnmounted, ref, type Ref } from "vue";
import {
  getNextSelectedPath,
  getNextVisibleCount,
  getRestoredSelectedPath,
  mergeResultsByMatchPathPriority,
  type FinderResult,
  type FinderSortMode,
} from "../core/finderLogic";

interface UseFinderSearchOptions {
  pageSize: number;
  maxResults: number;
  buildQuery: () => string;
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
  sortMode,
  matchPathEnabled,
}: UseFinderSearchOptions) {
  const results = ref<FinderResult[]>([]);
  const everythingTotal = ref(0);
  const visibleCount = ref(pageSize);
  const selectedPath = ref("");
  const statusText = ref("输入关键字开始搜索");
  const isLoading = ref(false);
  const visibleResults = computed(() => results.value.slice(0, visibleCount.value));
  const selectedItem = computed(() =>
    results.value.find((item) => item.fullPath === selectedPath.value),
  );

  let searchTimer: number | undefined;
  let searchSequence = 0;

  onUnmounted(clearSearchTimer);

  function scrollSelectedIntoView() {
    const index = visibleResults.value.findIndex((item) => item.fullPath === selectedPath.value);
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
    const currentMatchPathEnabled = matchPathEnabled.value;

    if (!window.services.everything.isAvailable()) {
      results.value = [];
      everythingTotal.value = 0;
      statusText.value = "Everything addon 不可用";
      return;
    }

    isLoading.value = true;
    visibleCount.value = pageSize;

    try {
      const nameResult = window.services.everything.query(
        everythingQuery,
        maxResults,
        currentSortMode,
        false,
      );

      if (currentMatchPathEnabled) {
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
        results.value = nameResult.items;
        everythingTotal.value = nameResult.total;
      }
      updateResultStatus();
      restoreSelection(options);
    } catch (error: unknown) {
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
    const currentPath = selectedPath.value;
    const selectedPathExists = results.value.some((item) => item.fullPath === currentPath);

    if (options.preserveSelection && currentPath && !selectedPathExists) {
      nextTick(() => onSelectionRestored?.());
      return;
    }

    selectedPath.value = getRestoredSelectedPath(results.value, currentPath);
    nextTick(() => onSelectionRestored?.());
  }

  function selectItem(item: FinderResult) {
    selectedPath.value = item.fullPath ?? "";
  }

  function clearSelection() {
    selectedPath.value = "";
  }

  function removeResultByPath(fullPath: string) {
    const beforeLength = results.value.length;
    results.value = results.value.filter((item) => item.fullPath !== fullPath);
    if (results.value.length === beforeLength) return;

    everythingTotal.value = Math.max(0, everythingTotal.value - 1);
    restoreSelection();
    updateResultStatus();
  }

  function moveSelection(direction: -1 | 1) {
    const paths = results.value
      .map((item) => item.fullPath)
      .filter((path): path is string => !!path);
    const nextPath = getNextSelectedPath(paths, selectedPath.value, direction);
    if (!nextPath) return;

    selectedPath.value = nextPath;
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
    selectedPath,
    statusText,
    isLoading,
    visibleResults,
    selectedItem,
    queueSearch,
    runSearch,
    restoreSelection,
    updateResultStatus,
    selectItem,
    clearSelection,
    removeResultByPath,
    moveSelection,
    growVisibleCount,
    resetVisibleCount,
    clearSearchTimer,
    scrollSelectedIntoView,
  };
}

<script setup lang="ts">
import { onMounted } from "vue";
import Finder from "./Finder/index.vue";
import { useFinderEnterAction } from "./Finder/composables/useFinderEnterAction";
import { getFileIconDataUrl, warmUpFileIconCache } from "./Finder/core/fileIconCache";
import {
  DEFAULT_CATEGORIES,
  buildEverythingQuery,
  mergeResultsByMatchPathPriority,
} from "./Finder/core/finderLogic";
import { useFinderCategories } from "./Finder/composables/useFinderCategories";
import { usePersistStorage } from "./Finder/composables/usePersistStorage";
import { useSubInput } from "./Finder/composables/useSubInput";

const MAIN_PUSH_RESULT_LIMIT = 6;

type MainPushSearchResult = MainPushResult & {
  fullPath?: string;
};

const { loadPersistStorage, matchPathEnabled } = usePersistStorage();
const { resetActiveCategory } = useFinderCategories();
const { handleEnterAction } = useFinderEnterAction();
const { syncSubInputValue } = useSubInput();
loadPersistStorage();

onMounted(() => {
  warmUpFileIconCache();

  window.ztools.onPluginEnter<string, Partial<MainPushSearchResult> | undefined>((action) => {
    if (action.from === "main") {
      syncSubInputValue();
    } else {
      resetActiveCategory();
      handleEnterAction({
        payload: action.code === "oversearch" ? action.payload : "",
        option: action.option,
      });
    }

    window.ztools.subInputFocus();
  });

  window.ztools.onMainPush<string>(
    (action) => {
      if (action.code !== "oversearch") return [];

      const searchText = action.payload;
      const everythingQuery = buildEverythingQuery(searchText, DEFAULT_CATEGORIES[0]);

      try {
        if (!window.services.everything.isAvailable()) return [];
        if (window.services.everything.getStartupStatus().state !== "ready") return [];
        const nameResult = window.services.everything.query(
          everythingQuery,
          MAIN_PUSH_RESULT_LIMIT,
          "modified-desc",
          false,
        );
        const matchPathResult = matchPathEnabled.value
          ? window.services.everything.query(
              everythingQuery,
              MAIN_PUSH_RESULT_LIMIT,
              "modified-desc",
              true,
            )
          : undefined;

        const resultItems = matchPathResult
          ? mergeResultsByMatchPathPriority(nameResult.items, matchPathResult.items)
          : nameResult.items;
        const total = matchPathResult?.total ?? nameResult.total;

        const items: MainPushSearchResult[] = resultItems
          .slice(0, MAIN_PUSH_RESULT_LIMIT)
          .map((item) => ({
            title: item.path ?? (item.fullPath ? getParentPath(item.fullPath) : ""),
            text: item.name,
            icon: item.fullPath ? window.ztools.getFileIcon(item.fullPath) : undefined,
            fullPath: item.fullPath,
          }));

        if (total > MAIN_PUSH_RESULT_LIMIT) {
          items.pop();
          items.push({
            text: `共有${total}个结果，查看更多...`,
          });
        }

        return items;
      } catch {
        return [];
      }
    },
    (action) => {
      resetActiveCategory();
      handleEnterAction({
        payload: action.payload,
        option: action.option as MainPushSearchResult,
      });
      return true;
    },
  );
});

function getParentPath(fullPath: string): string {
  const index = Math.max(fullPath.lastIndexOf("\\"), fullPath.lastIndexOf("/"));
  return index > 0 ? fullPath.slice(0, index) : fullPath;
}
</script>

<template>
  <Finder />
</template>

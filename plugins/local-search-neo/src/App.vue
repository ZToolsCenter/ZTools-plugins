<script setup lang="ts">
import { onMounted } from "vue";
import Finder from "./Finder/index.vue";
import {
  useFinderEnterAction,
  type FinderEnterAction,
} from "./Finder/composables/useFinderEnterAction";
import { warmUpFileIconCache } from "./Finder/core/fileIconCache";
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

/**
 * 根据 ZTools 插件进入事件（PluginEnterAction）构建 Finder 初始化动作。
 *
 * 支持的模式：
 * 1. `oversearch`：全局搜索，携带搜索词。
 * 2. `explorerfind`：读取当前活动资源管理器窗口所在路径，限定在该目录下搜索；
 *    - 增加 try-catch 防护：在快速访问、此电脑等特殊命名空间下读取可能抛错，失败时安全降级为全盘搜索。
 * 3. `folderfind`：在用户选中的文件夹内搜索，对 payload 进行防御性数组和路径有效性检查。
 */
async function buildEnterAction(action: PluginEnterAction): Promise<FinderEnterAction> {
  if (action.code === "oversearch") {
    return {
      query: typeof action.payload === "string" ? action.payload : "",
    };
  } else if (action.code === "explorerfind") {
    let path = "";
    try {
      path = (await window.ztools.readCurrentFolderPath()) || "";
    } catch {
      // 在「快速访问」或不支持读取路径的特殊窗口下，静默降级为常规全盘搜索
      path = "";
    }
    const trimmedPath = path.trim();
    if (!trimmedPath) {
      return {};
    }
    const name = trimmedPath.split(/[\\/]/).filter(Boolean).pop() || trimmedPath;
    return {
      prefix: trimmedPath,
      placeholder: `在"${name}"中查找`,
    };
  } else if (action.code === "folderfind") {
    const files = Array.isArray(action.payload) ? action.payload : [];
    const target = files[0];
    if (!target || !target.path) {
      return {};
    }
    const name = target.name || target.path.split(/[\\/]/).filter(Boolean).pop() || target.path;
    return {
      prefix: target.path,
      placeholder: `在"${name}"中查找`,
    };
  } else {
    return {};
  }
}

onMounted(() => {
  warmUpFileIconCache();

  window.ztools.onPluginEnter<any, Partial<MainPushSearchResult> | undefined>(async (action) => {
    if (action.from === "main") {
      syncSubInputValue();
    } else {
      resetActiveCategory();
      handleEnterAction(await buildEnterAction(action as any));
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
            title: item.path,
            text: item.name,
            icon: window.ztools.getFileIcon(item.fullPath),
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
      const option = action.option as MainPushSearchResult | undefined;
      handleEnterAction({
        query: typeof action.payload === "string" ? action.payload : "",
        fullPath: option?.fullPath,
      });
      return true;
    },
  );
});
</script>

<template>
  <Finder />
</template>

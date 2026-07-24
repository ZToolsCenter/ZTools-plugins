import { onUnmounted, shallowRef, watch } from "vue";
import {
  getCachedFileIconUrl,
  getDisplayFileIconUrl,
  getFolderFileIconUrl,
  getUnknownFileIconUrl,
  loadFileIconUrl,
  shouldLoadFileIcon,
} from "../core/fileIconCache";
import type { FinderResult } from "../core/finderLogic";

interface FileInfoState {
  isDirectory: boolean;
}

interface UseFileIconsOptions {
  visibleResults: () => FinderResult[];
  isFolderQuery: () => boolean;
}

const FILE_INFO_CONCURRENCY = 16;

export function useFileIcons({ visibleResults, isFolderQuery }: UseFileIconsOptions) {
  const iconUrls = shallowRef<Record<string, string>>({});
  const fileInfoByPath = shallowRef<Record<string, FileInfoState>>({});
  const loadedIconPaths = new Set<string>();
  const loadedFileInfoPaths = new Set<string>();
  let cancelIconLoad: (() => void) | undefined;
  let iconLoadGeneration = 0;
  let fileInfoLoadGeneration = 0;

  watch(
    [visibleResults, isFolderQuery],
    ([items]) => {
      queueVisibleFileInfo(items);
      queueVisibleIcons(items);
    },
    { immediate: true },
  );

  onUnmounted(() => {
    cancelIconLoad?.();
    iconLoadGeneration += 1;
    fileInfoLoadGeneration += 1;
  });

  function iconFor(item: FinderResult) {
    if (!item.fullPath) return getUnknownFileIconUrl();

    const loadedIconUrl = iconUrls.value[item.fullPath];
    if (loadedIconUrl) return loadedIconUrl;

    return getDisplayFileIconUrl(displayItem(item));
  }

  function displayItem(item: FinderResult): FinderResult {
    if (!item.fullPath) return item;
    if (isFolderQuery()) return { ...item, isDirectory: true };

    const fileInfo = fileInfoByPath.value[item.fullPath];
    return fileInfo ? { ...item, ...fileInfo } : item;
  }

  function queueVisibleFileInfo(items: FinderResult[]) {
    const generation = ++fileInfoLoadGeneration;

    if (isFolderQuery()) {
      rememberFolderQueryItems(items);
      return;
    }

    const queue = items.filter((item) => {
      if (!item.fullPath || item.isDirectory !== undefined) return false;
      if (hasResultExtension(item)) return false;
      if (loadedFileInfoPaths.has(item.fullPath)) return false;
      return true;
    });

    void loadQueuedFileInfo(queue, generation);
  }

  function rememberFolderQueryItems(items: FinderResult[]) {
    const folderIconUrl = getFolderFileIconUrl();
    const nextIconUrls = { ...iconUrls.value };
    const nextFileInfo = { ...fileInfoByPath.value };

    for (const item of items) {
      if (!item.fullPath) continue;

      loadedFileInfoPaths.add(item.fullPath);
      loadedIconPaths.add(item.fullPath);
      nextFileInfo[item.fullPath] = { isDirectory: true };
      if (folderIconUrl) nextIconUrls[item.fullPath] = folderIconUrl;
    }

    fileInfoByPath.value = nextFileInfo;
    iconUrls.value = nextIconUrls;
  }

  async function loadQueuedFileInfo(queue: FinderResult[], generation: number) {
    if (queue.length === 0) return;

    let nextIndex = 0;
    const workerCount = Math.min(FILE_INFO_CONCURRENCY, queue.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (generation === fileInfoLoadGeneration) {
        const item = queue[nextIndex];
        nextIndex += 1;
        if (!item) return;
        await loadFileInfo(item, generation);
      }
    });

    await Promise.all(workers);
  }

  async function loadFileInfo(item: FinderResult, generation: number) {
    if (!item.fullPath) return;

    const fileInfo = await window.services.getFileInfo(item.fullPath);
    loadedFileInfoPaths.add(item.fullPath);
    if (generation !== fileInfoLoadGeneration) return;

    fileInfoByPath.value = {
      ...fileInfoByPath.value,
      [item.fullPath]: {
        isDirectory: fileInfo.isDirectory,
      },
    };

    if (fileInfo.isDirectory) {
      const folderIconUrl = getFolderFileIconUrl();
      if (folderIconUrl) {
        iconUrls.value = {
          ...iconUrls.value,
          [item.fullPath]: folderIconUrl,
        };
      }
    }
  }

  function queueVisibleIcons(items: FinderResult[]) {
    iconLoadGeneration += 1;
    cancelIconLoad?.();
    cancelIconLoad = undefined;

    const generation = iconLoadGeneration;
    const nextIconUrls = { ...iconUrls.value };
    const queue: FinderResult[] = [];

    for (const item of items) {
      if (!item.fullPath) continue;

      const display = displayItem(item);
      const cachedUrl = getCachedFileIconUrl(display);
      if (cachedUrl) {
        nextIconUrls[item.fullPath] = cachedUrl;
        continue;
      }

      if (!shouldLoadFileIcon(display)) continue;
      if (!nextIconUrls[item.fullPath] && !loadedIconPaths.has(item.fullPath)) queue.push(item);
    }

    iconUrls.value = nextIconUrls;
    scheduleNextIconLoad(queue, generation);
  }

  function scheduleNextIconLoad(queue: FinderResult[], generation: number) {
    if (generation !== iconLoadGeneration) return;

    const item = queue.shift();
    if (!item) return;

    cancelIconLoad = scheduleIdleTask(() => {
      cancelIconLoad = undefined;
      if (generation !== iconLoadGeneration) return;

      loadQueuedIcon(item, generation);
      scheduleNextIconLoad(queue, generation);
    });
  }

  function scheduleIdleTask(callback: () => void) {
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => callback());
      return () => window.cancelIdleCallback(id);
    }

    const id = window.setTimeout(callback, 0);
    return () => window.clearTimeout(id);
  }

  function loadQueuedIcon(item: FinderResult, generation: number) {
    if (!item.fullPath) return;

    const display = displayItem(item);
    const iconUrl = loadFileIconUrl(display);
    loadedIconPaths.add(item.fullPath);

    if (!iconUrl || generation !== iconLoadGeneration) return;
    iconUrls.value = {
      ...iconUrls.value,
      [item.fullPath]: iconUrl,
    };
  }

  return {
    displayItem,
    iconFor,
  };
}

function hasResultExtension(file: Pick<FinderResult, "name" | "extension" | "fullPath">) {
  return (file.extension || getExtension(file.name || file.fullPath || "")) !== "";
}

function getExtension(name: string) {
  const fileName = name.split(/[\\/]/).pop() ?? name;
  const index = fileName.lastIndexOf(".");

  return index > 0 ? fileName.slice(index + 1).toLowerCase() : "";
}

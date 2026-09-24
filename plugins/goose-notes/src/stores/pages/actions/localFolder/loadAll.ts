import { useNotebooks } from "../../../useNotebooks";
import type { StoreSet, StoreGet } from "../hydrate";
import { loadLocalFolderPagesAction } from "./load";

// 把「所有尚未加载」的 local-folder 记事本页面扫进 store。
// 用途：全局搜索「所有记事本」需要覆盖全量，但 local-folder 记事本是懒加载的
// （只有打开过才扫盘进内存）。启动后后台静默预热一次，切到「所有记事本」时也兜底调用。
//
// 安全性：loadLocalFolderPagesAction 仅在 activeNotebookId === 目标记事本时才会改 activePageId，
// 这里预加载的都是非激活记事本，因此不会影响当前激活页 / 已打开标签。
export const loadAllLocalFolderPagesAction = async (
  set: StoreSet,
  get: StoreGet,
): Promise<void> => {
  if (typeof window === "undefined" || !window.gooseFs) return;

  const { notebooks, localFolderLoadStates } = useNotebooks.getState();

  const targets = Object.values(notebooks).filter((nb) => {
    if (nb.source !== "local-folder") return false;
    if (!nb.localPath || nb.localPathMissing) return false;
    const loadState = localFolderLoadStates[nb.id];
    // 正在加载或已就绪的跳过；只补加载从未触发过的。
    if (loadState?.status === "loading" || loadState?.status === "ready") {
      return false;
    }
    // 已有该记事本页面在内存里（可能由旧路径加载过）也跳过。
    const hasPages = Object.values(get().pages).some(
      (p) => p.workspaceId === nb.id,
    );
    return !hasPages;
  });

  if (targets.length === 0) return;

  // 串行扫盘，避免同时大量文件 IO 拖慢交互。
  for (const nb of targets) {
    try {
      await loadLocalFolderPagesAction(set, get, nb.id, nb.localPath!);
    } catch (error) {
      console.error(
        `[local-folder] preload pages failed for notebook ${nb.id}`,
        error,
      );
    }
  }
};

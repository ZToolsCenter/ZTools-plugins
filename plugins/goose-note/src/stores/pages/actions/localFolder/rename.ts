import { useNotebooks } from "../../../useNotebooks";
import { useTabs } from "../../../useTabs";
import { buildLocalPageId } from "@/lib/local-folder-scanner";
import {
  extractFirstHeadingText,
  sanitizeFilenameSegment,
  splitFilePath,
} from "@/lib/local-title-binding";
import { migrateLocalPageIdMapEntry, toRelativePath } from "@/lib/local-page-idmap";
import {
  acquireLocalPageFileOperation,
  flushPendingLocalSaveByPageIdInternal,
  migratePendingLocalSave,
} from "../../folderSync";
import type { StoreSet, StoreGet } from "../hydrate";
import { cloneLocalPageContent } from "../pageCreate";
import { markSelfMoved } from "./move";
import {
  allocateUniqueLocalBaseName,
  findDuplicateLocalFileOwner,
  localFilePathExists,
} from "./pathGuards";

function renameLocalPageInStore(
  set: StoreSet,
  get: StoreGet,
  oldPageId: string,
  newPageId: string,
  nextFilePath: string,
): string {
  if (oldPageId === newPageId) {
    set((state) => {
      const page = state.pages[oldPageId];
      if (!page) return state;
      return {
        pages: {
          ...state.pages,
          [oldPageId]: { ...page, localFilePath: nextFilePath },
        },
      };
    });
    return oldPageId;
  }

  const migration = migratePendingLocalSave(oldPageId, newPageId, get);
  if (!migration.ok) {
    throw new Error(`恢复日志迁移失败：${migration.error}`);
  }

  set((state) => {
    const page = state.pages[oldPageId];
    if (!page) return state;
    const nextPages = { ...state.pages };
    delete nextPages[oldPageId];
    nextPages[newPageId] = {
      ...page,
      id: newPageId,
      localFilePath: nextFilePath,
    };

    const nextDirty = { ...state.dirtyLocalPageIds };
    if (oldPageId in nextDirty) {
      // 注意：已保存的页面键值为 false 但键仍存在，不能用 `in` 当作"脏"——
      // 否则 rename 后标签页凭空出现"未保存"黄点。只有真 dirty 才转移。
      const wasDirty = nextDirty[oldPageId] === true;
      delete nextDirty[oldPageId];
      if (wasDirty) {
        nextDirty[newPageId] = true;
      }
    }

    return {
      pages: nextPages,
      dirtyLocalPageIds: nextDirty,
      activePageId:
        state.activePageId === oldPageId ? newPageId : state.activePageId,
    };
  });

  // tabs 引用同步
  useTabs.setState((state) => ({
    openTabs: state.openTabs.map((tab) =>
      tab.pageId === oldPageId ? { ...tab, pageId: newPageId } : tab,
    ),
  }));

  // notebooks 的 lastActivePage 同步
  const notebooksState = useNotebooks.getState();
  const nextLastActive = { ...notebooksState.lastActivePageByNotebook };
  let changed = false;
  for (const key of Object.keys(nextLastActive)) {
    if (nextLastActive[key] === oldPageId) {
      nextLastActive[key] = newPageId;
      changed = true;
    }
  }
  if (changed) {
    useNotebooks.setState({ lastActivePageByNotebook: nextLastActive });
  }

  return newPageId;
}

async function maybeRenameLocalFileForTitle(
  set: StoreSet,
  get: StoreGet,
  pageId: string,
): Promise<{ pageId: string; collision: boolean }> {
  const page = get().pages[pageId];
  if (!page || !page.localFilePath) return { pageId, collision: false };

  const newTitle = extractFirstHeadingText(page.content);
  if (!newTitle) return { pageId, collision: false };

  const sanitized = sanitizeFilenameSegment(newTitle);
  if (!sanitized) return { pageId, collision: false };

  const { dir, base, ext } = splitFilePath(page.localFilePath);
  if (sanitized === base) return { pageId, collision: false };

  const nextFilePath = `${dir}/${sanitized}${ext}`;

  if (typeof window === "undefined" || !window.gooseFs) {
    return { pageId, collision: false };
  }

  const fs = window.gooseFs;
  const duplicatePage = findDuplicateLocalFileOwner(
    get().pages,
    pageId,
    nextFilePath,
  );
  if (duplicatePage) {
    console.warn(
      "[local-title] rename skipped, target already tracked:",
      { nextFilePath, duplicatePageId: duplicatePage.id },
    );
    return { pageId, collision: true };
  }
  if (await localFilePathExists(fs, nextFilePath)) {
    console.warn(
      "[local-title] rename skipped, target exists:",
      nextFilePath,
    );
    return { pageId, collision: true };
  }

  let renamed: boolean;
  try {
    markSelfMoved(page.localFilePath.replace(/\\/g, "/"));
    markSelfMoved(nextFilePath.replace(/\\/g, "/"));
    renamed = Boolean(
      await Promise.resolve(fs.rename(page.localFilePath, nextFilePath)),
    );
  } catch (err) {
    console.error("[local-title] rename failed:", err);
    return { pageId, collision: false };
  }

  if (!renamed) return { pageId, collision: false };

  const notebook = useNotebooks.getState().notebooks[page.workspaceId];
  const basePath = notebook?.localPath || "";
  const newPageId = buildLocalPageId(page.workspaceId, basePath, nextFilePath);
  const nextPageId = renameLocalPageInStore(
    set,
    get,
    pageId,
    newPageId,
    nextFilePath,
  );

  return { pageId: nextPageId, collision: false };
}

/**
 * 显式重命名 local-folder 页面文件。
 * 由虚拟标题组件在用户提交新名称时调用。
 *
 * @param newBaseName  新文件名（不含扩展名，已由调用方 sanitize）
 * @returns            成功时返回新 pageId；失败时 throw
 */
export async function renameLocalPageFileAction(
  set: StoreSet,
  get: StoreGet,
  pageId: string,
  newBaseName: string,
): Promise<string> {
  const page = get().pages[pageId];
  if (!page || !page.localFilePath) {
    throw new Error("页面不存在或非本地文件夹页面");
  }

  const sanitized = sanitizeFilenameSegment(newBaseName);
  if (!sanitized) {
    throw new Error("文件名不能为空");
  }

  const { dir, base, ext } = splitFilePath(page.localFilePath);
  if (sanitized === base) {
    // 名称未变，无需操作
    return pageId;
  }

  if (typeof window === "undefined" || !window.gooseFs) {
    throw new Error("文件系统不可用");
  }

  const fs = window.gooseFs;
  // 与新建页一致：撞名时自动 `名称 (1)` / `名称 (2)`，不抛错打断用户
  const uniqueBase = await allocateUniqueLocalBaseName(
    fs,
    get().pages,
    pageId,
    dir,
    sanitized,
    ext,
    page.localFilePath,
  );
  const nextFilePath = `${dir}/${uniqueBase}${ext}`;
  // 解析后仍与当前基名相同（例如「foo (1)」→「foo」但「foo」已被占，落回自身）
  if (uniqueBase === base) {
    return pageId;
  }

  // 先让编辑器的 800ms 防抖立即提交到 store，再写完已经排队的旧路径内容。
  // 标题输入与编辑器同属同步事件链，dispatch 返回时 updatePage 已完成入队。
  window.dispatchEvent(
    new CustomEvent("goose-note:flush-editor", {
      detail: { immediate: true, pageId },
    }),
  );
  await flushPendingLocalSaveByPageIdInternal(pageId, get);

  // 与所有正文写盘共用页面级串行锁：等待在途的直接保存结束，并阻止后续保存
  // 在 localFilePath 切换前读取旧路径。同页并发 rename 也会自然串行。
  const releaseFileOperation = await acquireLocalPageFileOperation(pageId);
  try {
    const renamed = Boolean(
      await Promise.resolve(fs.rename(page.localFilePath, nextFilePath)),
    );
    if (!renamed) {
      throw new Error("重命名操作未成功");
    }

    // 成功后才登记自移路径；失败时不应误吞接下来 5 秒的真实文件事件。
    markSelfMoved(page.localFilePath.replace(/\\/g, "/"));
    markSelfMoved(nextFilePath.replace(/\\/g, "/"));

    // 磁盘已改名后先同步 store。后面的快照/idMap 属于附属元数据，即使迁移异常，
    // 等待锁的保存也会读取新路径，不会把旧文件重新创建出来。
    set((state) => {
      const current = state.pages[pageId];
      if (!current) return state;
      return {
        pages: {
          ...state.pages,
          [pageId]: { ...current, localFilePath: nextFilePath },
        },
      };
    });

    // 迁移快照 Map：旧路径 → 新路径（保持保存前 diff 有效）
    const { getLocalMdSnapshot, setLocalMdSnapshot, deleteLocalMdSnapshot } =
      await import("@/lib/local-md-snapshot");
    const oldSnapshot = getLocalMdSnapshot(page.localFilePath);
    if (oldSnapshot !== undefined) {
      setLocalMdSnapshot(nextFilePath, oldSnapshot);
      deleteLocalMdSnapshot(page.localFilePath);
    }

    // 稳定 id：更新映射表（旧 relativePath → 新 relativePath，stableId 不变），
    // 然后只更新 page 的 localFilePath 字段，id 保持不变。
    const notebook = useNotebooks.getState().notebooks[page.workspaceId];
    const basePath = notebook?.localPath || "";
    const oldRelativePath = toRelativePath(basePath, page.localFilePath);
    const newRelativePath = toRelativePath(basePath, nextFilePath);
    migrateLocalPageIdMapEntry(
      page.workspaceId,
      oldRelativePath,
      newRelativePath,
      pageId,
    );

    return pageId;
  } catch (error) {
    if (error instanceof Error && error.message === "重命名操作未成功") {
      throw error;
    }
    throw new Error(
      `重命名失败：${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  } finally {
    releaseFileOperation();
  }
}

export const saveDirtyLocalPageAction = async (
  set: StoreSet,
  get: StoreGet,
  pageId: string,
): Promise<boolean> => {
  const page = get().pages[pageId];
  if (!page) return false;
  if (page.localReadState === "error") return false;

  try {
    // 先让编辑器把最新内容刷进 store。
    window.dispatchEvent(
      new CustomEvent("goose-note:flush-editor", {
        detail: { immediate: true, pageId },
      }),
    );

    // NOTE: 「H1 → 文件名」自动 rename 已停用。
    // H1 不再绑定文件名（见 P0 止血：local-folder 链路重构），
    // maybeRenameLocalFileForTitle 调用被跳过，待虚拟标题方案接管后再重新设计此机制。
    // const { pageId: effectivePageId, collision } =
    //   await maybeRenameLocalFileForTitle(set, get, pageId);
    const effectivePageId = pageId;

    const latest = get().pages[effectivePageId];
    if (!latest) return false;

    const ok = await get().saveLocalPageContent(
      effectivePageId,
      cloneLocalPageContent(latest.content),
    );
    if (ok) {
      set((s) => ({
        dirtyLocalPageIds: { ...s.dirtyLocalPageIds, [effectivePageId]: false },
      }));
    }
    return ok;
  } catch {
    return false;
  }
};

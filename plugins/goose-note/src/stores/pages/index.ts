import { create } from "zustand";
import { useNotebooks, DEFAULT_NOTEBOOK } from "../useNotebooks";
import type { JSONContent } from "@/types";

import { loadInternalPage } from "@/lib/storage/pageRepository";
import type { PagesState } from "./types";
import {
  isLocalFolderPage,
  persistPageSnapshot,
  persistPageSnapshots,
  removePersistedPageSnapshots,
  shouldPersistLocalPageMetaUpdate,
} from "./persistence";
import {
  isLocalPageFrontmatterSettingsUpdate,
  mergeLocalPageSettingsIntoFrontmatter,
} from "@/lib/local-frontmatter";
import { queueLocalPageSave } from "./folderSync";
import { getContentSignature } from "@/components/editor/utils/blocknote-content";
import {
  acknowledgeRecoveryEntry,
  recordRecoveryEntry,
} from "@/lib/storage/recoveryJournal";
import { toast } from "@/components/ui/sonner";

// Re-export flushEditorContent for external consumers
export { flushEditorContent } from "./actions/flushEditor";
export { clearLocalPageMetadataCache } from "./clearCache";

import { flushEditorContent } from "./actions/flushEditor";
import { hydrateFromStorageAction } from "./actions/hydrate";
import {
  createOnboardingPagesAction,
  createPageAction,
  createPageRecordAction,
  createLocalPageAction,
  createLocalPageRecordAction,
  createLocalFolderRecordAction,
  duplicatePageAction,
} from "./actions/pageCreate";
import {
  loadLocalFolderPagesAction,
  loadAllLocalFolderPagesAction,
  reloadLocalPageFromDiskAction,
  removeSingleLocalPageAction,
  addSingleLocalPageAction,
  writePageContentAction,
  appendPageContentAction,
  replaceBlockRangeAction,
  saveLocalPageContentAction,
  flushPendingLocalSaveByPageIdAction,
  flushPendingLocalSavesAction,
  isLocalPageDirtyAction,
  saveDirtyLocalPageAction,
  renameLocalPageFileAction,
  moveLocalPageAction,
} from "./actions/localFolder";
import {
  deletePageAction,
  restorePageAction,
  permanentlyDeletePageAction,
  movePageTreeToNotebookAction,
  undoMovePageTreeAction,
  setActivePageAction,
} from "./actions/pageMutations";

export const usePages = create<PagesState>()((set, get) => ({
  pages: {},
  activePageId: null,
  pendingNavigatePageId: null,
  expandPageId: null,
  searchHighlightQuery: null,
  searchHighlightPageId: null,
  searchHighlightNonce: 0,
  handledSearchHighlightNonce: 0,
  hydrated: false,
  lastSavedAt: null,
  onboardingCompleted: false,
  dirtyLocalPageIds: {},

  hydrateFromStorage: () => hydrateFromStorageAction(set),

  reloadPageFromStorage: (pageId) => {
    const current = get().pages[pageId];
    const fresh = loadInternalPage(pageId);
    if (!fresh) return false;
    // 仅当 db 版本更新时才覆盖，避免回退本进程尚未落盘的较新编辑。
    if (current && fresh.updatedAt <= current.updatedAt) return false;
    set((state) => ({
      pages: { ...state.pages, [pageId]: fresh },
    }));
    return true;
  },

  createOnboardingPages: () => createOnboardingPagesAction(set, get),

  createPage: (parentId, workspaceId = DEFAULT_NOTEBOOK) =>
    createPageAction(set, get, parentId, workspaceId),

  createPageRecord: (options) => createPageRecordAction(set, get, options),

  createLocalPage: (parentId, workspaceId) =>
    createLocalPageAction(set, get, parentId, workspaceId),

  createLocalPageRecord: (options) =>
    createLocalPageRecordAction(set, get, options),

  createLocalFolderRecord: (options) =>
    createLocalFolderRecordAction(set, get, options),

  updatePage: (id, updates, options) => {
    const page = get().pages[id];
    const shouldPersistLocalMeta =
      isLocalFolderPage(page) && shouldPersistLocalPageMetaUpdate(updates);
    const silent = options?.silent === true;
    const isLocal = isLocalFolderPage(page);
    const isDurableContentEdit = Boolean(page) && "content" in updates && !silent;
    const recoveryEntry = isDurableContentEdit
      ? recordRecoveryEntry({
          source: isLocal ? "local-file" : "internal-page",
          id,
          content: updates.content ?? null,
          baseSignature: getContentSignature(page?.content ?? null),
          baseUpdatedAt: page?.updatedAt,
        })
      : null;
    if (isDurableContentEdit && !recoveryEntry) {
      toast.error("无法写入恢复备份", {
        id: "goose-recovery-journal-failed",
        description: "请先不要关闭窗口，并复制重要内容后重试。",
      });
    }
    const shouldMergeFrontmatterSettings =
      isLocal &&
      !silent &&
      isLocalPageFrontmatterSettingsUpdate(updates);
    // 仅改字体/锁定也要落盘；读失败页不写，避免覆盖坏文件
    const shouldQueueLocalSettingsSave =
      shouldMergeFrontmatterSettings && page?.localReadState !== "error";

    set((state) => {
      const page = state.pages[id];
      if (!page) return state;
      const now = Date.now();

      let favoriteOrder = updates.favoriteOrder ?? page.favoriteOrder;
      if (
        updates.isFavorite === true &&
        !page.isFavorite &&
        favoriteOrder === undefined
      ) {
        const maxFavoriteOrder = Object.values(state.pages)
          .filter((p) => p.workspaceId === page.workspaceId && p.isFavorite)
          .reduce((max, p) => {
            const candidate = p.favoriteOrder ?? p.order ?? p.createdAt;
            return Math.max(max, candidate);
          }, -1);
        favoriteOrder = maxFavoriteOrder + 1;
      }

      let pinnedAt = updates.pinnedAt ?? page.pinnedAt;
      if (updates.isPinned === true) {
        pinnedAt = now;
      }
      if (updates.isPinned === false) {
        pinnedAt = undefined;
      }

      // 只有真正的内容编辑才刷新 updatedAt：必须显式传入 content 字段，
      // 且没有标记为 silent（silent 用于切页/normalize 这类被动同步）。
      const isContentEdit = "content" in updates && !silent;
      let updatedPage = {
        ...page,
        ...updates,
        ...(favoriteOrder !== undefined ? { favoriteOrder } : {}),
        pinnedAt,
        updatedAt: isContentEdit ? now : page.updatedAt,
      };

      // 本地页：字体/锁定 merge 进 frontmatter blob（解析失败保留原文，避免破坏手写 YAML）
      if (shouldMergeFrontmatterSettings) {
        const mergeResult = mergeLocalPageSettingsIntoFrontmatter(
          updatedPage.localFrontmatter,
          {
            fontFamily: updatedPage.fontFamily ?? "default",
            isLocked: Boolean(updatedPage.isLocked),
          },
        );
        if (!mergeResult.parseFailed) {
          updatedPage = {
            ...updatedPage,
            localFrontmatter: mergeResult.blob,
          };
        } else if (mergeResult.error) {
          console.warn(
            "[local-frontmatter] 无法安全写入设置，已保留原 frontmatter：",
            mergeResult.error,
          );
        }
      }

      const shouldQueueContentSave =
        Boolean(updates.content) &&
        !silent &&
        useNotebooks.getState().notebooks[page.workspaceId]?.source ===
          "local-folder" &&
        page.localReadState !== "error";

      // 内容编辑 或 仅改 frontmatter 设置：标脏并入防抖写盘队列
      if (shouldQueueContentSave || shouldQueueLocalSettingsSave) {
        // 本地文件夹与普通笔记本一致：编辑即自动保存。先标脏（短暂显示"保存中"），
        // 再入防抖队列落盘；写盘成功后由 saveLocalPageContent 清除脏标记。
        // 标题→文件名的 rename 仍由显式 Cmd/Ctrl+S（saveDirtyLocalPage）处理，
        // 避免输入标题过程中频繁重命名文件。
        // silent=true（切页/normalize 被动同步）时跳过标脏与队列，不触发写盘。
        const contentForSave = shouldQueueContentSave
          ? updates.content!
          : updatedPage.content;
        set((s) => ({
          dirtyLocalPageIds: { ...s.dirtyLocalPageIds, [id]: true },
        }));
        queueLocalPageSave(id, contentForSave, get, recoveryEntry?.revision);
      }

      return {
        pages: {
          ...state.pages,
          [id]: updatedPage,
        },
      };
    });

    const updatedPage = get().pages[id];
    if (!updatedPage) return;

    if (isLocalFolderPage(updatedPage)) {
      if (shouldPersistLocalMeta) {
        persistPageSnapshot(updatedPage);
      }
      return;
    }

    const persisted = persistPageSnapshot(updatedPage);
    if (persisted && recoveryEntry) {
      acknowledgeRecoveryEntry("internal-page", id, recoveryEntry.revision);
    } else if (!persisted) {
      toast.error("内容暂未保存", {
        id: `goose-page-save-failed:${id}`,
        description: "最新内容已放入恢复备份，下次打开仍可找回。",
      });
    }
  },

  deletePage: (id, options) => deletePageAction(set, get, id, options),

  restorePage: (id) => restorePageAction(set, get, id),

  duplicatePage: (id) => duplicatePageAction(set, get, id),

  permanentlyDeletePage: (id) => permanentlyDeletePageAction(set, get, id),

  reorderPages: (ids, parentId) => {
    set((state) => {
      const newPages = { ...state.pages };

      ids.forEach((id, index) => {
        if (newPages[id]) {
          newPages[id] = {
            ...newPages[id],
            parentId: parentId,
            order: index,
          };
        }
      });

      return { pages: newPages };
    });
    persistPageSnapshots(get().pages, ids);
  },

  reorderFavorites: (ids) => {
    set((state) => {
      const newPages = { ...state.pages };

      ids.forEach((id, index) => {
        if (!newPages[id]) return;
        newPages[id] = {
          ...newPages[id],
          favoriteOrder: index,
        };
      });

      return { pages: newPages };
    });
    persistPageSnapshots(get().pages, ids);
  },

  movePageTreeToNotebook: (pageId, targetNotebookId) =>
    movePageTreeToNotebookAction(set, get, pageId, targetNotebookId),

  undoMovePageTree: (undoSnapshots, sourceNotebookId, prevActivePageId) =>
    undoMovePageTreeAction(
      set,
      get,
      undoSnapshots,
      sourceNotebookId,
      prevActivePageId,
    ),

  setActivePage: (id) => setActivePageAction(set, get, id),

  setPendingNavigatePageId: (id) => {
    set({ pendingNavigatePageId: id });
  },

  setExpandPageId: (id) => {
    set({ expandPageId: id });
  },

  setSearchHighlightQuery: (query) => {
    set({ searchHighlightQuery: query });
  },
  setSearchHighlightPageId: (id) => {
    set({ searchHighlightPageId: id });
  },
  setSearchHighlightNonce: (nonce) => {
    set({ searchHighlightNonce: nonce });
  },
  setHandledSearchHighlightNonce: (nonce) => {
    set({ handledSearchHighlightNonce: nonce });
  },

  setLastSavedAt: (timestamp) => {
    set({ lastSavedAt: timestamp });
  },

  getAncestorIds: (pageId) => {
    const pages = get().pages;
    const ancestorIds: string[] = [];
    let current = pages[pageId];
    while (current && current.parentId && pages[current.parentId]) {
      ancestorIds.push(current.parentId);
      current = pages[current.parentId];
    }
    return ancestorIds;
  },

  setHydrated: (hydrated) => {
    set({ hydrated });
  },

  getPage: (id) => get().pages[id],

  getChildren: (parentId, workspaceId) => {
    const pages = get().pages;
    return Object.values(pages)
      .filter((p) => {
        const matchParent = p.parentId === parentId && !p.trashedAt;
        const matchWorkspace = workspaceId
          ? p.workspaceId === workspaceId
          : true;
        return matchParent && matchWorkspace;
      })
      .sort((a, b) => {
        const valA = a.order ?? a.createdAt;
        const valB = b.order ?? b.createdAt;
        if (valA !== valB) return valA - valB;
        return a.id.localeCompare(b.id);
      });
  },

  getTrashedPages: (workspaceId) => {
    const pages = get().pages;
    return Object.values(pages)
      .filter((p) => {
        const isTrashed = !!p.trashedAt;
        const matchWorkspace = workspaceId
          ? p.workspaceId === workspaceId
          : true;
        return isTrashed && matchWorkspace;
      })
      .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));
  },

  getFavorites: (workspaceId) => {
    const pages = get().pages;
    return Object.values(pages)
      .filter((p) => {
        const isFavorite = p.isFavorite;
        const matchWorkspace = workspaceId
          ? p.workspaceId === workspaceId
          : true;
        return isFavorite && matchWorkspace;
      })
      .sort((a, b) => {
        const orderA = a.favoriteOrder ?? a.order ?? a.createdAt;
        const orderB = b.favoriteOrder ?? b.order ?? b.createdAt;
        if (orderA !== orderB) return orderA - orderB;
        return a.id.localeCompare(b.id);
      });
  },

  getPinnedPages: () => {
    const pages = get().pages;
    return Object.values(pages)
      .filter((p) => !p.trashedAt && p.isPinned)
      .sort((a, b) => {
        const pinA = a.pinnedAt ?? 0;
        const pinB = b.pinnedAt ?? 0;
        if (pinA !== pinB) return pinB - pinA;
        return b.updatedAt - a.updatedAt;
      });
  },

  removePagesByWorkspaceId: (workspaceId, options) => {
    const snapshotPages = get().pages;
    const removedIds = Object.values(snapshotPages)
      .filter((page) => page.workspaceId === workspaceId)
      .map((page) => page.id);

    set((state) => {
      const newPages = { ...state.pages };
      Object.values(state.pages).forEach((page) => {
        if (page.workspaceId === workspaceId) {
          delete newPages[page.id];
        }
      });

      const activePage = state.activePageId
        ? state.pages[state.activePageId]
        : null;
      const nextActivePageId =
        activePage?.workspaceId === workspaceId ? null : state.activePageId;

      return {
        pages: newPages,
        activePageId: nextActivePageId,
      };
    });

    if (options?.purgePersistence) {
      removePersistedPageSnapshots(snapshotPages, removedIds);
    }
  },

  loadLocalFolderPages: (notebookId, basePath, options) =>
    loadLocalFolderPagesAction(set, get, notebookId, basePath, options),

  reloadLocalPageFromDisk: (pageId) =>
    reloadLocalPageFromDiskAction(set, get, pageId),

  removeSingleLocalPage: (filePath) =>
    removeSingleLocalPageAction(set, get, filePath),

  addSingleLocalPage: (notebookId, basePath, filePath) =>
    addSingleLocalPageAction(set, get, notebookId, basePath, filePath),

  loadAllLocalFolderPages: () => loadAllLocalFolderPagesAction(set, get),

  saveLocalPageContent: (
    pageId: string,
    content: JSONContent,
    options?: { force?: boolean },
  ) => saveLocalPageContentAction(set, get, pageId, content, options),

  flushPendingLocalSaves: () => flushPendingLocalSavesAction(set, get),

  flushPendingLocalSaveByPageId: (pageId) =>
    flushPendingLocalSaveByPageIdAction(set, get, pageId),

  isLocalPageDirty: (pageId) => isLocalPageDirtyAction(get, pageId),

  saveDirtyLocalPage: (pageId) => saveDirtyLocalPageAction(set, get, pageId),

  renameLocalPageFile: (pageId, newBaseName) =>
    renameLocalPageFileAction(set, get, pageId, newBaseName),

  moveLocalPage: (pageId, targetFolderId) =>
    moveLocalPageAction(set, get, pageId, targetFolderId),

  getLocalFilePath: (pageId) => {
    const page = get().pages[pageId];
    return page?.localFilePath || null;
  },

  writePageContent: (pageId, content, mode) =>
    writePageContentAction(set, get, pageId, content, mode),

  appendPageContent: (pageId, content) =>
    appendPageContentAction(set, get, pageId, content),

  replaceBlockRange: (pageId, startBlockId, endBlockId, newBlocks) =>
    replaceBlockRangeAction(
      set,
      get,
      pageId,
      startBlockId,
      endBlockId,
      newBlocks,
    ),
}));

const setupImageStorageResolver = async () => {
  const { imageStorage } = await import("@/lib/imageStorage");
  imageStorage.setLocalFolderAccessResolver(() => {
    const activePageId = usePages.getState().activePageId;
    if (!activePageId) return null;

    const page = usePages.getState().pages[activePageId];
    if (!page) return null;

    const notebook = useNotebooks.getState().notebooks[page.workspaceId];
    return notebook?.source === "local-folder"
      ? (page.localFilePath ?? null)
      : null;
  });
};

void setupImageStorageResolver();

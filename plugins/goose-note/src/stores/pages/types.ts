import type { Page, JSONContent } from "@/types";

export const LOCAL_SAVE_DEBOUNCE_MS = 180;
export const LOCAL_SAVE_MAX_WAIT_MS = 1000;

export const LEGACY_TITLE_CHILDREN_REPAIR_MARK_KEY =
  "goose-note:content-repair:title-children:v1";
export const NESTED_EMPTY_WRAPPER_REPAIR_MARK_KEY =
  "goose-note:content-repair:nested-empty-wrapper:v1";

export const LOCAL_PAGE_META_UPDATE_KEYS: Array<keyof Page> = [
  "isFavorite",
  "favoriteOrder",
  "icon",
  "isPinned",
  "pinnedAt",
];

export type LocalPageMetadata = {
  isFavorite?: boolean;
  favoriteOrder?: number;
  icon?: string;
  isPinned?: boolean;
  pinnedAt?: number;
};

export interface PagesState {
  pages: Record<string, Page>;
  activePageId: string | null;
  pendingNavigatePageId: string | null;
  expandPageId: string | null;
  searchHighlightQuery: string | null;
  searchHighlightPageId: string | null;
  searchHighlightNonce: number;
  handledSearchHighlightNonce: number;
  hydrated: boolean;
  lastSavedAt: number | null;
  onboardingCompleted: boolean;
  dirtyLocalPageIds: Record<string, boolean>;
  hydrateFromStorage: () => Promise<void>;

  /**
   * 从 db 重读单页覆盖内存（跨窗同步用）。仅当 db 版本的 updatedAt 比内存新才覆盖，
   * 避免回退本进程未落盘的较新编辑。返回是否实际更新。
   */
  reloadPageFromStorage: (pageId: string) => boolean;

  createOnboardingPages: () => void;
  createPage: (parentId?: string, workspaceId?: string, id?: string) => string;
  createPageRecord: (
    options: {
      workspaceId: string;
      parentId?: string;
      id?: string;
    } & Partial<Page>,
  ) => string;
  updatePage: (
    id: string,
    updates: Partial<Page>,
    options?: { silent?: boolean },
  ) => void;
  deletePage: (
    id: string,
    options?: { trashBatchId?: string },
  ) => Promise<boolean>;
  restorePage: (id: string) => {
    ok: boolean;
    pageTitle?: string;
    notebookName?: string;
    parentTitles?: string[];
    restoredCount?: number;
    itemLabel?: string;
  };
  duplicatePage: (id: string) => string;
  permanentlyDeletePage: (id: string) => Promise<void>;
  reorderPages: (ids: string[], parentId: string | undefined) => void;
  reorderFavorites: (ids: string[]) => void;
  movePageTreeToNotebook: (
    pageId: string,
    targetNotebookId: string,
  ) => {
    ok: boolean;
    movedCount: number;
    sourceNotebookId?: string;
    targetNotebookId?: string;
    reason?: string;
    undoSnapshots?: Array<{
      id: string;
      workspaceId: string;
      parentId?: string;
      order?: number;
    }>;
    prevActivePageId?: string | null;
  };
  undoMovePageTree: (
    undoSnapshots:
      | Array<{
          id: string;
          workspaceId: string;
          parentId?: string;
          order?: number;
        }>
      | undefined,
    sourceNotebookId: string | undefined,
    prevActivePageId: string | null | undefined,
  ) => boolean;
  setActivePage: (id: string | null) => void;
  setPendingNavigatePageId: (id: string | null) => void;
  setExpandPageId: (id: string | null) => void;
  setSearchHighlightQuery: (query: string | null) => void;
  setSearchHighlightPageId: (id: string | null) => void;
  setSearchHighlightNonce: (nonce: number) => void;
  setHandledSearchHighlightNonce: (nonce: number) => void;
  setHydrated: (hydrated: boolean) => void;
  setLastSavedAt: (timestamp: number | null) => void;
  getAncestorIds: (pageId: string) => string[];

  getPage: (id: string) => Page | undefined;
  getChildren: (parentId?: string, workspaceId?: string) => Page[];
  getTrashedPages: (workspaceId?: string) => Page[];
  getFavorites: (workspaceId?: string) => Page[];
  getPinnedPages: () => Page[];
  removePagesByWorkspaceId: (
    workspaceId: string,
    options?: { purgePersistence?: boolean },
  ) => void;

  loadLocalFolderPages: (
    notebookId: string,
    basePath: string,
    options?: { showWelcome?: boolean },
  ) => Promise<void>;
  reloadLocalPageFromDisk: (pageId: string) => Promise<void>;
  removeSingleLocalPage: (filePath: string) => void;
  addSingleLocalPage: (
    notebookId: string,
    basePath: string,
    filePath: string,
  ) => Promise<void>;
  // 预加载所有尚未加载的 local-folder 记事本页面（供「所有记事本」全局搜索覆盖全量）。
  loadAllLocalFolderPages: () => Promise<void>;
  saveLocalPageContent: (
    pageId: string,
    content: JSONContent,
    options?: { force?: boolean },
  ) => Promise<boolean>;
  flushPendingLocalSaves: () => Promise<void>;
  flushPendingLocalSaveByPageId: (pageId: string) => Promise<void>;
  isLocalPageDirty: (pageId: string) => boolean;
  saveDirtyLocalPage: (pageId: string) => Promise<boolean>;
  /**
   * 显式重命名 local-folder 页面文件（由虚拟标题编辑入口触发）。
   * @param newBaseName 新文件名（不含扩展名）
   * @returns 新 pageId（文件名不变则返回原 pageId）
   */
  renameLocalPageFile: (pageId: string, newBaseName: string) => Promise<string>;
  /**
   * 移动 local-folder 页面（文件或目录）到目标父目录。
   * targetFolderId 为 undefined 表示移到根目录。
   */
  moveLocalPage: (
    pageId: string,
    targetFolderId: string | undefined,
  ) => Promise<void>;
  getLocalFilePath: (pageId: string) => string | null;
  createLocalPage: (
    parentId?: string,
    workspaceId?: string,
  ) => Promise<string | null> | string | null;
  createLocalPageRecord: (options: {
    workspaceId: string;
    parentId?: string;
    title?: string;
    content?: JSONContent;
  }) => Promise<string | null>;
  createLocalFolderRecord: (options: {
    workspaceId: string;
    parentId?: string;
    title?: string;
  }) => Promise<string | null>;
  writePageContent: (
    pageId: string,
    content: JSONContent,
    mode?: "replace",
  ) => Promise<boolean>;
  appendPageContent: (pageId: string, content: JSONContent) => Promise<boolean>;
  replaceBlockRange: (
    pageId: string,
    startBlockId: string,
    endBlockId: string,
    newBlocks: JSONContent,
  ) => Promise<boolean>;
}

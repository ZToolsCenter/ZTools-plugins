import type { Page } from "@/types";
import {
  readDbStorageJSON,
  removeDbStorageItem,
  writeDbStorageJSON,
} from "./utoolsDbStorage";
import { UToolsAdapter } from "../utools";

export const PAGE_DOC_PREFIX = "gn:page:";
export const LOCAL_PAGE_META_DOC_PREFIX = "gn:local-meta:";
export const PAGES_META_STORAGE_KEY = "goose-note-pages-meta";

const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type LocalPageMetaFields = Pick<
  Page,
  | "isFavorite"
  | "favoriteOrder"
  | "icon"
  | "isPinned"
  | "pinnedAt"
>;

export type PersistedPageDoc = Page;

export interface PersistedLocalPageMetaDoc extends LocalPageMetaFields {
  pageId: string;
  workspaceId: string;
  updatedAt: number;
}

export interface PersistedPagesMetaState {
  onboardingCompleted: boolean;
}

export interface HydratedPagesPayload {
  pages: Record<string, Page>;
  localPageMetas: Record<string, PersistedLocalPageMetaDoc>;
  onboardingCompleted: boolean;
}

const getPageDocId = (pageId: string) => `${PAGE_DOC_PREFIX}${pageId}`;
const getLocalPageMetaDocId = (pageId: string) => `${LOCAL_PAGE_META_DOC_PREFIX}${pageId}`;

const clonePage = <T>(value: T): T => structuredClone(value) as T;

const putDocWithRetry = <T>(id: string, data: T): boolean => {
  const current = UToolsAdapter.db.get<T>(id);
  let result = UToolsAdapter.db.put(id, data, current?._rev);
  if (result.ok !== false) return true;

  const latest = UToolsAdapter.db.get<T>(id);
  result = UToolsAdapter.db.put(id, data, latest?._rev);
  if (result.ok === false) {
    console.error("[pageRepository] db.put failed", id, result.error);
    return false;
  }
  return true;
};

const removeDoc = (id: string): void => {
  const current = UToolsAdapter.db.get(id);
  if (!current) return;
  const result = UToolsAdapter.db.remove(id);
  if (result.ok === false) {
    console.error("[pageRepository] db.remove failed", id, result.error);
  }
};

const normalizeLocalPageMeta = (
  pageId: string,
  workspaceId: string,
  fields: LocalPageMetaFields,
  updatedAt: number,
): PersistedLocalPageMetaDoc | null => {
  const doc: PersistedLocalPageMetaDoc = {
    pageId,
    workspaceId,
    updatedAt,
  };

  if (fields.isFavorite) {
    doc.isFavorite = true;
  }
  if (typeof fields.favoriteOrder === "number") {
    doc.favoriteOrder = fields.favoriteOrder;
  }
  if (typeof fields.icon === "string" && fields.icon.trim()) {
    doc.icon = fields.icon;
  }
  if (fields.isPinned) {
    doc.isPinned = true;
  }
  if (typeof fields.pinnedAt === "number") {
    doc.pinnedAt = fields.pinnedAt;
  }
  const hasMeta =
    doc.isFavorite === true ||
    typeof doc.favoriteOrder === "number" ||
    typeof doc.icon === "string" ||
    doc.isPinned === true ||
    typeof doc.pinnedAt === "number";

  return hasMeta ? doc : null;
};

const cleanupExpiredPages = (pages: Record<string, Page>): Record<string, Page> => {
  const now = Date.now();
  const nextPages = { ...pages };

  Object.values(pages).forEach((page) => {
    if (!page.trashedAt) return;
    if (now - page.trashedAt <= TRASH_RETENTION_MS) return;

    delete nextPages[page.id];
    removeDoc(getPageDocId(page.id));
  });

  return nextPages;
};

export const saveInternalPage = (page: Page): boolean => {
  return putDocWithRetry(getPageDocId(page.id), clonePage(page));
};

/** 从 db 读取单条内部页快照（跨窗同步用：另一窗写盘后重读最新）。 */
export const loadInternalPage = (pageId: string): Page | null => {
  const doc = UToolsAdapter.db.get<PersistedPageDoc>(getPageDocId(pageId));
  if (!doc?.data) return null;
  const { isFullWidth: _legacyFullWidth, ...page } = clonePage(
    doc.data as PersistedPageDoc & { isFullWidth?: boolean },
  );
  return page;
};

export const removeInternalPage = (pageId: string): void => {
  removeDoc(getPageDocId(pageId));
};

export const saveLocalPageMeta = (
  page: Pick<Page, "id" | "workspaceId" | "updatedAt"> & LocalPageMetaFields,
): boolean => {
  const doc = normalizeLocalPageMeta(page.id, page.workspaceId, page, page.updatedAt);
  if (!doc) {
    removeLocalPageMeta(page.id);
    return true;
  }

  return putDocWithRetry(getLocalPageMetaDocId(page.id), doc);
};

export const removeLocalPageMeta = (pageId: string): void => {
  removeDoc(getLocalPageMetaDocId(pageId));
};

export const removeLocalPageMetaByWorkspaceId = (workspaceId: string): void => {
  const docs = UToolsAdapter.db.allDocs<PersistedLocalPageMetaDoc>(
    LOCAL_PAGE_META_DOC_PREFIX,
  );
  docs.forEach((doc) => {
    if (doc.data.workspaceId === workspaceId) {
      removeDoc(doc._id);
    }
  });
};

export const loadPagesFromStorage = (): HydratedPagesPayload => {
  const pageDocs = UToolsAdapter.db.allDocs<PersistedPageDoc>(PAGE_DOC_PREFIX);
  const localMetaDocs = UToolsAdapter.db.allDocs<PersistedLocalPageMetaDoc>(
    LOCAL_PAGE_META_DOC_PREFIX,
  );

  const pages = cleanupExpiredPages(
    Object.fromEntries(
      pageDocs.map((doc) => {
        const pageId = doc._id.slice(PAGE_DOC_PREFIX.length);
        const { isFullWidth: _legacyFullWidth, ...page } = clonePage(
          doc.data as PersistedPageDoc & { isFullWidth?: boolean },
        );
        return [pageId, page];
      }),
    ),
  );

  const localPageMetas = Object.fromEntries(
    localMetaDocs.map((doc) => {
      const pageId = doc._id.slice(LOCAL_PAGE_META_DOC_PREFIX.length);
      const { isFullWidth: _legacyFullWidth, ...metadata } = clonePage(
        doc.data as PersistedLocalPageMetaDoc & { isFullWidth?: boolean },
      );
      return [pageId, metadata];
    }),
  );

  const meta = readDbStorageJSON<PersistedPagesMetaState>(
    PAGES_META_STORAGE_KEY,
    { onboardingCompleted: false },
  );

  return {
    pages,
    localPageMetas,
    onboardingCompleted: Boolean(meta.onboardingCompleted),
  };
};

export const savePagesMeta = (meta: PersistedPagesMetaState): boolean => {
  return writeDbStorageJSON(PAGES_META_STORAGE_KEY, meta);
};

export const removePagesMeta = (): void => {
  removeDbStorageItem(PAGES_META_STORAGE_KEY);
};

export const clearPersistedInternalPages = (): void => {
  UToolsAdapter.db.allDocs(PAGE_DOC_PREFIX).forEach((doc) => removeDoc(doc._id));
  removePagesMeta();
};

export const clearPersistedPages = (): void => {
  clearPersistedInternalPages();
  UToolsAdapter.db
    .allDocs(LOCAL_PAGE_META_DOC_PREFIX)
    .forEach((doc) => removeDoc(doc._id));
};

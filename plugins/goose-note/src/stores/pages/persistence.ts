import type { Page } from "@/types";
import { useNotebooks } from "../useNotebooks";
import type { PersistedLocalPageMetaDoc } from "@/lib/storage/pageRepository";
import {
  removeInternalPage,
  removeLocalPageMeta,
  saveInternalPage,
  saveLocalPageMeta,
} from "@/lib/storage/pageRepository";
import type { LocalPageMetadata } from "./types";
import { LOCAL_PAGE_META_UPDATE_KEYS } from "./types";

export const localPageMetadataCache = new Map<string, LocalPageMetadata>();

export const buildLocalPageMetadata = (
  source: Partial<Page> | PersistedLocalPageMetaDoc,
): LocalPageMetadata | null => {
  const metadata: LocalPageMetadata = {};

  if (source.isFavorite) {
    metadata.isFavorite = true;
  }
  if (typeof source.favoriteOrder === "number") {
    metadata.favoriteOrder = source.favoriteOrder;
  }
  if (typeof source.icon === "string" && source.icon.trim()) {
    metadata.icon = source.icon;
  }
  if (source.isPinned) {
    metadata.isPinned = true;
  }
  if (typeof source.pinnedAt === "number") {
    metadata.pinnedAt = source.pinnedAt;
  }
  return Object.keys(metadata).length > 0 ? metadata : null;
};

export const syncLocalPageMetadataCache = (
  pageId: string,
  source: Partial<Page> | PersistedLocalPageMetaDoc | null,
) => {
  const metadata = source ? buildLocalPageMetadata(source) : null;
  if (!metadata) {
    localPageMetadataCache.delete(pageId);
    return;
  }
  localPageMetadataCache.set(pageId, metadata);
};

export const seedLocalPageMetadataCache = (
  localPageMetas: Record<string, PersistedLocalPageMetaDoc>,
) => {
  localPageMetadataCache.clear();
  Object.entries(localPageMetas).forEach(([pageId, metadata]) => {
    syncLocalPageMetadataCache(pageId, metadata);
  });
};

export const isLocalFolderPage = (page: Page | undefined): boolean => {
  if (!page) return false;
  if (page.localFilePath) return true;
  const notebook = useNotebooks.getState().notebooks[page.workspaceId];
  return notebook?.source === "local-folder";
};

export const persistPageSnapshot = (page: Page | undefined): boolean => {
  if (!page) return false;

  if (isLocalFolderPage(page)) {
    syncLocalPageMetadataCache(page.id, page);
    return saveLocalPageMeta({
      id: page.id,
      workspaceId: page.workspaceId,
      updatedAt: page.updatedAt,
      isFavorite: page.isFavorite,
      favoriteOrder: page.favoriteOrder,
      icon: page.icon,
      isPinned: page.isPinned,
      pinnedAt: page.pinnedAt,
    });
  }

  return saveInternalPage(page);
};

export const persistPageSnapshots = (
  pages: Record<string, Page>,
  pageIds: Iterable<string>,
): boolean => {
  let ok = true;
  for (const pageId of pageIds) {
    ok = persistPageSnapshot(pages[pageId]) && ok;
  }
  return ok;
};

export const removePersistedPageSnapshot = (page: Page | undefined, pageId?: string) => {
  const targetPageId = page?.id ?? pageId;
  if (!targetPageId) return;

  if (isLocalFolderPage(page)) {
    syncLocalPageMetadataCache(targetPageId, null);
    removeLocalPageMeta(targetPageId);
    return;
  }

  removeInternalPage(targetPageId);
};

export const removePersistedPageSnapshots = (
  pages: Record<string, Page>,
  pageIds: Iterable<string>,
) => {
  for (const pageId of pageIds) {
    removePersistedPageSnapshot(pages[pageId], pageId);
  }
};

export const shouldPersistLocalPageMetaUpdate = (updates: Partial<Page>) => {
  return LOCAL_PAGE_META_UPDATE_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(updates, key),
  );
};

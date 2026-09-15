import {
  loadPagesFromStorage,
  saveInternalPage,
} from "@/lib/storage/pageRepository";
import { getDbStorageItem, setDbStorageItem } from "@/lib/storage/utoolsDbStorage";

import type { PagesState } from "../types";
import {
  LEGACY_TITLE_CHILDREN_REPAIR_MARK_KEY,
  NESTED_EMPTY_WRAPPER_REPAIR_MARK_KEY,
} from "../types";
import { isLocalFolderPage, seedLocalPageMetadataCache } from "../persistence";
import {
  acknowledgeRecoveryEntry,
  canApplyRecoveryEntry,
  listRecoveryEntries,
} from "@/lib/storage/recoveryJournal";
import { toast } from "@/components/ui/sonner";
import { getContentSignature } from "@/components/editor/utils/blocknote-content";
import {
  repairLegacyTitleChildrenInPages,
  repairNormalizedContentInPages,
} from "../migrations";

export type StoreSet = (
  fn: Partial<PagesState> | ((state: PagesState) => Partial<PagesState>),
) => void;
export type StoreGet = () => PagesState;

export const hydrateFromStorageAction = async (set: StoreSet) => {
  const { pages, localPageMetas, onboardingCompleted } =
    loadPagesFromStorage();
  const hasRepairedLegacyTitleChildren =
    getDbStorageItem(LEGACY_TITLE_CHILDREN_REPAIR_MARK_KEY) === "1";
  const { pages: repairedPages, repairedPageIds } = hasRepairedLegacyTitleChildren
    ? { pages, repairedPageIds: [] as string[] }
    : repairLegacyTitleChildrenInPages(pages);
  const hasRepairedNestedEmptyWrappers =
    getDbStorageItem(NESTED_EMPTY_WRAPPER_REPAIR_MARK_KEY) === "1";
  const {
    pages: contentRepairedPages,
    repairedPageIds: contentRepairedPageIds,
  } = hasRepairedNestedEmptyWrappers
    ? { pages: repairedPages, repairedPageIds: [] as string[] }
    : repairNormalizedContentInPages(repairedPages);

  if (!hasRepairedLegacyTitleChildren) {
    if (repairedPageIds.length > 0) {
      repairedPageIds.forEach((pageId) => {
        const repairedPage = contentRepairedPages[pageId];
        if (!repairedPage || repairedPage.localFilePath) return;
        saveInternalPage(repairedPage);
      });
      console.info(
        `[usePages] repaired legacy title-children structure in ${repairedPageIds.length} page(s).`,
      );
    }
    setDbStorageItem(LEGACY_TITLE_CHILDREN_REPAIR_MARK_KEY, "1");
  }

  if (!hasRepairedNestedEmptyWrappers) {
    if (contentRepairedPageIds.length > 0) {
      contentRepairedPageIds.forEach((pageId) => {
        const repairedPage = contentRepairedPages[pageId];
        if (!repairedPage || isLocalFolderPage(repairedPage)) return;
        saveInternalPage(repairedPage);
      });
      console.info(
        `[usePages] repaired nested empty wrapper content in ${contentRepairedPageIds.length} page(s).`,
      );
    }
    setDbStorageItem(NESTED_EMPTY_WRAPPER_REPAIR_MARK_KEY, "1");
  }

  const recoveredPages = { ...contentRepairedPages };
  let recoveredCount = 0;
  let conflictCount = 0;
  for (const entry of listRecoveryEntries("internal-page")) {
    const current = recoveredPages[entry.id];
    if (!current) continue;
    if (
      getContentSignature(current.content) === getContentSignature(entry.content)
    ) {
      acknowledgeRecoveryEntry("internal-page", entry.id, entry.revision);
      continue;
    }
    if (!canApplyRecoveryEntry(entry, current.content, current.updatedAt)) {
      conflictCount += 1;
      continue;
    }
    recoveredPages[entry.id] = {
      ...current,
      content: entry.content ?? [],
      updatedAt: Math.max(current.updatedAt, entry.updatedAt),
    };
    recoveredCount += 1;
  }

  seedLocalPageMetadataCache(localPageMetas);
  set({
    pages: recoveredPages,
    activePageId: null,
    pendingNavigatePageId: null,
    expandPageId: null,
    searchHighlightQuery: null,
    searchHighlightPageId: null,
    searchHighlightNonce: 0,
    handledSearchHighlightNonce: 0,
    hydrated: true,
    lastSavedAt: null,
    onboardingCompleted,
  });
  if (recoveredCount > 0) {
    toast.warning(`已恢复 ${recoveredCount} 篇未完成保存的笔记`, {
      id: "goose-recovered-internal-pages",
      description: "内容已放回编辑区，请确认后继续编辑或保存。",
    });
  }
  if (conflictCount > 0) {
    toast.warning("发现未自动覆盖的恢复稿", {
      id: "goose-recovery-conflicts",
      description: "主存储中有更新版本，恢复稿仍被保留。",
    });
  }
};

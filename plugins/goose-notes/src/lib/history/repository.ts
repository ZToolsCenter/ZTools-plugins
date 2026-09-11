import { UToolsAdapter } from "@/lib/utools";
import type { HistoryIndex, HistoryVersion } from "./types";
import { normalizeHistoryIndex, normalizeHistoryVersion } from "./guards";

const VERSION_PREFIX = "gn:hist:";
const INDEX_PREFIX = "gn:hist-idx:";

const versionKey = (pageId: string, versionId: string) =>
  `${VERSION_PREFIX}${pageId}:${versionId}`;
const indexKey = (pageId: string) => `${INDEX_PREFIX}${pageId}`;

export const historyRepository = {
  loadIndex(pageId: string): HistoryIndex {
    const doc = UToolsAdapter.db.get<HistoryIndex>(indexKey(pageId));
    return normalizeHistoryIndex(doc?.data, pageId);
  },

  saveIndex(index: HistoryIndex): void {
    const key = indexKey(index.pageId);
    const existing = UToolsAdapter.db.get<HistoryIndex>(key);
    UToolsAdapter.db.put(key, index, existing?._rev);
  },

  loadVersion(pageId: string, versionId: string): HistoryVersion | null {
    const doc = UToolsAdapter.db.get<HistoryVersion>(versionKey(pageId, versionId));
    return normalizeHistoryVersion(doc?.data, pageId, versionId);
  },

  saveVersion(version: HistoryVersion): void {
    const key = versionKey(version.pageId, version.versionId);
    const existing = UToolsAdapter.db.get<HistoryVersion>(key);
    UToolsAdapter.db.put(key, version, existing?._rev);
  },

  removeVersion(pageId: string, versionId: string): void {
    UToolsAdapter.db.remove(versionKey(pageId, versionId));
  },

  /** 级联删除某个 page 的所有历史 */
  dropAll(pageId: string): void {
    const versions = UToolsAdapter.db.allDocs<HistoryVersion>(
      `${VERSION_PREFIX}${pageId}:`,
    );
    versions.forEach((doc) => UToolsAdapter.db.remove(doc._id));
    UToolsAdapter.db.remove(indexKey(pageId));
  },

  /** 清理内部页面历史；本地文件夹的 .goose/history 不在该数据库中，不受影响。 */
  clearAll(): void {
    UToolsAdapter.db
      .allDocs<HistoryVersion>(VERSION_PREFIX)
      .forEach((doc) => UToolsAdapter.db.remove(doc._id));
    UToolsAdapter.db
      .allDocs<HistoryIndex>(INDEX_PREFIX)
      .forEach((doc) => UToolsAdapter.db.remove(doc._id));
  },
};

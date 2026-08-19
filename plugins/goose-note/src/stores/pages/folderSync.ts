import type { JSONContent } from "@/types";
import type { PagesState } from "./types";
import { LOCAL_SAVE_DEBOUNCE_MS, LOCAL_SAVE_MAX_WAIT_MS } from "./types";
import {
  acknowledgeRecoveryEntry,
  moveRecoveryEntry,
} from "@/lib/storage/recoveryJournal";

export const localSaveDebounceTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();
export const localSaveMaxWaitTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();
export const pendingLocalSaveContents = new Map<string, JSONContent>();
export const pendingLocalSaveRevisions = new Map<string, number>();
export const localSaveWriteChains = new Map<string, Promise<void>>();
const discardedPendingLocalSavePageIds = new Set<string>();
const localPageFileOperationTails = new Map<string, Promise<void>>();

/**
 * 同一页面的正文写盘与文件重命名必须串行：调用方取得锁后再读取 localFilePath。
 * 这样 rename 会等待已在途的直接保存，后续保存也会等路径切换完成。
 */
export const acquireLocalPageFileOperation = async (
  pageId: string,
): Promise<() => void> => {
  const previous = localPageFileOperationTails.get(pageId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  localPageFileOperationTails.set(pageId, current);
  await previous;
  return () => {
    if (localPageFileOperationTails.get(pageId) === current) {
      localPageFileOperationTails.delete(pageId);
    }
    release();
  };
};

export const cloneJSONContent = (content: JSONContent): JSONContent => {
  try {
    return structuredClone(content) as JSONContent;
  } catch {
    return JSON.parse(JSON.stringify(content)) as JSONContent;
  }
};

export const clearLocalSaveTimers = (pageId: string) => {
  const debounceTimer = localSaveDebounceTimers.get(pageId);
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    localSaveDebounceTimers.delete(pageId);
  }

  const maxWaitTimer = localSaveMaxWaitTimers.get(pageId);
  if (maxWaitTimer) {
    clearTimeout(maxWaitTimer);
    localSaveMaxWaitTimers.delete(pageId);
  }
};

/**
 * 用户明确接受磁盘版本时，丢弃该页尚未落盘的本地内容。
 * 标记会阻止当前在途保存失败后把旧快照重新放回 pending。
 */
export const discardPendingLocalSave = (pageId: string) => {
  clearLocalSaveTimers(pageId);
  pendingLocalSaveContents.delete(pageId);
  const recoveryRevision = pendingLocalSaveRevisions.get(pageId);
  if (typeof recoveryRevision === "number") {
    const acknowledged = acknowledgeRecoveryEntry(
      "local-file",
      pageId,
      recoveryRevision,
    );
    if (acknowledged) pendingLocalSaveRevisions.delete(pageId);
  } else {
    pendingLocalSaveRevisions.delete(pageId);
  }
  const activeWrite = localSaveWriteChains.get(pageId);
  if (!activeWrite) {
    discardedPendingLocalSavePageIds.delete(pageId);
    return;
  }

  discardedPendingLocalSavePageIds.add(pageId);
  void activeWrite
    .finally(() => discardedPendingLocalSavePageIds.delete(pageId))
    .catch(() => {
      // 原写入链的失败由其调用方处理；这里只负责清理 discard 标记。
    });
};

/** 启动恢复只放回内存 pending，不自动写盘；必须由后续编辑或显式保存确认。 */
export const restorePendingLocalSave = (
  pageId: string,
  content: JSONContent,
  recoveryRevision: number,
): void => {
  pendingLocalSaveContents.set(pageId, cloneJSONContent(content));
  pendingLocalSaveRevisions.set(pageId, recoveryRevision);
};

export const flushPendingLocalSaveByPageIdInternal = (
  pageId: string,
  getState: () => PagesState,
) => {
  clearLocalSaveTimers(pageId);
  const chain = localSaveWriteChains.get(pageId) ?? Promise.resolve();
  const next = chain
    .catch(() => {})
    .then(async () => {
      while (pendingLocalSaveContents.has(pageId)) {
        const latestContent = pendingLocalSaveContents.get(pageId);
        if (!latestContent) {
          pendingLocalSaveContents.delete(pageId);
          continue;
        }
        const savingRevision = pendingLocalSaveRevisions.get(pageId);
        pendingLocalSaveContents.delete(pageId);
        try {
          const saved = await getState().saveLocalPageContent(
            pageId,
            cloneJSONContent(latestContent),
          );
          if (!saved) {
            throw new Error(`本地页面保存未完成：${pageId}`);
          }
          if (typeof savingRevision === "number") {
            const acknowledged = acknowledgeRecoveryEntry(
              "local-file",
              pageId,
              savingRevision,
            );
            if (
              acknowledged &&
              pendingLocalSaveRevisions.get(pageId) === savingRevision
            ) {
              pendingLocalSaveRevisions.delete(pageId);
            }
          }
        } catch (err) {
          // save 抛错或明确返回 false：保留待写内容，让显式 flush 感知失败，
          // 并等待用户解决冲突或下一次编辑/flush 后重试。
          // 写盘期间若已有更新内容进入队列，必须保留更新版本，不能用旧快照覆盖。
          if (
            !discardedPendingLocalSavePageIds.has(pageId) &&
            !pendingLocalSaveContents.has(pageId)
          ) {
            pendingLocalSaveContents.set(pageId, latestContent);
          }
          throw err;
        }
      }
      const pendingRevision = pendingLocalSaveRevisions.get(pageId);
      if (typeof pendingRevision === "number") {
        const acknowledged = acknowledgeRecoveryEntry(
          "local-file",
          pageId,
          pendingRevision,
        );
        if (!acknowledged) {
          throw new Error(`本地页面恢复日志确认未完成：${pageId}`);
        }
        pendingLocalSaveRevisions.delete(pageId);
      }
    });

  const finalized = next.finally(() => {
    if (localSaveWriteChains.get(pageId) === finalized) {
      localSaveWriteChains.delete(pageId);
    }
  });

  localSaveWriteChains.set(pageId, finalized);
  return finalized;
};

export const queueLocalPageSave = (
  pageId: string,
  content: JSONContent,
  getState: () => PagesState,
  recoveryRevision?: number,
) => {
  // discard 只针对用户明确放弃的旧快照；后续真实编辑应恢复正常自动保存。
  discardedPendingLocalSavePageIds.delete(pageId);
  pendingLocalSaveContents.set(pageId, content);
  if (typeof recoveryRevision === "number") {
    pendingLocalSaveRevisions.set(pageId, recoveryRevision);
  }

  const runScheduledFlush = () => {
    void flushPendingLocalSaveByPageIdInternal(pageId, getState).catch(
      (error) => {
        // 自动保存失败已保留在 pending 队列；这里消费拒绝，避免定时器产生
        // unhandledrejection。冲突提示由 saveLocalPageContent 的现有事件链负责。
        console.error("[local-folder] scheduled save failed", pageId, error);
      },
    );
  };

  const existingDebounceTimer = localSaveDebounceTimers.get(pageId);
  if (existingDebounceTimer) {
    clearTimeout(existingDebounceTimer);
  }

  const debounceTimer = setTimeout(() => {
    runScheduledFlush();
  }, LOCAL_SAVE_DEBOUNCE_MS);
  localSaveDebounceTimers.set(pageId, debounceTimer);

  if (!localSaveMaxWaitTimers.has(pageId)) {
    const maxWaitTimer = setTimeout(() => {
      runScheduledFlush();
    }, LOCAL_SAVE_MAX_WAIT_MS);
    localSaveMaxWaitTimers.set(pageId, maxWaitTimer);
  }
};

/**
 * 页面 id 重建（文件 rename）时迁移防抖保存队列：
 * 把挂在旧 id 上的待写内容与计时器迁到新 id，避免计时器到期后按旧 id
 * 查不到页面导致内容丢失、脏标记永远清不掉。
 */
export const migratePendingLocalSave = (
  oldPageId: string,
  newPageId: string,
  getState: () => PagesState,
): { ok: true } | { ok: false; error: string } => {
  if (oldPageId === newPageId) return { ok: true };
  const pending = pendingLocalSaveContents.get(oldPageId);
  const recoveryRevision = pendingLocalSaveRevisions.get(oldPageId);
  if (!pending && typeof recoveryRevision !== "number") return { ok: true };

  const moved = moveRecoveryEntry("local-file", oldPageId, newPageId);
  if (!moved.ok) return moved;

  clearLocalSaveTimers(oldPageId);
  pendingLocalSaveContents.delete(oldPageId);
  pendingLocalSaveRevisions.delete(oldPageId);
  if (pending) {
    queueLocalPageSave(
      newPageId,
      pending,
      getState,
      moved.entry?.revision ?? recoveryRevision,
    );
  } else if (moved.entry) {
    pendingLocalSaveRevisions.set(newPageId, moved.entry.revision);
  }
  return { ok: true };
};

export const flushAllPendingLocalSavesInternal = async (
  getState: () => PagesState,
) => {
  const pageIds = new Set<string>([
    ...pendingLocalSaveContents.keys(),
    ...localSaveDebounceTimers.keys(),
    ...localSaveMaxWaitTimers.keys(),
    ...localSaveWriteChains.keys(),
    ...pendingLocalSaveRevisions.keys(),
  ]);

  await Promise.all(
    Array.from(pageIds).map((pageId) =>
      flushPendingLocalSaveByPageIdInternal(pageId, getState),
    ),
  );
};

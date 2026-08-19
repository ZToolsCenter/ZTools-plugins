import type { JSONContent } from "@/types";
import { getContentSignature } from "@/components/editor/utils/blocknote-content";
import { UToolsAdapter } from "@/lib/utools";
import {
  getDbStorageItem,
  removeDbStorageItem,
} from "./utoolsDbStorage";

export type RecoverySource = "internal-page" | "local-file" | "quicknote";

export interface RecoveryJournalEntry {
  source: RecoverySource;
  id: string;
  content: JSONContent | null;
  revision: number;
  updatedAt: number;
  /** 首次未 ACK 编辑时的持久化基线；连续编辑期间保持不变。 */
  baseSignature?: string;
  baseUpdatedAt?: number;
}

interface LegacyRecoveryJournalState {
  version: 1;
  entries: Record<string, RecoveryJournalEntry>;
}

interface RecoveryJournalDoc {
  version: 2;
  entry?: RecoveryJournalEntry;
  /** ACK 使用同一文档 CAS 写墓碑，避免无 revision 删除误删并发新稿。 */
  acknowledgedRevision?: number;
}

export const RECOVERY_JOURNAL_STORAGE_KEY = "goose-note:recovery-journal:v1";
export const RECOVERY_JOURNAL_DOC_PREFIX = "gn:recovery:v2:";

const docId = (source: RecoverySource, id: string) =>
  `${RECOVERY_JOURNAL_DOC_PREFIX}${source}:${encodeURIComponent(id)}`;

const readLegacyEntries = (): Record<string, RecoveryJournalEntry> => {
  const raw = getDbStorageItem(RECOVERY_JOURNAL_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Partial<LegacyRecoveryJournalState>;
    return parsed.version === 1 && parsed.entries && typeof parsed.entries === "object"
      ? parsed.entries
      : {};
  } catch {
    return {};
  }
};

const putDocWithCas = (
  source: RecoverySource,
  id: string,
  build: (current: RecoveryJournalDoc | null) => RecoveryJournalDoc | null,
): RecoveryJournalDoc | null => {
  const idForDb = docId(source, id);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const currentDoc = UToolsAdapter.db.get<RecoveryJournalDoc>(idForDb);
    const next = build(currentDoc?.data ?? null);
    if (!next) return null;
    const result = UToolsAdapter.db.put(idForDb, next, currentDoc?._rev);
    if (result.ok !== false) return next;
  }
  console.error("[recovery-journal] CAS put failed", source, id);
  return null;
};

const migrateLegacyEntries = (): RecoveryJournalEntry[] => {
  const legacyEntries = Object.values(readLegacyEntries());
  if (legacyEntries.length === 0) return [];
  let allMigrated = true;
  for (const legacy of legacyEntries) {
    const existing = UToolsAdapter.db.get<RecoveryJournalDoc>(
      docId(legacy.source, legacy.id),
    )?.data?.entry;
    if (existing && existing.revision >= legacy.revision) continue;
    const migrated = putDocWithCas(legacy.source, legacy.id, (current) => {
      if (current?.entry && current.entry.revision >= legacy.revision) return current;
      return { version: 2, entry: legacy };
    });
    if (!migrated) allMigrated = false;
  }
  if (allMigrated) removeDbStorageItem(RECOVERY_JOURNAL_STORAGE_KEY);
  return legacyEntries;
};

export const listRecoveryEntries = (
  source?: RecoverySource,
): RecoveryJournalEntry[] => {
  migrateLegacyEntries();
  return UToolsAdapter.db
    .allDocs<RecoveryJournalDoc>(RECOVERY_JOURNAL_DOC_PREFIX)
    .flatMap((doc) => (doc.data.entry ? [doc.data.entry] : []))
    .filter((entry) => !source || entry.source === source);
};

export const getRecoveryEntry = (
  source: RecoverySource,
  id: string,
): RecoveryJournalEntry | null => {
  const current = UToolsAdapter.db.get<RecoveryJournalDoc>(docId(source, id));
  if (current?.data.entry) return current.data.entry;
  migrateLegacyEntries();
  return (
    UToolsAdapter.db.get<RecoveryJournalDoc>(docId(source, id))?.data.entry ?? null
  );
};

export const recordRecoveryEntry = (input: {
  source: RecoverySource;
  id: string;
  content: JSONContent | null;
  baseSignature?: string;
  baseUpdatedAt?: number;
  now?: number;
}): RecoveryJournalEntry | null => {
  migrateLegacyEntries();
  let written: RecoveryJournalEntry | null = null;
  const result = putDocWithCas(input.source, input.id, (current) => {
    const previous = current?.entry;
    const lastRevision = previous?.revision ?? current?.acknowledgedRevision ?? 0;
    written = {
      source: input.source,
      id: input.id,
      content: input.content,
      revision: lastRevision + 1,
      updatedAt: input.now ?? Date.now(),
      // WAL 未 ACK 前始终沿用首次持久化基线，不能随内存连续编辑漂移。
      ...(previous?.baseSignature || input.baseSignature
        ? { baseSignature: previous?.baseSignature ?? input.baseSignature }
        : {}),
      ...(typeof (previous?.baseUpdatedAt ?? input.baseUpdatedAt) === "number"
        ? { baseUpdatedAt: previous?.baseUpdatedAt ?? input.baseUpdatedAt }
        : {}),
    };
    return { version: 2, entry: written };
  });
  return result ? written : null;
};

/** 旧 ACK 通过文档 CAS 写墓碑；与新 record 冲突时会重读并拒绝，不能清掉新稿。 */
export const acknowledgeRecoveryEntry = (
  source: RecoverySource,
  id: string,
  revision: number,
): boolean => {
  let acknowledged = false;
  const result = putDocWithCas(source, id, (current) => {
    if (!current?.entry || current.entry.revision !== revision) return null;
    acknowledged = true;
    return { version: 2, acknowledgedRevision: revision };
  });
  return Boolean(result && acknowledged);
};

export type MoveRecoveryEntryResult =
  | { ok: true; entry: RecoveryJournalEntry | null }
  | { ok: false; error: string };

export const moveRecoveryEntry = (
  source: RecoverySource,
  oldId: string,
  newId: string,
): MoveRecoveryEntryResult => {
  if (oldId === newId) {
    return { ok: true, entry: getRecoveryEntry(source, oldId) };
  }
  const current = getRecoveryEntry(source, oldId);
  if (!current) return { ok: true, entry: null };
  const moved = putDocWithCas(source, newId, (target) => ({
    version: 2,
    entry: {
      ...current,
      id: newId,
      revision: Math.max(
        current.revision,
        (target?.entry?.revision ?? target?.acknowledgedRevision ?? 0) + 1,
      ),
    },
  }));
  if (!moved?.entry) {
    return { ok: false, error: "目标恢复日志写入失败" };
  }
  if (!acknowledgeRecoveryEntry(source, oldId, current.revision)) {
    return { ok: false, error: "原恢复日志确认失败" };
  }
  return { ok: true, entry: moved.entry };
};

export const clearRecoveryJournalForTests = (): void => {
  UToolsAdapter.db
    .allDocs(RECOVERY_JOURNAL_DOC_PREFIX)
    .forEach((doc) => UToolsAdapter.db.remove(doc._id));
  removeDbStorageItem(RECOVERY_JOURNAL_STORAGE_KEY);
};

/** 仅当目标仍是首次未 ACK 编辑时的持久化版本，才允许恢复到内存。 */
export const canApplyRecoveryEntry = (
  entry: RecoveryJournalEntry,
  currentContent: JSONContent | null | undefined,
  currentUpdatedAt?: number,
): boolean => {
  if (
    typeof entry.baseUpdatedAt === "number" &&
    typeof currentUpdatedAt === "number" &&
    currentUpdatedAt > entry.baseUpdatedAt
  ) {
    return false;
  }
  return (
    !entry.baseSignature ||
    entry.baseSignature === getContentSignature(currentContent ?? null)
  );
};

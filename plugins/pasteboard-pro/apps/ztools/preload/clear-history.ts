import type { ZToolsCanonicalClipboardStore } from "./clipboard-store";
import type { RetentionBlobStore } from "./retention";

export type ClearClipboardHistoryResult = Readonly<{
  deleted: number;
  failed: number;
  blobFailures: number;
}>;

export async function clearClipboardHistory(
  store: ZToolsCanonicalClipboardStore,
  blobStore: RetentionBlobStore,
  systemClipboard: Readonly<{ clear(): void }>,
): Promise<ClearClipboardHistoryResult> {
  const records = await store.listRecords();
  const result = await store.deleteRecords(records.map((record) => record.item.id));
  const deleted = new Set(result.deletedIds);
  const retainedBlobIds = new Set(
    records.flatMap((record) =>
      deleted.has(record.item.id) || record.origin.pluginBlobId === undefined
        ? []
        : [record.origin.pluginBlobId],
    ),
  );
  const deletedBlobIds = new Set<string>();
  let blobFailures = 0;

  for (const record of records) {
    const blobId = record.origin.pluginBlobId;
    const filePath = record.origin.imagePath;
    if (
      !deleted.has(record.item.id) ||
      blobId === undefined ||
      filePath === undefined ||
      retainedBlobIds.has(blobId) ||
      deletedBlobIds.has(blobId)
    ) {
      continue;
    }
    deletedBlobIds.add(blobId);
    try {
      await blobStore.delete({ blobId, filePath });
    } catch {
      blobFailures += 1;
    }
  }

  systemClipboard.clear();
  return {
    deleted: result.deletedIds.length,
    failed: result.failures.length,
    blobFailures,
  };
}

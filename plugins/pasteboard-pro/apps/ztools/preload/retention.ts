import type { ZToolsCanonicalClipboardStore } from "./clipboard-store";
import {
  planRetentionPrune,
  type RetentionPolicy,
} from "./privacy";

export interface RetentionBlobStore {
  delete(input: Readonly<{ blobId: string; filePath: string }>): Promise<void>;
}

export type RetentionExecutionResult = Readonly<{
  plannedIds: string[];
  deletedIds: string[];
  metadataFailures: Array<Readonly<{ id: string; error: string }>>;
  blobFailures: Array<Readonly<{ id: string; blobId: string; error: string }>>;
  remainingBlobBytes: number;
  overBudget: boolean;
}>;

export async function executeRetentionPrune(
  store: ZToolsCanonicalClipboardStore,
  policy: RetentionPolicy,
  blobStore?: RetentionBlobStore,
): Promise<RetentionExecutionResult> {
  const records = await store.listRecords();
  const recordsById = new Map(records.map((record) => [record.item.id, record]));
  const plan = planRetentionPrune(
    records.map((record) => ({
      id: record.item.id,
      copiedAt: record.item.copiedAt,
      blobBytes: record.origin.blobBytes ?? 0,
      pinned: record.item.pinned,
      ...(record.item.pinboardId === undefined
        ? {}
        : { pinboardId: record.item.pinboardId }),
    })),
    policy,
  );
  const metadata = await store.deleteRecords(plan.deletedIds);
  const deleted = new Set(metadata.deletedIds);
  const blobFailures: Array<{ id: string; blobId: string; error: string }> = [];

  if (blobStore !== undefined) {
    for (const id of metadata.deletedIds) {
      const record = recordsById.get(id);
      const blobId = record?.origin.pluginBlobId;
      const filePath = record?.origin.imagePath;
      const stillReferenced = records.some(
        (candidate) =>
          !deleted.has(candidate.item.id) &&
          candidate.origin.pluginBlobId === blobId,
      );
      if (blobId === undefined || filePath === undefined || stillReferenced) {
        continue;
      }
      try {
        await blobStore.delete({ blobId, filePath });
      } catch (error) {
        blobFailures.push({
          id,
          blobId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const failedBytes = plan.deletedIds.reduce((total, id) => {
    if (deleted.has(id)) {
      return total;
    }
    return total + (recordsById.get(id)?.origin.blobBytes ?? 0);
  }, 0);
  const remainingBlobBytes = plan.remainingBlobBytes + failedBytes;

  return {
    plannedIds: [...plan.deletedIds],
    deletedIds: [...metadata.deletedIds],
    metadataFailures: [...metadata.failures],
    blobFailures,
    remainingBlobBytes,
    overBudget: remainingBlobBytes > policy.maxBlobBytes,
  };
}

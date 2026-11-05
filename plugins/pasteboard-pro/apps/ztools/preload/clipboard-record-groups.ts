import {
  compareStableOrder,
  orderKeyBetween,
  PasteItemSchema,
  type HybridClock,
} from "@pasteboard-pro/core";
import { markRecordChanged } from "./record-index";
import {
  getOptionalDocument,
  putWithConflictRetry,
  removeDocument,
} from "./clipboard-document-database";
import type {
  CanonicalClipboardRecord,
  ClipboardGroupPort,
  DeleteRecordsResult,
} from "./clipboard-store-types";

export async function deleteRecords(
  port: ClipboardGroupPort,
  itemIds: readonly string[],
): Promise<DeleteRecordsResult> {
  if (port.database.remove === undefined) {
    throw new TypeError("ZTools database does not expose remove");
  }
  const requested = new Set(itemIds);
  const records = (await port.listRecords()).filter((record) =>
    requested.has(record.item.id),
  );
  const deletedIds: string[] = [];
  const failures: Array<{ id: string; error: string }> = [];

  for (const record of records) {
    const documentId = port.recordDocumentId(record.item.contentFingerprint);
    try {
      const maximumClock = Math.max(
        ...Object.values(record.item.fieldClocks).map((clock) => clock.wallMs),
        0,
      );
      const deletedAt = Math.max(port.validTimestamp(), maximumClock + 1);
      const tombstoneId = "pasteboard-pro:tombstone:paste_item:" + record.item.id;
      await putWithConflictRetry(port.database, tombstoneId, (revision) => ({
        _id: tombstoneId,
        ...(revision === undefined ? {} : { _rev: revision }),
        type: "pasteboard-pro-tombstone",
        tombstone: {
          id: record.item.id,
          entityType: "paste_item",
          deleted: true,
          deletedAt: new Date(deletedAt).toISOString(),
          sourceDeviceId: port.deviceId,
          clock: { wallMs: deletedAt, counter: 0, deviceId: port.deviceId },
        },
      }));
      const document = await getOptionalDocument(port.database, documentId);
      if (document !== undefined) {
        await removeDocument(port.database, document, documentId);
      }
      markRecordChanged(port.database, documentId);
      deletedIds.push(record.item.id);
    } catch (error) {
      failures.push({
        id: record.item.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const missingId of requested) {
    if (!records.some((record) => record.item.id === missingId)) {
      deletedIds.push(missingId);
    }
  }

  return { deletedIds, failures };
}

export async function assignToPinboard(
  port: ClipboardGroupPort,
  itemIds: readonly string[],
  pinboardId: string | undefined,
): Promise<CanonicalClipboardRecord[]> {
  const requestedIds = [...new Set(itemIds)];
  const records = await port.listRecords();
  const recordsById = new Map(records.map((record) => [record.item.id, record]));
  for (const id of requestedIds) {
    if (!recordsById.has(id)) {
      throw new RangeError("Clipboard item " + id + " does not exist");
    }
  }

  const requestedSet = new Set(requestedIds);
  const existingBoardItems =
    pinboardId === undefined
      ? []
      : records
          .filter(
            (record) =>
              !requestedSet.has(record.item.id) &&
              record.item.pinboardId === pinboardId &&
              record.item.pinboardOrderKey !== undefined,
          )
          .map((record) => ({
            id: record.item.id,
            orderKey: record.item.pinboardOrderKey!,
          }))
          .sort(compareStableOrder);
  let previousOrderKey = existingBoardItems.at(-1)?.orderKey;
  const updatedRecords: CanonicalClipboardRecord[] = [];
  const originalRecords: CanonicalClipboardRecord[] = [];

  for (const id of requestedIds) {
    const record = recordsById.get(id)!;
    originalRecords.push(record);
    const timestamp = port.validTimestamp();
    const clock = (counter: number): HybridClock => ({
      wallMs: timestamp,
      counter,
      deviceId: port.deviceId,
    });
    const { pinboardId: _oldPinboardId, pinboardOrderKey: _oldOrderKey, ...base } =
      record.item;
    const nextOrderKey =
      pinboardId === undefined
        ? undefined
        : orderKeyBetween(previousOrderKey, undefined);
    const item = PasteItemSchema.parse({
      ...base,
      ...(pinboardId === undefined ? {} : { pinboardId }),
      ...(nextOrderKey === undefined ? {} : { pinboardOrderKey: nextOrderKey }),
      updatedAt: new Date(timestamp).toISOString(),
      fieldClocks: {
        ...record.item.fieldClocks,
        pinboardId: clock(0),
        pinboardOrderKey: clock(1),
      },
    });
    const updated = { item, origin: record.origin };
    updatedRecords.push(updated);
    previousOrderKey = nextOrderKey;
  }

  await putRecordsWithRollback(port, updatedRecords, originalRecords);
  return updatedRecords;
}

export async function restoreRecords(
  port: ClipboardGroupPort,
  records: readonly CanonicalClipboardRecord[],
): Promise<void> {
  const requestedIds = new Set(records.map((record) => record.item.id));
  if (requestedIds.size !== records.length) {
    throw new RangeError("Clipboard records to restore must have unique ids");
  }
  const current = await port.listRecords();
  const currentById = new Map(current.map((record) => [record.item.id, record]));
  const originals = records.map((record) => {
    const existing = currentById.get(record.item.id);
    if (existing === undefined) {
      throw new RangeError("Clipboard item " + record.item.id + " does not exist");
    }
    return existing;
  });
  await putRecordsWithRollback(port, records, originals);
}

async function putRecordsWithRollback(
  port: ClipboardGroupPort,
  updatedRecords: readonly CanonicalClipboardRecord[],
  originalRecords: readonly CanonicalClipboardRecord[],
): Promise<void> {
  const applied: CanonicalClipboardRecord[] = [];
  try {
    for (let index = 0; index < updatedRecords.length; index += 1) {
      await port.put(updatedRecords[index]!);
      applied.push(originalRecords[index]!);
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const original of applied.reverse()) {
      try {
        await port.put(original);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Clipboard batch update and rollback both failed",
      );
    }
    throw error;
  }
}

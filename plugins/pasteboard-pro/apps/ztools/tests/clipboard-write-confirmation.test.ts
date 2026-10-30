import { afterEach, describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

import { ZToolsPinboardStore } from "../preload/pinboard-store";
import {
  createCheckedZToolsDocumentDatabase,
  documentRevision,
  getOptionalDocument,
  putWithConflictRetry,
  removeDocument,
} from "../preload/clipboard-document-database";
import {
  mirrorHostHistory,
  normalizeHostClipboardItem,
  ZToolsCanonicalClipboardStore,
} from "../preload/clipboard-store";
import { takeRecordChanges } from "../preload/record-index";
import { migratePasteboardProPluginData } from "../preload/plugin-data-migration";
import { ZToolsSyncEntityRepository } from "../preload/sync-repository";
import {
  SYNTHETIC_SENSITIVE_MESSAGE,
  TemporaryLmdbHostDatabase,
} from "./clipboard-database-fixture";

const artifactRoot = resolve(
  fileURLToPath(new URL("../../../", import.meta.url)),
  "artifacts/pasteboardpro/clipboard-format-g0/v028-db-confirmation-tests",
);
const fixtures = new Set<TemporaryLmdbHostDatabase>();
const cursorId = "pasteboard-pro:cursor:ztools-history";

const clipboardItem = {
  id: "history-item-1",
  type: "text",
  timestamp: 1_790_000_000_000,
  content: "Persisted clipboard text",
  appName: "TextEdit",
  appBundleId: "com.apple.TextEdit",
};

function makeHost(items: readonly unknown[]) {
  return {
    async getHistory() {
      return { items, total: items.length };
    },
  };
}

async function makeFixture() {
  const fixture = await TemporaryLmdbHostDatabase.create(artifactRoot);
  fixtures.add(fixture);
  const database = createCheckedZToolsDocumentDatabase(fixture.raw);
  const store = new ZToolsCanonicalClipboardStore(database, {
    deviceId: "database-test-device",
    now: () => 1_790_000_100_000,
  });
  return { fixture, database, store };
}

function recordDocumentId(rawItem: unknown): string {
  const record = normalizeHostClipboardItem(rawItem, "database-test-device");
  if (record === null) throw new TypeError("Test clipboard item was rejected");
  return `pasteboard-pro:record:${record.item.contentFingerprint}`;
}

function errorText(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function conflictResult(id: string) {
  return {
    id,
    error: true,
    name: "conflict",
    message: SYNTHETIC_SENSITIVE_MESSAGE,
  };
}

afterEach(async () => {
  for (const fixture of fixtures) {
    fixtures.delete(fixture);
    await fixture.closeAndRemove();
  }
});

describe("checked ZTools clipboard database", () => {
  it("preserves original text, HTML, RTF, and source metadata across a real LMDB reopen", async () => {
    const { fixture, database } = await makeFixture();
    const id = "pasteboard-pro:record:format-roundtrip";
    const record = {
      item: {
        id: "format-roundtrip",
        payload: {
          text: "Plain text\r\nsecond line",
          html: "<article><strong>HTML source</strong></article>",
          rtf: String.raw`{\rtf1\ansi{\b RTF source}}`,
          sources: ["public.utf8-plain-text", "public.html", "public.rtf"],
        },
      },
      sources: [
        { format: "public.utf8-plain-text", original: true },
        { format: "public.html", original: true },
        { format: "public.rtf", original: true },
      ],
      sourceApplication: {
        name: "TextEdit",
        bundleId: "com.apple.TextEdit",
      },
    };

    await putWithConflictRetry(database, id, () => ({
      _id: id,
      type: "pasteboard-pro-format-fixture",
      record,
    }));
    const beforeReopen = await getOptionalDocument(database, id);
    expect(documentRevision(beforeReopen)).toBe("host-1");
    expect(fixture.committedPutIds).toEqual([id]);

    await fixture.reopen();

    await expect(database.get(id)).resolves.toEqual(beforeReopen);
    expect(fixture.readDocument(id)?.record).toEqual(record);
  });

  it("re-reads the current revision after a resolved conflict and counts one committed history item", async () => {
    const { fixture, store } = await makeFixture();
    const id = recordDocumentId(clipboardItem);
    fixture.queuePutResult(id, conflictResult(id), {
      _id: id,
      _rev: "host-1",
      type: "concurrent-document",
    });

    await expect(
      mirrorHostHistory(makeHost([clipboardItem]), store, {
        deviceId: "database-test-device",
      }),
    ).resolves.toMatchObject({ imported: 1, skipped: 0, pages: 1 });

    expect(fixture.putCalls.filter((document) => document._id === id)).toHaveLength(2);
    expect(fixture.putCalls[0]?._rev).toBeUndefined();
    expect(fixture.putCalls[1]?._rev).toBe("host-1");
    expect(fixture.committedPutIds.filter((documentId) => documentId === id)).toHaveLength(1);
    await expect(store.findByFingerprint(
      normalizeHostClipboardItem(clipboardItem, "database-test-device")!.item.contentFingerprint,
    )).resolves.toMatchObject({ payload: { text: clipboardItem.content } });
    await expect(store.getCursor()).resolves.toEqual({
      id: clipboardItem.id,
      timestamp: clipboardItem.timestamp,
    });
  });

  it("does not advance history after three resolved conflicts, then retries idempotently", async () => {
    const { fixture, database, store } = await makeFixture();
    const id = recordDocumentId(clipboardItem);
    fixture.queuePutResult(id, conflictResult(id));
    fixture.queuePutResult(id, conflictResult(id));
    fixture.queuePutResult(id, conflictResult(id));

    await expect(
      mirrorHostHistory(makeHost([clipboardItem]), store, {
        deviceId: "database-test-device",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(fixture.readDocument(id)).toBeUndefined();
    expect(fixture.readDocument(cursorId)).toBeUndefined();
    expect(fixture.committedPutIds).toEqual([]);
    expect(takeRecordChanges(database)).toEqual([]);
    const queryCountBeforeLookup = fixture.allDocsCalls.length;
    await expect(store.findRecordByItemId("ztools:history-item-1")).resolves.toBeUndefined();
    expect(fixture.allDocsCalls).toHaveLength(queryCountBeforeLookup + 1);

    await expect(
      mirrorHostHistory(makeHost([clipboardItem]), store, {
        deviceId: "database-test-device",
      }),
    ).resolves.toMatchObject({ imported: 1, skipped: 0, pages: 1 });
    await expect(
      mirrorHostHistory(makeHost([clipboardItem]), store, {
        deviceId: "database-test-device",
      }),
    ).resolves.toMatchObject({ imported: 0, skipped: 1, pages: 1 });
    expect(fixture.committedPutIds.filter((documentId) => documentId === id)).toHaveLength(1);
    expect(fixture.readDocument(cursorId)?.cursor).toEqual({
      id: clipboardItem.id,
      timestamp: clipboardItem.timestamp,
    });
  });

  it("does not report another resolved host write error as success or leak its message", async () => {
    const { fixture, store } = await makeFixture();
    const id = recordDocumentId(clipboardItem);
    fixture.queuePutResult(id, {
      id,
      error: true,
      name: "unavailable",
      message: SYNTHETIC_SENSITIVE_MESSAGE,
    });

    const failedImport = mirrorHostHistory(makeHost([clipboardItem]), store, {
      deviceId: "database-test-device",
    });
    await expect(failedImport).rejects.toThrow("Storage operation failed");
    const error = await failedImport.catch((failure: unknown) => failure);
    expect(errorText(error)).not.toContain(SYNTHETIC_SENSITIVE_MESSAGE);
    expect(fixture.readDocument(id)).toBeUndefined();
    expect(fixture.readDocument(cursorId)).toBeUndefined();

    await expect(
      mirrorHostHistory(makeHost([clipboardItem]), store, {
        deviceId: "database-test-device",
      }),
    ).resolves.toMatchObject({ imported: 1, skipped: 0, pages: 1 });
  });

  it("does not persist a cursor after cursor write failure and recovers without duplicating the record", async () => {
    const { fixture, database, store } = await makeFixture();
    const id = recordDocumentId(clipboardItem);
    fixture.queuePutResult(cursorId, {
      id: cursorId,
      error: true,
      name: "unavailable",
      message: SYNTHETIC_SENSITIVE_MESSAGE,
    });

    const failedImport = mirrorHostHistory(makeHost([clipboardItem]), store, {
      deviceId: "database-test-device",
    });
    await expect(failedImport).rejects.toThrow("Storage operation failed");
    const error = await failedImport.catch((failure: unknown) => failure);
    expect(errorText(error)).not.toContain(SYNTHETIC_SENSITIVE_MESSAGE);
    expect(fixture.readDocument(cursorId)).toBeUndefined();
    expect(fixture.readDocument(id)).toMatchObject({ record: { item: { id: "ztools:history-item-1" } } });
    expect(takeRecordChanges(database)).toEqual([id]);

    await expect(
      mirrorHostHistory(makeHost([clipboardItem]), store, {
        deviceId: "database-test-device",
      }),
    ).resolves.toMatchObject({ imported: 0, skipped: 1, pages: 1 });
    expect(fixture.committedPutIds.filter((documentId) => documentId === id)).toHaveLength(1);
    expect(fixture.readDocument(cursorId)?.cursor).toEqual({
      id: clipboardItem.id,
      timestamp: clipboardItem.timestamp,
    });
  });

  it("rejects malformed or negative put acknowledgements", async () => {
    const malformedAcks: Array<Readonly<{ name: string; result: unknown }>> = [
      { name: "void result", result: undefined },
      { name: "missing id", result: { ok: true, rev: "host-1" } },
      { name: "missing revision", result: { ok: true, id: "pasteboard-pro:record:ack" } },
      { name: "wrong id", result: { ok: true, id: "other-id", rev: "host-1" } },
      {
        name: "error with a positive flag",
        result: { ok: true, id: "pasteboard-pro:record:ack", rev: "host-1", error: true },
      },
    ];

    for (const { name, result } of malformedAcks) {
      const { fixture, database } = await makeFixture();
      const id = "pasteboard-pro:record:ack";
      fixture.queuePutResult(id, result);
      const failedWrite = putWithConflictRetry(database, id, () => ({ _id: id }));
      await expect(failedWrite, name).rejects.toThrow("Storage operation failed");
      const error = await failedWrite.catch((failure: unknown) => failure);
      expect(errorText(error), name).not.toContain(SYNTHETIC_SENSITIVE_MESSAGE);
      expect(fixture.readDocument(id), name).toBeUndefined();
      expect(fixture.committedPutIds, name).toEqual([]);
    }
  });

  it("surfaces allDocs errors instead of presenting an empty search", async () => {
    const { fixture, store } = await makeFixture();
    fixture.queueAllDocsResult({
      error: true,
      name: "storage_unavailable",
      message: SYNTHETIC_SENSITIVE_MESSAGE,
    });

    const search = store.search("", 10);
    await expect(search).rejects.toThrow("Storage operation failed");
    const error = await search.catch((failure: unknown) => failure);
    expect(errorText(error)).not.toContain(SYNTHETIC_SENSITIVE_MESSAGE);
    expect(fixture.allDocsCalls).toEqual(["pasteboard-pro:record:"]);
  });

  it("calls native allDocs with a prefix or ID list and filters returned documents", async () => {
    const { fixture, database, store } = await makeFixture();
    const prefixId = "pasteboard-pro:record:query";
    fixture.seedDocument({ _id: prefixId, type: "fixture" });
    fixture.seedDocument({ _id: "pasteboard-pro:pinboard:outside", type: "fixture" });
    await store.readHistoryDocuments();
    expect(fixture.allDocsCalls.at(-1)).toBe("pasteboard-pro:record:");

    fixture.queueAllDocsResult([
      { _id: prefixId, type: "fixture" },
      { _id: "outside", type: "fixture" },
    ]);
    await expect(database.allDocs?.({ include_docs: true, keys: [prefixId] })).resolves.toEqual([
      { _id: prefixId, type: "fixture" },
    ]);
    expect(fixture.allDocsCalls.at(-1)).toEqual([prefixId]);
  });

  it("keeps delete results and cache changes tied to confirmed success or explicit 404", async () => {
    const { fixture, database, store } = await makeFixture();
    const failed = await store.createTextItem("delete failure");
    const failedDocId = `pasteboard-pro:record:${failed.item.contentFingerprint}`;
    takeRecordChanges(database);
    fixture.queueRemoveResult(failedDocId, {
      id: failedDocId,
      error: true,
      name: "unavailable",
      message: SYNTHETIC_SENSITIVE_MESSAGE,
    });

    const failedDeletion = await store.deleteRecords([failed.item.id]);
    expect(failedDeletion.deletedIds).not.toContain(failed.item.id);
    expect(failedDeletion.failures).toEqual([
      { id: failed.item.id, error: "Storage operation failed" },
    ]);
    expect(fixture.readDocument(failedDocId)).toBeDefined();
    expect(takeRecordChanges(database)).toEqual([]);

    const failedSyncedRemove = await store.createTextItem("synced remove failure");
    const failedSyncedDocId = `pasteboard-pro:record:${failedSyncedRemove.item.contentFingerprint}`;
    takeRecordChanges(database);
    fixture.queueRemoveResult(failedSyncedDocId, {
      id: failedSyncedDocId,
      error: true,
      name: "unavailable",
      message: SYNTHETIC_SENSITIVE_MESSAGE,
    });
    await expect(store.removeSyncedItem(failedSyncedRemove.item.id)).rejects.toThrow(
      "Storage operation failed",
    );
    expect(fixture.readDocument(failedSyncedDocId)).toBeDefined();
    expect(takeRecordChanges(database)).toEqual([]);

    const removed = await store.createTextItem("valid host remove ack");
    const removedDocId = `pasteboard-pro:record:${removed.item.contentFingerprint}`;
    takeRecordChanges(database);
    await store.removeSyncedItem(removed.item.id);
    expect(fixture.readDocument(removedDocId)).toBeUndefined();
    expect(takeRecordChanges(database)).toEqual([removedDocId]);

    const alreadyMissing = await store.createTextItem("idempotent 404 remove");
    const missingDocId = `pasteboard-pro:record:${alreadyMissing.item.contentFingerprint}`;
    takeRecordChanges(database);
    fixture.queueRemoveResult(missingDocId, {
      id: missingDocId,
      error: true,
      name: "not_found",
      message: SYNTHETIC_SENSITIVE_MESSAGE,
    }, true);
    await expect(store.deleteRecords([alreadyMissing.item.id])).resolves.toMatchObject({
      deletedIds: [alreadyMissing.item.id],
      failures: [],
    });
    expect(fixture.readDocument(missingDocId)).toBeUndefined();
    expect(takeRecordChanges(database)).toEqual([missingDocId]);
  });

  it("reads records, Pinboards, tombstones, and migration paths through the normalized port", async () => {
    const { fixture, database, store } = await makeFixture();
    const legacyRoot = join(fixture.directory, "legacy-blobs");
    const blobRoot = join(fixture.directory, "plugin-data", "sync", "blobs");
    const dataRoot = join(fixture.directory, "plugin-data");
    const legacyImage = join(legacyRoot, "history-image.png");
    await mkdir(legacyRoot, { recursive: true });
    await mkdir(dataRoot, { recursive: true });
    await writeFile(legacyImage, Buffer.from([137, 80, 78, 71, 1, 2, 3]));

    const imageItem = {
      id: "migration-image",
      type: "image",
      timestamp: 1_790_000_200_000,
      imagePath: legacyImage,
      appName: "Preview",
      appBundleId: "com.apple.Preview",
    };
    const imageRecord = normalizeHostClipboardItem(imageItem, "database-test-device");
    if (imageRecord === null) throw new TypeError("Migration image fixture was rejected");
    await store.put(imageRecord);

    const pinboards = new ZToolsPinboardStore(database, {
      deviceId: "database-test-device",
      now: () => 1_790_000_300_000,
      idFactory: () => "board-test",
    });
    const pinboard = await pinboards.create("Work", "#3355AA");
    fixture.seedDocument({
      _id: "pasteboard-pro:tombstone:paste_item:deleted-item",
      type: "pasteboard-pro-tombstone",
      tombstone: {
        id: "deleted-item",
        entityType: "paste_item",
        deleted: true,
        deletedAt: "2026-09-01T00:00:00.000Z",
        sourceDeviceId: "database-test-device",
        clock: { wallMs: 1_788_000_000_000, counter: 0, deviceId: "database-test-device" },
      },
    });

    const repository = new ZToolsSyncEntityRepository(
      database,
      "database-test-device",
      join(fixture.directory, "managed-blobs"),
    );
    const entities = await repository.listEntities();
    expect(entities.map((entity) => entity.id)).toEqual(
      expect.arrayContaining([imageRecord.item.id, pinboard.id, "deleted-item"]),
    );
    expect(fixture.allDocsCalls).toEqual(expect.arrayContaining([
      "pasteboard-pro:record:",
      "pasteboard-pro:pinboard:",
      "pasteboard-pro:tombstone:",
    ]));

    await migratePasteboardProPluginData(database, {
      dataRoot,
      blobRoot,
      legacyBlobRoots: [legacyRoot],
      usesPluginData: true,
    });

    const migrated = await store.findRecordByItemId(imageRecord.item.id);
    const migratedImagePath = join(blobRoot, "history-image.png");
    expect(migrated?.origin).toMatchObject({ imagePath: migratedImagePath });
    await expect(readFile(migratedImagePath)).resolves.toEqual(
      Buffer.from([137, 80, 78, 71, 1, 2, 3]),
    );
    expect(fixture.allDocsCalls.filter((key) => key === "pasteboard-pro:record:").length)
      .toBeGreaterThanOrEqual(2);
  });

  it("treats explicit not-found remove as idempotent but still requires a real put acknowledgement", async () => {
    const { fixture, database } = await makeFixture();
    const id = "pasteboard-pro:record:helper-delete";
    const document = { _id: id, _rev: "host-1" };
    fixture.queueRemoveResult(id, {
      id,
      error: true,
      name: "not_found",
      message: SYNTHETIC_SENSITIVE_MESSAGE,
    });
    await expect(removeDocument(database, document, id)).resolves.toBeUndefined();

    fixture.queuePutResult(id, undefined);
    await expect(putWithConflictRetry(database, id, () => ({ _id: id })))
      .rejects.toThrow("Storage operation failed");
  });
});

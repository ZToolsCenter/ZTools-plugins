import {
  PasteItemSchema,
  searchPasteItems,
  type PasteItem,
} from "@pasteboard-pro/core";
import { compareStableOrder } from "@pasteboard-pro/core";
import {
  documentsFromAllDocs,
  getOptionalDocument,
  putWithConflictRetry,
  removeDocument,
} from "./clipboard-document-database";
import {
  markRecordChanged,
  rememberRecord,
  recordDocumentFor,
} from "./record-index";
import { isRecord, storedRecord } from "./clipboard-record-codec";
import type { StoredRecordDocument } from "./clipboard-record-codec";
import { storedCursor } from "./clipboard-host-normalization";
import {
  readMirrorImageRetryBoundary,
  writeMirrorImageRetryBoundary,
} from "./mirror-image-retry-progress";
import {
  advanceHistoryClearBoundary,
  copyHistoryClearBoundary,
  readHistoryClearBoundary,
} from "./history-clear-boundary";
import type {
  CanonicalClipboardRecord,
  CanonicalClipboardStore,
  CanonicalStoreOptions,
  HistoryClearBoundary,
  HostCursor,
  ZToolsDocumentDatabase,
} from "./clipboard-store-types";

const CURSOR_DOCUMENT_ID = "pasteboard-pro:cursor:ztools-history";

type StoredCursorDocument = Readonly<{
  _id: string;
  _rev?: string;
  type: "pasteboard-pro-cursor";
  cursor: HostCursor;
}>;

export class ClipboardRecordStore implements CanonicalClipboardStore {
  protected readonly deviceId: string;
  protected readonly now: () => number;
  protected readonly ready: Promise<void>;

  constructor(
    protected readonly database: ZToolsDocumentDatabase,
    options: CanonicalStoreOptions = {},
  ) {
    this.deviceId = options.deviceId?.trim() || "ztools-local";
    this.now = options.now ?? Date.now;
    this.ready = options.ready ?? Promise.resolve();
  }

  async findByFingerprint(fingerprint: string): Promise<PasteItem | undefined> {
    await this.ready;
    const document = await getOptionalDocument(
      this.database,
      this.recordDocumentId(fingerprint),
    );
    return storedRecord(document)?.item;
  }

  async put(record: CanonicalClipboardRecord): Promise<void> {
    await this.ready;
    const id = this.recordDocumentId(record.item.contentFingerprint);
    await putWithConflictRetry(this.database, id, (revision) => ({
      _id: id,
      ...(revision === undefined ? {} : { _rev: revision }),
      type: "pasteboard-pro-record",
      record: structuredClone(record),
    } satisfies StoredRecordDocument));
    rememberRecord(this.database, record.item.id, id);
    markRecordChanged(this.database, id);
  }

  async putSyncedItem(item: PasteItem): Promise<void> {
    const current = await this.findRecordByItemId(item.id);
    await this.put({
      item: PasteItemSchema.parse(item),
      origin:
        current !== undefined &&
        current.item.payload.revision === item.payload.revision
          ? current.origin
          : ({
              host: "sync",
              remoteAvailable:
                item.kind !== "image" &&
                item.kind !== "pdf" &&
                item.kind !== "files",
            } as const),
    });
  }

  async attachSyncedBlob(
    itemId: string,
    blobId: string,
    imagePath: string,
    blobBytes: number,
  ): Promise<void> {
    const current = await this.findRecordByItemId(itemId);
    if (current === undefined || current.item.payload.blobId !== blobId) return;
    await this.put({
      item: current.item,
      origin:
        current.origin.host === "ztools"
          ? current.origin
          : {
              host: "sync",
              remoteAvailable: true,
              imagePath,
              blobBytes,
              pluginBlobId: blobId,
            },
    });
  }

  async removeSyncedItem(itemId: string): Promise<void> {
    if (this.database.remove === undefined) {
      throw new TypeError("ZTools database does not expose remove");
    }
    const current = await this.findRecordByItemId(itemId);
    if (current === undefined) return;
    const documentId = this.recordDocumentId(current.item.contentFingerprint);
    const document = await getOptionalDocument(this.database, documentId);
    if (document !== undefined) {
      await removeDocument(this.database, document, documentId);
    }
    markRecordChanged(this.database, documentId);
  }

  async getCursor(): Promise<HostCursor | undefined> {
    await this.ready;
    return storedCursor(
      await getOptionalDocument(this.database, CURSOR_DOCUMENT_ID),
    );
  }

  async setCursor(cursor: HostCursor): Promise<void> {
    await this.ready;
    await putWithConflictRetry(
      this.database,
      CURSOR_DOCUMENT_ID,
      (revision) => ({
        _id: CURSOR_DOCUMENT_ID,
        ...(revision === undefined ? {} : { _rev: revision }),
        type: "pasteboard-pro-cursor",
        cursor: { ...cursor },
      } satisfies StoredCursorDocument),
    );
  }

  async getImageRetryBoundary(): Promise<HostCursor | undefined> {
    await this.ready;
    return readMirrorImageRetryBoundary(this.database);
  }

  async setImageRetryBoundary(boundary: HostCursor | undefined): Promise<void> {
    await this.ready;
    await writeMirrorImageRetryBoundary(this.database, boundary);
  }

  async getHistoryClearBoundary(): Promise<HistoryClearBoundary | undefined> {
    await this.ready;
    return readHistoryClearBoundary(this.database, this.deviceId);
  }

  async advanceHistoryClearBoundary(boundary: HistoryClearBoundary): Promise<void> {
    const ownedBoundary = copyHistoryClearBoundary(boundary);
    await this.ready;
    await advanceHistoryClearBoundary(this.database, this.deviceId, ownedBoundary);
  }

  async readHistoryDocuments(): Promise<unknown[]> {
    await this.ready;
    if (this.database.allDocs === undefined) {
      throw new TypeError("ZTools database does not expose allDocs");
    }
    const result = await this.database.allDocs({
      include_docs: true,
      startkey: "pasteboard-pro:record:",
      endkey: "pasteboard-pro:record:\uffff",
    });
    const documents = documentsFromAllDocs(
      result,
      "ZTools database returned invalid record rows",
    );
    // Only inspect IDs here. Full schema validation and search run in the worker.
    for (let offset = 0; offset < documents.length; offset += 500) {
      for (const document of documents.slice(offset, offset + 500)) {
        if (
          !isRecord(document) ||
          typeof document._id !== "string" ||
          !isRecord(document.record) ||
          !isRecord(document.record.item) ||
          typeof document.record.item.id !== "string"
        ) {
          continue;
        }
        rememberRecord(
          this.database,
          document.record.item.id,
          document._id,
        );
      }
      if (offset + 500 < documents.length) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    return documents;
  }

  async readHistoryChanges(ids: readonly string[]): Promise<unknown[]> {
    await this.ready;
    const documents: unknown[] = [];
    for (let offset = 0; offset < ids.length; offset += 50) {
      const batch = await Promise.all(
        ids
          .slice(offset, offset + 50)
          .map((id) => getOptionalDocument(this.database, id)),
      );
      for (const document of batch) {
        const record = storedRecord(document);
        if (record !== undefined && isRecord(document) && typeof document._id === "string") {
          rememberRecord(this.database, record.item.id, document._id);
          documents.push(document);
        }
      }
    }
    return documents;
  }

  async listRecords(): Promise<CanonicalClipboardRecord[]> {
    await this.ready;
    if (this.database.allDocs === undefined) {
      throw new TypeError("ZTools database does not expose allDocs");
    }
    const result = await this.database.allDocs({
      include_docs: true,
      startkey: "pasteboard-pro:record:",
      endkey: "pasteboard-pro:record:\uffff",
    });
    return documentsFromAllDocs(
      result,
      "ZTools database returned invalid record rows",
    )
      .flatMap((document) => {
        const record = storedRecord(document);
        if (record !== undefined) {
          rememberRecord(
            this.database,
            record.item.id,
            this.recordDocumentId(record.item.contentFingerprint),
          );
        }
        return record === undefined ? [] : [record];
      })
      .sort(
        (left, right) =>
          Date.parse(right.item.copiedAt) - Date.parse(left.item.copiedAt) ||
          left.item.id.localeCompare(right.item.id),
      );
  }

  async search(
    query: string,
    limit: number,
  ): Promise<Readonly<{ items: PasteItem[]; total: number }>> {
    return (await this.searchWithRecords(query, limit)).result;
  }

  async searchWithRecords(query: string, limit: number): Promise<Readonly<{
    result: Readonly<{ items: PasteItem[]; total: number }>;
    records: CanonicalClipboardRecord[];
  }>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
      throw new RangeError("Search limit must be an integer between 1 and 10000");
    }
    const records = await this.listRecords();
    const matched = searchPasteItems(
      records.map((record) => record.item),
      query,
    );
    return { result: { items: matched.slice(0, limit), total: matched.length }, records };
  }

  async findRecordByItemId(
    itemId: string,
  ): Promise<CanonicalClipboardRecord | undefined> {
    const documentId = recordDocumentFor(this.database, itemId);
    if (documentId !== undefined) {
      await this.ready;
      const record = storedRecord(await getOptionalDocument(this.database, documentId));
      return record?.item.id === itemId ? record : undefined;
    }
    return (await this.listRecords()).find((record) => record.item.id === itemId);
  }

  protected recordDocumentId(fingerprint: string): string {
    return "pasteboard-pro:record:" + fingerprint;
  }

  protected validTimestamp(): number {
    const value = this.now();
    if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) {
      throw new RangeError("Canonical store clock returned an invalid timestamp");
    }
    return value;
  }
}

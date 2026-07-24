import {
  compareStableOrder,
  orderKeyBetween,
  PasteItemSchema,
  searchPasteItems,
  type HybridClock,
  type PasteItem,
  type PastePayload,
} from "@pasteboard-pro/core";

export type HostCursor = Readonly<{
  id: string;
  timestamp: number;
}>;

export type CanonicalClipboardOrigin =
  | Readonly<{
      host: "ztools";
      hostItemId: string;
      hostType: "text" | "image" | "file";
      imagePath?: string;
      blobBytes?: number;
      pluginBlobId?: string;
    }>
  | Readonly<{
      host: "sync";
      remoteAvailable: boolean;
      imagePath?: string;
      blobBytes?: number;
      pluginBlobId?: string;
    }>;

export type CanonicalClipboardRecord = Readonly<{
  item: PasteItem;
  origin: CanonicalClipboardOrigin;
}>;

export interface CanonicalClipboardStore {
  findByFingerprint(fingerprint: string): Promise<PasteItem | undefined>;
  put(record: CanonicalClipboardRecord): Promise<void>;
  getCursor(): Promise<HostCursor | undefined>;
  setCursor(cursor: HostCursor): Promise<void>;
}

export interface ZToolsDocumentDatabase {
  get(id: string): Promise<unknown>;
  put(document: Record<string, unknown>): Promise<unknown>;
  allDocs?(options: Readonly<Record<string, unknown>>): Promise<unknown>;
  remove?(document: unknown): Promise<unknown>;
}

export type DeleteRecordsResult = Readonly<{
  deletedIds: string[];
  failures: Array<Readonly<{ id: string; error: string }>>;
}>;

export type CanonicalStoreOptions = Readonly<{
  deviceId?: string;
  now?: () => number;
}>;

export interface HostClipboardApi {
  getHistory(
    page: number,
    pageSize: number,
    query?: string,
  ): Promise<Readonly<{ items: readonly unknown[]; total: number }>>;
}

export type MirrorHostHistoryOptions = Readonly<{
  deviceId: string;
  pageSize?: number;
  maxPages?: number;
  shouldPersist?: (
    rawItem: unknown,
    record: CanonicalClipboardRecord,
  ) => boolean | Promise<boolean>;
}>;

export type MirrorHostHistoryResult = Readonly<{
  imported: number;
  skipped: number;
  pages: number;
}>;

type HostClipboardFile = Readonly<{
  name?: string;
  path: string;
  isDirectory?: boolean;
  exists?: boolean;
}>;

type StoredRecordDocument = Readonly<{
  _id: string;
  _rev?: string;
  type: "pasteboard-pro-record";
  record: CanonicalClipboardRecord;
}>;

type StoredCursorDocument = Readonly<{
  _id: string;
  _rev?: string;
  type: "pasteboard-pro-cursor";
  cursor: HostCursor;
}>;

const CURSOR_DOCUMENT_ID = "pasteboard-pro:cursor:ztools-history";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function documentsFromAllDocs(
  result: unknown,
  errorMessage: string,
): unknown[] {
  if (Array.isArray(result)) {
    return result;
  }
  if (isRecord(result) && Array.isArray(result.rows)) {
    return result.rows.flatMap((row) =>
      isRecord(row) && "doc" in row ? [row.doc] : [],
    );
  }
  throw new TypeError(errorMessage);
}

function documentRevision(value: unknown): string | undefined {
  return isRecord(value) && typeof value._rev === "string"
    ? value._rev
    : undefined;
}

function isDatabaseStatus(error: unknown, status: number): boolean {
  return (
    isRecord(error) &&
    (error.status === status || error.statusCode === status)
  );
}

async function getOptionalDocument(
  database: ZToolsDocumentDatabase,
  id: string,
): Promise<unknown | undefined> {
  try {
    return await database.get(id);
  } catch (error) {
    if (isDatabaseStatus(error, 404)) {
      return undefined;
    }
    throw error;
  }
}

function storedRecord(value: unknown): CanonicalClipboardRecord | undefined {
  if (
    !isRecord(value) ||
    value.type !== "pasteboard-pro-record" ||
    !isRecord(value.record) ||
    !isRecord(value.record.item) ||
    !isRecord(value.record.origin)
  ) {
    return undefined;
  }

  const item = PasteItemSchema.safeParse(value.record.item);
  const origin = value.record.origin;
  if (!item.success) return undefined;
  if (origin.host === "sync") {
    if (typeof origin.remoteAvailable !== "boolean") return undefined;
    return {
      item: item.data,
      origin: {
        host: "sync",
        remoteAvailable: origin.remoteAvailable,
        ...(typeof origin.imagePath === "string"
          ? { imagePath: origin.imagePath }
          : {}),
        ...(Number.isSafeInteger(origin.blobBytes) && Number(origin.blobBytes) >= 0
          ? { blobBytes: Number(origin.blobBytes) }
          : {}),
        ...(typeof origin.pluginBlobId === "string"
          ? { pluginBlobId: origin.pluginBlobId }
          : {}),
      },
    };
  }
  if (
    origin.host !== "ztools" ||
    typeof origin.hostItemId !== "string" ||
    (origin.hostType !== "text" &&
      origin.hostType !== "image" &&
      origin.hostType !== "file")
  ) {
    return undefined;
  }

  return {
    item: item.data,
    origin: {
      host: "ztools",
      hostItemId: origin.hostItemId,
      hostType: origin.hostType,
      ...(typeof origin.imagePath === "string"
        ? { imagePath: origin.imagePath }
        : {}),
      ...(Number.isSafeInteger(origin.blobBytes) && Number(origin.blobBytes) >= 0
        ? { blobBytes: Number(origin.blobBytes) }
        : {}),
      ...(typeof origin.pluginBlobId === "string"
        ? { pluginBlobId: origin.pluginBlobId }
        : {}),
    },
  };
}

function storedCursor(value: unknown): HostCursor | undefined {
  return isRecord(value) && value.type === "pasteboard-pro-cursor"
    ? hostCursor(value.cursor)
    : undefined;
}

async function putWithConflictRetry(
  database: ZToolsDocumentDatabase,
  id: string,
  build: (revision?: string) => Record<string, unknown>,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await getOptionalDocument(database, id);
    try {
      await database.put(build(documentRevision(current)));
      return;
    } catch (error) {
      if (!isDatabaseStatus(error, 409) || attempt === 2) {
        throw error;
      }
    }
  }
}

export class ZToolsCanonicalClipboardStore implements CanonicalClipboardStore {
  private readonly deviceId: string;
  private readonly now: () => number;

  constructor(
    private readonly database: ZToolsDocumentDatabase,
    options: CanonicalStoreOptions = {},
  ) {
    this.deviceId = options.deviceId?.trim() || "ztools-local";
    this.now = options.now ?? Date.now;
  }

  async findByFingerprint(fingerprint: string): Promise<PasteItem | undefined> {
    const document = await getOptionalDocument(
      this.database,
      this.recordDocumentId(fingerprint),
    );
    return storedRecord(document)?.item;
  }

  async put(record: CanonicalClipboardRecord): Promise<void> {
    const id = this.recordDocumentId(record.item.contentFingerprint);
    await putWithConflictRetry(this.database, id, (revision) => ({
      _id: id,
      ...(revision === undefined ? {} : { _rev: revision }),
      type: "pasteboard-pro-record",
      record: structuredClone(record),
    } satisfies StoredRecordDocument));
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
    try {
      await this.database.remove(
        await this.database.get(this.recordDocumentId(current.item.contentFingerprint)),
      );
    } catch (error) {
      if (!isDatabaseStatus(error, 404)) throw error;
    }
  }

  async getCursor(): Promise<HostCursor | undefined> {
    return storedCursor(
      await getOptionalDocument(this.database, CURSOR_DOCUMENT_ID),
    );
  }

  async setCursor(cursor: HostCursor): Promise<void> {
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

  async listRecords(): Promise<CanonicalClipboardRecord[]> {
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
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
      throw new RangeError("Search limit must be an integer between 1 and 10000");
    }
    const records = await this.listRecords();
    const matched = searchPasteItems(
      records.map((record) => record.item),
      query,
    );
    return { items: matched.slice(0, limit), total: matched.length };
  }

  async findRecordByItemId(
    itemId: string,
  ): Promise<CanonicalClipboardRecord | undefined> {
    return (await this.listRecords()).find((record) => record.item.id === itemId);
  }

  async createTextItem(
    text: string,
    title?: string,
  ): Promise<CanonicalClipboardRecord> {
    const normalizedText = text.trim();
    if (normalizedText.length === 0) {
      throw new RangeError("Text item content cannot be empty");
    }
    if (Buffer.byteLength(normalizedText, "utf8") > 10 * 1_024 * 1_024) {
      throw new RangeError("Text item content cannot exceed 10 MiB");
    }
    const timestamp = this.validTimestamp();
    const id = `ztools-created:${this.deviceId}:${crypto.randomUUID()}`;
    const normalizedTitle = title?.trim() || textTitle(normalizedText);
    const payloadRevision = fingerprint({ type: "created-text-payload", text: normalizedText });
    const contentFingerprint = fingerprint({ type: "created-text-item", id });
    const clock = (counter: number): HybridClock => ({
      wallMs: timestamp,
      counter,
      deviceId: this.deviceId,
    });
    const item = PasteItemSchema.parse({
      id,
      kind: "text",
      ...(normalizedTitle === undefined ? {} : { title: normalizedTitle }),
      sourceApp: { name: "Paste剪切板" },
      sourceDeviceId: this.deviceId,
      copiedAt: new Date(timestamp).toISOString(),
      updatedAt: new Date(timestamp).toISOString(),
      contentFingerprint,
      payload: { revision: payloadRevision, text: normalizedText },
      pinned: false,
      fieldClocks: {
        payload: clock(0),
        ...(normalizedTitle === undefined ? {} : { title: clock(1) }),
        pinned: clock(2),
      },
    });
    const record: CanonicalClipboardRecord = {
      item,
      origin: { host: "sync", remoteAvailable: true },
    };
    await this.put(record);
    return record;
  }

  async updateTextItem(
    itemId: string,
    text: string,
    title?: string,
  ): Promise<CanonicalClipboardRecord> {
    const record = await this.findRecordByItemId(itemId);
    if (record === undefined) {
      throw new RangeError("Clipboard item does not exist");
    }
    if (!new Set(["text", "rich_text", "html", "url", "color"]).has(record.item.kind)) {
      throw new TypeError("Clipboard item does not support text editing");
    }
    const normalizedText = text.trim();
    const byteLength = Buffer.byteLength(normalizedText, "utf8");
    if (byteLength === 0 || byteLength > 10 * 1_024 * 1_024) {
      throw new RangeError("Edited text must contain 1 byte to 10 MiB");
    }
    const timestamp = this.validTimestamp();
    const normalizedTitle = title?.trim() || textTitle(normalizedText);
    const { title: _oldTitle, ocrText: _oldOcrText, ...base } = record.item;
    const item = PasteItemSchema.parse({
      ...base,
      kind: "text",
      ...(normalizedTitle === undefined ? {} : { title: normalizedTitle }),
      payload: {
        revision: fingerprint({ type: "edited-text-payload", itemId, text: normalizedText, timestamp }),
        text: normalizedText,
      },
      updatedAt: new Date(timestamp).toISOString(),
      fieldClocks: {
        ...record.item.fieldClocks,
        payload: { wallMs: timestamp, counter: 0, deviceId: this.deviceId },
        title: { wallMs: timestamp, counter: 1, deviceId: this.deviceId },
        ocrText: { wallMs: timestamp, counter: 2, deviceId: this.deviceId },
      },
    });
    const updated: CanonicalClipboardRecord = {
      item,
      origin: { host: "sync", remoteAvailable: true },
    };
    await this.put(updated);
    return updated;
  }

  async updateItemTitle(
    itemId: string,
    title: string,
  ): Promise<CanonicalClipboardRecord> {
    const record = await this.findRecordByItemId(itemId);
    if (record === undefined) {
      throw new RangeError("Clipboard item does not exist");
    }
    const normalizedTitle = title.trim();
    if (normalizedTitle.length === 0 || [...normalizedTitle].length > 160) {
      throw new RangeError("Item title must contain 1 to 160 characters");
    }
    const timestamp = this.validTimestamp();
    const item = PasteItemSchema.parse({
      ...record.item,
      title: normalizedTitle,
      updatedAt: new Date(timestamp).toISOString(),
      fieldClocks: {
        ...record.item.fieldClocks,
        title: { wallMs: timestamp, counter: 0, deviceId: this.deviceId },
      },
    });
    const updated = { item, origin: record.origin };
    await this.put(updated);
    return updated;
  }

  async deleteRecords(itemIds: readonly string[]): Promise<DeleteRecordsResult> {
    if (this.database.remove === undefined) {
      throw new TypeError("ZTools database does not expose remove");
    }
    const requested = new Set(itemIds);
    const records = (await this.listRecords()).filter((record) =>
      requested.has(record.item.id),
    );
    const deletedIds: string[] = [];
    const failures: Array<{ id: string; error: string }> = [];

    for (const record of records) {
      const documentId = this.recordDocumentId(record.item.contentFingerprint);
      try {
        const maximumClock = Math.max(
          ...Object.values(record.item.fieldClocks).map((clock) => clock.wallMs),
          0,
        );
        const deletedAt = Math.max(this.validTimestamp(), maximumClock + 1);
        const tombstoneId = `pasteboard-pro:tombstone:paste_item:${record.item.id}`;
        await putWithConflictRetry(this.database, tombstoneId, (revision) => ({
          _id: tombstoneId,
          ...(revision === undefined ? {} : { _rev: revision }),
          type: "pasteboard-pro-tombstone",
          tombstone: {
            id: record.item.id,
            entityType: "paste_item",
            deleted: true,
            deletedAt: new Date(deletedAt).toISOString(),
            sourceDeviceId: this.deviceId,
            clock: { wallMs: deletedAt, counter: 0, deviceId: this.deviceId },
          },
        }));
        const document = await this.database.get(documentId);
        await this.database.remove(document);
        deletedIds.push(record.item.id);
      } catch (error) {
        if (isDatabaseStatus(error, 404)) {
          deletedIds.push(record.item.id);
        } else {
          failures.push({
            id: record.item.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    for (const missingId of requested) {
      if (!records.some((record) => record.item.id === missingId)) {
        deletedIds.push(missingId);
      }
    }

    return { deletedIds, failures };
  }

  async assignToPinboard(
    itemIds: readonly string[],
    pinboardId: string | undefined,
  ): Promise<CanonicalClipboardRecord[]> {
    const requestedIds = [...new Set(itemIds)];
    const records = await this.listRecords();
    const recordsById = new Map(records.map((record) => [record.item.id, record]));
    for (const id of requestedIds) {
      if (!recordsById.has(id)) {
        throw new RangeError(`Clipboard item ${id} does not exist`);
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

    for (const id of requestedIds) {
      const record = recordsById.get(id)!;
      const timestamp = this.validTimestamp();
      const clock = (counter: number): HybridClock => ({
        wallMs: timestamp,
        counter,
        deviceId: this.deviceId,
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
      await this.put(updated);
      updatedRecords.push(updated);
      previousOrderKey = nextOrderKey;
    }

    return updatedRecords;
  }

  async updateOcrText(
    itemId: string,
    ocrText: string | undefined,
  ): Promise<CanonicalClipboardRecord> {
    const record = await this.findRecordByItemId(itemId);
    if (record === undefined) {
      throw new RangeError("Clipboard item does not exist");
    }
    const timestamp = this.validTimestamp();
    const { ocrText: _oldOcrText, ...base } = record.item;
    const normalized = ocrText?.trim();
    const item = PasteItemSchema.parse({
      ...base,
      ...(normalized === undefined || normalized.length === 0
        ? {}
        : { ocrText: normalized }),
      updatedAt: new Date(timestamp).toISOString(),
      fieldClocks: {
        ...record.item.fieldClocks,
        ocrText: { wallMs: timestamp, counter: 0, deviceId: this.deviceId },
      },
    });
    const updated = { item, origin: record.origin };
    await this.put(updated);
    return updated;
  }

  async updateImagePayload(
    itemId: string,
    input: Readonly<{
      blobId: string;
      revision: string;
      imagePath: string;
      blobBytes: number;
      mediaType: "image/png";
    }>,
  ): Promise<CanonicalClipboardRecord> {
    const record = await this.findRecordByItemId(itemId);
    if (record === undefined) {
      throw new RangeError("Clipboard item does not exist");
    }
    if (record.item.kind !== "image") {
      throw new TypeError("Clipboard item is not an image");
    }
    const timestamp = this.validTimestamp();
    const { ocrText: _oldOcrText, ...base } = record.item;
    const item = PasteItemSchema.parse({
      ...base,
      payload: {
        ...record.item.payload,
        revision: input.revision,
        blobId: input.blobId,
        mediaType: input.mediaType,
      },
      updatedAt: new Date(timestamp).toISOString(),
      fieldClocks: {
        ...record.item.fieldClocks,
        payload: { wallMs: timestamp, counter: 0, deviceId: this.deviceId },
        ocrText: { wallMs: timestamp, counter: 1, deviceId: this.deviceId },
      },
    });
    const updated: CanonicalClipboardRecord = {
      item,
      origin: {
        host: "sync",
        remoteAvailable: true,
        imagePath: input.imagePath,
        blobBytes: input.blobBytes,
        pluginBlobId: input.blobId,
      },
    };
    await this.put(updated);
    return updated;
  }

  private recordDocumentId(fingerprint: string): string {
    return `pasteboard-pro:record:${fingerprint}`;
  }

  private validTimestamp(): number {
    const value = this.now();
    if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) {
      throw new RangeError("Canonical store clock returned an invalid timestamp");
    }
    return value;
  }
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

function finiteTimestamp(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isFinite(new Date(value).getTime())
    ? value
    : undefined;
}

function hostCursor(value: unknown): HostCursor | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = nonEmptyString(value.id);
  const timestamp = finiteTimestamp(value.timestamp);
  return id === undefined || timestamp === undefined
    ? undefined
    : { id, timestamp };
}

function compareCursor(left: HostCursor, right: HostCursor): -1 | 0 | 1 {
  if (left.timestamp < right.timestamp) {
    return -1;
  }
  if (left.timestamp > right.timestamp) {
    return 1;
  }
  if (left.id < right.id) {
    return -1;
  }
  if (left.id > right.id) {
    return 1;
  }
  return 0;
}

function textTitle(text: string): string | undefined {
  const firstLine = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return firstLine === undefined ? undefined : firstLine.slice(0, 80);
}

function normalizeFiles(value: Record<string, unknown>): HostClipboardFile[] {
  if (Array.isArray(value.files)) {
    return value.files.flatMap((candidate) => {
      if (!isRecord(candidate)) {
        return [];
      }
      const path = nonEmptyString(candidate.path);
      if (path === undefined) {
        return [];
      }
      const name = nonEmptyString(candidate.name);
      return [
        {
          path,
          ...(name === undefined ? {} : { name }),
          ...(typeof candidate.isDirectory === "boolean"
            ? { isDirectory: candidate.isDirectory }
            : {}),
          ...(typeof candidate.exists === "boolean"
            ? { exists: candidate.exists }
            : {}),
        },
      ];
    });
  }

  const path = nonEmptyString(value.filePath);
  if (path === undefined) {
    return [];
  }
  const name = nonEmptyString(value.fileName);
  return [{ path, ...(name === undefined ? {} : { name }) }];
}

function inferImageMediaType(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    default:
      return "image/png";
  }
}

function fingerprint(value: unknown): string {
  const input = JSON.stringify(value);
  let hash = 0xcbf29ce484222325n;

  for (const character of input) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }

  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

function sourceApp(value: Record<string, unknown>): PasteItem["sourceApp"] {
  const name = nonEmptyString(value.appName);
  const bundleId = nonEmptyString(value.appBundleId);
  return name === undefined && bundleId === undefined
    ? undefined
    : {
        ...(name === undefined ? {} : { name }),
        ...(bundleId === undefined ? {} : { bundleId }),
      };
}

export function normalizeHostClipboardItem(
  value: unknown,
  deviceId: string,
): CanonicalClipboardRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const cursor = hostCursor(value);
  const hostType = value.type;
  if (
    cursor === undefined ||
    (hostType !== "text" && hostType !== "image" && hostType !== "file")
  ) {
    return null;
  }

  const normalizedDeviceId = nonEmptyString(deviceId);
  if (normalizedDeviceId === undefined) {
    throw new TypeError("deviceId must be a non-empty string");
  }

  const copiedAt = new Date(cursor.timestamp).toISOString();
  const clock: HybridClock = {
    wallMs: cursor.timestamp,
    counter: 0,
    deviceId: normalizedDeviceId,
  };
  let kind: PasteItem["kind"];
  let payload: PastePayload;
  let title: string | undefined;
  let origin: CanonicalClipboardOrigin;

  if (hostType === "text") {
    const text =
      typeof value.content === "string"
        ? value.content
        : typeof value.preview === "string"
          ? value.preview
          : undefined;
    if (text === undefined || text.length === 0) {
      return null;
    }
    const contentFingerprint = fingerprint({ type: hostType, text });
    kind = "text";
    payload = { revision: contentFingerprint, text };
    title = textTitle(text);
    origin = { host: "ztools", hostItemId: cursor.id, hostType };
  } else if (hostType === "image") {
    const imagePath = nonEmptyString(value.imagePath);
    if (imagePath === undefined) {
      return null;
    }
    const contentFingerprint = fingerprint({ type: hostType, imagePath });
    kind = "image";
    payload = {
      revision: contentFingerprint,
      blobId: `ztools-image:${cursor.id}`,
      mediaType: inferImageMediaType(imagePath),
    };
    title = nonEmptyString(value.preview);
    const blobBytes =
      Number.isSafeInteger(value.byteSize) && Number(value.byteSize) >= 0
        ? Number(value.byteSize)
        : Number.isSafeInteger(value.size) && Number(value.size) >= 0
          ? Number(value.size)
          : undefined;
    origin = {
      host: "ztools",
      hostItemId: cursor.id,
      hostType,
      imagePath,
      ...(blobBytes === undefined ? {} : { blobBytes }),
    };
  } else {
    const files = normalizeFiles(value);
    if (files.length === 0) {
      return null;
    }
    const filePaths = files.map((file) => file.path);
    const contentFingerprint = fingerprint({ type: hostType, filePaths });
    kind = "files";
    payload = { revision: contentFingerprint, filePaths };
    title =
      files.length === 1
        ? (files[0]?.name ?? files[0]?.path)
        : `${files.length} items`;
    origin = { host: "ztools", hostItemId: cursor.id, hostType };
  }

  const app = sourceApp(value);
  const item = PasteItemSchema.parse({
    id: `ztools:${cursor.id}`,
    kind,
    ...(title === undefined ? {} : { title }),
    ...(app === undefined ? {} : { sourceApp: app }),
    sourceDeviceId: normalizedDeviceId,
    copiedAt,
    updatedAt: copiedAt,
    contentFingerprint: payload.revision,
    payload,
    pinned: false,
    fieldClocks: {
      ...(title === undefined ? {} : { title: clock }),
      payload: clock,
      pinned: clock,
    },
  });

  return { item, origin };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new RangeError("Pagination values must be positive integers");
  }
  return resolved;
}

export async function mirrorHostHistory(
  host: HostClipboardApi,
  store: CanonicalClipboardStore,
  options: MirrorHostHistoryOptions,
): Promise<MirrorHostHistoryResult> {
  const pageSize = positiveInteger(options.pageSize, 100);
  const maxPages = positiveInteger(options.maxPages, 1_000);
  const savedCursor = await store.getCursor();
  let newestCursor = savedCursor;
  let imported = 0;
  let skipped = 0;
  let pages = 0;
  let loaded = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await host.getHistory(page, pageSize);
    if (
      !Array.isArray(result.items) ||
      !Number.isSafeInteger(result.total) ||
      result.total < 0
    ) {
      throw new TypeError("ZTools clipboard history returned an invalid page");
    }

    pages += 1;
    loaded += result.items.length;
    let newerItemsInPage = 0;

    for (const rawItem of result.items) {
      const cursor = hostCursor(rawItem);
      if (cursor === undefined) {
        skipped += 1;
        continue;
      }

      if (newestCursor === undefined || compareCursor(cursor, newestCursor) > 0) {
        newestCursor = cursor;
      }

      if (savedCursor !== undefined && compareCursor(cursor, savedCursor) <= 0) {
        skipped += 1;
        continue;
      }

      newerItemsInPage += 1;
      const record = normalizeHostClipboardItem(rawItem, options.deviceId);
      if (record === null) {
        skipped += 1;
        continue;
      }

      if (
        options.shouldPersist !== undefined &&
        !(await options.shouldPersist(rawItem, record))
      ) {
        skipped += 1;
        continue;
      }

      const existing = await store.findByFingerprint(
        record.item.contentFingerprint,
      );
      if (existing !== undefined) {
        skipped += 1;
        continue;
      }

      await store.put(record);
      imported += 1;
    }

    if (
      result.items.length === 0 ||
      loaded >= Math.max(0, result.total) ||
      (savedCursor !== undefined && newerItemsInPage === 0)
    ) {
      break;
    }

    if (page === maxPages) {
      throw new RangeError("Clipboard history exceeded the configured page limit");
    }
  }

  if (
    newestCursor !== undefined &&
    (savedCursor === undefined || compareCursor(newestCursor, savedCursor) > 0)
  ) {
    await store.setCursor(newestCursor);
  }

  return { imported, skipped, pages };
}

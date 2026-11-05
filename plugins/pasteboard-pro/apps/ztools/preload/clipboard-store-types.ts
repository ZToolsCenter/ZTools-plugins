import type { PasteItem } from "@pasteboard-pro/core";

export type HostCursor = Readonly<{
  id: string;
  timestamp: number;
}>;

export type HistoryClearBoundary = Readonly<{
  through: HostCursor;
  clearedIdentities: readonly string[];
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
  getImageRetryBoundary(): Promise<HostCursor | undefined>;
  setImageRetryBoundary(boundary: HostCursor | undefined): Promise<void>;
  getHistoryClearBoundary(): Promise<HistoryClearBoundary | undefined>;
  advanceHistoryClearBoundary(boundary: HistoryClearBoundary): Promise<void>;
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
  ready?: Promise<void>;
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
    record: CanonicalClipboardRecord | null,
  ) => boolean | Promise<boolean>;
  prepareRecord?: (
    rawItem: unknown,
    record: CanonicalClipboardRecord,
  ) => CanonicalClipboardRecord | Promise<CanonicalClipboardRecord>;
}>;

export type MirrorHostHistoryResult = Readonly<{
  imported: number;
  skipped: number;
  pages: number;
}>;

export type ClipboardCommandPort = Readonly<{
  deviceId: string;
  validTimestamp(): number;
  findRecordByItemId(itemId: string): Promise<CanonicalClipboardRecord | undefined>;
  listRecords(): Promise<CanonicalClipboardRecord[]>;
  put(record: CanonicalClipboardRecord): Promise<void>;
}>;

export type ClipboardGroupPort = ClipboardCommandPort & Readonly<{
  database: ZToolsDocumentDatabase;
  recordDocumentId(fingerprint: string): string;
}>;

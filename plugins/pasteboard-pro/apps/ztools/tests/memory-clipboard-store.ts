import { compareCursor } from "../preload/clipboard-host-normalization";
import type { PasteItem } from "@pasteboard-pro/core";
import type { CanonicalClipboardRecord, CanonicalClipboardStore, HistoryClearBoundary, HostCursor } from "../preload/clipboard-store-types";

export class MemoryStore implements CanonicalClipboardStore {
  readonly records = new Map<string, CanonicalClipboardRecord>();
  private readonly fingerprints = new Map<string, PasteItem>();
  private cursor: HostCursor | undefined;
  private imageRetryBoundary: HostCursor | undefined;
  private historyClearBoundary: HistoryClearBoundary | undefined;

  async findByFingerprint(fingerprint: string): Promise<PasteItem | undefined> {
    return this.fingerprints.get(fingerprint);
  }

  async put(record: CanonicalClipboardRecord): Promise<void> {
    this.records.set(record.item.id, structuredClone(record));
    this.fingerprints.set(
      record.item.contentFingerprint,
      structuredClone(record.item),
    );
  }

  async getCursor(): Promise<HostCursor | undefined> {
    return this.cursor === undefined ? undefined : { ...this.cursor };
  }

  async setCursor(cursor: HostCursor): Promise<void> {
    this.cursor = { ...cursor };
  }

  async getImageRetryBoundary(): Promise<HostCursor | undefined> {
    return this.imageRetryBoundary === undefined ? undefined : { ...this.imageRetryBoundary };
  }

  async setImageRetryBoundary(boundary: HostCursor | undefined): Promise<void> {
    this.imageRetryBoundary = boundary === undefined ? undefined : { ...boundary };
  }

  async getHistoryClearBoundary(): Promise<HistoryClearBoundary | undefined> {
    return this.historyClearBoundary === undefined ? undefined : structuredClone(this.historyClearBoundary);
  }

  async advanceHistoryClearBoundary(boundary: HistoryClearBoundary): Promise<void> {
    const current = this.historyClearBoundary;
    this.historyClearBoundary = {
      through: { ...(current !== undefined && compareCursor(current.through, boundary.through) > 0
        ? current.through : boundary.through) },
      clearedIdentities: [...new Set([...(current?.clearedIdentities ?? []), ...boundary.clearedIdentities])].sort(),
    };
  }

}

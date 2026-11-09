import type { ZToolsCanonicalClipboardStore } from "./clipboard-store";
import type { ZToolsWindowPreferencesStore } from "./window-preferences";
import { fetchUrlMetadata, shouldFetchUrlMetadata, type UrlMeta } from "./url-metadata-service";
import { storedRecord } from "./clipboard-record-codec";

export type UrlMetadataSchedulerOptions = Readonly<{
  store: ZToolsCanonicalClipboardStore;
  windowPreferencesStore: ZToolsWindowPreferencesStore;
  onItemUpdated?: () => void;
  fetchDelayMs?: number;
}>;

type QueueEntry = Readonly<{
  itemId: string;
  url: string;
}>;

const MAX_QUEUE_SIZE = 64;

export class UrlMetadataScheduler {
  private readonly queue: QueueEntry[] = [];
  private readonly queuedItemIds = new Set<string>();
  private readonly processedItemIds = new Set<string>();
  private onItemUpdatedCallback?: () => void;
  private isProcessing = false;
  private isDestroyed = false;
  private readonly fetchDelayMs: number;

  constructor(private readonly options: UrlMetadataSchedulerOptions) {
    this.fetchDelayMs = options.fetchDelayMs ?? 350;
  }

  setOnItemUpdated(callback: () => void): void {
    this.onItemUpdatedCallback = callback;
  }

  enqueue(itemId: string, rawUrl: string): void {
    if (this.isDestroyed) return;
    if (this.queuedItemIds.has(itemId) || this.processedItemIds.has(itemId)) return;
    if (!shouldFetchUrlMetadata(rawUrl)) {
      this.processedItemIds.add(itemId);
      return;
    }

    // Bound memory if rapid copying occurs
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      const dropped = this.queue.shift();
      if (dropped) {
        this.queuedItemIds.delete(dropped.itemId);
        this.processedItemIds.add(dropped.itemId);
      }
    }

    this.queuedItemIds.add(itemId);
    this.queue.push({ itemId, url: rawUrl.trim() });
    void this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.isDestroyed || this.queue.length === 0) return;
    this.isProcessing = true;

    try {
      while (this.queue.length > 0 && !this.isDestroyed) {
        const entry = this.queue.shift();
        if (!entry) break;
        this.queuedItemIds.delete(entry.itemId);
        this.processedItemIds.add(entry.itemId);

        // Check if user disabled URL metadata in settings
        try {
          const preferences = await this.options.windowPreferencesStore.get();
          if (preferences.fetchUrlMetadata === false) {
            this.queue.length = 0;
            this.queuedItemIds.clear();
            break;
          }
        } catch {}

        try {
          const metadata = await fetchUrlMetadata(entry.url);
          if (metadata && (metadata.title || metadata.favicon || metadata.hostname)) {
            await this.options.store.updateItemUrlMetadata(entry.itemId, metadata);
            this.options.onItemUpdated?.();
            this.onItemUpdatedCallback?.();
          }
        } catch {
          // Failures should never disrupt or crash the app
        }

        // Delay between fetches to avoid network/CPU spikes
        if (this.queue.length > 0 && !this.isDestroyed) {
          await new Promise((resolve) => setTimeout(resolve, this.fetchDelayMs));
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  async scanHistoricalItems(maxCount = 50): Promise<number> {
    if (this.isDestroyed) return 0;

    try {
      const preferences = await this.options.windowPreferencesStore.get();
      if (preferences.fetchUrlMetadata === false) return 0;
    } catch {
      return 0;
    }

    let enqueuedCount = 0;
    try {
      const documents = await this.options.store.readHistoryDocuments();
      for (const rawDoc of documents) {
        if (enqueuedCount >= maxCount) break;

        const record = storedRecord(rawDoc);
        if (!record) continue;

        const item = record.item;
        const text = item.payload.text?.trim() ?? "";

        const isUrlKind = item.kind === "url" || shouldFetchUrlMetadata(text);
        const hasMeta = Boolean(item.payload.urlMeta?.title || item.payload.urlMeta?.favicon);

        if (isUrlKind && !hasMeta && shouldFetchUrlMetadata(text)) {
          if (!this.queuedItemIds.has(item.id) && !this.processedItemIds.has(item.id)) {
            this.enqueue(item.id, text);
            enqueuedCount += 1;
          }
        }
      }
    } catch (error) {
      console.warn("[pasteboard-pro] url metadata historical scan failed", error);
    }

    return enqueuedCount;
  }

  // Backward compatibility alias for any existing caller
  async runHistoricalMigration(): Promise<number> {
    return this.scanHistoricalItems();
  }

  destroy(): void {
    this.isDestroyed = true;
    this.queue.length = 0;
    this.queuedItemIds.clear();
  }
}

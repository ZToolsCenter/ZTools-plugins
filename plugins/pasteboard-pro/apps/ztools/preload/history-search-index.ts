import { searchPasteItems, type PasteItem } from "@pasteboard-pro/core";
import { applyListOrder } from "../src/list-order";
import { isSmartPinboardId, matchesSmartPinboard } from "../src/smart-pinboards";
import { storedRecord, type CanonicalClipboardRecord } from "./clipboard-store";
import type { HistoryPage, HistoryRequest } from "./history-page";

/** Lives exclusively in the worker. Cursors address a versioned result snapshot. */
export class HistorySearchIndex {
  private readonly records = new Map<string, CanonicalClipboardRecord>();
  private version = 0;
  private orderedSearchItems: PasteItem[] | undefined;
  private readonly searchable = new Map<string, PasteItem>();
  private readonly originals = new WeakMap<PasteItem, PasteItem>();
  private sequence = 0;
  private readonly snapshots = new Map<string, { key: string; items: PasteItem[] }>();

  replace(documents: readonly unknown[]): void {
    this.records.clear();
    this.searchable.clear();
    this.update(documents, []);
  }

  update(documents: readonly unknown[], removed: readonly string[]): void {
    for (const id of removed) { this.records.delete(id); this.searchable.delete(id); }
    for (const document of documents) {
      const record = storedRecord(document);
      const id = (document as { _id?: unknown } | null)?._id;
      if (typeof id !== "string") continue;
      if (record === undefined) { this.records.delete(id); this.searchable.delete(id); }
      else {
        this.records.set(id, record);
        const normalized = normalizedSearchItem(record.item);
        this.searchable.set(id, normalized);
        this.originals.set(normalized, record.item);
      }
    }
    this.orderedSearchItems = undefined;
    this.version++;
    this.snapshots.clear();
  }

  order(request: HistoryRequest): string[] {
    const { cursor: _cursor, ...firstPage } = request;
    this.page({ ...firstPage, limit: 1 });
    return [...this.snapshots.values()].at(-1)!.items.map(item => item.id);
  }

  page(request: HistoryRequest): HistoryPage {
    const limit = request.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError("Page size must be 1–100");
    const key = JSON.stringify([request.query ?? "", request.pinboardId, request.orderedIds ?? []]);
    let offset = 0;
    let token: string | undefined;
    let snapshot: { key: string; items: PasteItem[] } | undefined;
    if (request.cursor !== undefined) {
      const match = /^(\d+-\d+):(\d+)$/.exec(request.cursor);
      token = match?.[1];
      offset = Number(match?.[2]);
      snapshot = token === undefined ? undefined : this.snapshots.get(token);
      if (snapshot?.key !== key || !Number.isSafeInteger(offset) || offset < 0) {
        const { cursor: _cursor, ...firstPage } = request;
        return { ...this.page(firstPage), reset: true };
      }
    }
    if (snapshot === undefined) {
      // Stable tie order matches listRecords; the shared query function preserves
      // substring matching, Chinese text, quoted phrases, OCR and all filters.
      this.orderedSearchItems ??= [...this.searchable.values()].sort((a, b) =>
        Date.parse(b.copiedAt) - Date.parse(a.copiedAt) || a.id.localeCompare(b.id));
      const matched = searchPasteItems(this.orderedSearchItems, request.query ?? "")
        .map(item => this.originals.get(item)!);
      const scope = request.pinboardId;
      const scoped = scope === undefined ? matched : matched.filter(item =>
        isSmartPinboardId(scope) ? matchesSmartPinboard(item, scope) : item.pinboardId === scope);
      snapshot = { key, items: applyListOrder(scoped, request.orderedIds ?? []) };
      token = `${this.version}-${++this.sequence}`;
      this.snapshots.set(token, snapshot);
      while (this.snapshots.size > 4) this.snapshots.delete(this.snapshots.keys().next().value!);
    }
    const end = Math.min(snapshot.items.length, offset + limit);
    return {
      items: snapshot.items.slice(offset, end).map(historyCard),
      total: snapshot.items.length,
      ...(end < snapshot.items.length ? { nextCursor: `${token}:${end}` } : {}),
    };
  }
}

/** The list gets bounded previews; clipboard actions always fetch full records. */
function historyCard(item: PasteItem): PasteItem {
  return {
    ...item,
    ...(item.title === undefined ? {} : { title: item.title.slice(0, 1_024) }),
    ...(item.ocrText === undefined ? {} : { ocrText: item.ocrText.slice(0, 4_096) }),
    payload: {
      ...item.payload,
      ...(item.payload.text === undefined ? {} : { text: item.payload.text.slice(0, 4_096) }),
      ...(item.payload.html === undefined ? {} : { html: item.payload.html.slice(0, 4_096) }),
    },
  };
}

/** Normalize searchable fields once per change, retaining originals for display/paste. */
function normalizedSearchItem(item: PasteItem): PasteItem {
  return {
    ...item,
    ...(item.title === undefined ? {} : { title: item.title.toLowerCase() }),
    ...(item.ocrText === undefined ? {} : { ocrText: item.ocrText.toLowerCase() }),
    sourceDeviceId: item.sourceDeviceId.toLowerCase(),
    ...(item.sourceApp === undefined ? {} : { sourceApp: {
      ...item.sourceApp,
      ...(item.sourceApp.name === undefined ? {} : { name: item.sourceApp.name.toLowerCase() }),
      ...(item.sourceApp.bundleId === undefined ? {} : { bundleId: item.sourceApp.bundleId.toLowerCase() }),
    } }),
    payload: {
      ...item.payload,
      ...(item.payload.text === undefined ? {} : { text: item.payload.text.toLowerCase() }),
      ...(item.payload.html === undefined ? {} : { html: item.payload.html.toLowerCase() }),
      ...(item.payload.mediaType === undefined ? {} : { mediaType: item.payload.mediaType.toLowerCase() }),
      ...(item.payload.filePaths === undefined ? {} : { filePaths: item.payload.filePaths.map(value => value.toLowerCase()) }),
    },
  };
}

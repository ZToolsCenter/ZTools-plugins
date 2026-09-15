import { describe, expect, it, vi } from "vitest";
import { historyFixture } from "@pasteboard-pro/contract-fixtures";
import { PasteItemSchema, searchPasteItems, type PasteItem } from "@pasteboard-pro/core";
import { HistorySearchIndex } from "../preload/history-search-index";
import { HistoryPager } from "../src/history-pager";
import { HistoryRpcClient } from "../preload/history-rpc";
import { ZToolsCanonicalClipboardStore } from "../preload/clipboard-store";
import { takeRecordChanges } from "../preload/record-index";
import type { HistoryPage } from "../preload/history-page";

function item(i: number): PasteItem {
  return {
    ...historyFixture[0]!, id: `item-${i}`, contentFingerprint: `fp-${i}`,
    kind: "text", title: `Record ${i}`, pinned: false,
    copiedAt: new Date(1_800_000_000_000 - i).toISOString(),
    payload: { revision: `r-${i}`, text: `Clipboard ${i}` },
  };
}
function doc(value: PasteItem) {
  return { _id: `pasteboard-pro:record:${value.contentFingerprint}`, type: "pasteboard-pro-record",
    record: { item: value, origin: { host: "sync", remoteAvailable: true } } };
}

describe("worker history index", () => {
  it("searches beyond 10k, pages 100k records and retains full text outside card previews", () => {
    const index = new HistorySearchIndex();
    const items = Array.from({ length: 100_000 }, (_, i) => item(i));
    items[99_999] = { ...items[99_999]!, payload: { revision: "long", text: "x".repeat(8_192) + " 中文尾部命中" } };
    index.replace(items.map(doc));
    const first = index.page({});
    expect(first.total).toBe(100_000);
    expect(first.items).toHaveLength(50);
    expect(index.page({ cursor: first.nextCursor! }).items[0]?.id).toBe("item-50");
    const search = index.page({ query: "中文尾部命中" });
    expect(search.items.map(value => value.id)).toEqual(["item-99999"]);
    expect(search.items[0]?.payload.text).toHaveLength(4_096);
    expect(index.order({})).toHaveLength(100_000);
  }, 15_000);

  it.each(["", "type:image", "invoice", '"hello world"', "app:Safari", "device:mac", "date:2026-07-16", "board:work"])(
    "preserves shared search semantics for %s", query => {
      const index = new HistorySearchIndex();
      index.replace(historyFixture.map(value => doc(PasteItemSchema.parse(value))));
      const sorted = historyFixture.map(value => PasteItemSchema.parse(value)).sort((a, b) => Date.parse(b.copiedAt) - Date.parse(a.copiedAt) || a.id.localeCompare(b.id));
      expect(index.page({ query, limit: 100 }).items.map(value => value.id))
        .toEqual(searchPasteItems(sorted, query).map(value => value.id));
    },
  );

  it("invalidates cursors after a write, deletion or query change without skipping rows", () => {
    const index = new HistorySearchIndex();
    index.replace(Array.from({ length: 120 }, (_, i) => doc(item(i))));
    const first = index.page({});
    index.update([doc(item(-1))], [doc(item(0))._id]);
    const restarted = index.page({ cursor: first.nextCursor! });
    expect(restarted.reset).toBe(true);
    expect(restarted.items[0]?.id).toBe("item--1");
    expect(restarted.total).toBe(120);
    expect(index.page({ query: "missing", cursor: restarted.nextCursor! })).toMatchObject({ items: [], total: 0, reset: true });
  });

  it("keeps full-scope ordering and filters before paging", () => {
    const index = new HistorySearchIndex();
    index.replace(Array.from({ length: 120 }, (_, i) => doc({ ...item(i), pinboardId: i % 2 === 0 ? "work" : "personal" })));
    const ids = index.order({ pinboardId: "work" });
    const reordered = [ids.at(-1)!, ...ids.slice(0, -1)];
    const first = index.page({ pinboardId: "work", orderedIds: reordered });
    expect(first.total).toBe(60);
    expect(first.items[0]?.id).toBe("item-118");
    expect(index.page({ pinboardId: "work", orderedIds: reordered, cursor: first.nextCursor! }).items).toHaveLength(10);
  });
});

describe("history pager", () => {
  it("discards stale replies and coalesces rapid query changes", async () => {
    let resolve!: (value: HistoryPage) => void;
    const read = vi.fn().mockImplementationOnce(() => new Promise<HistoryPage>(done => { resolve = done; }))
      .mockResolvedValue({ items: [item(99)], total: 1 });
    const apply = vi.fn();
    const pager = new HistoryPager(read, apply);
    const first = pager.refresh({ query: "old" });
    await Promise.resolve();
    void pager.refresh({ query: "intermediate" });
    void pager.refresh({ query: "latest" });
    resolve({ items: [item(0)], total: 1 });
    await first;
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[1]?.[0].query).toBe("latest");
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]?.[0].items[0].id).toBe("item-99");
  });

  it("preserves the loaded range on refresh and restarts an expired append cursor", async () => {
    const index = new HistorySearchIndex();
    index.replace(Array.from({ length: 120 }, (_, i) => doc(item(i))));
    const apply = vi.fn();
    const pager = new HistoryPager(async request => index.page(request), apply);
    await pager.refresh({});
    await pager.loadMore();
    expect(apply.mock.lastCall?.[0].items).toHaveLength(100);
    await pager.refresh({}, true);
    expect(apply.mock.lastCall?.[0].items).toHaveLength(100);
    index.update([doc(item(-1))], []);
    await pager.loadMore();
    expect(apply.mock.lastCall?.[0].items).toHaveLength(50);
    expect(apply.mock.lastCall?.[0].items[0].id).toBe("item--1");
  });
});

it("routes only the current shelf session's response and cleans up pending RPCs", async () => {
  const send = vi.fn();
  const rpc = new HistoryRpcClient("new-window", send);
  const pending = rpc.page({ query: "needle" });
  rpc.receive({ id: "old-window:1", page: { items: [], total: 0 } });
  rpc.receive({ id: send.mock.calls[0]![0], page: { items: [item(1)], total: 1 } });
  await expect(pending).resolves.toMatchObject({ total: 1 });
  const closing = rpc.page({});
  rpc.dispose();
  await expect(closing).rejects.toThrow("closed");
});

it("indexes IDs once and reads only changed/requested documents across store instances", async () => {
  const documents = new Map([[doc(item(0))._id, doc(item(0))]]);
  const allDocs = vi.fn(async () => [...documents.values()]);
  const get = vi.fn(async (id: string) => documents.get(id));
  const database = { allDocs, get, put: async (value: Record<string, unknown>) => { documents.set(String(value._id), value as ReturnType<typeof doc>); } };
  const store = new ZToolsCanonicalClipboardStore(database);
  const syncStore = new ZToolsCanonicalClipboardStore(database);
  await store.readHistoryDocuments();
  await store.findRecordByItemId("item-0");
  await syncStore.put(doc(item(1)).record as Parameters<typeof store.put>[0]);
  const changes = takeRecordChanges(database);
  expect(changes).toEqual([doc(item(1))._id]);
  await store.readHistoryChanges(changes);
  await store.findRecordByItemId("item-1");
  expect(allDocs).toHaveBeenCalledTimes(1);
});

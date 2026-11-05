import { describe, expect, it, vi } from "vitest";

import { clearClipboardHistory } from "../preload/clear-history";

const emptyHost = { getHistory: async () => ({ items: [], total: 0 }) };

describe("clear clipboard history", () => {
  it("deletes every record, owned blob, and current system clipboard", async () => {
    const records = [
      {
        item: { id: "image-1" },
        origin: {
          pluginBlobId: "blob-shared",
          imagePath: "/plugin/blobs/shared.png",
        },
      },
      {
        item: { id: "image-2" },
        origin: {
          pluginBlobId: "blob-shared",
          imagePath: "/plugin/blobs/shared.png",
        },
      },
      { item: { id: "text-1" }, origin: {} },
    ];
    const store = {
      setImageRetryBoundary: vi.fn(async () => undefined),
      listRecords: vi.fn(async () => records),
      deleteRecords: vi.fn(async () => ({
        deletedIds: records.map((record) => record.item.id),
        failures: [],
      })),
    };
    const blobStore = { delete: vi.fn(async () => undefined) };
    const systemClipboard = { clear: vi.fn() };

    await expect(
      clearClipboardHistory(store as never, blobStore, systemClipboard, emptyHost),
    ).resolves.toEqual({ deleted: 3, failed: 0, blobFailures: 0 });
    expect(blobStore.delete).toHaveBeenCalledTimes(1);
    expect(systemClipboard.clear).toHaveBeenCalledOnce();
    expect(store.setImageRetryBoundary).toHaveBeenCalledWith(undefined);
  });

  it("preserves a blob still referenced by a record that failed to delete", async () => {
    const records = [
      {
        item: { id: "deleted" },
        origin: { pluginBlobId: "blob-shared", imagePath: "/plugin/shared.png" },
      },
      {
        item: { id: "failed" },
        origin: { pluginBlobId: "blob-shared", imagePath: "/plugin/shared.png" },
      },
    ];
    const store = {
      setImageRetryBoundary: vi.fn(async () => undefined),
      listRecords: vi.fn(async () => records),
      deleteRecords: vi.fn(async () => ({
        deletedIds: ["deleted"],
        failures: [{ id: "failed", error: "conflict" }],
      })),
    };
    const blobStore = { delete: vi.fn(async () => undefined) };
    const systemClipboard = { clear: vi.fn() };

    await expect(
      clearClipboardHistory(store as never, blobStore, systemClipboard, emptyHost),
    ).resolves.toEqual({ deleted: 1, failed: 1, blobFailures: 0 });
    expect(blobStore.delete).not.toHaveBeenCalled();
    expect(systemClipboard.clear).toHaveBeenCalledOnce();
    expect(store.setImageRetryBoundary).toHaveBeenCalledWith(undefined);
  });
  it("stops clearing when retry progress reset is not confirmed", async () => {
    const failure = new Error("progress reset failed");
    const store = {
      setImageRetryBoundary: vi.fn(async () => { throw failure; }),
      listRecords: vi.fn(async () => []),
      deleteRecords: vi.fn(),
    };
    const systemClipboard = { clear: vi.fn() };
    await expect(clearClipboardHistory(store as never, { delete: vi.fn() }, systemClipboard, emptyHost)).rejects.toBe(failure);
    expect(store.listRecords).not.toHaveBeenCalled();
    expect(store.deleteRecords).not.toHaveBeenCalled();
    expect(systemClipboard.clear).not.toHaveBeenCalled();
  });
});

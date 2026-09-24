import { describe, expect, it, vi } from "vitest";

import { clearClipboardHistory } from "../preload/clear-history";

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
      listRecords: vi.fn(async () => records),
      deleteRecords: vi.fn(async () => ({
        deletedIds: records.map((record) => record.item.id),
        failures: [],
      })),
    };
    const blobStore = { delete: vi.fn(async () => undefined) };
    const systemClipboard = { clear: vi.fn() };

    await expect(
      clearClipboardHistory(store as never, blobStore, systemClipboard),
    ).resolves.toEqual({ deleted: 3, failed: 0, blobFailures: 0 });
    expect(blobStore.delete).toHaveBeenCalledTimes(1);
    expect(systemClipboard.clear).toHaveBeenCalledOnce();
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
      listRecords: vi.fn(async () => records),
      deleteRecords: vi.fn(async () => ({
        deletedIds: ["deleted"],
        failures: [{ id: "failed", error: "conflict" }],
      })),
    };
    const blobStore = { delete: vi.fn(async () => undefined) };
    const systemClipboard = { clear: vi.fn() };

    await expect(
      clearClipboardHistory(store as never, blobStore, systemClipboard),
    ).resolves.toEqual({ deleted: 1, failed: 1, blobFailures: 0 });
    expect(blobStore.delete).not.toHaveBeenCalled();
    expect(systemClipboard.clear).toHaveBeenCalledOnce();
  });
});

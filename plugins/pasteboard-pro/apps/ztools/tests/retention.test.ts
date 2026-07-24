import { describe, expect, it, vi } from "vitest";

import type { PasteItem } from "@pasteboard-pro/core";

import {
  executeRetentionPrune,
  type RetentionBlobStore,
} from "../preload/retention";
import type {
  CanonicalClipboardRecord,
  ZToolsCanonicalClipboardStore,
} from "../preload/clipboard-store";

const record = (
  id: string,
  copiedAt: string,
  options: {
    pinned?: boolean;
    pinboardId?: string;
    blobBytes?: number;
    pluginBlobId?: string;
  } = {},
): CanonicalClipboardRecord => {
  const item: PasteItem = {
    id,
    kind: options.pluginBlobId === undefined ? "text" : "image",
    sourceDeviceId: "device",
    copiedAt,
    updatedAt: copiedAt,
    contentFingerprint: `fp:${id}`,
    payload:
      options.pluginBlobId === undefined
        ? { revision: `rev:${id}`, text: id }
        : {
            revision: `rev:${id}`,
            blobId: options.pluginBlobId,
            mediaType: "image/png",
          },
    ...(options.pinboardId === undefined
      ? {}
      : { pinboardId: options.pinboardId }),
    pinned: options.pinned ?? false,
    fieldClocks: {},
  };
  return {
    item,
    origin: {
      host: "ztools",
      hostItemId: `host:${id}`,
      hostType: options.pluginBlobId === undefined ? "text" : "image",
      ...(options.blobBytes === undefined
        ? {}
        : { blobBytes: options.blobBytes }),
      ...(options.pluginBlobId === undefined
        ? {}
        : { pluginBlobId: options.pluginBlobId }),
    },
  };
};

describe("retention executor", () => {
  it("deletes planned metadata and owned blobs while preserving Pinboards", async () => {
    const records = [
      record("expired", "2026-01-01T00:00:00Z", {
        blobBytes: 40,
        pluginBlobId: "blob-expired",
      }),
      record("protected", "2026-01-01T00:00:00Z", {
        pinboardId: "board-work",
        blobBytes: 90,
        pluginBlobId: "blob-protected",
      }),
      record("recent", "2026-07-15T00:00:00Z", {
        blobBytes: 20,
        pinned: true,
      }),
    ];
    const deleteRecords = vi.fn(async () => ({
      deletedIds: ["expired"],
      failures: [],
    }));
    const store = {
      listRecords: async () => records,
      deleteRecords,
    } as unknown as ZToolsCanonicalClipboardStore;
    const blobStore: RetentionBlobStore = {
      delete: vi.fn(async () => undefined),
    };

    await expect(
      executeRetentionPrune(
        store,
        { days: 90, maxBlobBytes: 100, now: "2026-07-16T00:00:00Z" },
        blobStore,
      ),
    ).resolves.toEqual({
      plannedIds: ["expired"],
      deletedIds: ["expired"],
      metadataFailures: [],
      blobFailures: [],
      remainingBlobBytes: 110,
      overBudget: true,
    });
    expect(deleteRecords).toHaveBeenCalledWith(["expired"]);
    expect(blobStore.delete).toHaveBeenCalledWith("blob-expired");
    expect(blobStore.delete).not.toHaveBeenCalledWith("blob-protected");
  });

  it("does not delete a blob when metadata deletion fails", async () => {
    const expired = record("expired", "2026-01-01T00:00:00Z", {
      blobBytes: 40,
      pluginBlobId: "blob-expired",
    });
    const store = {
      listRecords: async () => [expired],
      deleteRecords: async () => ({
        deletedIds: [],
        failures: [{ id: "expired", error: "database conflict" }],
      }),
    } as unknown as ZToolsCanonicalClipboardStore;
    const blobStore: RetentionBlobStore = {
      delete: vi.fn(async () => undefined),
    };

    const result = await executeRetentionPrune(
      store,
      { days: 1, maxBlobBytes: 0, now: "2026-07-16T00:00:00Z" },
      blobStore,
    );

    expect(result.metadataFailures).toEqual([
      { id: "expired", error: "database conflict" },
    ]);
    expect(blobStore.delete).not.toHaveBeenCalled();
  });
});

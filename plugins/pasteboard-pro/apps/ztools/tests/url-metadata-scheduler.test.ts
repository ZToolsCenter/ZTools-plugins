import { describe, expect, it, vi } from "vitest";
import { UrlMetadataScheduler } from "../preload/url-metadata-scheduler";
import * as urlService from "../preload/url-metadata-service";
import { defaultWindowPreferences } from "../preload/window-preferences";

describe("UrlMetadataScheduler", () => {
  it("enqueues and updates url metadata when enabled", async () => {
    const updatedCalls: any[] = [];
    const mockStore: any = {
      updateItemUrlMetadata: vi.fn(async (id, meta) => {
        updatedCalls.push({ id, meta });
        return { item: { id }, origin: { host: "sync" } };
      }),
    };
    const mockPrefsStore: any = {
      get: vi.fn(async () => ({ ...defaultWindowPreferences, fetchUrlMetadata: true })),
    };

    const spyFetch = vi.spyOn(urlService, "fetchUrlMetadata").mockResolvedValueOnce({
      title: "Vue 3 Documentation",
      favicon: "https://vuejs.org/favicon.ico",
      hostname: "vuejs.org",
    });

    const scheduler = new UrlMetadataScheduler({
      store: mockStore,
      windowPreferencesStore: mockPrefsStore,
      fetchDelayMs: 10,
    });

    const onUpdated = vi.fn();
    scheduler.setOnItemUpdated(onUpdated);

    scheduler.enqueue("item-1", "https://vuejs.org/guide");

    // Wait for queue processing
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(spyFetch).toHaveBeenCalledWith("https://vuejs.org/guide");
    expect(mockStore.updateItemUrlMetadata).toHaveBeenCalledWith("item-1", {
      title: "Vue 3 Documentation",
      favicon: "https://vuejs.org/favicon.ico",
      hostname: "vuejs.org",
    });
    expect(onUpdated).toHaveBeenCalled();

    scheduler.destroy();
    spyFetch.mockRestore();
  });

  it("skips fetching when disabled in preferences", async () => {
    const mockStore: any = {
      updateItemUrlMetadata: vi.fn(),
    };
    const mockPrefsStore: any = {
      get: vi.fn(async () => ({ ...defaultWindowPreferences, fetchUrlMetadata: false })),
    };

    const spyFetch = vi.spyOn(urlService, "fetchUrlMetadata");

    const scheduler = new UrlMetadataScheduler({
      store: mockStore,
      windowPreferencesStore: mockPrefsStore,
      fetchDelayMs: 10,
    });

    scheduler.enqueue("item-2", "https://github.com/vuejs/core");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(spyFetch).not.toHaveBeenCalled();
    expect(mockStore.updateItemUrlMetadata).not.toHaveBeenCalled();

    scheduler.destroy();
    spyFetch.mockRestore();
  });

  it("runs historical scanning across stored records without metadata", async () => {
    const mockRecords = [
      {
        type: "pasteboard-pro-record",
        record: {
          item: {
            id: "url-1",
            kind: "url",
            sourceDeviceId: "dev-1",
            copiedAt: "2026-07-15T00:00:00.000Z",
            updatedAt: "2026-07-15T00:00:00.000Z",
            contentFingerprint: "fp-1",
            payload: { revision: "r1", text: "https://bilibili.com" },
            pinned: false,
            fieldClocks: {},
          },
          origin: { host: "sync", remoteAvailable: true },
        },
      },
      {
        type: "pasteboard-pro-record",
        record: {
          item: {
            id: "url-2-has-meta",
            kind: "url",
            title: "Already Has Title",
            sourceDeviceId: "dev-1",
            copiedAt: "2026-07-15T00:00:00.000Z",
            updatedAt: "2026-07-15T00:00:00.000Z",
            contentFingerprint: "fp-2",
            payload: {
              revision: "r2",
              text: "https://github.com",
              urlMeta: { title: "GitHub", favicon: "https://github.com/favicon.ico" },
            },
            pinned: false,
            fieldClocks: {},
          },
          origin: { host: "sync", remoteAvailable: true },
        },
      },
    ];

    const mockStore: any = {
      readHistoryDocuments: vi.fn(async () => mockRecords),
      updateItemUrlMetadata: vi.fn(),
    };
    const mockPrefsStore: any = {
      get: vi.fn(async () => defaultWindowPreferences),
    };

    const spyFetch = vi.spyOn(urlService, "fetchUrlMetadata").mockResolvedValueOnce({
      title: "Bilibili",
      favicon: "https://bilibili.com/favicon.ico",
      hostname: "bilibili.com",
    });

    const scheduler = new UrlMetadataScheduler({
      store: mockStore,
      windowPreferencesStore: mockPrefsStore,
      fetchDelayMs: 10,
    });

    const count = await scheduler.scanHistoricalItems();
    expect(count).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockStore.updateItemUrlMetadata).toHaveBeenCalledWith("url-1", {
      title: "Bilibili",
      favicon: "https://bilibili.com/favicon.ico",
      hostname: "bilibili.com",
    });

    scheduler.destroy();
    spyFetch.mockRestore();
  });
});

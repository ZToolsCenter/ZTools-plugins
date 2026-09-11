import { describe, expect, it } from "vitest";

import {
  defaultWindowPreferences,
  ZToolsWindowPreferencesStore,
} from "../preload/window-preferences";

describe("ZTools window preference themes and sync", () => {
  it("persists a portable image theme and exposes it as a WebDAV sync entity", async () => {
    let document: Record<string, unknown> | undefined;
    const store = new ZToolsWindowPreferencesStore(
      {
        async get() {
          if (document === undefined) throw { status: 404 };
          return structuredClone(document);
        },
        async put(next) {
          document = { ...structuredClone(next), _rev: "1-test" };
          return { ok: true };
        },
      },
      { deviceId: "device-a", now: () => 1_700_000_000_000 },
    );

    const settings = {
      dockEdge: "right" as const,
      multiPasteMode: "batch" as const,
      theme: {
        accentColor: "#224466",
        background: {
          type: "image" as const,
          imageDataUrl: "data:image/png;base64,iVBORw==",
        },
      },
    };
    await store.put(settings);

    await expect(store.get()).resolves.toEqual(settings);
    await expect(store.getSyncEntity()).resolves.toMatchObject({
      id: "window",
      entityType: "window_preferences",
      settings,
      sourceDeviceId: "device-a",
      clock: { wallMs: 1_700_000_000_000, deviceId: "device-a" },
    });
  });

  it("applies only newer synced appearance preferences", async () => {
    let document: Record<string, unknown> | undefined;
    const database = {
      async get() {
        if (document === undefined) throw { status: 404 };
        return structuredClone(document);
      },
      async put(next: Record<string, unknown>) {
        document = { ...structuredClone(next), _rev: "next" };
        return { ok: true };
      },
    };
    const store = new ZToolsWindowPreferencesStore(database, {
      deviceId: "device-a",
      now: () => 200,
    });
    await store.put(defaultWindowPreferences);
    await store.putSynced({
      id: "window",
      entityType: "window_preferences",
      settings: {
        ...defaultWindowPreferences,
        theme: {
          accentColor: "#123456",
          background: { type: "color", color: "#abcdef" },
        },
      },
      updatedAt: new Date(300).toISOString(),
      sourceDeviceId: "device-b",
      clock: { wallMs: 300, counter: 0, deviceId: "device-b" },
    });

    await expect(store.get()).resolves.toMatchObject({
      theme: {
        accentColor: "#123456",
        background: { type: "color", color: "#abcdef" },
      },
    });
  });

  it("falls back from invalid persisted theme values and rejects invalid writes", async () => {
    const store = new ZToolsWindowPreferencesStore({
      async get() {
        return {
          settings: {
            dockEdge: "bottom",
            multiPasteMode: "batch",
            theme: {
              accentColor: "red",
              background: { type: "image", imageDataUrl: "https://example.com/a.png" },
            },
          },
        };
      },
      async put() { return { ok: true }; },
    });

    await expect(store.get()).resolves.toEqual(defaultWindowPreferences);
    await expect(
      store.put({
        dockEdge: "bottom",
        multiPasteMode: "batch",
        theme: { accentColor: "red", background: { type: "default" } },
      }),
    ).rejects.toThrow(/#RRGGBB/i);
  });
});

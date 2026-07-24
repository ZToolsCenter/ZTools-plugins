import { describe, expect, it } from "vitest";

import {
  defaultWindowPreferences,
  ZToolsWindowPreferencesStore,
} from "../preload/window-preferences";

describe("ZTools window preferences", () => {
  it("defaults to the bottom edge when no local setting exists", async () => {
    const store = new ZToolsWindowPreferencesStore({
      async get() { throw { status: 404 }; },
      async put() { return { ok: true }; },
    });

    await expect(store.get()).resolves.toEqual(defaultWindowPreferences);
  });

  it("persists a four-edge dock preference and retries conflicts", async () => {
    let document: Record<string, unknown> | undefined;
    let conflict = true;
    const store = new ZToolsWindowPreferencesStore({
      async get() {
        if (document === undefined) throw { status: 404 };
        return structuredClone(document);
      },
      async put(next) {
        if (conflict) {
          conflict = false;
          throw { status: 409 };
        }
        document = { ...structuredClone(next), _rev: "2-test" };
        return { ok: true };
      },
    });

    await store.put({ dockEdge: "left", multiPasteMode: "queue" });
    await expect(store.get()).resolves.toEqual({
      dockEdge: "left",
      multiPasteMode: "queue",
    });
  });

  it("migrates an existing dock-only preference to batch multi-paste", async () => {
    const store = new ZToolsWindowPreferencesStore({
      async get() {
        return { settings: { dockEdge: "top" } };
      },
      async put() { return { ok: true }; },
    });

    await expect(store.get()).resolves.toEqual({
      dockEdge: "top",
      multiPasteMode: "batch",
    });
  });

  it("rejects invalid persisted and requested edges safely", async () => {
    const store = new ZToolsWindowPreferencesStore({
      async get() {
        return { settings: { dockEdge: "floating" } };
      },
      async put() { return { ok: true }; },
    });

    await expect(store.get()).resolves.toEqual(defaultWindowPreferences);
    await expect(
      store.put({ dockEdge: "floating" } as never),
    ).rejects.toThrow(/top, bottom, left, or right/i);
  });
});

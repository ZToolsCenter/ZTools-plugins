import { describe, expect, it } from "vitest";

import { ZToolsListOrderStore } from "../preload/list-order-store";

describe("ZTools list order store", () => {
  it("returns empty orders when no preference document exists", async () => {
    const store = new ZToolsListOrderStore({
      async get() { throw { status: 404 }; },
      async put() { return { ok: true }; },
    });

    await expect(store.get()).resolves.toEqual({});
  });

  it("persists independent view orders and retries conflicts", async () => {
    let document: Record<string, unknown> | undefined;
    let conflict = true;
    const store = new ZToolsListOrderStore({
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

    await store.put("all", ["item-2", "item-1"]);
    await store.put("smart:image", ["image-2", "image-1"]);
    await expect(store.get()).resolves.toEqual({
      all: ["item-2", "item-1"],
      "smart:image": ["image-2", "image-1"],
    });
  });

  it("deduplicates ids and rejects invalid scopes", async () => {
    let saved: Record<string, unknown> | undefined;
    const store = new ZToolsListOrderStore({
      async get() {
        if (saved === undefined) throw { status: 404 };
        return saved;
      },
      async put(next) {
        saved = next;
        return { ok: true };
      },
    });

    await expect(store.put("pinboard:board-1", ["a", "a", "b"])).resolves.toEqual({
      "pinboard:board-1": ["a", "b"],
    });
    await expect(store.put("unknown", ["a"])).rejects.toThrow(/scope/i);
  });
});

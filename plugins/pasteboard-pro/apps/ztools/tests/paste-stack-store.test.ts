import { describe, expect, it } from "vitest";

import {
  defaultPasteStackState,
  normalizePasteStackState,
  ZToolsPasteStackStore,
} from "../preload/paste-stack-store";

describe("ZTools paste stack store", () => {
  it("normalizes malformed values and removes duplicate or empty item ids", () => {
    expect(normalizePasteStackState(null)).toEqual(defaultPasteStackState);
    expect(normalizePasteStackState({
      direction: "reverse",
      itemIds: ["a", "", "a", 2, "b"],
    })).toEqual({ direction: "reverse", itemIds: ["a", "b"] });
  });

  it("persists queue direction and retries revision conflicts", async () => {
    let document: Record<string, unknown> | undefined;
    let conflict = true;
    const store = new ZToolsPasteStackStore({
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

    await expect(store.put({ direction: "reverse", itemIds: ["a", "b"] }))
      .resolves.toEqual({ direction: "reverse", itemIds: ["a", "b"] });
    await expect(store.get()).resolves.toEqual({
      direction: "reverse",
      itemIds: ["a", "b"],
    });
  });
});

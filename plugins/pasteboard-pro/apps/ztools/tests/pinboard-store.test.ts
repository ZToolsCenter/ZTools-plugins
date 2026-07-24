import { describe, expect, it } from "vitest";

import type { ZToolsDocumentDatabase } from "../preload/clipboard-store";
import { ZToolsPinboardStore } from "../preload/pinboard-store";

function database(): ZToolsDocumentDatabase {
  const documents = new Map<string, Record<string, unknown>>();
  let revision = 0;
  return {
    async get(id) {
      const document = documents.get(id);
      if (document === undefined) throw { status: 404 };
      return structuredClone(document);
    },
    async put(document) {
      const id = String(document._id);
      const current = documents.get(id);
      if (current !== undefined && document._rev !== current._rev) {
        throw { status: 409 };
      }
      revision += 1;
      documents.set(id, { ...structuredClone(document), _rev: `${revision}-test` });
      return { ok: true };
    },
    async allDocs(options) {
      const start = String(options.startkey ?? "");
      const end = String(options.endkey ?? "\uffff");
      return {
        rows: [...documents.entries()]
          .filter(([id]) => id >= start && id <= end)
          .map(([id, document]) => ({ id, doc: structuredClone(document) })),
      };
    },
    async remove(document) {
      if (typeof document !== "object" || document === null) throw new TypeError();
      documents.delete(String((document as { _id: unknown })._id));
      return { ok: true };
    },
  };
}

describe("ZTools Pinboard store", () => {
  it("creates Pinboards with stable fractional ordering", async () => {
    let id = 0;
    let now = Date.parse("2026-07-16T10:00:00Z");
    const store = new ZToolsPinboardStore(database(), {
      deviceId: "device-a",
      idFactory: () => `board-${++id}`,
      now: () => now++,
    });

    const work = await store.create("Work", "#6F61EA");
    const links = await store.create("Links", "#33A37A");

    expect((await store.list()).map((board) => board.id)).toEqual([
      work.id,
      links.id,
    ]);
    expect(work.orderKey < links.orderKey).toBe(true);
  });

  it("renames and reorders Pinboards without replacing unrelated fields", async () => {
    let id = 0;
    let now = Date.parse("2026-07-16T10:00:00Z");
    const store = new ZToolsPinboardStore(database(), {
      deviceId: "device-a",
      idFactory: () => `board-${++id}`,
      now: () => now++,
    });
    const first = await store.create("First", "#111111");
    const second = await store.create("Second", "#222222");
    const third = await store.create("Third", "#333333");

    const renamed = await store.rename(second.id, "Reference");
    await store.moveBetween(third.id, undefined, first.id);

    expect(renamed).toMatchObject({
      id: second.id,
      name: "Reference",
      color: "#222222",
    });
    expect((await store.list()).map((board) => board.id)).toEqual([
      third.id,
      first.id,
      second.id,
    ]);
  });

  it("rejects blank names and missing reorder anchors", async () => {
    const store = new ZToolsPinboardStore(database(), {
      deviceId: "device-a",
      idFactory: () => "board-1",
      now: () => 1,
    });
    const board = await store.create("Board", "#ffffff");

    await expect(store.rename(board.id, "   ")).rejects.toThrow(/name/i);
    await expect(store.moveBetween(board.id, "missing", undefined)).rejects.toThrow(
      /anchor/i,
    );
  });

  it("updates color and replaces a deleted Pinboard with a sync tombstone", async () => {
    let now = Date.parse("2026-07-17T00:00:00Z");
    const db = database();
    const store = new ZToolsPinboardStore(db, {
      deviceId: "device-a",
      idFactory: () => "board-1",
      now: () => now++,
    });
    const board = await store.create("Board", "#111111");

    await expect(store.updateColor(board.id, "#aabbcc")).resolves.toMatchObject({
      color: "#AABBCC",
    });
    const tombstone = await store.delete(board.id);

    expect(await store.list()).toEqual([]);
    expect(tombstone).toMatchObject({
      id: board.id,
      entityType: "pinboard",
      deleted: true,
      sourceDeviceId: "device-a",
    });
    await expect(
      db.get(`pasteboard-pro:tombstone:pinboard:${board.id}`),
    ).resolves.toMatchObject({ tombstone });
  });
});

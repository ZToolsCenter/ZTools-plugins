import { mkdtemp, readFile, rm, stat, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { historyFixture } from "@pasteboard-pro/contract-fixtures";
import { PasteItemSchema } from "@pasteboard-pro/core";

import {
  ZToolsCanonicalClipboardStore,
  type ZToolsDocumentDatabase,
} from "../preload/clipboard-store";
import { ZToolsSyncEntityRepository } from "../preload/sync-repository";

function database(): ZToolsDocumentDatabase {
  const documents = new Map<string, Record<string, unknown>>();
  let revision = 0;
  return {
    async get(id) {
      const value = documents.get(id);
      if (value === undefined) throw { status: 404 };
      return structuredClone(value);
    },
    async put(document) {
      revision += 1;
      documents.set(String(document._id), {
        ...structuredClone(document),
        _rev: `${revision}-test`,
      });
      return { ok: true };
    },
    async remove(value) {
      if (typeof value !== "object" || value === null || !("_id" in value)) {
        throw new TypeError("invalid document");
      }
      documents.delete(String(value._id));
      return { ok: true };
    },
    async allDocs(options) {
      const start = String(options.startkey ?? "");
      const end = String(options.endkey ?? "\uffff");
      return {
        rows: [...documents.entries()]
          .filter(([id]) => id >= start && id <= end)
          .map(([id, doc]) => ({ id, doc: structuredClone(doc) })),
      };
    },
  };
}

describe("ZTools sync entity repository", () => {
  it("stores derived image bytes in the content-addressed blob directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pasteboard-pro-derived-"));
    try {
      const repository = new ZToolsSyncEntityRepository(database(), "host-a", root);
      const stored = await repository.storeLocalBlob(
        new Uint8Array([1, 2, 3, 4]),
        "image/png",
      );
      expect(stored.id).toMatch(/^blob-[0-9a-f]{64}$/u);
      expect(stored.imagePath.startsWith(root)).toBe(true);
      expect(await readFile(stored.imagePath)).toEqual(Buffer.from([1, 2, 3, 4]));
      await utimes(stored.imagePath, 1, 1);
      const duplicate = await repository.storeLocalBlob(
        new Uint8Array([1, 2, 3, 4]),
        "image/png",
      );
      expect(duplicate).toEqual(stored);
      expect((await stat(duplicate.imagePath)).mtimeMs).toBe(1_000);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("turns local deletion into a tombstone and permits only a newer live edit to return", async () => {
    const db = database();
    const clipboard = new ZToolsCanonicalClipboardStore(db, {
      deviceId: "host-a",
      now: () => 2_000_000_000_000,
    });
    const item = PasteItemSchema.parse(historyFixture[0]);
    await clipboard.put({
      item,
      origin: { host: "ztools", hostItemId: "host-item", hostType: "text" },
    });
    await clipboard.deleteRecords([item.id]);

    const repository = new ZToolsSyncEntityRepository(db, "host-a");
    expect(await repository.listEntities()).toEqual([
      expect.objectContaining({ id: item.id, deleted: true, entityType: "paste_item" }),
    ]);

    const revived = PasteItemSchema.parse({
      ...item,
      title: "Newer remote title",
      updatedAt: "2033-05-18T03:33:20.001Z",
      fieldClocks: {
        ...item.fieldClocks,
        title: { wallMs: 2_000_000_000_001, counter: 1, deviceId: "host-b" },
      },
    });
    await repository.applyEntities([revived]);
    expect(await repository.listEntities()).toEqual([
      expect.objectContaining({ id: item.id, title: "Newer remote title" }),
    ]);
  });
});

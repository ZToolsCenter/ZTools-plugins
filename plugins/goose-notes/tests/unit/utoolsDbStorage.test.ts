import { expect, test } from "playwright/test";
import {
  getDbStorageItem,
  removeDbStorageItem,
  setDbStorageItem,
} from "../../src/lib/storage/utoolsDbStorage";

const storageDocId = (key: string) => `gn:storage:${key}`;

function installUToolsStorageRuntime() {
  let rev = 0;
  const docs = new Map<string, { _id: string; _rev: string; data: unknown }>();
  const dbStorage = new Map<string, string>();

  (globalThis as any).window = {
    utools: {
      db: {
        get: (id: string) => docs.get(id) ?? null,
        put: (doc: { _id: string; _rev?: string; data: unknown }) => {
          const current = docs.get(doc._id);
          if (doc._rev && current?._rev && doc._rev !== current._rev) {
            return { id: doc._id, ok: false, error: "conflict" };
          }
          const nextRev = `rev-${++rev}`;
          docs.set(doc._id, { _id: doc._id, _rev: nextRev, data: doc.data });
          return { id: doc._id, ok: true, rev: nextRev };
        },
        remove: (id: string) => {
          docs.delete(id);
          return { id, ok: true };
        },
        allDocs: () => [],
      },
      dbStorage: {
        getItem: (key: string) => dbStorage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          dbStorage.set(key, value);
        },
        removeItem: (key: string) => {
          dbStorage.delete(key);
        },
      },
    },
  };

  return { docs, dbStorage };
}

test.afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

test("uTools storage migrates legacy dbStorage into a db document", () => {
  const { docs, dbStorage } = installUToolsStorageRuntime();
  dbStorage.set("goose-note-settings", "legacy-value");

  expect(getDbStorageItem("goose-note-settings")).toBe("legacy-value");
  expect(docs.get(storageDocId("goose-note-settings"))?.data).toMatchObject({
    value: "legacy-value",
  });
  expect(dbStorage.has("goose-note-settings")).toBe(false);
});

test("uTools storage writes only the db document and clears stale dbStorage", () => {
  const { docs, dbStorage } = installUToolsStorageRuntime();
  dbStorage.set("goose-note-notebooks", "stale-value");

  setDbStorageItem("goose-note-notebooks", "fresh-value");

  expect(docs.get(storageDocId("goose-note-notebooks"))?.data).toMatchObject({
    value: "fresh-value",
  });
  expect(dbStorage.has("goose-note-notebooks")).toBe(false);
  expect(getDbStorageItem("goose-note-notebooks")).toBe("fresh-value");
});

test("uTools storage remove clears both canonical and legacy stores", () => {
  const { docs, dbStorage } = installUToolsStorageRuntime();
  setDbStorageItem("goose-note-pages-meta", "saved-value");
  dbStorage.set("goose-note-pages-meta", "legacy-value");

  removeDbStorageItem("goose-note-pages-meta");

  expect(docs.has(storageDocId("goose-note-pages-meta"))).toBe(false);
  expect(dbStorage.has("goose-note-pages-meta")).toBe(false);
  expect(getDbStorageItem("goose-note-pages-meta")).toBeNull();
});

test("uTools storage reports a canonical write failure", () => {
  installUToolsStorageRuntime();
  const utools = (globalThis as any).window.utools;
  utools.db.put = () => ({ ok: false, error: "fault-injected" });

  expect(setDbStorageItem("critical", "draft")).toBe(false);
  expect(getDbStorageItem("critical")).toBeNull();
});

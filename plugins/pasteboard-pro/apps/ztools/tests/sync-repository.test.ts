import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
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

async function writeManagedBlob(
  root: string,
  bytes: Uint8Array,
  extension = "png",
): Promise<string> {
  const digest = createHash("sha256").update(bytes).digest("hex");
  const directory = path.join(root, digest.slice(0, 2));
  const file = path.join(directory, `${digest}.${extension}`);
  await mkdir(directory, { recursive: true });
  await writeFile(file, bytes);
  return file;
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

  it("deletes only files inside the plugin-managed blob directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pasteboard-pro-delete-"));
    const outside = path.join(os.tmpdir(), `pasteboard-pro-outside-${Date.now()}.png`);
    try {
      const repository = new ZToolsSyncEntityRepository(database(), "host-a", root);
      const stored = await repository.storeLocalBlob(new Uint8Array([9, 8, 7]), "image/png");

      await repository.deleteLocalBlob({ blobId: stored.id, filePath: stored.imagePath });
      await expect(stat(stored.imagePath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        repository.deleteLocalBlob({ blobId: "blob-outside", filePath: outside }),
      ).rejects.toThrow(/outside/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects managed roots, invalid blob ids, and symlink escape paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pasteboard-pro-safe-delete-"));
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "pasteboard-pro-delete-outside-"));
    const outsideFile = path.join(outsideRoot, "outside.png");
    const targetLink = path.join(root, "target-link.png");
    const parentLink = path.join(root, "parent-link");
    try {
      await writeFile(outsideFile, Buffer.from([1, 2, 3]));
      await symlink(outsideFile, targetLink);
      await symlink(outsideRoot, parentLink, "dir");
      const repository = new ZToolsSyncEntityRepository(database(), "host-a", root);

      await expect(
        repository.deleteLocalBlob({ blobId: "blob-target", filePath: targetLink }),
      ).rejects.toThrow(/symbolic link/i);
      await expect(
        repository.deleteLocalBlob({
          blobId: "blob-parent",
          filePath: path.join(parentLink, "outside.png"),
        }),
      ).rejects.toThrow(/symbolic link/i);
      await expect(
        repository.deleteLocalBlob({ blobId: "blob-root", filePath: root }),
      ).rejects.toThrow(/outside/i);
      await expect(
        repository.deleteLocalBlob({ blobId: "blob\0invalid", filePath: targetLink }),
      ).rejects.toThrow(/NUL/i);
      await expect(
        repository.deleteLocalBlob({ blobId: "../blob-invalid", filePath: targetLink }),
      ).rejects.toThrow(/safe object identifier/i);
      expect(await readFile(outsideFile)).toEqual(Buffer.from([1, 2, 3]));
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("rejects a symbolic-link managed root", async () => {
    const realRoot = await mkdtemp(path.join(os.tmpdir(), "pasteboard-pro-real-root-"));
    const linkParent = await mkdtemp(path.join(os.tmpdir(), "pasteboard-pro-link-root-"));
    const linkedRoot = path.join(linkParent, "blobs");
    const file = path.join(realRoot, "blob.png");
    try {
      await writeFile(file, Buffer.from([7, 8, 9]));
      await symlink(realRoot, linkedRoot, "dir");
      const repository = new ZToolsSyncEntityRepository(
        database(),
        "host-a",
        linkedRoot,
      );

      await expect(
        repository.deleteLocalBlob({
          blobId: "blob-root-link",
          filePath: path.join(linkedRoot, "blob.png"),
        }),
      ).rejects.toThrow(/symbolic-link blob root/i);
      expect(await readFile(file)).toEqual(Buffer.from([7, 8, 9]));
    } finally {
      await rm(linkParent, { recursive: true, force: true });
      await rm(realRoot, { recursive: true, force: true });
    }
  });

  it("keeps legacy blob records removable after new writes move to pluginData", async () => {
    const currentRoot = await mkdtemp(path.join(os.tmpdir(), "pasteboard-pro-current-"));
    const legacyRoot = await mkdtemp(path.join(os.tmpdir(), "pasteboard-pro-legacy-"));
    try {
      const legacyFile = await writeManagedBlob(
        legacyRoot,
        new Uint8Array([4, 5, 6]),
      );
      const repository = new ZToolsSyncEntityRepository(
        database(),
        "host-a",
        currentRoot,
        [legacyRoot],
      );
      const current = await repository.storeLocalBlob(
        new Uint8Array([1, 2, 3]),
        "image/png",
      );

      expect(current.imagePath.startsWith(currentRoot)).toBe(true);
      await repository.deleteLocalBlob({ blobId: "blob-legacy", filePath: legacyFile });
      await expect(stat(legacyFile)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(currentRoot, { recursive: true, force: true });
      await rm(legacyRoot, { recursive: true, force: true });
    }
  });

  it("refuses a content-addressed path whose bytes do not match its digest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pasteboard-pro-digest-delete-"));
    try {
      const claimedBytes = new Uint8Array([1, 1, 1]);
      const digest = createHash("sha256").update(claimedBytes).digest("hex");
      const directory = path.join(root, digest.slice(0, 2));
      const file = path.join(directory, `${digest}.png`);
      await mkdir(directory, { recursive: true });
      await writeFile(file, new Uint8Array([9, 9, 9]));
      const repository = new ZToolsSyncEntityRepository(database(), "host-a", root);

      await expect(
        repository.deleteLocalBlob({ blobId: "blob-mismatch", filePath: file }),
      ).rejects.toThrow(/content does not match/i);
      expect(await readFile(file)).toEqual(Buffer.from([9, 9, 9]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps a verified blob while another database record still references it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pasteboard-pro-referenced-delete-"));
    try {
      const db = database();
      const repository = new ZToolsSyncEntityRepository(db, "host-a", root);
      const stored = await repository.storeLocalBlob(
        new Uint8Array([3, 1, 4, 1, 5]),
        "image/png",
      );
      const fixture = historyFixture.find((item) => item.kind === "image");
      if (fixture === undefined) throw new Error("Image fixture is required");
      const item = PasteItemSchema.parse({
        ...fixture,
        payload: {
          ...fixture.payload,
          blobId: stored.id,
          mediaType: "image/png",
        },
      });
      const store = new ZToolsCanonicalClipboardStore(db, { deviceId: "host-a" });
      await store.put({
        item,
        origin: {
          host: "sync",
          remoteAvailable: true,
          imagePath: stored.imagePath,
          blobBytes: stored.blobBytes,
          pluginBlobId: stored.id,
        },
      });

      await repository.deleteLocalBlob({
        blobId: stored.id,
        filePath: stored.imagePath,
      });
      expect(await readFile(stored.imagePath)).toEqual(
        Buffer.from([3, 1, 4, 1, 5]),
      );
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

import { describe, expect, it } from "vitest";

import type { PasteItem } from "@pasteboard-pro/core";

import {
  mirrorHostHistory,
  normalizeHostClipboardItem,
  ZToolsCanonicalClipboardStore,
  type CanonicalClipboardRecord,
  type CanonicalClipboardStore,
  type HostClipboardApi,
  type HostCursor,
  type ZToolsDocumentDatabase,
} from "../preload/clipboard-store";

class MemoryStore implements CanonicalClipboardStore {
  readonly records = new Map<string, CanonicalClipboardRecord>();
  private readonly fingerprints = new Map<string, PasteItem>();
  private cursor: HostCursor | undefined;

  async findByFingerprint(fingerprint: string): Promise<PasteItem | undefined> {
    return this.fingerprints.get(fingerprint);
  }

  async put(record: CanonicalClipboardRecord): Promise<void> {
    this.records.set(record.item.id, structuredClone(record));
    this.fingerprints.set(
      record.item.contentFingerprint,
      structuredClone(record.item),
    );
  }

  async getCursor(): Promise<HostCursor | undefined> {
    return this.cursor === undefined ? undefined : { ...this.cursor };
  }

  async setCursor(cursor: HostCursor): Promise<void> {
    this.cursor = { ...cursor };
  }
}

const hostItems = [
  {
    id: "text-1",
    type: "text",
    timestamp: 300,
    content: "Roadmap\nPasteboardPro",
    appName: "TextEdit",
  },
  {
    id: "image-1",
    type: "image",
    timestamp: 200,
    imagePath: "/tmp/capture.png",
    appName: "Preview",
  },
  {
    id: "files-1",
    type: "file",
    timestamp: 100,
    files: [
      {
        name: "brief.pdf",
        path: "/tmp/brief.pdf",
        isDirectory: false,
        exists: true,
      },
    ],
    appName: "Finder",
  },
] as const;

describe("ZTools clipboard adapter", () => {
  it("normalizes host text, image, and file items into canonical records", () => {
    const records = hostItems.map((item) =>
      normalizeHostClipboardItem(item, "ztools-device"),
    );

    expect(records.map((record) => record?.item.kind)).toEqual([
      "text",
      "image",
      "files",
    ]);
    expect(records[0]?.item).toMatchObject({
      id: "ztools:text-1",
      title: "Roadmap",
      payload: { text: "Roadmap\nPasteboardPro" },
      sourceApp: { name: "TextEdit" },
    });
    expect(records[1]?.origin).toMatchObject({
      hostItemId: "image-1",
      imagePath: "/tmp/capture.png",
    });
    expect(records[2]?.item.payload.filePaths).toEqual(["/tmp/brief.pdf"]);
  });

  it("pages through history, persists a restart cursor, and deduplicates unchanged items", async () => {
    const calls: number[] = [];
    const host: HostClipboardApi = {
      async getHistory(page, pageSize) {
        calls.push(page);
        const start = (page - 1) * pageSize;
        return {
          items: hostItems.slice(start, start + pageSize),
          total: hostItems.length,
        };
      },
    };
    const store = new MemoryStore();

    await expect(
      mirrorHostHistory(host, store, {
        deviceId: "ztools-device",
        pageSize: 2,
      }),
    ).resolves.toEqual({ imported: 3, skipped: 0, pages: 2 });
    expect(store.records.size).toBe(3);
    expect(await store.getCursor()).toEqual({ id: "text-1", timestamp: 300 });

    await expect(
      mirrorHostHistory(host, store, {
        deviceId: "ztools-device",
        pageSize: 2,
      }),
    ).resolves.toEqual({ imported: 0, skipped: 2, pages: 1 });
    expect(store.records.size).toBe(3);
    expect(calls).toEqual([1, 2, 1]);
  });

  it("imports only items newer than the saved cursor", async () => {
    const store = new MemoryStore();
    const initialHost: HostClipboardApi = {
      async getHistory() {
        return { items: hostItems, total: hostItems.length };
      },
    };
    await mirrorHostHistory(initialHost, store, {
      deviceId: "ztools-device",
      pageSize: 10,
    });

    const newer = {
      id: "text-2",
      type: "text",
      timestamp: 400,
      content: "New clipboard item",
    };
    const incrementalHost: HostClipboardApi = {
      async getHistory() {
        return { items: [newer, ...hostItems], total: hostItems.length + 1 };
      },
    };

    await expect(
      mirrorHostHistory(incrementalHost, store, {
        deviceId: "ztools-device",
        pageSize: 10,
      }),
    ).resolves.toEqual({ imported: 1, skipped: 3, pages: 1 });
    expect(store.records.has("ztools:text-2")).toBe(true);
    expect(await store.getCursor()).toEqual({ id: "text-2", timestamp: 400 });
  });

  it("advances the cursor without persisting items rejected by capture policy", async () => {
    const store = new MemoryStore();
    const host: HostClipboardApi = {
      async getHistory() {
        return { items: [hostItems[0]], total: 1 };
      },
    };

    await expect(
      mirrorHostHistory(host, store, {
        deviceId: "ztools-device",
        shouldPersist: () => false,
      }),
    ).resolves.toEqual({ imported: 0, skipped: 1, pages: 1 });
    expect(store.records.size).toBe(0);
    expect(await store.getCursor()).toEqual({ id: "text-1", timestamp: 300 });
  });

  it("skips unsupported or malformed host values without inventing records", () => {
    expect(normalizeHostClipboardItem(null, "device")).toBeNull();
    expect(
      normalizeHostClipboardItem(
        { id: "audio-1", type: "audio", timestamp: 1 },
        "device",
      ),
    ).toBeNull();
    expect(
      normalizeHostClipboardItem(
        { id: "image-1", type: "image", timestamp: 1 },
        "device",
      ),
    ).toBeNull();
    expect(
      normalizeHostClipboardItem(
        { id: "text-1", type: "text", timestamp: Number.MAX_VALUE, content: "x" },
        "device",
      ),
    ).toBeNull();
  });

  it("persists canonical records and cursors in isolated ZTools documents", async () => {
    const documents = new Map<string, Record<string, unknown>>();
    let revision = 0;
    const database: ZToolsDocumentDatabase = {
      async get(id) {
        const document = documents.get(id);
        if (document === undefined) {
          throw { status: 404 };
        }
        return structuredClone(document);
      },
      async put(document) {
        const id = document._id;
        if (typeof id !== "string") {
          throw new TypeError("missing id");
        }
        const current = documents.get(id);
        if (
          current !== undefined &&
          document._rev !== current._rev
        ) {
          throw { status: 409 };
        }
        revision += 1;
        documents.set(id, {
          ...structuredClone(document),
          _rev: `${revision}-test`,
        });
        return { ok: true };
      },
      async allDocs(options) {
        const start = String(options.startkey ?? "");
        const end = String(options.endkey ?? "\uffff");
        return {
          rows: [...documents.entries()]
            .filter(([id]) => id >= start && id <= end)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([id, document]) => ({ id, doc: structuredClone(document) })),
        };
      },
    };
    const store = new ZToolsCanonicalClipboardStore(database);
    const record = normalizeHostClipboardItem(hostItems[0], "ztools-device");
    expect(record).not.toBeNull();

    await store.put(record!);
    await store.setCursor({ id: "text-1", timestamp: 300 });

    await expect(
      store.findByFingerprint(record!.item.contentFingerprint),
    ).resolves.toEqual(record!.item);
    await expect(store.getCursor()).resolves.toEqual({
      id: "text-1",
      timestamp: 300,
    });
    expect([...documents.keys()]).toEqual([
      `pasteboard-pro:record:${record!.item.contentFingerprint}`,
      "pasteboard-pro:cursor:ztools-history",
    ]);
    await expect(store.search("roadmap", 10)).resolves.toMatchObject({
      total: 1,
      items: [{ id: "ztools:text-1" }],
    });
    await expect(store.findRecordByItemId("ztools:text-1")).resolves.toEqual(
      record,
    );
    await store.assignToPinboard(["ztools:text-1"], "board-work");
    await expect(store.findRecordByItemId("ztools:text-1")).resolves.toMatchObject({
      item: { pinboardId: "board-work", pinboardOrderKey: expect.any(String) },
    });
    await store.assignToPinboard(["ztools:text-1"], undefined);
    await expect(store.findRecordByItemId("ztools:text-1")).resolves.not.toHaveProperty(
      "item.pinboardId",
    );
    await store.updateOcrText("ztools:text-1", "  recognized invoice  ");
    await expect(store.findRecordByItemId("ztools:text-1")).resolves.toMatchObject({
      item: { ocrText: "recognized invoice" },
    });

    const imageRecord = normalizeHostClipboardItem(hostItems[1], "ztools-device");
    await store.put(imageRecord!);
    const originalFingerprint = imageRecord!.item.contentFingerprint;
    await store.updateOcrText(imageRecord!.item.id, "stale OCR");
    await store.updateImagePayload(imageRecord!.item.id, {
      blobId: "blob-rotated",
      revision: "sha256:rotated",
      imagePath: "/tmp/rotated.png",
      blobBytes: 321,
      mediaType: "image/png",
    });
    await expect(store.findRecordByItemId(imageRecord!.item.id)).resolves.toMatchObject({
      item: {
        contentFingerprint: originalFingerprint,
        payload: {
          blobId: "blob-rotated",
          revision: "sha256:rotated",
          mediaType: "image/png",
        },
      },
      origin: {
        host: "sync",
        imagePath: "/tmp/rotated.png",
        pluginBlobId: "blob-rotated",
      },
    });
    await expect(store.findRecordByItemId(imageRecord!.item.id)).resolves.not.toHaveProperty(
      "item.ocrText",
    );

    const created = await store.createTextItem("Draft body", "Draft title");
    expect(created.item).toMatchObject({
      kind: "text",
      title: "Draft title",
      payload: { text: "Draft body" },
      sourceApp: { name: "Paste剪切板" },
    });
    const captureFingerprint = created.item.contentFingerprint;
    const edited = await store.updateTextItem(
      created.item.id,
      "Edited body",
      "Edited title",
    );
    expect(edited.item).toMatchObject({
      title: "Edited title",
      contentFingerprint: captureFingerprint,
      payload: { text: "Edited body" },
    });
    expect(edited.item.payload.revision).not.toBe(created.item.payload.revision);
    const oversizedUtf8Text = "剪".repeat(Math.floor((10 * 1_024 * 1_024) / 3) + 1);
    await expect(store.createTextItem(oversizedUtf8Text)).rejects.toThrow("10 MiB");
    await expect(
      store.updateTextItem(created.item.id, oversizedUtf8Text),
    ).rejects.toThrow("10 MiB");
    const renamed = await store.updateItemTitle(created.item.id, "Final title");
    expect(renamed.item.title).toBe("Final title");
    expect(renamed.item.payload.revision).toBe(edited.item.payload.revision);
  });

  it("accepts ZTools native allDocs arrays", async () => {
    const record = normalizeHostClipboardItem(hostItems[0], "ztools-device");
    expect(record).not.toBeNull();
    const document = {
      _id: `pasteboard-pro:record:${record!.item.contentFingerprint}`,
      _rev: "1-native",
      type: "pasteboard-pro-record",
      record,
    };
    const store = new ZToolsCanonicalClipboardStore({
      async get(id) {
        if (id !== document._id) throw { status: 404 };
        return structuredClone(document);
      },
      async put() {
        return { ok: true };
      },
      async allDocs() {
        return [structuredClone(document)];
      },
    });

    await expect(store.search("roadmap", 10)).resolves.toMatchObject({
      total: 1,
      items: [{ id: "ztools:text-1" }],
    });
  });
});

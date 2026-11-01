import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createCheckedZToolsDocumentDatabase } from "../preload/clipboard-document-database";
import { mirrorHostHistory } from "../preload/clipboard-history-mirror";
import { MirroredImagePersistenceError } from "../preload/mirrored-image";
import type { HostClipboardApi } from "../preload/clipboard-store-types";
import type { CanonicalClipboardRecord } from "../preload/clipboard-store-types";
import { ZToolsCanonicalClipboardStore } from "../preload/clipboard-store";
import { fingerprint } from "../preload/clipboard-record-codec";
import { TemporaryLmdbHostDatabase } from "./clipboard-database-fixture";

const deviceId = "mirror-isolation-test-device";
const initialCursor = { id: "already-mirrored", timestamp: 1_790_000_000_000 };
const artifactRoot = resolve(
  fileURLToPath(new URL("../../../", import.meta.url)),
  "artifacts/pasteboardpro/clipboard-format-g0/v028-mirror-tests",
);
const fixtures = new Set<TemporaryLmdbHostDatabase>();
type PrepareRecord = NonNullable<Parameters<typeof mirrorHostHistory>[2]["prepareRecord"]>;

function image(id: string, timestamp: number, withPath = true) {
  return {
    id,
    type: "image",
    timestamp,
    ...(withPath ? { imagePath: `/host/${id}.png` } : {}),
  };
}

function text(id: string, timestamp: number) {
  return { id, type: "text", timestamp, content: `text:${id}` };
}

function makeHost(
  pages: ReadonlyMap<number, readonly unknown[]>,
  total: number,
  failure?: Readonly<{ page: number; error: Error }>,
): HostClipboardApi & { calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    async getHistory(page) {
      calls.push(page);
      if (failure?.page === page) throw failure.error;
      return { items: pages.get(page) ?? [], total };
    },
  };
}

function persistenceOptions(
  prepareRecord: NonNullable<Parameters<typeof mirrorHostHistory>[2]["prepareRecord"]>,
  shouldPersist?: NonNullable<Parameters<typeof mirrorHostHistory>[2]["shouldPersist"]>,
) {
  return { deviceId, prepareRecord, ...(shouldPersist === undefined ? {} : { shouldPersist }) };
}

async function createStore() {
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const fixture = await TemporaryLmdbHostDatabase.create(artifactRoot);
  fixtures.add(fixture);
  const database = createCheckedZToolsDocumentDatabase(fixture.raw);
  const store = new ZToolsCanonicalClipboardStore(database, { deviceId });
  await store.setCursor(initialCursor);
  return { fixture, store };
}

async function expectImageFailure(
  promise: Promise<unknown>,
  code: MirroredImagePersistenceError["code"],
) {
  const failure = await promise.then(() => undefined, (error: unknown) => error);
  expect(failure).toBeInstanceOf(MirroredImagePersistenceError);
  expect(failure).toHaveProperty("name", "MirroredImagePersistenceError");
  expect(failure).toHaveProperty("code", code);
  expect((failure as Error).message).toBe("Clipboard image persistence failed");
  expect((failure as Error & { cause?: unknown }).cause).toBeUndefined();
}

function localizedImage(record: CanonicalClipboardRecord): CanonicalClipboardRecord {
  return {
    item: record.item,
    origin: {
      ...record.origin,
      imagePath: "/plugin/blobs/recovered.png",
      pluginBlobId: "blob-recovered-image",
      blobBytes: 4,
    },
  };
}

describe("history mirror isolates known image persistence failures", () => {
  afterEach(async () => {
    for (const fixture of fixtures) {
      fixtures.delete(fixture);
      await fixture.closeAndRemove();
    }
  });

  it("stores healthy records after a failed image on the same page without advancing the cursor", async () => {
    const { store } = await createStore();
    const host = makeHost(new Map([[1, [image("broken-image", 1_790_000_300_000), text("healthy-after", 1_790_000_200_000)]]]), 2);
    const prepareRecord = vi.fn(async (rawItem: unknown, record: Parameters<PrepareRecord>[1]) => {
      if ((rawItem as { id?: string }).id === "broken-image") {
        const failure = new MirroredImagePersistenceError("image-storage-failed");
        failure.message = "private path: /host/broken-image.png";
        Object.defineProperty(failure, "cause", { value: new Error("host storage detail") });
        throw failure;
      }
      return record;
    });

    await expectImageFailure(
      mirrorHostHistory(host, store, persistenceOptions(prepareRecord)),
      "image-storage-failed",
    );

    await expect(store.findRecordByItemId("ztools:healthy-after")).resolves.toBeDefined();
    await expect(store.findRecordByItemId("ztools:broken-image")).resolves.toBeUndefined();
    await expect(store.getCursor()).resolves.toEqual(initialCursor);
    expect(host.calls).toEqual([1]);
  });

  it("continues across pages and retries failed images idempotently", async () => {
    const { store } = await createStore();
    const failedImage = image("retry-image", 1_790_000_300_000);
    const acceptedText = text("healthy-on-page-two", 1_790_000_200_000);
    const host = makeHost(new Map([[1, [failedImage]], [2, [acceptedText]]]), 2);
    let imageReady = false;
    const prepareRecord = vi.fn(async (rawItem: unknown, record: Parameters<PrepareRecord>[1]) => {
      if ((rawItem as { id?: string }).id === "retry-image") {
        if (!imageReady) throw new MirroredImagePersistenceError("image-read-failed");
        return localizedImage(record);
      }
      return record;
    });
    const options = persistenceOptions(prepareRecord);

    await expectImageFailure(mirrorHostHistory(host, store, { ...options, pageSize: 1 }), "image-read-failed");
    await expect(store.findRecordByItemId("ztools:healthy-on-page-two")).resolves.toBeDefined();
    await expect(store.getCursor()).resolves.toEqual(initialCursor);
    expect(host.calls).toEqual([1, 2]);

    imageReady = true;
    await expect(mirrorHostHistory(host, store, { ...options, pageSize: 1 })).resolves.toEqual({
      imported: 1,
      skipped: 1,
      pages: 2,
    });
    await expect(store.findRecordByItemId("ztools:healthy-on-page-two")).resolves.toBeDefined();
    await expect(store.findRecordByItemId("ztools:retry-image")).resolves.toMatchObject({
      origin: { imagePath: "/plugin/blobs/recovered.png", pluginBlobId: "blob-recovered-image" },
    });
    await expect(store.getCursor()).resolves.toEqual({ id: "retry-image", timestamp: failedImage.timestamp });
    await expect(mirrorHostHistory(host, store, { ...options, pageSize: 1 })).resolves.toMatchObject({ imported: 0 });
    await expect(store.search("", 10)).resolves.toMatchObject({ total: 2 });
  });

  it("does not charge privacy-denied images against the per-run failure cap", async () => {
    const { store } = await createStore();
    const denied = Array.from({ length: 18 }, (_, index) => image(`denied-${index}`, 1_790_001_000_000 - index, false));
    const allowedFailure = image("allowed-failure", 1_790_000_500_000, false);
    const healthy = text("healthy-after-denials", 1_790_000_400_000);
    const host = makeHost(new Map([[1, [...denied, allowedFailure, healthy]]]), 20);
    const prepareRecord = vi.fn(async (_raw: unknown, record: Parameters<PrepareRecord>[1]) => {
      return record;
    });
    const shouldPersist = vi.fn((raw: unknown) => {
      const id = (raw as { id: string }).id;
      return !id.startsWith("denied-");
    });

    await expectImageFailure(
      mirrorHostHistory(host, store, persistenceOptions(prepareRecord, shouldPersist)),
      "image-path-unavailable",
    );

    expect(shouldPersist).toHaveBeenCalledTimes(20);
    expect(prepareRecord).toHaveBeenCalledTimes(1);
    await expect(store.findRecordByItemId("ztools:healthy-after-denials")).resolves.toBeDefined();
    await expect(store.getCursor()).resolves.toEqual(initialCursor);
  });

  it("defers further image preparation after the failure cap but still stores healthy text", async () => {
    const { store } = await createStore();
    const failedImages = Array.from({ length: 17 }, (_, index) => image(`failed-${index}`, 1_790_000_500_000 - index));
    const firstPage = failedImages.slice(0, 16);
    const secondPage: unknown[] = [failedImages[16], text("after-failure-cap", 1_790_000_400_000)];
    const host = makeHost(new Map([[1, firstPage], [2, secondPage]]), 18);
    const prepareRecord = vi.fn(async (rawItem: unknown, record: Parameters<PrepareRecord>[1]) => {
      if ((rawItem as { type?: string }).type === "image") {
        throw new MirroredImagePersistenceError("image-storage-failed");
      }
      return record;
    });

    await expectImageFailure(
      mirrorHostHistory(host, store, { ...persistenceOptions(prepareRecord), pageSize: 16 }),
      "image-storage-failed",
    );

    const preparedIds = prepareRecord.mock.calls.map(([rawItem]) => (rawItem as { id: string }).id);
    expect(preparedIds.filter((id) => id.startsWith("failed-"))).toHaveLength(16);
    expect(preparedIds.at(-1)).toBe("after-failure-cap");
    expect(host.calls).toEqual([1, 2]);
    await expect(store.findRecordByItemId("ztools:after-failure-cap")).resolves.toBeDefined();
    await expect(store.getCursor()).resolves.toEqual(initialCursor);
  });

  it("does not let unknown preparation failures bypass a later valid record", async () => {
    const { store } = await createStore();
    const host = makeHost(new Map([[1, [image("unknown-failure", 1_790_000_300_000), text("must-not-run", 1_790_000_200_000)]]]), 2);
    const failure = new Error("unclassified storage fault");

    await expect(mirrorHostHistory(host, store, persistenceOptions(async () => { throw failure; })))
      .rejects.toBe(failure);

    await expect(store.findRecordByItemId("ztools:must-not-run")).resolves.toBeUndefined();
    await expect(store.getCursor()).resolves.toEqual(initialCursor);
  });

  it("does not isolate an image error thrown while preparing a non-image record", async () => {
    const { store } = await createStore();
    const host = makeHost(new Map([[1, [text("typed-error-on-text", 1_790_000_300_000), text("must-not-run", 1_790_000_200_000)]]]), 2);
    const prepareRecord = vi.fn(async () => {
      throw new MirroredImagePersistenceError("image-storage-failed");
    });

    await expectImageFailure(
      mirrorHostHistory(host, store, persistenceOptions(prepareRecord)),
      "image-storage-failed",
    );

    expect(prepareRecord).toHaveBeenCalledTimes(1);
    await expect(store.findRecordByItemId("ztools:typed-error-on-text")).resolves.toBeUndefined();
    await expect(store.findRecordByItemId("ztools:must-not-run")).resolves.toBeUndefined();
    await expect(store.getCursor()).resolves.toEqual(initialCursor);
  });

  it("stops immediately when the privacy policy fails", async () => {
    const { store } = await createStore();
    const host = makeHost(new Map([[1, [text("policy-error", 1_790_000_300_000), text("must-not-run", 1_790_000_200_000)]]]), 2);
    const failure = new Error("policy lookup failed");

    await expect(mirrorHostHistory(host, store, {
      deviceId,
      shouldPersist: () => { throw failure; },
    })).rejects.toBe(failure);

    await expect(store.findRecordByItemId("ztools:policy-error")).resolves.toBeUndefined();
    await expect(store.findRecordByItemId("ztools:must-not-run")).resolves.toBeUndefined();
    await expect(store.getCursor()).resolves.toEqual(initialCursor);
  });

  it("stops immediately when the host page fails", async () => {
    const { store } = await createStore();
    const failure = new Error("history page unavailable");
    const host = makeHost(new Map([[1, [text("page-one", 1_790_000_300_000)]]]), 2, { page: 2, error: failure });

    await expect(mirrorHostHistory(host, store, { deviceId, pageSize: 1 })).rejects.toBe(failure);

    await expect(store.findRecordByItemId("ztools:page-one")).resolves.toBeDefined();
    await expect(store.getCursor()).resolves.toEqual(initialCursor);
    expect(host.calls).toEqual([1, 2]);
  });

  it("stops immediately when a database write fails", async () => {
    const { fixture, store } = await createStore();
    const blockedText = text("database-failure", 1_790_000_300_000);
    const textFingerprint = fingerprint({ type: "text", text: blockedText.content });
    const documentId = `pasteboard-pro:record:${textFingerprint}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      fixture.queuePutResult(documentId, {
        id: documentId,
        error: true,
        name: "conflict",
        message: "hidden database detail",
      });
    }
    const host = makeHost(new Map([[1, [blockedText, text("must-not-run", 1_790_000_200_000)]]]), 2);

    await expect(mirrorHostHistory(host, store, { deviceId })).rejects.toMatchObject({
      name: "ZToolsDatabaseError",
      message: "Database conflict",
    });

    await expect(store.findRecordByItemId("ztools:must-not-run")).resolves.toBeUndefined();
    await expect(store.getCursor()).resolves.toEqual(initialCursor);
  });
});

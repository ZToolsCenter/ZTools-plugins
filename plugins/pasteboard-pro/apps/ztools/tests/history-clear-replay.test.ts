import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createCheckedZToolsDocumentDatabase } from "../preload/clipboard-document-database";
import { mirrorHostHistory } from "../preload/clipboard-history-mirror";
import { clearClipboardHistory } from "../preload/clear-history";
import { historyClearIdentity } from "../preload/history-clear-identity";
import { MirroredImagePersistenceError } from "../preload/mirrored-image";
import type { CanonicalClipboardRecord, HostClipboardApi } from "../preload/clipboard-store-types";
import { ZToolsCanonicalClipboardStore } from "../preload/clipboard-store";
import { TemporaryLmdbHostDatabase } from "./clipboard-database-fixture";

const deviceId = "history-clear-replay-test-device";
const initialCursor = { id: "initial", timestamp: 100 };
const artifactRoot = resolve(
  fileURLToPath(new URL("../../../", import.meta.url)),
  "artifacts/pasteboardpro/clipboard-format-g0/v032-clear-replay-tests",
);
const fixtures = new Set<TemporaryLmdbHostDatabase>();

function boundaryDocumentId(id: string): string {
  const hash = createHash("sha256").update(id, "utf8").digest("hex");
  return `pasteboard-pro:history-clear-boundary:${hash}`;
}

function image(id: string, timestamp: number) {
  return { id, type: "image", timestamp, imagePath: `/host/${id}.png` };
}

function text(id: string, timestamp: number, content = "repeatable content") {
  return { id, type: "text", timestamp, content };
}

function hostFor(items: readonly unknown[]): HostClipboardApi & { calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    async getHistory(page, pageSize) {
      calls.push(page);
      const start = (page - 1) * pageSize;
      return { items: items.slice(start, start + pageSize), total: items.length };
    },
  };
}

async function createStore() {
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const fixture = await TemporaryLmdbHostDatabase.create(artifactRoot);
  fixtures.add(fixture);
  const store = new ZToolsCanonicalClipboardStore(
    createCheckedZToolsDocumentDatabase(fixture.raw),
    { deviceId },
  );
  await store.setCursor(initialCursor);
  return { fixture, store };
}

function imageRetryFailure() {
  return expect.objectContaining({
    name: "MirroredImagePersistenceError",
    code: "image-storage-failed",
    message: "Clipboard image persistence failed",
  });
}

describe("history clear boundary prevents source-history replay", () => {
  afterEach(async () => {
    for (const fixture of fixtures) {
      fixtures.delete(fixture);
      await fixture.closeAndRemove();
    }
  });

  it("does not replay old healthy text or a failed image after clear while the mirror cursor is stalled", async () => {
    const { store } = await createStore();
    const items = [image("old-image", 300), text("old-text", 200)];
    const host = hostFor(items);
    const firstPrepare = vi.fn(async (raw: unknown, record: CanonicalClipboardRecord) => {
      if ((raw as { type: string }).type === "image") {
        throw new MirroredImagePersistenceError("image-storage-failed");
      }
      return record;
    });

    await expect(mirrorHostHistory(host, store, { deviceId, prepareRecord: firstPrepare }))
      .rejects.toMatchObject(imageRetryFailure());
    expect(firstPrepare.mock.calls.map(([raw]) => (raw as { id: string }).id))
      .toEqual(["old-image", "old-text"]);
    await expect(store.findRecordByItemId("ztools:old-text")).resolves.toBeDefined();
    await expect(store.findRecordByItemId("ztools:old-image")).resolves.toBeUndefined();
    await expect(store.getCursor()).resolves.toEqual(initialCursor);

    const systemClipboard = { clear: vi.fn(), getContents: vi.fn() };
    await clearClipboardHistory(store, { delete: vi.fn() } as never, systemClipboard, host);
    await expect(store.findRecordByItemId("ztools:old-text")).resolves.toBeUndefined();
    expect(systemClipboard.clear).toHaveBeenCalledOnce();

    const replayPrepare = vi.fn(async (_raw: unknown, record: CanonicalClipboardRecord) => record);
    await expect(mirrorHostHistory(host, store, { deviceId, prepareRecord: replayPrepare }))
      .resolves.toEqual({ imported: 0, skipped: 2, pages: 1 });

    expect(replayPrepare).not.toHaveBeenCalled();
    await expect(store.findRecordByItemId("ztools:old-text")).resolves.toBeUndefined();
    await expect(store.findRecordByItemId("ztools:old-image")).resolves.toBeUndefined();
    expect(systemClipboard.getContents).not.toHaveBeenCalled();
  });

  it("allows the same content to be imported again from a fresh host ID after clear", async () => {
    const { store } = await createStore();
    const original = text("original-copy", 200);
    const originalHost = hostFor([original]);
    await expect(mirrorHostHistory(originalHost, store, { deviceId }))
      .resolves.toMatchObject({ imported: 1 });
    await clearClipboardHistory(store, { delete: vi.fn() } as never, { clear: vi.fn() }, originalHost);
    await expect(store.findRecordByItemId("ztools:original-copy")).resolves.toBeUndefined();

    const freshCopy = text("fresh-copy", 201);
    const host = hostFor([original, freshCopy]);
    await expect(mirrorHostHistory(host, store, { deviceId }))
      .resolves.toEqual({ imported: 1, skipped: 1, pages: 1 });

    await expect(store.findRecordByItemId("ztools:original-copy")).resolves.toBeUndefined();
    await expect(store.findRecordByItemId("ztools:fresh-copy")).resolves.toMatchObject({
      item: { payload: { text: "repeatable content" } },
      origin: { hostItemId: "fresh-copy" },
    });
  });

  it("keeps replay suppression after reopening the real LMDB database", async () => {
    const { fixture, store } = await createStore();
    const items = [image("reopen-old-image", 300), text("reopen-old-text", 200)];
    const host = hostFor(items);
    const failImage = vi.fn(async (raw: unknown, record: CanonicalClipboardRecord) => {
      if ((raw as { type: string }).type === "image") {
        throw new MirroredImagePersistenceError("image-read-failed");
      }
      return record;
    });

    await expect(mirrorHostHistory(host, store, { deviceId, prepareRecord: failImage }))
      .rejects.toMatchObject({ code: "image-read-failed" });
    await clearClipboardHistory(store, { delete: vi.fn() } as never, { clear: vi.fn() }, host);
    await expect(store.getCursor()).resolves.toEqual(initialCursor);

    await fixture.reopen();
    const reopened = new ZToolsCanonicalClipboardStore(
      createCheckedZToolsDocumentDatabase(fixture.raw),
      { deviceId },
    );
    const prepare = vi.fn(async (_raw: unknown, record: CanonicalClipboardRecord) => record);
    await expect(mirrorHostHistory(host, reopened, { deviceId, prepareRecord: prepare }))
      .resolves.toEqual({ imported: 0, skipped: 2, pages: 1 });

    expect(prepare).not.toHaveBeenCalled();
    await expect(reopened.findRecordByItemId("ztools:reopen-old-text")).resolves.toBeUndefined();
    await expect(reopened.findRecordByItemId("ztools:reopen-old-image")).resolves.toBeUndefined();
  });

  it("fails closed on unavailable or invalid source history before any clear mutation", async () => {
    const { store } = await createStore();
    const existingHost = hostFor([text("preserve-on-source-error", 200)]);
    await expect(mirrorHostHistory(existingHost, store, { deviceId })).resolves.toMatchObject({
      imported: 1,
    });

    const setRetryBoundary = vi.spyOn(store, "setImageRetryBoundary");
    const advanceBoundary = vi.spyOn(store, "advanceHistoryClearBoundary");
    const deleteRecords = vi.spyOn(store, "deleteRecords");
    const systemClipboard = { clear: vi.fn() };
    const unavailableHost: HostClipboardApi = {
      async getHistory() { throw new Error("synthetic host storage details"); },
    };
    const invalidHost: HostClipboardApi = {
      async getHistory() {
        return { items: [{ id: "invalid", type: "text", timestamp: Number.NaN }], total: 1 };
      },
    };

    for (const [host, code] of [
      [unavailableHost, "history-clear-source-unavailable"],
      [invalidHost, "history-clear-source-invalid"],
    ] as const) {
      const failure = await clearClipboardHistory(
        store,
        { delete: vi.fn() } as never,
        systemClipboard,
        host,
      ).then(() => undefined, (error: unknown) => error);
      expect(failure).toMatchObject({
        name: "HistoryClearSourceError",
        code,
        message: "Cannot confirm clipboard history clear boundary",
      });
      expect((failure as Error & { cause?: unknown }).cause).toBeUndefined();
    }

    expect(setRetryBoundary).not.toHaveBeenCalled();
    expect(advanceBoundary).not.toHaveBeenCalled();
    expect(deleteRecords).not.toHaveBeenCalled();
    expect(systemClipboard.clear).not.toHaveBeenCalled();
    await expect(store.findRecordByItemId("ztools:preserve-on-source-error")).resolves.toBeDefined();
  });

  it("stops before record or clipboard deletion when the boundary acknowledgement fails", async () => {
    const { fixture, store } = await createStore();
    const existing = text("preserve-on-marker-error", 200);
    await expect(mirrorHostHistory(hostFor([existing]), store, { deviceId }))
      .resolves.toMatchObject({ imported: 1 });

    const markerId = boundaryDocumentId(deviceId);
    fixture.queuePutResult(markerId, { ok: false, id: markerId });
    const deleteRecords = vi.spyOn(store, "deleteRecords");
    const systemClipboard = { clear: vi.fn() };
    await expect(clearClipboardHistory(
      store,
      { delete: vi.fn() } as never,
      systemClipboard,
      hostFor([text("new-boundary", 300)]),
    )).rejects.toMatchObject({
      name: "ZToolsDatabaseError",
      message: "Storage operation failed",
    });

    expect(fixture.putCalls.filter(({ _id }) => _id === markerId)).toHaveLength(1);
    expect(deleteRecords).not.toHaveBeenCalled();
    expect(systemClipboard.clear).not.toHaveBeenCalled();
    await expect(store.findRecordByItemId("ztools:preserve-on-marker-error")).resolves.toBeDefined();
  });

  it("does not lower an existing boundary when the host history is empty", async () => {
    const { store } = await createStore();
    const through = { id: "higher-existing-boundary", timestamp: 900 };
    const established = {
      through,
      clearedIdentities: [historyClearIdentity(through)],
    };
    await store.advanceHistoryClearBoundary(established);

    await expect(clearClipboardHistory(
      store,
      { delete: vi.fn() } as never,
      { clear: vi.fn() },
      hostFor([]),
    )).resolves.toMatchObject({ deleted: 0, failed: 0, blobFailures: 0 });

    await expect(store.getHistoryClearBoundary()).resolves.toEqual(established);
  });

  it("allows an unseen ID that sorts before the cleared ID at the same timestamp", async () => {
    const { store } = await createStore();
    const clearedImage = image("zzz-cleared-image", 300);
    const originalHost = hostFor([clearedImage]);
    const failImage = vi.fn(async (_raw: unknown, _record: CanonicalClipboardRecord) => {
      throw new MirroredImagePersistenceError("image-storage-failed");
    });
    await expect(mirrorHostHistory(originalHost, store, { deviceId, prepareRecord: failImage }))
      .rejects.toMatchObject({ code: "image-storage-failed" });
    await clearClipboardHistory(store, { delete: vi.fn() } as never, { clear: vi.fn() }, originalHost);
    await expect(store.getCursor()).resolves.toEqual(initialCursor);

    const unseenCopy = text("aaa-new-same-time", 300);
    const host = hostFor([clearedImage, unseenCopy]);
    const prepare = vi.fn(async (_raw: unknown, record: CanonicalClipboardRecord) => record);
    await expect(mirrorHostHistory(host, store, { deviceId, prepareRecord: prepare }))
      .resolves.toEqual({ imported: 1, skipped: 1, pages: 1 });

    expect(prepare.mock.calls.map(([raw]) => (raw as { id: string }).id))
      .toEqual(["aaa-new-same-time"]);
    await expect(store.findRecordByItemId("ztools:aaa-new-same-time")).resolves.toMatchObject({
      origin: { hostItemId: "aaa-new-same-time" },
    });
  });

  it("allows an unseen copy between the stalled main cursor and a later cleared identity", async () => {
    const { store } = await createStore();
    const clearedImage = image("old-image-300", 300);
    const originalHost = hostFor([clearedImage]);
    const failImage = vi.fn(async (_raw: unknown, _record: CanonicalClipboardRecord) => {
      throw new MirroredImagePersistenceError("image-storage-failed");
    });
    await expect(mirrorHostHistory(originalHost, store, { deviceId, prepareRecord: failImage }))
      .rejects.toMatchObject({ code: "image-storage-failed" });
    await clearClipboardHistory(store, { delete: vi.fn() } as never, { clear: vi.fn() }, originalHost);
    await expect(store.getCursor()).resolves.toEqual(initialCursor);

    const rolledBackTimestampCopy = text("new-copy-at-250", 250);
    const host = hostFor([clearedImage, rolledBackTimestampCopy]);
    const prepare = vi.fn(async (_raw: unknown, record: CanonicalClipboardRecord) => record);
    await expect(mirrorHostHistory(host, store, { deviceId, prepareRecord: prepare }))
      .resolves.toEqual({ imported: 1, skipped: 1, pages: 1 });

    expect(prepare.mock.calls.map(([raw]) => (raw as { id: string }).id))
      .toEqual(["new-copy-at-250"]);
    await expect(store.findRecordByItemId("ztools:new-copy-at-250")).resolves.toMatchObject({
      origin: { hostItemId: "new-copy-at-250" },
    });
  });

  it("does not advance the stalled main cursor when a mirror sees only a cleared row", async () => {
    const { store } = await createStore();
    const clearedImage = image("zzz-cleared-image", 300);
    const originalHost = hostFor([clearedImage]);
    const failImage = vi.fn(async (_raw: unknown, _record: CanonicalClipboardRecord) => {
      throw new MirroredImagePersistenceError("image-storage-failed");
    });
    await expect(mirrorHostHistory(originalHost, store, { deviceId, prepareRecord: failImage }))
      .rejects.toMatchObject({ code: "image-storage-failed" });
    await clearClipboardHistory(store, { delete: vi.fn() } as never, { clear: vi.fn() }, originalHost);

    const replayPrepare = vi.fn(async (_raw: unknown, record: CanonicalClipboardRecord) => record);
    await expect(mirrorHostHistory(hostFor([clearedImage]), store, {
      deviceId,
      prepareRecord: replayPrepare,
    })).resolves.toEqual({ imported: 0, skipped: 1, pages: 1 });
    expect(replayPrepare).not.toHaveBeenCalled();
    await expect(store.getCursor()).resolves.toEqual(initialCursor);

    const sameTimestampNewId = text("aaa-new-same-time", 300, "same-timestamp copy");
    const rolledBackTimestampCopy = text("new-copy-at-250", 250, "rolled-back timestamp copy");
    const appendedHost = hostFor([clearedImage, sameTimestampNewId, rolledBackTimestampCopy]);
    const appendPrepare = vi.fn(async (_raw: unknown, record: CanonicalClipboardRecord) => record);
    await expect(mirrorHostHistory(appendedHost, store, {
      deviceId,
      prepareRecord: appendPrepare,
    })).resolves.toEqual({ imported: 2, skipped: 1, pages: 1 });

    expect(appendPrepare.mock.calls.map(([raw]) => (raw as { id: string }).id))
      .toEqual(["aaa-new-same-time", "new-copy-at-250"]);
    await expect(store.findRecordByItemId("ztools:aaa-new-same-time")).resolves.toBeDefined();
    await expect(store.findRecordByItemId("ztools:new-copy-at-250")).resolves.toBeDefined();
  });
});

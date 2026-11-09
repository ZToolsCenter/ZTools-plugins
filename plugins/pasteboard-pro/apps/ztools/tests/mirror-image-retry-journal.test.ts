import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCheckedZToolsDocumentDatabase } from "../preload/clipboard-document-database";
import { ZToolsCanonicalClipboardStore } from "../preload/clipboard-store";
import { mirrorHostHistory } from "../preload/clipboard-history-mirror";
import { normalizeHostClipboardItem } from "../preload/clipboard-host-normalization";
import { clearClipboardHistory } from "../preload/clear-history";
import { historyClearIdentity } from "../preload/history-clear-identity";
import { MirroredImagePersistenceError } from "../preload/mirrored-image";
import type { CanonicalClipboardRecord, HostClipboardApi, HostCursor } from "../preload/clipboard-store-types";
import { TemporaryLmdbHostDatabase } from "./clipboard-database-fixture";

const deviceId = "retry-journal-test";
const journalId = "pasteboard-pro:mirror-image-retry-journal:" + createHash("sha256").update(deviceId).digest("hex");
const artifactRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)),
  "artifacts/pasteboardpro/v033-retry-journal/lmdb");
const fixtures = new Set<TemporaryLmdbHostDatabase>();
const cursor = (id: string, timestamp = 500): HostCursor => ({ id, timestamp });
const image = (id: string, timestamp = 500) => ({ id, timestamp, type: "image", imagePath: `/sensitive/${id}.png` });
function host(items: readonly unknown[]): HostClipboardApi {
  return { async getHistory(page, pageSize) {
    return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length };
  } };
}
async function createStore() {
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const fixture = await TemporaryLmdbHostDatabase.create(artifactRoot);
  fixtures.add(fixture);
  const store = new ZToolsCanonicalClipboardStore(createCheckedZToolsDocumentDatabase(fixture.raw), { deviceId });
  await store.setCursor(cursor("initial", 1));
  return { fixture, store };
}
const failPrepare = async (_raw: unknown, _record: CanonicalClipboardRecord) => {
  throw new MirroredImagePersistenceError("image-read-failed");
};

describe("durable image retry journal", () => {
  afterEach(async () => {
    for (const fixture of fixtures) { fixtures.delete(fixture); await fixture.closeAndRemove(); }
  });

  it("does not invoke prepare or advance cursor when initial pending persistence is unconfirmed", async () => {
    const { fixture, store } = await createStore();
    fixture.queuePutResult(journalId, { ok: false, id: journalId });
    const prepare = vi.fn(async (_raw: unknown, record: CanonicalClipboardRecord) => record);
    await expect(mirrorHostHistory(host([image("not-prepared")]), store, { deviceId, prepareRecord: prepare }))
      .rejects.toMatchObject({ name: "ZToolsDatabaseError" });
    expect(prepare).not.toHaveBeenCalled();
    expect(await store.getCursor()).toEqual(cursor("initial", 1));
    expect(fixture.readDocument(journalId)).toBeUndefined();
  });

  it("does not prepare when the attempt update is unconfirmed", async () => {
    const { fixture, store } = await createStore();
    const item = image("attempt-not-confirmed");
    await store.imageRetries.observe(cursor("attempt-not-confirmed"));
    fixture.queuePutResult(journalId, { ok: false, id: journalId });
    const prepare = vi.fn(async (_raw: unknown, record: CanonicalClipboardRecord) => record);
    await expect(mirrorHostHistory(host([item]), store, { deviceId, prepareRecord: prepare }))
      .rejects.toMatchObject({ name: "ZToolsDatabaseError" });
    expect(prepare).not.toHaveBeenCalled();
    expect(fixture.readDocument(journalId)?.entries).toMatchObject([{ state: "pending", attempts: 0 }]);
    expect(await store.getCursor()).toEqual(cursor("initial", 1));
  });

  it("reopens failed metadata and increments each retry exactly once without storing image contents", async () => {
    const { fixture, store } = await createStore();
    const item = image("failed-image");
    await expect(mirrorHostHistory(host([item]), store, { deviceId, prepareRecord: failPrepare }))
      .rejects.toMatchObject({ code: "image-read-failed" });
    expect(await store.imageRetries.readSummary()).toEqual({ pending: 0, failed: 1, total: 1, capacity: 4096 });
    expect(fixture.readDocument(journalId)?.entries).toMatchObject([{ cursor: cursor("failed-image"), state: "failed", attempts: 1, reason: "image-read-failed" }]);
    expect(JSON.stringify(fixture.readDocument(journalId))).not.toMatch(/imagePath|\/sensitive|content|stack|exception/u);
    await fixture.reopen();
    const reopened = new ZToolsCanonicalClipboardStore(createCheckedZToolsDocumentDatabase(fixture.raw), { deviceId });
    await expect(mirrorHostHistory(host([item]), reopened, { deviceId, prepareRecord: failPrepare }))
      .rejects.toMatchObject({ code: "image-read-failed" });
    expect(fixture.readDocument(journalId)?.entries).toMatchObject([{ state: "failed", attempts: 2, reason: "image-read-failed" }]);
  });

  it("retries completion after a confirmed record write without preparing or rewriting the record", async () => {
    const { fixture, store } = await createStore();
    const item = image("complete-failed");
    const prepare = vi.fn(async (_raw: unknown, record: CanonicalClipboardRecord) => {
      fixture.queuePutResult(journalId, { ok: false, id: journalId });
      return record;
    });
    await expect(mirrorHostHistory(host([item]), store, { deviceId, prepareRecord: prepare }))
      .rejects.toMatchObject({ name: "ZToolsDatabaseError" });
    const imported = await store.findRecordByItemId("ztools:complete-failed");
    expect(imported).toBeDefined();
    expect(await store.getCursor()).toEqual(cursor("initial", 1));
    expect(await store.imageRetries.readSummary()).toMatchObject({ pending: 1, total: 1 });
    const recordWrites = fixture.putCalls.filter((call) => call.type === "pasteboard-pro-record").length;
    await fixture.reopen();
    const reopened = new ZToolsCanonicalClipboardStore(createCheckedZToolsDocumentDatabase(fixture.raw), { deviceId });
    const retryPrepare = vi.fn(async (_raw: unknown, record: CanonicalClipboardRecord) => record);
    await expect(mirrorHostHistory(host([item]), reopened, { deviceId, prepareRecord: retryPrepare }))
      .resolves.toMatchObject({ imported: 0, skipped: 1 });
    expect(retryPrepare).not.toHaveBeenCalled();
    expect(fixture.putCalls.filter((call) => call.type === "pasteboard-pro-record")).toHaveLength(recordWrites);
    expect(await reopened.imageRetries.readSummary()).toMatchObject({ total: 0 });
    expect(await reopened.getCursor()).toEqual(cursor("complete-failed"));
  });

  it("keeps missing source images visible and prevents cursor advance until explicit clear", async () => {
    const { store } = await createStore();
    const item = image("source-disappeared");
    await expect(mirrorHostHistory(host([item]), store, { deviceId, prepareRecord: failPrepare })).rejects.toThrow();
    await expect(mirrorHostHistory(host([]), store, { deviceId })).rejects.toMatchObject({ code: "image-retry-pending" });
    expect(await store.imageRetries.readSummary()).toMatchObject({ total: 1, failed: 1 });
    expect(await store.getCursor()).toEqual(cursor("initial", 1));
    const system = { clear: vi.fn() };
    await clearClipboardHistory(store, { delete: vi.fn() } as never, system, host([]));
    expect(system.clear).toHaveBeenCalledOnce();
    expect(await store.imageRetries.readSummary()).toMatchObject({ total: 0 });
    const prepare = vi.fn(async (_raw: unknown, record: CanonicalClipboardRecord) => record);
    await expect(mirrorHostHistory(host([item]), store, { deviceId, prepareRecord: prepare })).resolves.toMatchObject({ imported: 0 });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("clears an existing retry when current privacy denies it without reading the image", async () => {
    const { store } = await createStore();
    const item = image("now-private");
    await expect(mirrorHostHistory(host([item]), store, { deviceId, prepareRecord: failPrepare })).rejects.toThrow();
    const prepare = vi.fn(async (_raw: unknown, record: CanonicalClipboardRecord) => record);
    await expect(mirrorHostHistory(host([item]), store, { deviceId, shouldPersist: () => false, prepareRecord: prepare }))
      .resolves.toMatchObject({ imported: 0, skipped: 1 });
    expect(prepare).not.toHaveBeenCalled();
    expect(await store.imageRetries.readSummary()).toMatchObject({ total: 0 });
  });

  it("does not delete records or clear clipboard when retry journal clearing is unconfirmed", async () => {
    const { fixture, store } = await createStore();
    const item = image("clear-unconfirmed");
    await expect(mirrorHostHistory(host([item]), store, { deviceId, prepareRecord: failPrepare })).rejects.toThrow();
    const list = vi.spyOn(store, "listRecords");
    const system = { clear: vi.fn() };
    fixture.queuePutResult(journalId, { ok: false, id: journalId });
    await expect(clearClipboardHistory(store, { delete: vi.fn() } as never, system, host([])))
      .rejects.toMatchObject({ name: "ZToolsDatabaseError" });
    expect(list).not.toHaveBeenCalled();
    expect(system.clear).not.toHaveBeenCalled();
    expect(await store.imageRetries.readSummary()).toMatchObject({ total: 1, failed: 1 });
    await expect(clearClipboardHistory(store, { delete: vi.fn() } as never, system, host([])))
      .resolves.toMatchObject({ failed: 0 });
    expect(await store.imageRetries.readSummary()).toMatchObject({ total: 0 });
  });

  it("rejects unknown/corrupt schemas, unconfirmed updates, and cross-device reads", async () => {
    const { fixture, store } = await createStore();
    await store.imageRetries.observe(cursor("known"));
    const document = fixture.readDocument(journalId)!;
    const other = new ZToolsCanonicalClipboardStore(createCheckedZToolsDocumentDatabase(fixture.raw), { deviceId: "other-device" });
    expect(await other.imageRetries.readSummary()).toMatchObject({ total: 0 });
    fixture.seedDocument({ ...document, schemaVersion: 2 });
    await expect(store.imageRetries.readSummary()).rejects.toThrow("Image retry journal is invalid");
    await expect(store.imageRetries.observe(cursor("new"))).rejects.toThrow("Image retry journal is invalid");
    fixture.seedDocument({ ...document, entries: [{ identity: "0".repeat(64), cursor: cursor("known"), state: "pending", attempts: 0 }] });
    await expect(store.imageRetries.readSummary()).rejects.toThrow("Image retry journal is invalid");
    fixture.seedDocument({ ...document, entries: [{ ...(document.entries as object[])[0], secret: "/private" }] });
    await expect(store.imageRetries.readSummary()).rejects.toThrow("Image retry journal is invalid");
  });

  it("does not mistake an unrelated duplicate text row for a saved image retry", async () => {
    const { store } = await createStore();
    const row = { id: "reused-source-id", timestamp: 500, type: "text", content: "already saved" };
    const record = normalizeHostClipboardItem(row, deviceId);
    expect(record).not.toBeNull();
    await store.put(record!);
    await store.imageRetries.observe(cursor("reused-source-id"));
    await expect(mirrorHostHistory(host([row]), store, { deviceId })).rejects.toMatchObject({ code: "image-retry-pending" });
    expect(await store.imageRetries.readSummary()).toMatchObject({ pending: 1, total: 1 });
    expect(await store.getCursor()).toEqual(cursor("initial", 1));
  });

  it("keeps newly concurrent retries when a clear marker does not cover them", async () => {
    const { fixture, store } = await createStore();
    const first = cursor("before-clear", 500), concurrent = cursor("concurrent", 501);
    await store.imageRetries.observe(first);
    const boundary = await store.imageRetries.readClearBoundary();
    expect(boundary).toBeDefined();
    await store.advanceHistoryClearBoundary(boundary!);
    const stored = fixture.readDocument(journalId)!;
    const entries = [
      ...(stored.entries as Array<Record<string, unknown>>),
      { identity: historyClearIdentity(concurrent), cursor: concurrent, state: "pending", attempts: 0 },
    ].sort((a, b) => String(a.identity) < String(b.identity) ? -1 : 1);
    fixture.queuePutResult(journalId, { id: journalId, error: true, name: "conflict" }, { ...stored, entries });
    await expect(store.imageRetries.clear()).rejects.toThrow("Image retry journal is invalid");
    expect(await store.imageRetries.readSummary()).toMatchObject({ total: 2, pending: 2 });
  });

  it("rejects attempts and failures for identities that were never observed", async () => {
    const { store } = await createStore();
    await expect(store.imageRetries.begin(cursor("missing"))).rejects.toThrow("Image retry journal is invalid");
    await expect(store.imageRetries.fail(cursor("missing"), "image-read-failed")).rejects.toThrow("Image retry journal is invalid");
    expect(await store.imageRetries.readSummary()).toMatchObject({ total: 0 });
  });

  it("enforces both the 4096-entry and 1 MiB document budgets without truncating", async () => {
    const { fixture, store } = await createStore();
    const base = { _id: journalId, type: "pasteboard-pro-mirror-image-retry-journal", schemaVersion: 1,
      deviceIdHash: createHash("sha256").update(deviceId).digest("hex") };
    const makeEntry = (value: HostCursor) => ({ identity: historyClearIdentity(value), cursor: value, state: "pending", attempts: 0 });
    const entries = Array.from({ length: 4096 }, (_, i) => makeEntry(cursor(`id-${i}`, i + 2)))
      .sort((a, b) => a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0);
    fixture.seedDocument({ ...base, entries });
    expect(await store.imageRetries.readSummary()).toMatchObject({ pending: 4096, total: 4096, capacity: 4096 });
    await expect(store.imageRetries.observe(cursor("over-limit"))).rejects.toMatchObject({ code: "image-retry-capacity" });
    expect((fixture.readDocument(journalId)?.entries as unknown[])).toHaveLength(4096);
    const huge = Array.from({ length: 260 }, (_, i) => makeEntry(cursor(`${i}-${"x".repeat(4080)}`, i + 2)))
      .sort((a, b) => a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0);
    fixture.seedDocument({ ...base, entries: huge });
    await expect(store.imageRetries.readSummary()).rejects.toThrow("Image retry journal capacity exceeded");

    // A new host revision is appended after put; the candidate must reserve it.
    let reservedBytes = Buffer.byteLength(JSON.stringify({ ...base, entries: [], _rev: "x".repeat(2046) }));
    const near: typeof huge = [];
    for (const entry of huge) {
      const increment = Buffer.byteLength(JSON.stringify(entry)) + (near.length ? 1 : 0);
      if (reservedBytes + increment > 1024 * 1024) break;
      near.push(entry); reservedBytes += increment;
    }
    expect(near.length).toBeGreaterThan(0);
    expect(near.length).toBeLessThan(huge.length);
    fixture.seedDocument({ ...base, entries: near });
    await expect(store.imageRetries.observe(huge[near.length]!.cursor)).rejects.toMatchObject({ code: "image-retry-capacity" });
    expect((fixture.readDocument(journalId)?.entries as unknown[])).toHaveLength(near.length);
  });
});

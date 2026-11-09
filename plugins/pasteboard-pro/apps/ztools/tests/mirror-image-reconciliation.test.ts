import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCheckedZToolsDocumentDatabase } from "../preload/clipboard-document-database";
import { ZToolsCanonicalClipboardStore } from "../preload/clipboard-store";
import { mirrorHostHistory } from "../preload/clipboard-history-mirror";
import { reconcilePersistedMirrorImage } from "../preload/mirror-image-reconciliation";
import { localizeMirroredImage, MirroredImagePersistenceError } from "../preload/mirrored-image";
import { readBoundedImageBytes, writeVerifiedSyncBlobFile } from "../preload/sync-blob-files";
import type { CanonicalClipboardRecord, HostClipboardApi, HostCursor } from "../preload/clipboard-store-types";
import { TemporaryLmdbHostDatabase } from "./clipboard-database-fixture";

const deviceId = "reconciliation-test";
const journalId = "pasteboard-pro:mirror-image-retry-journal:" + createHash("sha256").update(deviceId).digest("hex");
const artifactRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)),
  "artifacts/pasteboardpro/v033-retry-journal/reconciliation");
const fixtures = new Set<TemporaryLmdbHostDatabase>();
function host(items: readonly unknown[]): HostClipboardApi {
  return { async getHistory(page, size) { return { items: items.slice((page - 1) * size, page * size), total: items.length }; } };
}
async function createStore() {
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const fixture = await TemporaryLmdbHostDatabase.create(artifactRoot); fixtures.add(fixture);
  const store = new ZToolsCanonicalClipboardStore(createCheckedZToolsDocumentDatabase(fixture.raw), { deviceId });
  await store.setCursor({ id: "initial", timestamp: 1 });
  const blobRoot = path.join(fixture.directory, "blobs");
  const source = path.join(fixture.directory, "source.png");
  await writeFile(source, Buffer.from("owned image fixture"));
  const raw = { id: "saved-image", timestamp: 500, type: "image", imagePath: source };
  const prepare = async (_raw: unknown, record: CanonicalClipboardRecord) => localizeMirroredImage(record, {
    readFile: readBoundedImageBytes,
    storeLocalBlob: async (bytes, mediaType) => {
      const blob = await writeVerifiedSyncBlobFile(blobRoot, bytes, mediaType);
      return { id: `blob-${blob.digest}`, imagePath: blob.filePath, blobBytes: blob.byteLength };
    },
  });
  return { fixture, store, blobRoot, raw, prepare };
}
async function leaveConfirmedRecordWithPendingJournal(state: Awaited<ReturnType<typeof createStore>>) {
  const prepare = vi.fn(async (raw: unknown, record: CanonicalClipboardRecord) => {
    const saved = await state.prepare(raw, record);
    state.fixture.queuePutResult(journalId, { ok: false, id: journalId });
    return saved;
  });
  await expect(mirrorHostHistory(host([state.raw]), state.store, { deviceId, prepareRecord: prepare }))
    .rejects.toMatchObject({ name: "ZToolsDatabaseError" });
  expect(await state.store.imageRetries.readSummary()).toMatchObject({ pending: 1, total: 1 });
  return state.store.findRecordByItemId("ztools:saved-image");
}

describe("persisted image reconciliation", () => {
  afterEach(async () => { for (const fixture of fixtures) { fixtures.delete(fixture); await fixture.closeAndRemove(); } });

  it("reconciles a confirmed record after journal failure, host disappearance and LMDB reopen", async () => {
    const state = await createStore();
    const record = await leaveConfirmedRecordWithPendingJournal(state);
    expect(record).toBeDefined();
    const writes = state.fixture.putCalls.filter((value) => value.type === "pasteboard-pro-record").length;
    await state.fixture.reopen();
    const reopened = new ZToolsCanonicalClipboardStore(createCheckedZToolsDocumentDatabase(state.fixture.raw), { deviceId });
    const verify = vi.fn((candidate: HostCursor) => reconcilePersistedMirrorImage(reopened, candidate, deviceId, state.blobRoot));
    const newer = { id: "new-text", timestamp: 1000, type: "text", content: "not lost" };
    await expect(mirrorHostHistory(host([newer]), reopened, { deviceId, reconcilePersistedImage: verify }))
      .resolves.toMatchObject({ imported: 1 });
    expect(verify).toHaveBeenCalledWith({ id: "saved-image", timestamp: 500 });
    expect(await reopened.imageRetries.readSummary()).toMatchObject({ total: 0 });
    expect(await reopened.getCursor()).toEqual({ id: "new-text", timestamp: 1000 });
    const imageWrites = state.fixture.putCalls.filter((value) => value.type === "pasteboard-pro-record" &&
      (value.record as CanonicalClipboardRecord).item.kind === "image");
    expect(imageWrites).toHaveLength(writes);
  });

  it("keeps a failed prepare whose source disappears instead of inventing a saved record", async () => {
    const state = await createStore();
    await expect(mirrorHostHistory(host([state.raw]), state.store, { deviceId, prepareRecord: async () => {
      throw new MirroredImagePersistenceError("image-read-failed");
    } })).rejects.toMatchObject({ code: "image-read-failed" });
    await state.fixture.reopen();
    const reopened = new ZToolsCanonicalClipboardStore(createCheckedZToolsDocumentDatabase(state.fixture.raw), { deviceId });
    const verify = vi.fn((candidate: HostCursor) => reconcilePersistedMirrorImage(reopened, candidate, deviceId, state.blobRoot));
    await expect(mirrorHostHistory(host([]), reopened, { deviceId, reconcilePersistedImage: verify }))
      .rejects.toMatchObject({ code: "image-retry-pending" });
    expect(verify).not.toHaveBeenCalled();
    expect(await reopened.imageRetries.readSummary()).toMatchObject({ failed: 1, total: 1 });
    expect(await reopened.getCursor()).toEqual({ id: "initial", timestamp: 1 });
  });

  it("requires exact device, source id, unambiguous timestamp and owned blob bytes", async () => {
    const state = await createStore();
    const record = await leaveConfirmedRecordWithPendingJournal(state);
    expect(record).toBeDefined();
    const value = { id: "saved-image", timestamp: 500 };
    expect(await reconcilePersistedMirrorImage(state.store, value, deviceId, state.blobRoot)).toBe(true);
    expect(await reconcilePersistedMirrorImage(state.store, { ...value, id: "other" }, deviceId, state.blobRoot)).toBe(false);
    expect(await reconcilePersistedMirrorImage(state.store, { ...value, timestamp: 501 }, deviceId, state.blobRoot)).toBe(false);
    expect(await reconcilePersistedMirrorImage(state.store, { ...value, timestamp: 500.5 }, deviceId, state.blobRoot)).toBe(false);
    expect(await reconcilePersistedMirrorImage(state.store, value, "other-device", state.blobRoot)).toBe(false);
    expect(await reconcilePersistedMirrorImage(state.store, value, deviceId, state.fixture.directory)).toBe(false);
    await writeFile(record!.origin.imagePath!, Buffer.from("tampered image data"));
    expect(await reconcilePersistedMirrorImage(state.store, value, deviceId, state.blobRoot)).toBe(false);
    await expect(mirrorHostHistory(host([]), state.store, { deviceId,
      reconcilePersistedImage: (candidate) => reconcilePersistedMirrorImage(state.store, candidate, deviceId, state.blobRoot) }))
      .rejects.toMatchObject({ code: "image-retry-pending" });
  });

  it("preserves an exact source binding across local image edits and reconciles after reopen", async () => {
    const state = await createStore();
    await leaveConfirmedRecordWithPendingJournal(state);
    let edited: CanonicalClipboardRecord | undefined;
    for (const contents of ["first local edit", "second local edit"]) {
      const blob = await writeVerifiedSyncBlobFile(state.blobRoot, Buffer.from(contents), "image/png");
      const blobId = `blob-${blob.digest}`;
      edited = await state.store.updateImagePayload("ztools:saved-image", {
        blobId, revision: `sha256:${blob.digest}`, imagePath: blob.filePath,
        blobBytes: blob.byteLength, mediaType: "image/png",
      });
      expect(edited.origin).toMatchObject({ host: "sync", hostCapture: {
        schemaVersion: 1, hostItemId: "saved-image", timestamp: 500, deviceId, editedBlobId: blobId,
      } });
    }
    await state.fixture.reopen();
    const reopened = new ZToolsCanonicalClipboardStore(createCheckedZToolsDocumentDatabase(state.fixture.raw), { deviceId });
    const restored = await reopened.findRecordByItemId("ztools:saved-image");
    expect(restored?.origin).toEqual(edited?.origin);
    const newer = { id: "later", timestamp: 1000, type: "text", content: "newer" };
    await expect(mirrorHostHistory(host([newer]), reopened, { deviceId,
      reconcilePersistedImage: (candidate) => reconcilePersistedMirrorImage(reopened, candidate, deviceId, state.blobRoot) }))
      .resolves.toMatchObject({ imported: 1 });
    expect(await reopened.imageRetries.readSummary()).toMatchObject({ total: 0 });
    expect(await reopened.getCursor()).toEqual({ id: "later", timestamp: 1000 });
  });

  it("never infers source provenance from a plain sync item or carries it across remote payload replacement", async () => {
    const state = await createStore();
    await leaveConfirmedRecordWithPendingJournal(state);
    const blob = await writeVerifiedSyncBlobFile(state.blobRoot, Buffer.from("local edit"), "image/png");
    const blobId = `blob-${blob.digest}`;
    const edited = await state.store.updateImagePayload("ztools:saved-image", {
      blobId, revision: `sha256:${blob.digest}`, imagePath: blob.filePath,
      blobBytes: blob.byteLength, mediaType: "image/png",
    });
    if (edited.origin.host !== "sync") throw new Error("expected sync origin");
    const { hostCapture: _binding, ...unbound } = edited.origin;
    const lookalike = { ...edited, origin: unbound };
    const fake = { findRecordByItemId: vi.fn(async () => lookalike) };
    expect(await reconcilePersistedMirrorImage(fake, { id: "saved-image", timestamp: 500 }, deviceId, state.blobRoot)).toBe(false);
    await state.store.putSyncedItem({ ...edited.item, payload: { ...edited.item.payload,
      revision: `sha256:${"a".repeat(64)}`, blobId: `blob-${"a".repeat(64)}` } });
    const replaced = await state.store.findRecordByItemId("ztools:saved-image");
    expect(replaced?.origin).not.toHaveProperty("hostCapture");
    expect(await reconcilePersistedMirrorImage(state.store, { id: "saved-image", timestamp: 500 }, deviceId, state.blobRoot)).toBe(false);
    expect(await state.store.imageRetries.readSummary()).toMatchObject({ total: 1 });
  });

  it("rejects tampered source binding and an unchanged revision with a different remote blob", async () => {
    const state = await createStore();
    await leaveConfirmedRecordWithPendingJournal(state);
    const blob = await writeVerifiedSyncBlobFile(state.blobRoot, Buffer.from("local edit"), "image/png");
    const blobId = `blob-${blob.digest}`;
    const edited = await state.store.updateImagePayload("ztools:saved-image", {
      blobId, revision: `sha256:${blob.digest}`, imagePath: blob.filePath,
      blobBytes: blob.byteLength, mediaType: "image/png",
    });
    if (edited.origin.host !== "sync" || !edited.origin.hostCapture) throw new Error("expected source binding");
    for (const changed of [
      { ...edited.origin.hostCapture, hostItemId: "other" },
      { ...edited.origin.hostCapture, timestamp: 501 },
      { ...edited.origin.hostCapture, deviceId: "other-device" },
      { ...edited.origin.hostCapture, editedBlobId: `blob-${"b".repeat(64)}` },
    ]) {
      const fake = { findRecordByItemId: vi.fn(async () => ({ ...edited, origin: { ...edited.origin, hostCapture: changed } })) };
      expect(await reconcilePersistedMirrorImage(fake, { id: "saved-image", timestamp: 500 }, deviceId, state.blobRoot)).toBe(false);
    }
    await state.store.putSyncedItem({ ...edited.item, payload: { ...edited.item.payload, blobId: `blob-${"b".repeat(64)}` } });
    expect(await reconcilePersistedMirrorImage(state.store, { id: "saved-image", timestamp: 500 }, deviceId, state.blobRoot)).toBe(false);
    expect(await state.store.imageRetries.readSummary()).toMatchObject({ total: 1 });
  });

  it("leaves unknown or malformed source-binding versions unresolved without rewriting the record", async () => {
    const state = await createStore();
    await leaveConfirmedRecordWithPendingJournal(state);
    const blob = await writeVerifiedSyncBlobFile(state.blobRoot, Buffer.from("local edit"), "image/png");
    await state.store.updateImagePayload("ztools:saved-image", {
      blobId: `blob-${blob.digest}`, revision: `sha256:${blob.digest}`, imagePath: blob.filePath,
      blobBytes: blob.byteLength, mediaType: "image/png",
    });
    const recordPut = state.fixture.putCalls.filter((call) => call.type === "pasteboard-pro-record").at(-1)!;
    const doc = state.fixture.readDocument(recordPut._id as string)!;
    const current = doc.record as CanonicalClipboardRecord;
    if (current.origin.host !== "sync" || !current.origin.hostCapture) throw new Error("expected binding");
    const corrupted = { ...doc, record: { ...current, origin: { ...current.origin,
      hostCapture: { ...current.origin.hostCapture, schemaVersion: 2 } } } };
    // Use the checked host-shaped put: seedDocument ignores a thenable LMDB
    // transaction and can deadlock close when immediately followed by reopen.
    const writeResult = await state.fixture.raw.put(corrupted);
    expect(writeResult).toMatchObject({ ok: true, id: recordPut._id });
    const expected = { ...corrupted, _rev: (writeResult as { rev: string }).rev };
    await state.fixture.reopen();
    const reopened = new ZToolsCanonicalClipboardStore(createCheckedZToolsDocumentDatabase(state.fixture.raw), { deviceId });
    await expect(mirrorHostHistory(host([]), reopened, { deviceId,
      reconcilePersistedImage: (candidate) => reconcilePersistedMirrorImage(reopened, candidate, deviceId, state.blobRoot) }))
      .rejects.toMatchObject({ code: "image-retry-pending" });
    expect(await reopened.imageRetries.readSummary()).toMatchObject({ total: 1 });
    expect(state.fixture.readDocument(recordPut._id as string)).toEqual(expected);
  });

  it("does not accept a nonboolean verifier result or allow it to retarget a completion", async () => {
    const state = await createStore();
    await state.store.imageRetries.observe({ id: "candidate", timestamp: 400 });
    await state.store.imageRetries.begin({ id: "candidate", timestamp: 400 });
    await state.store.imageRetries.observe({ id: "other", timestamp: 300 });
    await state.store.imageRetries.begin({ id: "other", timestamp: 300 });
    await state.store.imageRetries.fail({ id: "other", timestamp: 300 }, "image-read-failed");
    await expect(mirrorHostHistory(host([]), state.store, { deviceId,
      reconcilePersistedImage: async () => "truthy" as never })).rejects.toThrow("Image retry reconciliation returned an invalid result");
    expect(await state.store.imageRetries.readSummary()).toMatchObject({ pending: 1, failed: 1, total: 2 });
    await expect(mirrorHostHistory(host([]), state.store, { deviceId, reconcilePersistedImage: async (candidate) => {
      expect(Reflect.set(candidate, "id", "other")).toBe(false);
      return true;
    } })).rejects.toMatchObject({ code: "image-retry-pending" });
    expect(await state.store.imageRetries.readSummary()).toMatchObject({ pending: 0, failed: 1, total: 1 });
    expect(await state.store.imageRetries.readClearBoundary()).toMatchObject({ through: { id: "other", timestamp: 300 } });
  });

  it("does not convert an actual database read error into an absent record", async () => {
    const failure = new Error("database unavailable");
    const store = { findRecordByItemId: vi.fn(async () => { throw failure; }) };
    await expect(reconcilePersistedMirrorImage(store, { id: "x", timestamp: 1 }, deviceId, artifactRoot)).rejects.toBe(failure);
  });
});

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCheckedZToolsDocumentDatabase } from "../preload/clipboard-document-database";
import { ZToolsCanonicalClipboardStore } from "../preload/clipboard-store";
import { mirrorHostHistory } from "../preload/clipboard-history-mirror";
import { historyClearIdentity } from "../preload/history-clear-identity";
import { localizeMirroredImage, MirroredImagePersistenceError } from "../preload/mirrored-image";
import { readBoundedImageBytes, writeVerifiedSyncBlobFile } from "../preload/sync-blob-files";
import type { CanonicalClipboardRecord, HostClipboardApi, HostCursor } from "../preload/clipboard-store-types";
import { TemporaryLmdbHostDatabase } from "./clipboard-database-fixture";

const deviceId = "retry-capacity-test";
const hash = createHash("sha256").update(deviceId).digest("hex");
const journalId = "pasteboard-pro:mirror-image-retry-journal:" + hash;
const artifactRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)),
  "artifacts/pasteboardpro/v033-retry-journal/capacity");
const fixtures = new Set<TemporaryLmdbHostDatabase>();
type Entry = { identity: string; cursor: HostCursor; state: "pending" | "failed"; attempts: number; reason?: "image-read-failed" };
function entry(id: string, timestamp: number, failed = false): Entry {
  const cursor = { id, timestamp };
  return { identity: historyClearIdentity(cursor), cursor, state: failed ? "failed" : "pending", attempts: failed ? 1 : 0,
    ...(failed ? { reason: "image-read-failed" as const } : {}) };
}
function sort(entries: Entry[]): Entry[] { return entries.sort((a, b) => a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0); }
function image(id: string, timestamp: number) { return { id, timestamp, type: "image", imagePath: `/fake/${id}.png` }; }
const text = { id: "healthy", timestamp: 2000, type: "text", content: "healthy text" };
function host(items: readonly unknown[]): HostClipboardApi {
  return { async getHistory(page, size) { return { items: items.slice((page - 1) * size, page * size), total: items.length }; } };
}
async function createStore() {
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const fixture = await TemporaryLmdbHostDatabase.create(artifactRoot); fixtures.add(fixture);
  const store = new ZToolsCanonicalClipboardStore(createCheckedZToolsDocumentDatabase(fixture.raw), { deviceId });
  await store.setCursor({ id: "initial", timestamp: 1 });
  return { fixture, store };
}
async function seed(fixture: TemporaryLmdbHostDatabase, entries: Entry[]) {
  const acknowledgement = await fixture.raw.put({ _id: journalId, type: "pasteboard-pro-mirror-image-retry-journal", schemaVersion: 1, deviceIdHash: hash, entries: sort(entries) });
  expect(acknowledgement).toMatchObject({ ok: true, id: journalId, rev: expect.any(String) });
}

describe("bounded image retry admission", () => {
  afterEach(async () => { for (const fixture of fixtures) { fixtures.delete(fixture); await fixture.closeAndRemove(); } });

  it("at 4096 entries skips the new head, drains an existing image, and keeps healthy text", async () => {
    const { fixture, store } = await createStore();
    const entries = [entry("known", 500, true), ...Array.from({ length: 4095 }, (_, index) => entry(`missing-${index}`, 10 + index))];
    await seed(fixture, entries);
    const prepare = vi.fn(async (_raw: unknown, record: CanonicalClipboardRecord) => record);
    const rows = [image("new-head", 1000), image("known", 500), text];
    await expect(mirrorHostHistory(host(rows), store, { deviceId, prepareRecord: prepare }))
      .rejects.toMatchObject({ name: "MirrorImageRetryCapacityError", code: "image-retry-capacity" });
    expect(prepare.mock.calls.map(([raw]) => (raw as { id: string }).id)).toEqual(["known", "healthy"]);
    expect(await store.findRecordByItemId("ztools:known")).toBeDefined();
    expect(await store.findRecordByItemId("ztools:healthy")).toBeDefined();
    expect(await store.getCursor()).toEqual({ id: "initial", timestamp: 1 });
    expect(await store.imageRetries.readSummary()).toMatchObject({ total: 4095 });
    const next = vi.fn(async (_raw: unknown, record: CanonicalClipboardRecord) => record);
    await expect(mirrorHostHistory(host(rows), store, { deviceId, prepareRecord: next }))
      .rejects.toMatchObject({ code: "image-retry-pending" });
    expect(next.mock.calls.map(([raw]) => (raw as { id: string }).id)).toContain("new-head");
    expect(await store.findRecordByItemId("ztools:new-head")).toBeDefined();
    expect(await store.getCursor()).toEqual({ id: "initial", timestamp: 1 });
  }, 30000);

  it("persists the 16-failure rotation even when the new head is refused at capacity", async () => {
    const { fixture, store } = await createStore();
    const known = Array.from({ length: 17 }, (_, i) => entry(`existing-${i}`, 1000 - i, true));
    await seed(fixture, [...known, ...Array.from({ length: 4079 }, (_, i) => entry(`other-${i}`, 10 + i))]);
    const attempted: string[] = [];
    const prepare = vi.fn(async (raw: unknown, record: CanonicalClipboardRecord) => {
      if (record.item.kind === "image") { attempted.push((raw as { id: string }).id); throw new MirroredImagePersistenceError("image-read-failed"); }
      return record;
    });
    await expect(mirrorHostHistory(host([image("refused-head", 1500), ...known.map((e) => image(e.cursor.id, e.cursor.timestamp)), text]),
      store, { deviceId, prepareRecord: prepare })).rejects.toMatchObject({ code: "image-retry-capacity" });
    expect(attempted).toEqual(known.slice(0, 16).map((value) => value.cursor.id));
    expect(await store.getImageRetryBoundary()).toEqual(known[15]!.cursor);
    expect(await store.findRecordByItemId("ztools:healthy")).toBeDefined();
    expect(await store.imageRetries.readSummary()).toMatchObject({ total: 4096 });
    expect(await store.getCursor()).toEqual({ id: "initial", timestamp: 1 });
  }, 30000);

  it("drains a known large entry at the reserved 1 MiB boundary before retrying a refused head", async () => {
    const { fixture, store } = await createStore();
    const makeLongId = (n: string) => `${n}-${"x".repeat(4000)}`;
    const known = entry(makeLongId("known"), 500, true);
    const candidates = Array.from({ length: 270 }, (_, i) => entry(makeLongId(`other-${i}`), 10 + i));
    const base = { _id: journalId, type: "pasteboard-pro-mirror-image-retry-journal", schemaVersion: 1,
      deviceIdHash: hash, _rev: "x".repeat(2046) };
    const future = (e: Entry) => ({ ...e, state: "failed", attempts: Number.MAX_SAFE_INTEGER, reason: "image-verification-failed" });
    const entries = [known];
    for (const candidate of candidates) {
      if (Buffer.byteLength(JSON.stringify({ ...base, entries: [...entries, candidate].map(future) })) > 1024 * 1024) break;
      entries.push(candidate);
    }
    expect(entries.length).toBeLessThan(270);
    const newId = makeLongId("new-head");
    expect(Buffer.byteLength(JSON.stringify({ ...base, entries: [...entries, entry(newId, 1000)].map(future) })))
      .toBeGreaterThan(1024 * 1024);
    await seed(fixture, entries);
    const prepare = vi.fn(async (_raw: unknown, record: CanonicalClipboardRecord) => record);
    const rows = [image(newId, 1000), image(known.cursor.id, 500), text];
    await expect(mirrorHostHistory(host(rows), store, { deviceId, prepareRecord: prepare }))
      .rejects.toMatchObject({ code: "image-retry-capacity" });
    expect(prepare.mock.calls.map(([raw]) => (raw as { id: string }).id)).toEqual([known.cursor.id, "healthy"]);
    expect(await store.imageRetries.readSummary()).toMatchObject({ total: entries.length - 1 });
    await expect(mirrorHostHistory(host(rows), store, { deviceId, prepareRecord: prepare }))
      .rejects.toMatchObject({ code: "image-retry-pending" });
    expect(await store.findRecordByItemId("ztools:" + newId)).toBeDefined();
    expect(await store.getCursor()).toEqual({ id: "initial", timestamp: 1 });
  }, 30000);

  it.each(["entries", "bytes"] as const)("drains %s capacity, reopens LMDB, then admits the refused image", async (kind) => {
    const { fixture, store } = await createStore();
    const makeLongId = (label: string) => `${label}-${"x".repeat(4000)}`;
    const oldId = kind === "entries" ? "known-before-reopen" : makeLongId("known-before-reopen");
    const newId = kind === "entries" ? "new-after-reopen" : makeLongId("new-after-reopen");
    const known = entry(oldId, 500, true);
    let entries: Entry[];
    if (kind === "entries") {
      entries = [known, ...Array.from({ length: 4095 }, (_, i) => entry(`reopen-other-${i}`, 10 + i))];
    } else {
      const candidates = Array.from({ length: 270 }, (_, i) => entry(makeLongId(`reopen-other-${i}`), 10 + i));
      const base = { _id: journalId, type: "pasteboard-pro-mirror-image-retry-journal", schemaVersion: 1,
        deviceIdHash: hash, _rev: "x".repeat(2046) };
      const future = (value: Entry) => ({ ...value, state: "failed", attempts: Number.MAX_SAFE_INTEGER, reason: "image-verification-failed" });
      entries = [known];
      for (const candidate of candidates) {
        if (Buffer.byteLength(JSON.stringify({ ...base, entries: [...entries, candidate].map(future) })) > 1024 * 1024) break;
        entries.push(candidate);
      }
      expect(entries.length).toBeLessThan(candidates.length);
      expect(Buffer.byteLength(JSON.stringify({ ...base, entries: [...entries, entry(newId, 1000)].map(future) })))
        .toBeGreaterThan(1024 * 1024);
    }
    await seed(fixture, entries);
    const blobRoot = path.join(fixture.directory, "owned-blobs");
    const oldPath = path.join(fixture.directory, "known.png");
    const newPath = path.join(fixture.directory, "new.png");
    const oldBytes = Buffer.from("known image before database reopen");
    const newBytes = Buffer.from("new image after database reopen");
    await writeFile(oldPath, oldBytes);
    await writeFile(newPath, newBytes);
    const sourceRows = [
      { ...image(newId, 1000), imagePath: newPath },
      { ...image(oldId, 500), imagePath: oldPath },
      text,
    ];
    const prepared: string[] = [];
    const prepare = async (raw: unknown, record: CanonicalClipboardRecord) => {
      prepared.push((raw as { id: string }).id);
      return localizeMirroredImage(record, { readFile: readBoundedImageBytes,
        storeLocalBlob: async (bytes, mediaType) => {
          const blob = await writeVerifiedSyncBlobFile(blobRoot, bytes, mediaType);
          return { id: `blob-${blob.digest}`, imagePath: blob.filePath, blobBytes: blob.byteLength };
        } });
    };
    await expect(mirrorHostHistory(host(sourceRows), store, { deviceId, prepareRecord: prepare }))
      .rejects.toMatchObject({ code: "image-retry-capacity" });
    expect(prepared).toEqual([oldId, "healthy"]);
    expect(await store.imageRetries.readSummary()).toMatchObject({ total: entries.length - 1 });
    expect(await store.getCursor()).toEqual({ id: "initial", timestamp: 1 });
    const oldWrites = fixture.putCalls.filter((document) =>
      document.type === "pasteboard-pro-record" && (document.record as CanonicalClipboardRecord).item.id === `ztools:${oldId}`).length;
    expect(oldWrites).toBe(1);
    await fixture.reopen();
    const reopened = new ZToolsCanonicalClipboardStore(createCheckedZToolsDocumentDatabase(fixture.raw), { deviceId });
    expect(await reopened.imageRetries.readSummary()).toMatchObject({ total: entries.length - 1 });
    expect(await reopened.getCursor()).toEqual({ id: "initial", timestamp: 1 });
    await expect(mirrorHostHistory(host(sourceRows), reopened, { deviceId, prepareRecord: prepare }))
      .rejects.toMatchObject({ code: "image-retry-pending" });
    expect(prepared).toEqual([oldId, "healthy", newId]);
    const saved = await reopened.findRecordByItemId(`ztools:${newId}`);
    expect(saved?.origin.pluginBlobId).toBe(`blob-${createHash("sha256").update(newBytes).digest("hex")}`);
    expect(await readBoundedImageBytes(saved!.origin.imagePath!)).toEqual(newBytes);
    expect(fixture.putCalls.filter((document) =>
      document.type === "pasteboard-pro-record" && (document.record as CanonicalClipboardRecord).item.id === `ztools:${oldId}`)).toHaveLength(oldWrites);
    expect(await reopened.imageRetries.readSummary()).toMatchObject({ total: entries.length - 1 });
    expect(await reopened.getCursor()).toEqual({ id: "initial", timestamp: 1 });
  }, 30000);

  it("does not treat a corrupt oversized existing document as ordinary admission pressure", async () => {
    const { fixture, store } = await createStore();
    await seed(fixture, Array.from({ length: 4097 }, (_, i) => entry(`invalid-${i}`, i + 2)));
    const prepare = vi.fn(async (_raw: unknown, record: CanonicalClipboardRecord) => record);
    const error = await mirrorHostHistory(host([image("new", 9000), text]), store, { deviceId, prepareRecord: prepare })
      .then(() => undefined, (value: unknown) => value);
    expect(error).toBeInstanceOf(RangeError);
    expect(error).not.toMatchObject({ code: "image-retry-capacity" });
    expect(prepare).not.toHaveBeenCalled();
    expect(await store.getCursor()).toEqual({ id: "initial", timestamp: 1 });
  }, 30000);
});

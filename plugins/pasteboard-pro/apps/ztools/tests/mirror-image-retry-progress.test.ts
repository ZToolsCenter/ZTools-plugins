import { afterEach, describe, expect, it } from "vitest";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCheckedZToolsDocumentDatabase } from "../preload/clipboard-document-database";
import {
  MIRROR_IMAGE_RETRY_PROGRESS_ID,
  writeMirrorImageRetryBoundary,
} from "../preload/mirror-image-retry-progress";
import { ZToolsCanonicalClipboardStore } from "../preload/clipboard-store";
import type { ZToolsDocumentDatabase } from "../preload/clipboard-store-types";
import { TemporaryLmdbHostDatabase } from "./clipboard-database-fixture";

const artifactRoot = path.resolve(
  fileURLToPath(new URL("../../../", import.meta.url)),
  "artifacts/pasteboardpro/clipboard-format-g0/v030-retry-progress-tests",
);
const fixtures = new Set<TemporaryLmdbHostDatabase>();
const boundary = { id: "host-entry-17", timestamp: 1_790_000_017_000.25 };

async function createStore() {
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const fixture = await TemporaryLmdbHostDatabase.create(artifactRoot);
  fixtures.add(fixture);
  const database = createCheckedZToolsDocumentDatabase(fixture.raw);
  return { fixture, database, store: new ZToolsCanonicalClipboardStore(database) };
}

describe("persistent image retry boundary", () => {
  afterEach(async () => {
    for (const fixture of fixtures) {
      fixtures.delete(fixture);
      await fixture.closeAndRemove();
    }
  });

  it("persists one restricted document and reads it after closing and reopening the store", async () => {
    const { fixture, store, database } = await createStore();
    await expect(store.getImageRetryBoundary()).resolves.toBeUndefined();
    await store.setImageRetryBoundary(boundary);
    await fixture.reopen();

    const reopened = new ZToolsCanonicalClipboardStore(
      createCheckedZToolsDocumentDatabase(fixture.raw),
    );
    await expect(reopened.getImageRetryBoundary()).resolves.toEqual(boundary);
    expect(fixture.readDocument(MIRROR_IMAGE_RETRY_PROGRESS_ID)).toEqual({
      _id: MIRROR_IMAGE_RETRY_PROGRESS_ID,
      _rev: "host-1",
      type: "pasteboard-pro-mirror-image-retry",
      schemaVersion: 1,
      before: boundary,
    });
    expect(await database.allDocs?.({
      include_docs: true,
      startkey: "pasteboard-pro:mirror-image-retry",
      endkey: "pasteboard-pro:mirror-image-retry\uffff",
    })).toHaveLength(1);
    const serialized = JSON.stringify(fixture.readDocument(MIRROR_IMAGE_RETRY_PROGRESS_ID));
    expect(serialized).not.toMatch(/imagePath|content|appBundleId|error|cause/u);
  });

  it("overwrites by revision and clears the checkpoint without deleting the fixed document", async () => {
    const { fixture, store } = await createStore();
    await store.setImageRetryBoundary(boundary);
    await store.setImageRetryBoundary({ id: "host-entry-31", timestamp: 1_790_000_031_000 });
    await expect(store.getImageRetryBoundary()).resolves.toEqual({
      id: "host-entry-31",
      timestamp: 1_790_000_031_000,
    });
    await store.setImageRetryBoundary(undefined);
    await expect(store.getImageRetryBoundary()).resolves.toBeUndefined();
    expect(fixture.readDocument(MIRROR_IMAGE_RETRY_PROGRESS_ID)).toMatchObject({
      _id: MIRROR_IMAGE_RETRY_PROGRESS_ID,
      type: "pasteboard-pro-mirror-image-retry",
      schemaVersion: 1,
      before: null,
    });
  });

  it("copies the caller boundary before the first asynchronous database read", async () => {
    const { fixture, database } = await createStore();
    let releaseRead!: () => void;
    let markReadStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    let firstRead = true;
    const delayedRead: ZToolsDocumentDatabase = {
      ...database,
      async get(id) {
        if (firstRead) {
          firstRead = false;
          markReadStarted();
          await readGate;
        }
        return database.get(id);
      },
    };
    const input = { ...boundary };
    const write = writeMirrorImageRetryBoundary(delayedRead, input);
    await readStarted;
    input.id = "mutated-after-call";
    input.timestamp = 1;
    releaseRead();
    await write;

    expect(fixture.readDocument(MIRROR_IMAGE_RETRY_PROGRESS_ID)?.before).toEqual(boundary);
  });

  it("retries a conflict against a newer valid document and needs a positive final acknowledgement", async () => {
    const { fixture, store } = await createStore();
    fixture.queuePutResult(
      MIRROR_IMAGE_RETRY_PROGRESS_ID,
      { id: MIRROR_IMAGE_RETRY_PROGRESS_ID, error: true, name: "conflict", message: "private" },
      {
        _id: MIRROR_IMAGE_RETRY_PROGRESS_ID,
        type: "pasteboard-pro-mirror-image-retry",
        schemaVersion: 1,
        before: null,
      },
    );
    await store.setImageRetryBoundary(boundary);
    await expect(store.getImageRetryBoundary()).resolves.toEqual(boundary);

    const { fixture: failingFixture, store: failingStore } = await createStore();
    const badAck = { id: MIRROR_IMAGE_RETRY_PROGRESS_ID, error: true, name: "conflict", message: "private" };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      failingFixture.queuePutResult(MIRROR_IMAGE_RETRY_PROGRESS_ID, badAck);
    }
    await expect(failingStore.setImageRetryBoundary(boundary)).rejects.toMatchObject({
      name: "ZToolsDatabaseError",
      message: "Database conflict",
    });
    expect(failingFixture.readDocument(MIRROR_IMAGE_RETRY_PROGRESS_ID)).toBeUndefined();
  });

  it("rejects corrupt persisted schemas and unavailable reads instead of resetting silently", async () => {
    const { fixture, database, store } = await createStore();
    fixture.seedDocument({
      _id: MIRROR_IMAGE_RETRY_PROGRESS_ID,
      type: "pasteboard-pro-mirror-image-retry",
      schemaVersion: 1,
      before: { ...boundary, imagePath: "/private/host/path.png" },
    });
    await expect(store.getImageRetryBoundary()).rejects.toThrow(
      "Mirror image retry progress is invalid",
    );

    const unavailable: ZToolsDocumentDatabase = {
      ...database,
      async get() { throw { status: 500, message: "private storage detail" }; },
    };
    const failingStore = new ZToolsCanonicalClipboardStore(unavailable);
    await expect(failingStore.getImageRetryBoundary()).rejects.toMatchObject({
      name: "ZToolsDatabaseError",
      message: "Storage operation failed",
    });
  });

  it("does not write malformed caller boundaries", async () => {
    const { fixture, store } = await createStore();
    for (const invalid of [
      { id: "", timestamp: 1 },
      { id: "  host-entry", timestamp: 1 },
      { id: "host-entry", timestamp: Number.NaN },
      { id: "host-entry", timestamp: Number.MAX_VALUE },
      { id: "x".repeat(4097), timestamp: 1 },
    ]) {
      await expect(store.setImageRetryBoundary(invalid as never)).rejects.toThrow(
        "Mirror image retry progress is invalid",
      );
    }
    expect(fixture.readDocument(MIRROR_IMAGE_RETRY_PROGRESS_ID)).toBeUndefined();
  });

  it("rejects writes whose acknowledgement is absent or does not bind the fixed document revision", async () => {
    const { fixture, store } = await createStore();
    const invalidAcks: unknown[] = [
      undefined,
      { ok: true, id: "another-document", rev: "host-1" },
      { ok: true, id: MIRROR_IMAGE_RETRY_PROGRESS_ID, rev: "" },
    ];
    for (const ack of invalidAcks) {
      fixture.queuePutResult(MIRROR_IMAGE_RETRY_PROGRESS_ID, ack);
      await expect(store.setImageRetryBoundary(boundary)).rejects.toMatchObject({
        name: "ZToolsDatabaseError",
        message: "Storage operation failed",
      });
      expect(fixture.readDocument(MIRROR_IMAGE_RETRY_PROGRESS_ID)).toBeUndefined();
    }
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCheckedZToolsDocumentDatabase } from "../preload/clipboard-document-database";
import { compareCursor } from "../preload/clipboard-host-normalization";
import { ZToolsCanonicalClipboardStore } from "../preload/clipboard-store";
import {
  historyClearIdentity,
  MAX_HISTORY_CLEAR_IDENTITIES,
} from "../preload/history-clear-identity";
import { readHistoryClearBoundary } from "../preload/history-clear-boundary";
import type {
  HistoryClearBoundary,
  HostCursor,
  ZToolsDocumentDatabase,
} from "../preload/clipboard-store-types";
import { TemporaryLmdbHostDatabase } from "./clipboard-database-fixture";

const artifactRoot = path.resolve(
  fileURLToPath(new URL("../../../", import.meta.url)),
  "artifacts/pasteboardpro/clipboard-format-g0/v032-clear-boundary-tests",
);
const runtimeTag = process.versions.electron === undefined ? "node" : "electron";
const capacityResultPath = path.join(
  artifactRoot,
  `capacity-result-${runtimeTag}-${process.pid}-${randomUUID()}.json`,
);
const fixtures = new Set<TemporaryLmdbHostDatabase>();
const deviceId = "device-one";
const cursor = { id: "host-entry-17", timestamp: 1_790_000_017_000.25 };

function boundaryDocumentId(id: string): string {
  const hash = createHash("sha256").update(id, "utf8").digest("hex");
  return `pasteboard-pro:history-clear-boundary:${hash}`;
}

function makeBoundary(...cursors: HostCursor[]): HistoryClearBoundary {
  if (cursors.length === 0) throw new TypeError("Test boundary requires a cursor");
  const through = cursors.reduce((newest, candidate) =>
    compareCursor(candidate, newest) > 0 ? candidate : newest,
  );
  const clearedIdentities = [...new Set(cursors.map(historyClearIdentity))].sort();
  return {
    through: { id: through.id, timestamp: through.timestamp },
    clearedIdentities,
  };
}

function fullCapacityBoundary(through: HostCursor): HistoryClearBoundary {
  const throughIdentity = historyClearIdentity(through);
  const identities = [throughIdentity];
  for (let candidate = 0; identities.length < MAX_HISTORY_CLEAR_IDENTITIES; candidate += 1) {
    const identity = candidate.toString(16).padStart(64, "0");
    if (identity !== throughIdentity) identities.push(identity);
  }
  identities.sort();
  return {
    through: { id: through.id, timestamp: through.timestamp },
    clearedIdentities: identities,
  };
}

async function createStore(id = deviceId) {
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const fixture = await TemporaryLmdbHostDatabase.create(artifactRoot);
  fixtures.add(fixture);
  const database = createCheckedZToolsDocumentDatabase(fixture.raw);
  return {
    fixture,
    database,
    store: new ZToolsCanonicalClipboardStore(database, { deviceId: id }),
  };
}

describe("persistent per-device history clear boundary", () => {
  afterEach(async () => {
    for (const fixture of fixtures) {
      fixtures.delete(fixture);
      await fixture.closeAndRemove();
    }
  });

  it("persists one restricted document and reads it after reopening", async () => {
    const { fixture, store } = await createStore();
    const boundary = makeBoundary(cursor);
    await expect(store.getHistoryClearBoundary()).resolves.toBeUndefined();
    await store.advanceHistoryClearBoundary(boundary);
    await fixture.reopen();

    const reopened = new ZToolsCanonicalClipboardStore(
      createCheckedZToolsDocumentDatabase(fixture.raw),
      { deviceId },
    );
    await expect(reopened.getHistoryClearBoundary()).resolves.toEqual(boundary);
    const id = boundaryDocumentId(deviceId);
    const document = fixture.readDocument(id);
    expect(document).toEqual({
      _id: id,
      _rev: "host-1",
      type: "pasteboard-pro-history-clear-boundary",
      schemaVersion: 1,
      deviceIdHash: createHash("sha256").update(deviceId, "utf8").digest("hex"),
      through: boundary.through,
      clearedIdentities: boundary.clearedIdentities,
    });
    expect(fixture.committedPutIds).toEqual([id]);
    expect(JSON.stringify(document)).not.toMatch(/imagePath|content|appBundleId|sourceApp|exception|secret/u);
  });

  it("unions exact identities while keeping the maximum reference cursor", async () => {
    const { fixture, store } = await createStore();
    const newest = { id: "host-entry-31", timestamp: 1_790_000_031_000 };
    const older = { id: "host-entry-12", timestamp: 1_790_000_012_000 };
    const newestBoundary = makeBoundary(newest);
    const expected = makeBoundary(newest, older);
    await store.advanceHistoryClearBoundary(newestBoundary);
    await store.advanceHistoryClearBoundary(newestBoundary);
    await store.advanceHistoryClearBoundary(makeBoundary(older));

    await expect(store.getHistoryClearBoundary()).resolves.toEqual(expected);
    expect(fixture.committedPutIds).toEqual(Array(3).fill(boundaryDocumentId(deviceId)));
    expect(fixture.readDocument(boundaryDocumentId(deviceId))).toMatchObject(expected);
  });

  it("preserves both identity sets and the greater cursor after a 409 conflict", async () => {
    const { fixture, store } = await createStore();
    const id = boundaryDocumentId(deviceId);
    const concurrent = { id: "host-entry-44", timestamp: 1_790_000_044_000 };
    const candidate = { id: "host-entry-20", timestamp: 1_790_000_020_000 };
    const concurrentBoundary = makeBoundary(concurrent);
    const candidateBoundary = makeBoundary(candidate);
    const expected = makeBoundary(concurrent, candidate);
    fixture.queuePutResult(
      id,
      { id, error: true, name: "conflict", message: "synthetic private conflict" },
      {
        _id: id,
        type: "pasteboard-pro-history-clear-boundary",
        schemaVersion: 1,
        deviceIdHash: createHash("sha256").update(deviceId, "utf8").digest("hex"),
        through: concurrentBoundary.through,
        clearedIdentities: concurrentBoundary.clearedIdentities,
      },
    );

    await store.advanceHistoryClearBoundary(candidateBoundary);

    await expect(store.getHistoryClearBoundary()).resolves.toEqual(expected);
    expect(fixture.putCalls.map((call) => call.clearedIdentities)).toEqual([
      candidateBoundary.clearedIdentities,
      expected.clearedIdentities,
    ]);
    expect(fixture.readDocument(id)).toMatchObject(expected);
  });

  it("stops after the existing three-attempt conflict retry limit", async () => {
    const { fixture, store } = await createStore();
    const id = boundaryDocumentId(deviceId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      fixture.queuePutResult(id, {
        id,
        error: true,
        name: "conflict",
        message: "synthetic private conflict",
      });
    }

    await expect(store.advanceHistoryClearBoundary(makeBoundary(cursor))).rejects.toMatchObject({
      name: "ZToolsDatabaseError",
      message: "Database conflict",
    });
    expect(fixture.putCalls.filter((call) => call._id === id)).toHaveLength(3);
    expect(fixture.readDocument(id)).toBeUndefined();
  });

  it("keeps device boundaries isolated in distinct hashed documents", async () => {
    const { fixture, store } = await createStore("device-one");
    const second = new ZToolsCanonicalClipboardStore(
      createCheckedZToolsDocumentDatabase(fixture.raw),
      { deviceId: "device-two" },
    );
    const firstBoundary = makeBoundary(cursor);
    const secondCursor = { id: "other-entry", timestamp: 1_790_000_030_000 };
    const secondBoundary = makeBoundary(secondCursor);
    await store.advanceHistoryClearBoundary(firstBoundary);
    await expect(second.getHistoryClearBoundary()).resolves.toBeUndefined();
    await second.advanceHistoryClearBoundary(secondBoundary);

    expect(fixture.readDocument(boundaryDocumentId("device-one"))).toMatchObject(firstBoundary);
    expect(fixture.readDocument(boundaryDocumentId("device-two"))).toMatchObject(secondBoundary);
  });

  it("fails closed on corrupt schemas, malformed identities, and unavailable reads", async () => {
    const { fixture, database, store } = await createStore();
    const id = boundaryDocumentId(deviceId);
    const boundary = makeBoundary(cursor);
    const expectedHash = createHash("sha256").update(deviceId, "utf8").digest("hex");
    fixture.seedDocument({
      _id: id,
      type: "pasteboard-pro-history-clear-boundary",
      schemaVersion: 2,
      deviceIdHash: expectedHash,
      through: boundary.through,
      clearedIdentities: boundary.clearedIdentities,
    });
    await expect(store.getHistoryClearBoundary()).rejects.toThrow(
      "History clear boundary is invalid",
    );

    fixture.seedDocument({
      _id: id,
      type: "pasteboard-pro-history-clear-boundary",
      schemaVersion: 1,
      deviceIdHash: "0".repeat(64),
      through: boundary.through,
      clearedIdentities: boundary.clearedIdentities,
    });
    await expect(store.getHistoryClearBoundary()).rejects.toThrow(
      "History clear boundary is invalid",
    );
    await expect(store.advanceHistoryClearBoundary(boundary)).rejects.toThrow(
      "History clear boundary is invalid",
    );
    expect(fixture.putCalls).toHaveLength(0);

    const malformed = [
      { through: { id: "", timestamp: 1 }, clearedIdentities: boundary.clearedIdentities },
      { through: boundary.through, clearedIdentities: [] },
      { through: boundary.through, clearedIdentities: ["A".repeat(64)] },
      { through: boundary.through, clearedIdentities: [boundary.clearedIdentities[0], boundary.clearedIdentities[0]] },
      { through: boundary.through, clearedIdentities: [historyClearIdentity({ id: "other", timestamp: 1 })] },
      { ...boundary, unexpected: true },
    ];
    for (const candidate of malformed) {
      await expect(store.advanceHistoryClearBoundary(candidate as never)).rejects.toThrow(
        "History clear boundary is invalid",
      );
    }

    const unavailable: ZToolsDocumentDatabase = {
      ...database,
      async get() { throw { status: 500, message: "synthetic-private-storage-detail" }; },
    };
    const failingStore = new ZToolsCanonicalClipboardStore(unavailable, { deviceId });
    await expect(failingStore.getHistoryClearBoundary()).rejects.toMatchObject({
      name: "ZToolsDatabaseError",
      message: "Storage operation failed",
    });
  });

  it("copies the whole snapshot before the first asynchronous read", async () => {
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
    const initial = makeBoundary(cursor);
    const input = {
      through: { ...initial.through },
      clearedIdentities: [...initial.clearedIdentities],
    };
    const write = new ZToolsCanonicalClipboardStore(delayedRead, { deviceId })
      .advanceHistoryClearBoundary(input);
    await readStarted;
    input.through.id = "mutated-after-call";
    input.through.timestamp = 1;
    input.clearedIdentities[0] = "0".repeat(64);
    releaseRead();
    await write;

    expect(fixture.readDocument(boundaryDocumentId(deviceId))).toMatchObject(initial);
  });

  it("copies the whole snapshot before store readiness and rejects unconfirmed writes", async () => {
    const { fixture, database } = await createStore();
    let releaseReady!: () => void;
    const ready = new Promise<void>((resolve) => { releaseReady = resolve; });
    const store = new ZToolsCanonicalClipboardStore(database, { deviceId, ready });
    const initial = makeBoundary(cursor);
    const input = {
      through: { ...initial.through },
      clearedIdentities: [...initial.clearedIdentities],
    };
    const write = store.advanceHistoryClearBoundary(input);
    input.through.id = "mutated-before-ready";
    input.through.timestamp = 1;
    input.clearedIdentities.push("0".repeat(64));
    releaseReady();
    await write;
    expect(fixture.readDocument(boundaryDocumentId(deviceId))).toMatchObject(initial);

    const id = boundaryDocumentId(deviceId);
    for (const acknowledgement of [
      undefined,
      { ok: true, id: "another-document", rev: "host-1" },
      { ok: true, id, rev: "" },
    ]) {
      fixture.queuePutResult(id, acknowledgement);
      await expect(store.advanceHistoryClearBoundary(initial)).rejects.toMatchObject({
        name: "ZToolsDatabaseError",
        message: "Storage operation failed",
      });
      expect(fixture.readDocument(id)).toMatchObject(initial);
    }
  });

  it("persists and reopens the 100000-identity limit and fails closed on overflow", async () => {
    const { fixture, store } = await createStore();
    const through = { id: "capacity-entry", timestamp: 1_790_000_100_000 };
    const capacityBoundary = fullCapacityBoundary(through);
    const startedAt = performance.now();
    await store.advanceHistoryClearBoundary(capacityBoundary);
    await fixture.reopen();

    const reopened = new ZToolsCanonicalClipboardStore(
      createCheckedZToolsDocumentDatabase(fixture.raw),
      { deviceId },
    );
    await expect(reopened.getHistoryClearBoundary()).resolves.toEqual(capacityBoundary);
    const elapsedMs = Math.round((performance.now() - startedAt) * 100) / 100;
    await writeFile(capacityResultPath, `${JSON.stringify({
      schemaVersion: 1,
      fixture: "TemporaryLmdbHostDatabase",
      deviceHash: createHash("sha256").update(deviceId, "utf8").digest("hex"),
      identityCount: MAX_HISTORY_CLEAR_IDENTITIES,
      persistedAndReopened: true,
      elapsedMs,
      acceptance: "synthetic fixture timing only; not a host capacity or latency guarantee",
    }, null, 2)}\n`, { flag: "wx", mode: 0o600 });

    const overflowCursor = { id: "overflow-entry", timestamp: 1_790_000_090_000 };
    const overflowBoundary = makeBoundary(overflowCursor);
    expect(capacityBoundary.clearedIdentities).not.toContain(
      overflowBoundary.clearedIdentities[0],
    );
    await expect(store.advanceHistoryClearBoundary(overflowBoundary)).rejects.toThrow(
      "History clear boundary capacity exceeded",
    );
    expect(fixture.putCalls).toHaveLength(1);
    await expect(reopened.getHistoryClearBoundary()).resolves.toEqual(capacityBoundary);
  }, 30_000);
});

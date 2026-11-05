import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createCheckedZToolsDocumentDatabase } from "../preload/clipboard-document-database";
import { mirrorHostHistory } from "../preload/clipboard-history-mirror";
import { MirroredImagePersistenceError } from "../preload/mirrored-image";
import type { CanonicalClipboardRecord, HostClipboardApi, HostCursor } from "../preload/clipboard-store-types";
import { ZToolsCanonicalClipboardStore } from "../preload/clipboard-store";
import { TemporaryLmdbHostDatabase } from "./clipboard-database-fixture";

const deviceId = "mirror-image-retry-rotation-test";
const initialCursor = { id: "initial", timestamp: 1 };
const artifactRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)),
  "artifacts/pasteboardpro/clipboard-format-g0/v030-retry-rotation-tests");
const fixtures = new Set<TemporaryLmdbHostDatabase>();
type PrepareRecord = NonNullable<Parameters<typeof mirrorHostHistory>[2]["prepareRecord"]>;

function image(id: string, timestamp: number) {
  return { id, type: "image", timestamp, imagePath: `/host/${id}.png` };
}

function text(id: string, timestamp: number) {
  return { id, type: "text", timestamp, content: `safe:${id}` };
}

function hostFor(items: readonly unknown[], options: { pageSize?: number; failPage?: number } = {}) {
  const calls: number[] = [];
  const host: HostClipboardApi & { calls: number[] } = {
    calls,
    async getHistory(page, pageSize) {
      calls.push(page);
      if (page === options.failPage) throw new Error("synthetic page unavailable");
      const size = options.pageSize ?? pageSize;
      return { items: items.slice((page - 1) * size, page * size), total: items.length };
    },
  };
  return host;
}

async function createStore() {
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const fixture = await TemporaryLmdbHostDatabase.create(artifactRoot);
  fixtures.add(fixture);
  const database = createCheckedZToolsDocumentDatabase(fixture.raw);
  const store = new ZToolsCanonicalClipboardStore(database, { deviceId });
  await store.setCursor(initialCursor);
  return { fixture, database, store };
}

function failingPrepare(fail: () => boolean, ids: string[]) {
  return vi.fn(async (raw: unknown, record: CanonicalClipboardRecord) => {
    const id = (raw as { id: string }).id;
    if (record.item.kind === "image") {
      ids.push(id);
      if (fail()) throw new MirroredImagePersistenceError("image-storage-failed");
    }
    return record;
  });
}

async function expectPending(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({
    name: "MirrorImageRetryPendingError",
    code: "image-retry-pending",
    message: "Clipboard image retry is pending",
  });
}

async function expectImageFailure(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({
    name: "MirroredImagePersistenceError",
    message: "Clipboard image persistence failed",
  });
}

describe("persistent history-image retry rotation", () => {
  afterEach(async () => {
    for (const fixture of fixtures) {
      fixtures.delete(fixture);
      await fixture.closeAndRemove();
    }
  });

  it("rotates after sixteen failures across a database reopen and keeps text progress", async () => {
    const { fixture, store } = await createStore();
    const images = Array.from({ length: 17 }, (_, index) => image(`image-${index}`, 1_000 - index));
    const healthy = text("healthy", 2_000);
    const items = [...images, healthy];
    const host = hostFor(items);
    const prepared: string[] = [];
    const prepare = failingPrepare(() => true, prepared);

    await expectImageFailure(mirrorHostHistory(host, store, {
      deviceId, prepareRecord: prepare,
    }));
    expect(prepared).toHaveLength(16);
    expect(prepared).toEqual(images.slice(0, 16).map(({ id }) => id));
    expect(await store.findRecordByItemId("ztools:healthy")).toBeDefined();
    expect(await store.getCursor()).toEqual(initialCursor);
    expect(await store.getImageRetryBoundary()).toEqual({ id: "image-15", timestamp: 985 });

    await fixture.reopen();
    const reopenedStore = new ZToolsCanonicalClipboardStore(
      createCheckedZToolsDocumentDatabase(fixture.raw), { deviceId },
    );
    const recovered = vi.fn(async (_raw: unknown, record: CanonicalClipboardRecord) => record);
    await expectPending(mirrorHostHistory(hostFor(items), reopenedStore, {
      deviceId, prepareRecord: recovered,
    }));
    expect(recovered.mock.calls.map(([raw]) => (raw as { id: string }).id)).toEqual(["image-16"]);
    expect(await reopenedStore.findRecordByItemId("ztools:image-16")).toBeDefined();
    expect(await reopenedStore.getCursor()).toEqual(initialCursor);
  });

  it("covers forty permanently failing images in three bounded rounds, then recovers and advances", async () => {
    const { store } = await createStore();
    const images = Array.from({ length: 40 }, (_, index) => image(`many-${index}`, 1_000 - index));
    const items = [...images, text("between-retries", 2_000)];
    const failingIds = new Set<string>();
    const attemptedIds: string[] = [];
    const prepare = vi.fn(async (raw: unknown, record: CanonicalClipboardRecord) => {
      const id = (raw as { id: string }).id;
      if (record.item.kind === "image") {
        failingIds.add(id);
        attemptedIds.push(id);
        throw new MirroredImagePersistenceError("image-read-failed");
      }
      return record;
    });

    for (let round = 0; round < 3; round += 1) {
      const before = attemptedIds.length;
      await expectImageFailure(mirrorHostHistory(hostFor(items), store, { deviceId, prepareRecord: prepare }));
      const attempted = attemptedIds.length - before;
      expect(attempted).toBeGreaterThan(0);
      expect(attempted).toBeLessThanOrEqual(16);
      expect(await store.getCursor()).toEqual(initialCursor);
      expect(await store.findRecordByItemId("ztools:between-retries")).toBeDefined();
    }
    expect(failingIds).toEqual(new Set(images.map(({ id }) => id)));

    const recovered = vi.fn(async (_raw: unknown, record: CanonicalClipboardRecord) => record);
    await expect(mirrorHostHistory(hostFor(items), store, { deviceId, prepareRecord: recovered }))
      .resolves.toMatchObject({ imported: 40 });
    expect(await store.getImageRetryBoundary()).toBeUndefined();
    expect(await store.getCursor()).toEqual({ id: "between-retries", timestamp: 2_000 });
  });

  it("uses HostCursor ordering for equal timestamps", async () => {
    const { store } = await createStore();
    const images = Array.from({ length: 20 }, (_, index) => image(`tie-${String(19 - index).padStart(2, "0")}`, 500));
    const failed: string[] = [];
    await expectImageFailure(mirrorHostHistory(hostFor(images), store, {
      deviceId,
      prepareRecord: failingPrepare(() => true, failed),
    }));
    expect(await store.getImageRetryBoundary()).toEqual({ id: "tie-04", timestamp: 500 });

    const second: string[] = [];
    await expectPending(mirrorHostHistory(hostFor(images), store, {
      deviceId,
      prepareRecord: failingPrepare(() => false, second),
    }));
    expect(second).toEqual(["tie-03", "tie-02", "tie-01", "tie-00"]);
    expect(await store.getImageRetryBoundary()).toBeUndefined();
  });

  it("continues past a removed boundary item and wraps when no older item remains", async () => {
    const { store } = await createStore();
    const images = Array.from({ length: 17 }, (_, index) => image(`gone-${index}`, 1_000 - index));
    const first = failingPrepare(() => true, []);
    await expectImageFailure(mirrorHostHistory(hostFor(images), store, { deviceId, prepareRecord: first }));
    expect(await store.getImageRetryBoundary()).toEqual({ id: "gone-15", timestamp: 985 });

    const withoutBoundary = [...images.slice(0, 15), images[16]!];
    const older: string[] = [];
    await expectPending(mirrorHostHistory(hostFor(withoutBoundary), store, {
      deviceId,
      prepareRecord: failingPrepare(() => false, older),
    }));
    expect(older).toEqual(["gone-16"]);
    expect(await store.getImageRetryBoundary()).toBeUndefined();

    const { store: noOlderStore } = await createStore();
    await expectImageFailure(mirrorHostHistory(hostFor(images), noOlderStore, {
      deviceId, prepareRecord: failingPrepare(() => true, []),
    }));
    const noOlderItems = images.slice(0, 15);
    const wrapped = vi.fn(async (_raw: unknown, record: CanonicalClipboardRecord) => record);
    await expectPending(mirrorHostHistory(hostFor(noOlderItems), noOlderStore, {
      deviceId, prepareRecord: wrapped,
    }));
    expect(wrapped).not.toHaveBeenCalled();
    expect(await noOlderStore.getImageRetryBoundary()).toBeUndefined();
    await expect(mirrorHostHistory(hostFor(noOlderItems), noOlderStore, {
      deviceId, prepareRecord: wrapped,
    })).resolves.toMatchObject({ imported: 15 });
  });

  it("rechecks current privacy before retry work and does not charge denied images", async () => {
    const { store } = await createStore();
    const images = Array.from({ length: 17 }, (_, index) => image(`private-now-${index}`, 1_000 - index));
    await expectImageFailure(mirrorHostHistory(hostFor(images), store, {
      deviceId,
      prepareRecord: failingPrepare(() => true, []),
    }));

    const checked: string[] = [];
    const prepared: string[] = [];
    const result = mirrorHostHistory(hostFor(images), store, {
      deviceId,
      shouldPersist: (raw) => {
        const id = (raw as { id: string }).id;
        checked.push(id);
        return id !== "private-now-15";
      },
      prepareRecord: failingPrepare(() => false, prepared),
    });
    await expectPending(result);
    expect(checked).toHaveLength(17);
    expect(prepared).toEqual(["private-now-16"]);
    expect(await store.getImageRetryBoundary()).toBeUndefined();
    expect(await store.getCursor()).toEqual(initialCursor);
  });

  it("does not advance the main cursor when persisting the boundary is unconfirmed", async () => {
    const { fixture, store } = await createStore();
    fixture.queuePutResult("pasteboard-pro:mirror-image-retry", { ok: false, id: "pasteboard-pro:mirror-image-retry" });
    fixture.queuePutResult("pasteboard-pro:mirror-image-retry", { ok: false, id: "pasteboard-pro:mirror-image-retry" });
    fixture.queuePutResult("pasteboard-pro:mirror-image-retry", { ok: false, id: "pasteboard-pro:mirror-image-retry" });
    const images = Array.from({ length: 17 }, (_, index) => image(`dbfail-${index}`, 1_000 - index));
    const pending = mirrorHostHistory(hostFor([...images, text("healthy-db-fail", 2_000)]), store, {
      deviceId, prepareRecord: failingPrepare(() => true, []),
    });
    await expect(pending).rejects.toMatchObject({ name: "ZToolsDatabaseError" });
    expect(fixture.putCalls.filter(({ _id }) => _id === "pasteboard-pro:mirror-image-retry")).toHaveLength(1);
    expect(await store.getCursor()).toEqual(initialCursor);
    expect(await store.findRecordByItemId("ztools:healthy-db-fail")).toBeDefined();
  });

  it("preserves unknown preparation, host-page, and privacy errors instead of reporting pending", async () => {
    const { store } = await createStore();
    const items = [
      ...Array.from({ length: 16 }, (_, index) => image(`unknown-${index}`, 1_000 - index)),
      text("unknown-trigger", 900),
      text("second-page", 800),
    ];
    const preparationError = new Error("unknown preparation error");
    const prepare = vi.fn(async (raw: unknown, record: CanonicalClipboardRecord) => {
      if ((raw as { id: string }).id === "unknown-trigger") throw preparationError;
      throw new MirroredImagePersistenceError("image-storage-failed");
    });
    await expect(mirrorHostHistory(hostFor(items), store, { deviceId, prepareRecord: prepare }))
      .rejects.toBe(preparationError);
    expect(await store.getCursor()).toEqual(initialCursor);
    expect(await store.getImageRetryBoundary()).toBeUndefined();

    const hostError = new Error("host page failed");
    const host = hostFor(items, { pageSize: 16, failPage: 2 });
    const failing = vi.spyOn(host, "getHistory").mockImplementation(async (page, pageSize) => {
      if (page === 2) throw hostError;
      return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length };
    });
    await expect(mirrorHostHistory(host, store, {
      deviceId, prepareRecord: failingPrepare(() => true, []), pageSize: 16,
    })).rejects.toBe(hostError);
    expect(await store.getCursor()).toEqual(initialCursor);
    expect(await store.getImageRetryBoundary()).toBeUndefined();

    const privacyError = new Error("privacy lookup failed");
    await expect(mirrorHostHistory(hostFor(items), store, {
      deviceId,
      shouldPersist: (raw) => {
        if ((raw as { id: string }).id === "unknown-trigger") throw privacyError;
        return true;
      },
      prepareRecord: failingPrepare(() => true, []),
    })).rejects.toBe(privacyError);
    expect(await store.getCursor()).toEqual(initialCursor);
  });
});

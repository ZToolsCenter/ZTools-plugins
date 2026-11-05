import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  mirrorHostHistory,
  ZToolsCanonicalClipboardStore,
  type HostClipboardApi,
} from "../preload/clipboard-store";
import { createCheckedZToolsDocumentDatabase } from "../preload/clipboard-document-database";
import {
  localizeMirroredImage,
  MirroredImagePersistenceError,
} from "../preload/mirrored-image";
import { MAX_SYNC_BLOB_BYTES } from "../preload/sync-blob-files";
import { TemporaryLmdbHostDatabase } from "./clipboard-database-fixture";

const fixedErrorMessage = "Clipboard image persistence failed";
const artifactRoot = resolve(
  fileURLToPath(new URL("../../../", import.meta.url)),
  "artifacts/pasteboardpro/clipboard-format-g0/v028-image-admission-tests",
);
const fixtures = new Set<TemporaryLmdbHostDatabase>();

async function makeStore() {
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const fixture = await TemporaryLmdbHostDatabase.create(artifactRoot);
  fixtures.add(fixture);
  const database = createCheckedZToolsDocumentDatabase(fixture.raw);
  const store = new ZToolsCanonicalClipboardStore(database, {
    deviceId: "image-admission-test-device",
  });
  return { fixture, store };
}

function makeHost(items: readonly unknown[]): HostClipboardApi {
  return {
    async getHistory(page) {
      return { items: page === 1 ? items : [], total: items.length };
    },
  };
}

async function expectImageError(
  promise: Promise<unknown>,
  code: string,
): Promise<MirroredImagePersistenceError> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(MirroredImagePersistenceError);
  expect(caught).toMatchObject({ code, message: fixedErrorMessage });
  expect((caught as Error & { cause?: unknown }).cause).toBeUndefined();
  expect((caught as Error).message).not.toContain("/host/");
  return caught as MirroredImagePersistenceError;
}

describe("history image admission", () => {
  afterEach(async () => {
    for (const fixture of fixtures) {
      fixtures.delete(fixture);
      await fixture.closeAndRemove();
    }
  });

  it("lets an active privacy decision skip an image whose source path is missing", async () => {
    const { store } = await makeStore();
    const privateImage = {
      id: "private-image",
      type: "image",
      timestamp: 1_790_000_100_000,
      confidential: true,
    };
    const shouldPersist = vi.fn((rawItem: unknown, record: unknown) => {
      expect(rawItem).toBe(privateImage);
      expect(record).toBeNull();
      return false;
    });

    await expect(
      mirrorHostHistory(makeHost([privateImage]), store, {
        deviceId: "image-admission-test-device",
        shouldPersist,
      }),
    ).resolves.toEqual({ imported: 0, skipped: 1, pages: 1 });

    expect(shouldPersist).toHaveBeenCalledTimes(1);
    await expect(store.findRecordByItemId("ztools:private-image")).resolves.toBeUndefined();
    await expect(store.getCursor()).resolves.toEqual({
      id: "private-image",
      timestamp: 1_790_000_100_000,
    });
  });

  it("fails an allowed image with no path without storing it or advancing the cursor", async () => {
    const { store } = await makeStore();
    const pathlessImage = {
      id: "pathless-image",
      type: "image",
      timestamp: 1_790_000_200_000,
    };
    const shouldPersist = vi.fn((_rawItem: unknown, record: unknown) => {
      expect(record).toBeNull();
      return true;
    });

    const error = await expectImageError(
      mirrorHostHistory(makeHost([pathlessImage]), store, {
        deviceId: "image-admission-test-device",
        shouldPersist,
      }),
      "image-path-unavailable",
    );

    expect(error.message).toBe(fixedErrorMessage);
    expect(shouldPersist).toHaveBeenCalledTimes(1);
    await expect(store.findRecordByItemId("ztools:pathless-image")).resolves.toBeUndefined();
    await expect(store.getCursor()).resolves.toBeUndefined();
  });

  it("keeps the old cursor after a mixed batch fails, then retries one record per item", async () => {
    const { fixture, store } = await makeStore();
    const sourcePath = "/host/capture.png";
    const outputPath = "/plugin/blobs/capture.png";
    const sourceBytes = new Uint8Array([1, 2, 3, 4]);
    const sourceSha = createHash("sha256").update(sourceBytes).digest("hex");
    const writtenBlobs = new Map<string, Uint8Array>();
    let failStorage = true;
    const readFile = vi.fn(async (filePath: string) => {
      if (filePath === sourcePath) return sourceBytes;
      const output = writtenBlobs.get(filePath);
      if (output === undefined) throw new Error("fixture output missing");
      return output;
    });
    const storeLocalBlob = vi.fn(async (bytes: Uint8Array) => {
      if (failStorage) throw new Error("private host storage detail");
      writtenBlobs.set(outputPath, new Uint8Array(bytes));
      return {
        id: `blob-${sourceSha}`,
        imagePath: outputPath,
        blobBytes: bytes.byteLength,
      };
    });
    const host = makeHost([
      {
        id: "newer-text",
        type: "text",
        timestamp: 1_790_000_300_000,
        content: "The accepted text survives the failed image batch",
      },
      {
        id: "older-image",
        type: "image",
        timestamp: 1_790_000_200_000,
        imagePath: sourcePath,
      },
    ]);
    const options = {
      deviceId: "image-admission-test-device",
      shouldPersist: () => true,
      prepareRecord: (_rawItem: unknown, record: Parameters<typeof localizeMirroredImage>[0]) =>
        localizeMirroredImage(record, { readFile, storeLocalBlob }),
    };

    await expectImageError(
      mirrorHostHistory(host, store, options),
      "image-storage-failed",
    );
    await expect(store.findRecordByItemId("ztools:newer-text")).resolves.toBeDefined();
    await expect(store.findRecordByItemId("ztools:older-image")).resolves.toBeUndefined();
    await expect(store.getCursor()).resolves.toBeUndefined();
    expect(fixture.readDocument("pasteboard-pro:cursor:ztools-history")).toBeUndefined();

    failStorage = false;
    await expect(mirrorHostHistory(host, store, options)).resolves.toEqual({
      imported: 1,
      skipped: 1,
      pages: 1,
    });
    await expect(store.findRecordByItemId("ztools:newer-text")).resolves.toBeDefined();
    await expect(store.findRecordByItemId("ztools:older-image")).resolves.toMatchObject({
      origin: {
        imagePath: outputPath,
        pluginBlobId: `blob-${sourceSha}`,
        blobBytes: sourceBytes.byteLength,
      },
    });
    await expect(store.getCursor()).resolves.toEqual({
      id: "newer-text",
      timestamp: 1_790_000_300_000,
    });
    await expect(store.search("", 10)).resolves.toMatchObject({ total: 2 });

    await expect(mirrorHostHistory(host, store, options)).resolves.toMatchObject({
      imported: 0,
      skipped: 2,
    });
    await expect(store.search("", 10)).resolves.toMatchObject({ total: 2 });
    expect(storeLocalBlob).toHaveBeenCalledTimes(2);
    expect(readFile).toHaveBeenCalledWith(sourcePath);
  });

  it("blocks an oversized source without storing an image or advancing the cursor", async () => {
    const { store } = await makeStore();
    const oversizedView = new Uint8Array(0);
    Object.defineProperty(oversizedView, "byteLength", {
      value: MAX_SYNC_BLOB_BYTES + 1,
    });
    expect(ArrayBuffer.isView(oversizedView)).toBe(true);

    const readFile = vi.fn(async () => oversizedView);
    const storeLocalBlob = vi.fn();
    const image = {
      id: "oversized-image",
      type: "image",
      timestamp: 1_790_000_400_000,
      imagePath: "/host/oversized.png",
    };
    await expectImageError(
      mirrorHostHistory(makeHost([image]), store, {
        deviceId: "image-admission-test-device",
        prepareRecord: (_rawItem, acceptedRecord) =>
          localizeMirroredImage(acceptedRecord, { readFile, storeLocalBlob }),
      }),
      "image-storage-failed",
    );

    await expect(store.search("", 10)).resolves.toMatchObject({ total: 0 });
    await expect(store.getCursor()).resolves.toBeUndefined();
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(storeLocalBlob).not.toHaveBeenCalled();
  });
});

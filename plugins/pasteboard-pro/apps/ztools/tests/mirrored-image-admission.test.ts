import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  normalizeHostClipboardItem,
  type CanonicalClipboardRecord,
} from "../preload/clipboard-store";
import {
  localizeMirroredImage,
  MirroredImagePersistenceError,
} from "../preload/mirrored-image";

const fixedErrorMessage = "Clipboard image persistence failed";
const sourcePath = "/host/capture.png";
const sourceBytes = new Uint8Array([10, 20, 30, 40]);
const sourceSha = createHash("sha256").update(sourceBytes).digest("hex");
const outputPath = "/plugin/blobs/capture.png";

function imageRecord(): CanonicalClipboardRecord {
  const record = normalizeHostClipboardItem({
    id: "image-admission-unit",
    type: "image",
    timestamp: 1_790_000_100_000,
    imagePath: sourcePath,
  }, "image-admission-test-device");
  if (record === null) throw new TypeError("Image fixture did not normalize");
  return record;
}

function imageRecordWithoutPath(record: CanonicalClipboardRecord): CanonicalClipboardRecord {
  if (record.origin.host !== "ztools") throw new TypeError("Expected a host image record");
  const { imagePath: _imagePath, ...origin } = record.origin;
  return { ...record, origin };
}

function imageRecordWithSourcePath(
  record: CanonicalClipboardRecord,
  imagePath: string,
): CanonicalClipboardRecord {
  if (record.origin.host !== "ztools") throw new TypeError("Expected a host image record");
  return { ...record, origin: { ...record.origin, imagePath } };
}

function imageRecordWithoutMediaType(record: CanonicalClipboardRecord): CanonicalClipboardRecord {
  const { mediaType: _mediaType, ...payload } = record.item.payload;
  return { ...record, item: { ...record.item, payload } };
}

async function expectImageError(
  action: Promise<unknown>,
  code: string,
): Promise<MirroredImagePersistenceError> {
  let caught: unknown;
  try {
    await action;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(MirroredImagePersistenceError);
  expect(caught).toMatchObject({ code, message: fixedErrorMessage });
  expect((caught as Error & { cause?: unknown }).cause).toBeUndefined();
  return caught as MirroredImagePersistenceError;
}

function validDependencies() {
  const written = new Map<string, Uint8Array>();
  const readFile = vi.fn(async (filePath: string) => {
    if (filePath === sourcePath) return new Uint8Array(sourceBytes);
    const output = written.get(filePath);
    if (output === undefined) throw new Error("synthetic missing output file");
    return new Uint8Array(output);
  });
  const storeLocalBlob = vi.fn(async (bytes: Uint8Array) => {
    written.set(outputPath, new Uint8Array(bytes));
    return {
      id: `blob-${sourceSha}`,
      imagePath: outputPath,
      blobBytes: bytes.byteLength,
    };
  });
  return { readFile, storeLocalBlob, written };
}

function expectSafeFailure(error: MirroredImagePersistenceError, privateText: string): void {
  expect(error.message).toBe(fixedErrorMessage);
  expect(error.message).not.toContain(privateText);
  expect(error.message).not.toContain(sourcePath);
}

describe("mirrored image admission", () => {
  it("stores by source digest, verifies the stored bytes, and leaves the record immutable", async () => {
    const record = imageRecord();
    const original = structuredClone(record);
    const dependencies = validDependencies();

    const localized = await localizeMirroredImage(record, dependencies);

    expect(dependencies.readFile.mock.calls.map(([path]) => path)).toEqual([
      sourcePath,
      outputPath,
    ]);
    expect(dependencies.storeLocalBlob).toHaveBeenCalledWith(sourceBytes, "image/png");
    expect(localized.item).toBe(record.item);
    expect(localized.origin).toMatchObject({
      imagePath: outputPath,
      blobBytes: sourceBytes.byteLength,
      pluginBlobId: `blob-${sourceSha}`,
    });
    expect(record).toEqual(original);
  });

  it.each([
    ["image source path is missing", "image-path-unavailable", (record: CanonicalClipboardRecord) => imageRecordWithoutPath(record)],
    ["image source path is relative", "image-path-unavailable", (record: CanonicalClipboardRecord) => imageRecordWithSourcePath(record, "relative/capture.png")],
    ["image media type is missing", "image-metadata-invalid", (record: CanonicalClipboardRecord) => imageRecordWithoutMediaType(record)],
  ])("rejects when %s before any file or blob I/O", async (_label, code, transform) => {
    const dependencies = validDependencies();

    await expectImageError(
      localizeMirroredImage(transform(imageRecord()), dependencies),
      code,
    );

    expect(dependencies.readFile).not.toHaveBeenCalled();
    expect(dependencies.storeLocalBlob).not.toHaveBeenCalled();
  });

  it("reports a source read error with a fixed safe error", async () => {
    const readFile = vi.fn(async () => {
      throw new Error("secret host path and read failure");
    });
    const storeLocalBlob = vi.fn();

    const error = await expectImageError(
      localizeMirroredImage(imageRecord(), { readFile, storeLocalBlob }),
      "image-read-failed",
    );

    expectSafeFailure(error, "secret host path and read failure");
    expect(storeLocalBlob).not.toHaveBeenCalled();
  });

  it("rejects zero-byte sources before asking storage to persist them", async () => {
    const readFile = vi.fn(async () => new Uint8Array());
    const storeLocalBlob = vi.fn();

    await expectImageError(
      localizeMirroredImage(imageRecord(), { readFile, storeLocalBlob }),
      "image-metadata-invalid",
    );

    expect(storeLocalBlob).not.toHaveBeenCalled();
  });

  it("reports storage failures without exposing the storage error", async () => {
    const readFile = vi.fn(async () => new Uint8Array(sourceBytes));
    const storeLocalBlob = vi.fn(async () => {
      throw new Error("private blob-store location and failure");
    });

    const error = await expectImageError(
      localizeMirroredImage(imageRecord(), { readFile, storeLocalBlob }),
      "image-storage-failed",
    );

    expectSafeFailure(error, "private blob-store location and failure");
  });

  it.each([
    ["wrong blob id", (bytes: Uint8Array) => ({ id: "blob-wrong", imagePath: outputPath, blobBytes: bytes.byteLength })],
    ["wrong byte length", (bytes: Uint8Array) => ({ id: `blob-${sourceSha}`, imagePath: outputPath, blobBytes: bytes.byteLength + 1 })],
    ["relative output path", (bytes: Uint8Array) => ({ id: `blob-${sourceSha}`, imagePath: "blobs/capture.png", blobBytes: bytes.byteLength })],
  ])("rejects storage acknowledgement with %s", async (_label, acknowledgement) => {
    const readFile = vi.fn(async () => new Uint8Array(sourceBytes));
    const storeLocalBlob = vi.fn(async (bytes: Uint8Array) => acknowledgement(bytes));

    await expectImageError(
      localizeMirroredImage(imageRecord(), { readFile, storeLocalBlob }),
      "image-verification-failed",
    );

    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing output", undefined],
    ["output digest mismatch", new Uint8Array([10, 20, 30, 41])],
    ["output length mismatch", new Uint8Array([10, 20, 30])],
  ])("rejects a %s after storage acknowledges the blob", async (_label, output) => {
    const readFile = vi.fn(async (filePath: string) => {
      if (filePath === sourcePath) return new Uint8Array(sourceBytes);
      if (output === undefined) throw new Error("private output path unavailable");
      return new Uint8Array(output);
    });
    const storeLocalBlob = vi.fn(async (bytes: Uint8Array) => ({
      id: `blob-${sourceSha}`,
      imagePath: outputPath,
      blobBytes: bytes.byteLength,
    }));

    const error = await expectImageError(
      localizeMirroredImage(imageRecord(), { readFile, storeLocalBlob }),
      "image-verification-failed",
    );

    expectSafeFailure(error, "private output path unavailable");
    expect(readFile).toHaveBeenCalledTimes(2);
  });

  it("performs no I/O for non-image records", async () => {
    const record = normalizeHostClipboardItem({
      id: "text-admission-unit",
      type: "text",
      timestamp: 1_790_000_100_000,
      content: "plain text",
    }, "image-admission-test-device");
    if (record === null) throw new TypeError("Text fixture did not normalize");
    const dependencies = validDependencies();

    await expect(localizeMirroredImage(record, dependencies)).resolves.toBe(record);

    expect(dependencies.readFile).not.toHaveBeenCalled();
    expect(dependencies.storeLocalBlob).not.toHaveBeenCalled();
  });
});

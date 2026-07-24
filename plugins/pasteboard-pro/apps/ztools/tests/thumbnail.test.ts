import { describe, expect, it } from "vitest";

import {
  normalizeHostClipboardItem,
  type CanonicalClipboardRecord,
} from "../preload/clipboard-store";
import {
  ThumbnailService,
  type NativeImageApi,
  type NativeImageLike,
} from "../preload/thumbnail";

function imageRecord(id: string, timestamp: number): CanonicalClipboardRecord {
  const record = normalizeHostClipboardItem(
    {
      id,
      type: "image",
      timestamp,
      imagePath: `/tmp/${id}.png`,
      appName: "Preview",
    },
    "thumbnail-test",
  );
  if (record === null) throw new Error("Expected an image record");
  return record;
}

function fakeImage(bytes = new Uint8Array([1, 2, 3])): NativeImageLike {
  return {
    isEmpty: () => false,
    resize: () => fakeImage(bytes),
    toJPEG: () => bytes,
  };
}

describe("ZTools thumbnail service", () => {
  it("batches one record scan, skips non-images, and reuses generated thumbnails", async () => {
    const image = imageRecord("image-1", 200);
    const text = normalizeHostClipboardItem(
      { id: "text-1", type: "text", timestamp: 100, content: "hello" },
      "thumbnail-test",
    )!;
    let scans = 0;
    let generations = 0;
    let resizes = 0;
    const nativeImage: NativeImageApi = {
      async createThumbnailFromPath() {
        generations += 1;
        return {
          ...fakeImage(),
          resize() {
            resizes += 1;
            return fakeImage();
          },
        };
      },
      createFromPath: () => fakeImage(),
    };
    const service = new ThumbnailService(
      {
        async listRecords() {
          scans += 1;
          return [image, text];
        },
      },
      nativeImage,
    );

    await expect(
      service.get([image.item.id, text.item.id, image.item.id]),
    ).resolves.toEqual([
      {
        itemId: image.item.id,
        mediaType: "image/jpeg",
        dataBase64: "AQID",
      },
    ]);
    await expect(service.get([image.item.id])).resolves.toHaveLength(1);
    expect(scans).toBe(1);
    expect(generations).toBe(1);
    expect(resizes).toBe(1);
  });

  it("invalidates the shared record index when history changes", async () => {
    const first = imageRecord("image-1", 200);
    const second = imageRecord("image-2", 300);
    let records = [first];
    let scans = 0;
    const service = new ThumbnailService(
      {
        async listRecords() {
          scans += 1;
          return records;
        },
      },
      {
        createThumbnailFromPath: async () => fakeImage(),
        createFromPath: () => fakeImage(),
      },
    );

    await expect(service.get([first.item.id])).resolves.toHaveLength(1);
    records = [second, first];
    await expect(service.get([second.item.id])).resolves.toEqual([]);
    service.invalidateRecordIndex();
    await expect(service.get([second.item.id])).resolves.toHaveLength(1);
    expect(scans).toBe(2);
  });

  it("limits native image decoding to two concurrent thumbnails", async () => {
    const records = Array.from({ length: 6 }, (_, index) =>
      imageRecord(`image-${index}`, 1_000 - index),
    );
    let active = 0;
    let maximumActive = 0;
    const nativeImage: NativeImageApi = {
      async createThumbnailFromPath() {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return fakeImage();
      },
      createFromPath: () => fakeImage(),
    };
    const service = new ThumbnailService(
      { async listRecords() { return records; } },
      nativeImage,
    );

    await expect(service.get(records.map((record) => record.item.id))).resolves.toHaveLength(6);
    expect(maximumActive).toBe(2);
  });

  it("rejects oversized batches before scanning history", async () => {
    let scans = 0;
    const service = new ThumbnailService(
      {
        async listRecords() {
          scans += 1;
          return [];
        },
      },
      {
        createFromPath: () => fakeImage(),
      },
    );

    await expect(
      service.get(Array.from({ length: 25 }, (_, index) => `image-${index}`)),
    ).rejects.toThrow("limited to 24 items");
    expect(scans).toBe(0);
  });
});

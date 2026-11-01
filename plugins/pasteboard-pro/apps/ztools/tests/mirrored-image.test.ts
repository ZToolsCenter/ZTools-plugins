import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

import { normalizeHostClipboardItem } from "../preload/clipboard-store";
import { localizeMirroredImage } from "../preload/mirrored-image";

describe("mirrored image persistence", () => {
  it("moves a captured image onto plugin-owned storage", async () => {
    const record = normalizeHostClipboardItem({
      id: "image-1",
      type: "image",
      timestamp: 100,
      imagePath: "/host/temporary.png",
    }, "device-1");
    expect(record).not.toBeNull();
    const sourceBytes = new Uint8Array([1, 2, 3]);
    const blobId = `blob-${createHash("sha256").update(sourceBytes).digest("hex")}`;
    const readFile = vi.fn(async (filePath: string) => {
      expect(["/host/temporary.png", "/plugin/blobs/hash.png"]).toContain(filePath);
      return sourceBytes;
    });
    const storeLocalBlob = vi.fn().mockResolvedValue({
      id: blobId,
      imagePath: "/plugin/blobs/hash.png",
      blobBytes: 3,
    });

    const localized = await localizeMirroredImage(record!, { readFile, storeLocalBlob });

    expect(readFile).toHaveBeenCalledWith("/host/temporary.png");
    expect(readFile).toHaveBeenCalledWith("/plugin/blobs/hash.png");
    expect(storeLocalBlob).toHaveBeenCalledWith(sourceBytes, "image/png");
    expect(localized.origin).toMatchObject({
      host: "ztools",
      hostItemId: "image-1",
      imagePath: "/plugin/blobs/hash.png",
      pluginBlobId: blobId,
      blobBytes: 3,
    });
  });
});

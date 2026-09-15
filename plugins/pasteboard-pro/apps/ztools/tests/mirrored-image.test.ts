import { describe, expect, it, vi } from "vitest";

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
    const readFile = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    const storeLocalBlob = vi.fn().mockResolvedValue({
      id: "blob-hash",
      imagePath: "/plugin/blobs/hash.png",
      blobBytes: 3,
    });

    const localized = await localizeMirroredImage(record!, { readFile, storeLocalBlob });

    expect(readFile).toHaveBeenCalledWith("/host/temporary.png");
    expect(storeLocalBlob).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), "image/png");
    expect(localized.origin).toMatchObject({
      host: "ztools",
      hostItemId: "image-1",
      imagePath: "/plugin/blobs/hash.png",
      pluginBlobId: "blob-hash",
      blobBytes: 3,
    });
  });
});

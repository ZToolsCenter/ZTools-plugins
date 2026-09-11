import { describe, expect, it, vi } from "vitest";

import { loadItemPreview, previewDataUrl } from "../src/preview-loader";

describe("image preview loading", () => {
  it("uses the full source preview when it is available", async () => {
    const bridge = {
      getItemPreview: vi.fn().mockResolvedValue({ mediaType: "image/png", dataBase64: "full" }),
      getItemThumbnails: vi.fn().mockResolvedValue([]),
    };

    await expect(loadItemPreview(bridge, "image-1")).resolves.toEqual({
      mediaType: "image/png",
      dataBase64: "full",
    });
    expect(bridge.getItemThumbnails).not.toHaveBeenCalled();
  });

  it("falls back to the thumbnail when the source file is unavailable", async () => {
    const bridge = {
      getItemPreview: vi.fn().mockRejectedValue(new Error("missing source")),
      getItemThumbnails: vi.fn().mockResolvedValue([
        { itemId: "image-1", mediaType: "image/jpeg", dataBase64: "thumb" },
      ]),
    };

    await expect(loadItemPreview(bridge, "image-1")).resolves.toEqual({
      mediaType: "image/jpeg",
      dataBase64: "thumb",
    });
    expect(previewDataUrl({ mediaType: "image/jpeg", dataBase64: "thumb" }))
      .toBe("data:image/jpeg;base64,thumb");
  });
});

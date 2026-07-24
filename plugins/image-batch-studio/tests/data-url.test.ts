import { describe, expect, it } from "vitest";
import { imageDataUrlToBuffer } from "../src/preload/data-url";

describe("image data url parsing", () => {
  it("rejects oversized image data urls before decoding them", () => {
    const payload = `data:image/png;base64,${"A".repeat(32)}`;

    expect(() => imageDataUrlToBuffer(payload, { maxBytes: 8 })).toThrow("图片数据过大");
  });

  it("decodes supported image data urls with normalized extensions", () => {
    const result = imageDataUrlToBuffer("data:image/jpeg;base64,AAAA", { maxBytes: 8 });

    expect(result.ext).toBe("jpg");
    expect(result.buffer.byteLength).toBe(3);
  });
});

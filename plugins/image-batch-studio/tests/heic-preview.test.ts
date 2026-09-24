import { describe, expect, it } from "vitest";
import { isBrowserRenderableImage, isImagePath } from "../src/preload/file-discovery";

describe("heic preview support", () => {
  it("identifies heic as image but not browser renderable", () => {
    expect(isImagePath("/photos/test.heic")).toBe(true);
    expect(isImagePath("/photos/test.HEIC")).toBe(true);
    expect(isImagePath("/photos/test.heif")).toBe(true);
    expect(isBrowserRenderableImage("/photos/test.heic")).toBe(false);
    expect(isBrowserRenderableImage("/photos/test.heif")).toBe(false);
    expect(isBrowserRenderableImage("/photos/test.tiff")).toBe(false);
  });

  it("identifies browser renderable images", () => {
    expect(isBrowserRenderableImage("/photos/test.jpg")).toBe(true);
    expect(isBrowserRenderableImage("/photos/test.jpeg")).toBe(true);
    expect(isBrowserRenderableImage("/photos/test.png")).toBe(true);
    expect(isBrowserRenderableImage("/photos/test.webp")).toBe(true);
    expect(isBrowserRenderableImage("/photos/test.gif")).toBe(true);
  });
});

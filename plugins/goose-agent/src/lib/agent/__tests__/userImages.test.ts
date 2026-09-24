import { describe, expect, it } from "vitest";
import {
  USER_IMAGE_MAX_COUNT,
  USER_IMAGE_MAX_EDGE,
  USER_IMAGE_MAX_BYTES,
  USER_IMAGE_JPEG_QUALITY,
  USER_IMAGE_ALLOWED_MIME,
  createImageId,
  attachmentToDataUrl,
  isAllowedImageMime,
  type UserImageAttachment,
} from "../userImages";

describe("userImages constants", () => {
  it("exposes expected limits", () => {
    expect(USER_IMAGE_MAX_COUNT).toBe(4);
    expect(USER_IMAGE_MAX_EDGE).toBe(1280);
    expect(USER_IMAGE_MAX_BYTES).toBe(512 * 1024);
    expect(USER_IMAGE_JPEG_QUALITY).toBe(0.8);
    expect(USER_IMAGE_ALLOWED_MIME).toContain("image/jpeg");
    expect(USER_IMAGE_ALLOWED_MIME).toContain("image/png");
    expect(USER_IMAGE_ALLOWED_MIME).toContain("image/webp");
    expect(USER_IMAGE_ALLOWED_MIME).toContain("image/gif");
  });
});

describe("createImageId", () => {
  it("returns unique img- prefixed ids", () => {
    const a = createImageId();
    const b = createImageId();
    expect(a.startsWith("img-")).toBe(true);
    expect(b.startsWith("img-")).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("attachmentToDataUrl", () => {
  it("builds data URL without double prefix", () => {
    const a: UserImageAttachment = {
      id: "img-1",
      mediaType: "image/jpeg",
      dataBase64: "abc123",
    };
    expect(attachmentToDataUrl(a)).toBe("data:image/jpeg;base64,abc123");
  });
});

describe("isAllowedImageMime", () => {
  it("accepts allowed and rejects others", () => {
    expect(isAllowedImageMime("image/jpeg")).toBe(true);
    expect(isAllowedImageMime("image/png")).toBe(true);
    expect(isAllowedImageMime("image/gif")).toBe(true);
    expect(isAllowedImageMime("image/webp")).toBe(true);
    expect(isAllowedImageMime("image/svg+xml")).toBe(false);
    expect(isAllowedImageMime("application/pdf")).toBe(false);
  });
});

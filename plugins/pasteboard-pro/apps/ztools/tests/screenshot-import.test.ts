import { describe, expect, it, vi } from "vitest";

import {
  importCapturedScreenshot,
  importScreenCapture,
  SCREEN_CAPTURE_PAUSED_MESSAGE,
  SCREEN_CAPTURE_UNAVAILABLE_MESSAGE,
} from "../preload/screenshot-import";

function image(empty = false) {
  return {
    isEmpty: () => empty,
    resize: () => image(empty),
    toJPEG: () => new Uint8Array(),
  };
}

describe("captured screenshot import", () => {
  it("writes a valid captured image to the system clipboard", () => {
    const writeImage = vi.fn();
    const createFromDataURL = vi.fn(() => image());

    expect(importCapturedScreenshot("data:image/png;base64,aGVsbG8=", {
      clipboard: { writeImage },
      nativeImage: { createFromDataURL },
    })).toBe(true);
    expect(createFromDataURL).toHaveBeenCalledOnce();
    expect(writeImage).toHaveBeenCalledOnce();
  });

  it("rejects invalid or empty images without changing the clipboard", () => {
    const writeImage = vi.fn();
    const createFromDataURL = vi.fn(() => image(true));
    const dependencies = {
      clipboard: { writeImage },
      nativeImage: { createFromDataURL },
    };

    expect(importCapturedScreenshot("https://example.com/image.png", dependencies)).toBe(false);
    expect(importCapturedScreenshot("data:image/png;base64,", dependencies)).toBe(false);
    expect(writeImage).not.toHaveBeenCalled();
  });

  it("requests editable capture and writes only to the clipboard", async () => {
    const writeImage = vi.fn();
    const canImport = vi.fn(async () => true);
    let requestedAutoConfirm: boolean | undefined;

    const result = await importScreenCapture(
      {
        screenCapture(callback, autoConfirm) {
          requestedAutoConfirm = autoConfirm;
          callback(image(), { x: 10, y: 20, width: 300, height: 180 });
        },
      },
      { createFromDataURL: () => image() },
      { writeImage },
      { canImport },
    );

    expect(requestedAutoConfirm).toBe(false);
    expect(result).toEqual({
      bounds: { x: 10, y: 20, width: 300, height: 180 },
    });
    expect(canImport).toHaveBeenCalledTimes(2);
    expect(writeImage).toHaveBeenCalledOnce();
  });

  it("accepts the official one-argument wrapper and optional bounds", async () => {
    const writeImage = vi.fn();
    function legacyScreenCapture(
      callback: (captured: unknown, bounds?: unknown) => void,
    ): void {
      callback(image());
    }

    await expect(importScreenCapture(
      { screenCapture: legacyScreenCapture },
      { createFromDataURL: () => image() },
      { writeImage },
    )).resolves.toEqual({});
    expect(writeImage).toHaveBeenCalledOnce();
  });

  it("rejects hosts without screen capture", async () => {
    await expect(importScreenCapture(
      {},
      { createFromDataURL: () => image() },
      { writeImage: vi.fn() },
    )).rejects.toThrow(SCREEN_CAPTURE_UNAVAILABLE_MESSAGE);
  });

  it("does not invoke capture while privacy pause is active", async () => {
    let invoked = false;
    function screenCapture(
      _callback: (captured: unknown, bounds?: unknown) => void,
      _autoConfirm?: boolean,
    ): void {
      invoked = true;
    }

    await expect(
      importScreenCapture(
        { screenCapture },
        { createFromDataURL: () => image() },
        { writeImage: vi.fn() },
        { canImport: async () => false },
      ),
    ).rejects.toThrow(SCREEN_CAPTURE_PAUSED_MESSAGE);
    expect(invoked).toBe(false);
  });

  it("rechecks privacy after capture and before writing the clipboard", async () => {
    const writeImage = vi.fn();
    let checks = 0;
    function screenCapture(
      callback: (captured: unknown, bounds?: unknown) => void,
      _autoConfirm?: boolean,
    ): void {
      callback(image(), { x: 0, y: 0, width: 100, height: 100 });
    }

    await expect(
      importScreenCapture(
        { screenCapture },
        { createFromDataURL: () => image() },
        { writeImage },
        { canImport: async () => (checks += 1) === 1 },
      ),
    ).rejects.toThrow(SCREEN_CAPTURE_PAUSED_MESSAGE);
    expect(writeImage).not.toHaveBeenCalled();
  });
});

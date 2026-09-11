import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  loadThemeBackgroundImage,
  MAX_THEME_BACKGROUND_BYTES,
} from "../preload/theme-background";

const imagePath = path.resolve("theme.png");

function dependencies(options?: Readonly<{ empty?: boolean; size?: number }>) {
  const bytes = new Uint8Array([137, 80, 78, 71]);
  return {
    fileSystem: {
      stat: vi.fn(async () => ({
        isFile: () => true,
        size: options?.size ?? bytes.byteLength,
      })),
      readFile: vi.fn(async () => bytes),
    },
    nativeImage: {
      createFromPath: vi.fn(() => ({
        isEmpty: () => options?.empty ?? false,
        resize() { return this; },
        toJPEG: () => new Uint8Array(),
      })),
    },
  };
}

describe("theme background image", () => {
  it("copies a valid image into a portable data URL", async () => {
    await expect(loadThemeBackgroundImage(imagePath, dependencies())).resolves.toBe(
      "data:image/png;base64,iVBORw==",
    );
  });

  it("rejects relative paths and unsupported extensions", async () => {
    await expect(loadThemeBackgroundImage("theme.png", dependencies())).rejects.toThrow(
      /绝对路径/,
    );
    await expect(
      loadThemeBackgroundImage(path.resolve("theme.svg"), dependencies()),
    ).rejects.toThrow(/PNG、JPEG 和 WebP/);
  });

  it("rejects oversized or undecodable images before reading them", async () => {
    const oversized = dependencies({ size: MAX_THEME_BACKGROUND_BYTES + 1 });
    await expect(loadThemeBackgroundImage(imagePath, oversized)).rejects.toThrow(/8 MB/);
    expect(oversized.fileSystem.readFile).not.toHaveBeenCalled();

    const invalid = dependencies({ empty: true });
    await expect(loadThemeBackgroundImage(imagePath, invalid)).rejects.toThrow(/无法读取/);
    expect(invalid.fileSystem.readFile).not.toHaveBeenCalled();
  });
});

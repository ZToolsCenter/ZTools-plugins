import { afterEach, describe, expect, it, vi } from "vitest";

import {
  constrainImageCrop,
  exportEditedImage,
  fitImageCrop,
  loadEditableImage,
  renderImagePreview,
  resizeImageCrop,
  rotatedImageSize,
  type ImageCrop,
  type ImageRotation,
} from "../src/theme-image-edit";
import { MAX_THEME_BACKGROUND_BYTES } from "../preload/window-theme-preferences";

const dataUrl = "data:image/png;base64,iVBORw==";

afterEach(() => vi.unstubAllGlobals());

describe("theme image edit geometry", () => {
  it.each<ImageRotation>([0, 90, 180, 270])("calculates the canvas bounds for %i degrees", (rotation) => {
    expect(rotatedImageSize({ width: 800, height: 600 }, rotation)).toEqual(
      rotation === 90 || rotation === 270
        ? { width: 600, height: 800 }
        : { width: 800, height: 600 },
    );
  });

  it("keeps the whole image without a ratio and centers a fixed-ratio crop", () => {
    expect(fitImageCrop({ width: 800, height: 600 })).toEqual({
      x: 0, y: 0, width: 1, height: 1,
    });
    expect(fitImageCrop({ width: 800, height: 600 }, 1)).toEqual({
      x: 0.125, y: 0, width: 0.75, height: 1,
    });
  });

  it("rejects invalid crop ratios and clamps a crop to the image", () => {
    expect(() => fitImageCrop({ width: 800, height: 600 }, Number.NaN)).toThrow(/比例/);
    expect(constrainImageCrop({ x: -0.2, y: 0.2, width: 0.8, height: 1 })).toEqual({
      x: 0, y: 0.2, width: 0.8, height: 0.8,
    });
    expect(() => constrainImageCrop({ x: 1, y: 0, width: 0.1, height: 1 })).toThrow(/边界/);
    expect(() => constrainImageCrop({ x: 0, y: 0, width: Number.NaN, height: 1 })).toThrow(/无效/);
  });

  it("resizes from the selected corner and keeps an optional pixel ratio", () => {
    const full: ImageCrop = { x: 0, y: 0, width: 1, height: 1 };
    expect(resizeImageCrop(full, "se", { x: -0.25, y: -0.25 }, {
      width: 800, height: 600,
    })).toEqual({ x: 0, y: 0, width: 0.75, height: 0.75 });

    const locked = resizeImageCrop(full, "se", { x: -0.25, y: -0.1 }, {
      width: 800, height: 600,
    }, 4 / 3);
    expect(locked.x).toBe(0);
    expect(locked.y).toBe(0);
    expect(locked.width / locked.height * (800 / 600)).toBeCloseTo(4 / 3);
    expect(locked.width).toBeLessThanOrEqual(1);
    expect(locked.height).toBeLessThanOrEqual(1);

    expect(() => resizeImageCrop(full, "se", { x: Infinity, y: 0 }, {
      width: 800, height: 600,
    })).toThrow(/移动距离/);
  });

  it.each([
    { handle: "nw", delta: { x: 0.1, y: 0.1 }, fixed: { x: 0.7, y: 0.7 } },
    { handle: "ne", delta: { x: -0.1, y: 0.1 }, fixed: { x: 0.2, y: 0.7 } },
    { handle: "sw", delta: { x: 0.1, y: -0.1 }, fixed: { x: 0.7, y: 0.2 } },
    { handle: "se", delta: { x: -0.1, y: -0.1 }, fixed: { x: 0.2, y: 0.2 } },
  ] as const)("resizes $handle while keeping the opposite corner fixed", ({ handle, delta, fixed }) => {
    const result = resizeImageCrop(
      { x: 0.2, y: 0.2, width: 0.5, height: 0.5 },
      handle,
      delta,
      { width: 800, height: 600 },
      4 / 3,
    );
    expect(result.width).toBeCloseTo(0.4);
    expect(result.height).toBeCloseTo(0.4);
    expect(result.x + result.width * (handle.includes("e") ? 0 : 1)).toBeCloseTo(fixed.x);
    expect(result.y + result.height * (handle.includes("n") ? 1 : 0)).toBeCloseTo(fixed.y);
  });

  it.each([
    { delta: { x: 0.1, y: 0 } },
    { delta: { x: 0, y: 0.1 } },
  ] as const)("shrinks a locked aspect crop from a single drag axis", ({ delta }) => {
    const result = resizeImageCrop(
      { x: 0.2, y: 0.2, width: 0.5, height: 0.5 },
      "nw",
      delta,
      { width: 800, height: 600 },
      4 / 3,
    );
    expect(result.width).toBeCloseTo(0.4);
    expect(result.height).toBeCloseTo(0.4);
    expect(result.x + result.width).toBeCloseTo(0.7);
    expect(result.y + result.height).toBeCloseTo(0.7);
  });
});

describe("theme image decode and canvas rendering", () => {
  it("loads only decodable and bounded image data", async () => {
    class DecodedImage {
      decoding = "";
      src = "";
      naturalWidth = 40;
      naturalHeight = 20;
      async decode(): Promise<void> {
        if (this.src.includes("bad")) throw new Error("bad data");
        if (this.src.includes("large")) {
          this.naturalWidth = 16_000;
          this.naturalHeight = 5_000;
        }
      }
    }
    vi.stubGlobal("Image", DecodedImage);

    await expect(loadEditableImage(dataUrl)).resolves.toMatchObject({
      naturalWidth: 40,
      naturalHeight: 20,
    });
    await expect(loadEditableImage("https://example.com/a.png")).rejects.toThrow(/格式无效/);
    await expect(loadEditableImage("data:image/png;base64,bad")).rejects.toThrow(/解码/);
    await expect(loadEditableImage("data:image/png;base64,large")).rejects.toThrow(/尺寸无效/);
  });

  it("rejects a PNG pixel bomb from IHDR before asking the browser to decode it", async () => {
    const header = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header, 0);
    header.writeUInt32BE(13, 8);
    header.write("IHDR", 12, "ascii");
    header.writeUInt32BE(16_000, 16);
    header.writeUInt32BE(5_000, 20);
    const decode = vi.fn(async () => undefined);
    class UndecodedImage {
      decoding = "";
      src = "";
      naturalWidth = 1;
      naturalHeight = 1;
      decode = decode;
    }
    vi.stubGlobal("Image", UndecodedImage);
    const imageDataUrl = `data:image/png;base64,${header.toString("base64")}`;
    const error = await loadEditableImage(imageDataUrl).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).toMatch(/尺寸无效/);
    expect(decode).not.toHaveBeenCalled();
  });

  it("accepts exactly 8 MB of encoded image data and rejects one byte more", async () => {
    class DecodedImage {
      decoding = "";
      src = "";
      naturalWidth = 1;
      naturalHeight = 1;
      async decode(): Promise<void> {}
    }
    vi.stubGlobal("Image", DecodedImage);
    const exact = `data:image/png;base64,${Buffer.alloc(MAX_THEME_BACKGROUND_BYTES).toString("base64")}`;
    const oversized = `data:image/png;base64,${Buffer.alloc(MAX_THEME_BACKGROUND_BYTES + 1).toString("base64")}`;

    await expect(loadEditableImage(exact)).resolves.toBeInstanceOf(DecodedImage);
    await expect(loadEditableImage(oversized)).rejects.toThrow(/8 MB/);
  });

  it("bounds a rotated preview and keeps its original proportions", () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
    } as unknown as HTMLCanvasElement;
    const context = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      translate: vi.fn(),
      rotate: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    Object.defineProperty(canvas, "getContext", { value: vi.fn(() => context) });
    const image = { naturalWidth: 2_000, naturalHeight: 1_000 } as HTMLImageElement;

    renderImagePreview(canvas, image, 90);

    expect(canvas.width).toBe(700);
    expect(canvas.height).toBe(1_400);
    expect(context.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(context.drawImage).toHaveBeenCalledOnce();
  });

  it("exports the rotated crop without stretching and enforces output limits", async () => {
    const operations: string[] = [];
    const context = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      scale: vi.fn(() => operations.push("scale")),
      translate: vi.fn(() => operations.push("translate")),
      rotate: vi.fn(() => operations.push("rotate")),
      drawImage: vi.fn(() => operations.push("drawImage")),
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toDataURL: () => dataUrl,
    } as unknown as HTMLCanvasElement;
    vi.stubGlobal("document", {
      createElement: vi.fn(() => canvas),
    });
    const image = { naturalWidth: 800, naturalHeight: 600 } as HTMLImageElement;
    const edit = {
      rotation: 90 as const,
      crop: { x: 0.125, y: 0, width: 0.75, height: 1 },
      width: 450,
      height: 800,
    };

    await expect(exportEditedImage(image, edit)).resolves.toBe(dataUrl);
    expect(operations).toEqual(["scale", "translate", "translate", "rotate", "drawImage"]);
    await expect(exportEditedImage(image, { ...edit, width: 4_097 })).rejects.toThrow(/过大/);
    await expect(exportEditedImage(image, { ...edit, width: 449, height: 798 })).resolves.toBe(dataUrl);
    await expect(exportEditedImage(image, { ...edit, width: 800 })).rejects.toThrow(/比例/);

    const wideImage = { naturalWidth: 1_600, naturalHeight: 900 } as HTMLImageElement;
    const wideEdit = {
      rotation: 0 as const,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      width: 449,
      height: 253,
    };
    await expect(exportEditedImage(wideImage, wideEdit)).resolves.toBe(dataUrl);
    await expect(exportEditedImage(wideImage, { ...wideEdit, height: 250 })).rejects.toThrow(/比例/);
  });

  it("keeps JPEG photos in JPEG format and reduces quality only as needed", async () => {
    const context = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      scale: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const oversized = `data:image/jpeg;base64,${Buffer.alloc(MAX_THEME_BACKGROUND_BYTES + 1).toString("base64")}`;
    const jpeg = "data:image/jpeg;base64,AA==";
    const toDataURL = vi.fn((_type: string, quality?: number) =>
      quality === 0.92 ? oversized : jpeg,
    );
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: () => context,
        toDataURL,
      })),
    });
    const image = {
      naturalWidth: 800,
      naturalHeight: 600,
      src: "data:image/jpeg;base64,source",
    } as HTMLImageElement;
    const edit = {
      rotation: 0 as const,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      width: 800,
      height: 600,
    };

    await expect(exportEditedImage(image, edit)).resolves.toBe(jpeg);
    expect(toDataURL.mock.calls).toEqual([
      ["image/jpeg", 0.92],
      ["image/jpeg", 0.84],
    ]);
  });
});

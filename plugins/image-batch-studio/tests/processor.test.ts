import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import {
  createGif,
  mergeImages,
  mergePdfs,
  processImages
} from "../src/preload/processor";
import type { ImageJobSettings } from "../src/shared/types";

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "image-batch-studio-"));
}

async function makeImage(filePath: string, width: number, height: number, color: string) {
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: color
    }
  })
    .png()
    .toFile(filePath);
}

async function makeTwoColorImage(filePath: string) {
  await sharp({
    create: {
      width: 2,
      height: 1,
      channels: 4,
      background: "#00000000"
    }
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="2" height="1" xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="#ff0000"/><rect x="1" width="1" height="1" fill="#00ff00"/></svg>'
        )
      }
    ])
    .png()
    .toFile(filePath);
}

async function makeTinyOptimizedPng(filePath: string) {
  await fs.writeFile(
    filePath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64"
    )
  );
}

async function makeHeif(filePath: string, width: number, height: number, color: string) {
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: color
    }
  })
    .heif({ quality: 80, compression: "av1" })
    .toFile(filePath);
}

async function makePdf(filePath: string, text: string) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([240, 120]);
  page.drawText(text, { x: 24, y: 64, size: 18 });
  await fs.writeFile(filePath, await doc.save());
}

describe("offline processing engine", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("converts, resizes, crops, adds border, and rounds corners for HEIF inputs", async () => {
    const dir = await makeTempDir();
    const input = path.join(dir, "source.heif");
    const outputDir = path.join(dir, "out");
    await makeHeif(input, 120, 90, "#2b7a78");

    const settings: ImageJobSettings = {
      output: { directory: outputDir, namingPattern: "{name}-processed.{ext}", overwrite: false },
      format: { type: "webp", quality: 82 },
      resize: { mode: "exact", width: 80, height: 60, withoutEnlargement: true },
      crop: { left: 10, top: 5, width: 70, height: 50 },
      border: { enabled: true, width: 4, color: "#efc46a" },
      rounded: { enabled: true, radius: 10 }
    };

    const [result] = await processImages([input], settings);

    expect(result.ok).toBe(true);
    expect(result.outputPath.endsWith("source-processed.webp")).toBe(true);
    const metadata = await sharp(result.outputPath).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(78);
    expect(metadata.height).toBe(58);
  });

  it("keeps the extended border dimensions when applying rounded corners", async () => {
    const dir = await makeTempDir();
    const input = path.join(dir, "border.png");
    const outputDir = path.join(dir, "out");
    await makeImage(input, 64, 48, "#236b8e");

    const [result] = await processImages([input], {
      output: { directory: outputDir, namingPattern: "{name}-rounded.{ext}", overwrite: false },
      format: { type: "png" },
      border: { enabled: true, width: 6, color: "#ffffff" },
      rounded: { enabled: true, radius: 12 }
    });

    expect(result.ok).toBe(true);
    const metadata = await sharp(result.outputPath).metadata();
    expect(metadata.width).toBe(76);
    expect(metadata.height).toBe(60);
  });

  it("adds text watermarks to HEIC inputs and keeps output readable by sharp", async () => {
    const dir = await makeTempDir();
    const input = path.join(dir, "watermark.heic");
    const outputDir = path.join(dir, "out");
    await makeHeif(input, 100, 80, "#183a37");

    const [result] = await processImages([input], {
      output: { directory: outputDir, namingPattern: "{name}-wm.{ext}", overwrite: false },
      format: { type: "png" },
      watermark: {
        enabled: true,
        kind: "text",
        text: "ZTools",
        position: "center",
        opacity: 0.72,
        fontSize: 22,
        color: "#ffffff",
        margin: 12,
        rotation: -12
      }
    });

    expect(result.ok).toBe(true);
    const metadata = await sharp(result.outputPath).metadata();
    expect(metadata.width).toBe(100);
    expect(metadata.height).toBe(80);
  });

  it("rotates text watermarks around their anchor point", async () => {
    const dir = await makeTempDir();
    const input = path.join(dir, "watermark-anchor.png");
    const outputDir = path.join(dir, "out");
    await makeImage(input, 160, 120, "#000000");

    const [result] = await processImages([input], {
      output: { directory: outputDir, namingPattern: "{name}-anchored.{ext}", overwrite: false },
      format: { type: "png" },
      watermark: {
        enabled: true,
        kind: "text",
        text: "Z",
        position: "northwest",
        opacity: 1,
        fontSize: 48,
        color: "#ffffff",
        margin: 8,
        rotation: 45
      }
    });

    expect(result.ok).toBe(true);
    const leftAnchorPixels = await sharp(result.outputPath)
      .ensureAlpha()
      .extract({ left: 0, top: 0, width: 32, height: 70 })
      .raw()
      .toBuffer()
      .then((pixels) => {
        let brightPixels = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] > 180 && pixels[index + 1] > 180 && pixels[index + 2] > 180) {
            brightPixels += 1;
          }
        }
        return brightPixels;
      });
    expect(leftAnchorPixels).toBeGreaterThan(100);
  });

  it("falls back to a safe text watermark color when the configured color is invalid", async () => {
    const dir = await makeTempDir();
    const input = path.join(dir, "watermark-color.png");
    const outputDir = path.join(dir, "out");
    await makeImage(input, 160, 120, "#000000");

    const [result] = await processImages([input], {
      output: { directory: outputDir, namingPattern: "{name}-safe-color.{ext}", overwrite: false },
      format: { type: "png" },
      watermark: {
        enabled: true,
        kind: "text",
        text: "Z",
        position: "northwest",
        opacity: 1,
        fontSize: 32,
        color: '#ffffff" /><rect width="160" height="120" fill="#ff0000" /><text fill="#ffffff',
        margin: 8,
        rotation: 0
      }
    });

    expect(result.ok).toBe(true);
    const centerPixel = await sharp(result.outputPath).extract({ left: 80, top: 60, width: 1, height: 1 }).raw().toBuffer();
    expect(centerPixel[0]).toBeLessThan(20);
    expect(centerPixel[1]).toBeLessThan(20);
    expect(centerPixel[2]).toBeLessThan(20);
  });

  it("processes HEIF and HEIC inputs through image modules", async () => {
    const dir = await makeTempDir();
    const heifInput = path.join(dir, "source.heif");
    const heicInput = path.join(dir, "source.heic");
    const outputDir = path.join(dir, "out");
    await makeHeif(heifInput, 64, 48, "#2388cc");
    await makeHeif(heicInput, 50, 30, "#bb6f2a");

    const results = await processImages([heifInput, heicInput], {
      output: { directory: outputDir, namingPattern: "{name}-processed.{ext}", overwrite: false },
      format: { type: "webp", quality: 82 },
      resize: { mode: "fit", width: 32, withoutEnlargement: true }
    });

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.ok)).toBe(true);
    const heifMeta = await sharp(results[0].outputPath).metadata();
    const heicMeta = await sharp(results[1].outputPath).metadata();
    expect(heifMeta.format).toBe("webp");
    expect(heifMeta.width).toBe(32);
    expect(heicMeta.format).toBe("webp");
    expect(heicMeta.width).toBe(32);
  });

  it("converts supported images to HEIF output", async () => {
    const dir = await makeTempDir();
    const input = path.join(dir, "source.png");
    const outputDir = path.join(dir, "out");
    await makeImage(input, 48, 36, "#4455aa");

    const [result] = await processImages([input], {
      output: { directory: outputDir, namingPattern: "{name}.{ext}", overwrite: false },
      format: { type: "heif", quality: 72 }
    });

    expect(result.ok).toBe(true);
    expect(result.outputPath.endsWith(".heif")).toBe(true);
    const metadata = await sharp(result.outputPath).metadata();
    expect(metadata.format).toBe("heif");
    expect(metadata.compression).toBe("av1");
  });

  it("keeps optimized PNG compression output from growing", async () => {
    const dir = await makeTempDir();
    const input = path.join(dir, "tiny.png");
    const outputDir = path.join(dir, "out");
    await makeTinyOptimizedPng(input);

    const [result] = await processImages([input], {
      output: { directory: outputDir, namingPattern: "{name}-compressed.{ext}", overwrite: false },
      compression: { quality: 60, keepMetadata: false }
    });

    expect(result.ok).toBe(true);
    expect(result.outputBytes).toBeLessThanOrEqual(result.inputBytes ?? 0);
    const metadata = await sharp(result.outputPath).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(1);
    expect(metadata.height).toBe(1);
  });

  it("adds HEIC image watermarks to HEIF inputs without changing canvas size", async () => {
    const dir = await makeTempDir();
    const input = path.join(dir, "base.heif");
    const watermark = path.join(dir, "mark.heic");
    const outputDir = path.join(dir, "out");
    await makeHeif(input, 120, 80, "#000000");
    await makeHeif(watermark, 20, 20, "#ff0000");

    const [result] = await processImages([input], {
      output: { directory: outputDir, namingPattern: "{name}-image-wm.{ext}", overwrite: false },
      format: { type: "png" },
      watermark: {
        enabled: true,
        kind: "image",
        imagePath: watermark,
        position: "center",
        opacity: 1,
        fontSize: 16,
        color: "#ffffff",
        margin: 0,
        rotation: 0
      }
    });

    expect(result.ok).toBe(true);
    const metadata = await sharp(result.outputPath).metadata();
    expect(metadata.width).toBe(120);
    expect(metadata.height).toBe(80);
    const centerPixel = await sharp(result.outputPath).extract({ left: 60, top: 40, width: 1, height: 1 }).raw().toBuffer();
    expect(centerPixel[0]).toBeGreaterThan(180);
    expect(centerPixel[1]).toBeLessThan(80);
    expect(centerPixel[2]).toBeLessThan(80);
  });

  it("rotates and flips HEIC images while preserving readable output", async () => {
    const dir = await makeTempDir();
    const input = path.join(dir, "rotate.heic");
    const outputDir = path.join(dir, "out");
    await makeHeif(input, 40, 20, "#335f9d");

    const [result] = await processImages([input], {
      output: { directory: outputDir, namingPattern: "{name}-rotated.{ext}", overwrite: false },
      format: { type: "png" },
      rotate: 90,
      flip: "horizontal"
    });

    expect(result.ok).toBe(true);
    const metadata = await sharp(result.outputPath).metadata();
    expect(metadata.width).toBe(20);
    expect(metadata.height).toBe(40);
  });

  it("ignores resize settings when both dimensions are empty", async () => {
    const dir = await makeTempDir();
    const input = path.join(dir, "no-resize.png");
    const outputDir = path.join(dir, "out");
    await makeImage(input, 48, 36, "#446a9d");

    const [result] = await processImages([input], {
      output: { directory: outputDir, namingPattern: "{name}-same.{ext}", overwrite: false },
      format: { type: "png" },
      resize: { mode: "fit", withoutEnlargement: true }
    });

    expect(result.ok).toBe(true);
    const metadata = await sharp(result.outputPath).metadata();
    expect(metadata.width).toBe(48);
    expect(metadata.height).toBe(36);
  });

  it("clamps crop geometry against resized dimensions before extracting", async () => {
    const dir = await makeTempDir();
    const input = path.join(dir, "resize-crop.png");
    const outputDir = path.join(dir, "out");
    await makeImage(input, 100, 100, "#446a9d");

    const [result] = await processImages([input], {
      output: { directory: outputDir, namingPattern: "{name}-clamped.{ext}", overwrite: false },
      format: { type: "png" },
      resize: { mode: "exact", width: 50, height: 50, withoutEnlargement: false },
      crop: { left: 75, top: 0, width: 25, height: 25 }
    });

    expect(result.ok).toBe(true);
    const metadata = await sharp(result.outputPath).metadata();
    expect(metadata.width).toBe(1);
    expect(metadata.height).toBe(25);
  });

  it("uses atomic create writes when overwrite is disabled", async () => {
    const dir = await makeTempDir();
    const input = path.join(dir, "atomic.png");
    const outputDir = path.join(dir, "out");
    await makeImage(input, 24, 18, "#446a9d");
    const writeFile = vi.spyOn(fs, "writeFile");

    const [result] = await processImages([input], {
      output: { directory: outputDir, namingPattern: "{name}.{ext}", overwrite: false },
      format: { type: "png" }
    });

    expect(result.ok).toBe(true);
    const outputWrite = writeFile.mock.calls.find((call) => String(call[0]) === result.outputPath);
    expect(outputWrite?.[2]).toMatchObject({ flag: "wx" });
  });

  it("applies relative crop geometry per image in mixed-size batches", async () => {
    const dir = await makeTempDir();
    const first = path.join(dir, "crop-small.png");
    const second = path.join(dir, "crop-wide.png");
    const outputDir = path.join(dir, "out");
    await makeImage(first, 100, 100, "#446a9d");
    await makeImage(second, 200, 100, "#9d6a44");

    const results = await processImages([first, second], {
      output: { directory: outputDir, namingPattern: "{name}-crop.{ext}", overwrite: false },
      format: { type: "png" },
      crop: { left: 25, top: 25, width: 50, height: 50 },
      cropRelative: { left: 0.25, top: 0.25, width: 0.5, height: 0.5 }
    });

    expect(results.every((result) => result.ok)).toBe(true);
    const firstMeta = await sharp(results[0].outputPath).metadata();
    const secondMeta = await sharp(results[1].outputPath).metadata();
    expect(firstMeta.width).toBe(50);
    expect(firstMeta.height).toBe(50);
    expect(secondMeta.width).toBe(100);
    expect(secondMeta.height).toBe(50);
  });

  it("merges PDFs in input order", async () => {
    const dir = await makeTempDir();
    const first = path.join(dir, "a.pdf");
    const second = path.join(dir, "b.pdf");
    const output = path.join(dir, "merged.pdf");
    await makePdf(first, "A");
    await makePdf(second, "B");

    await mergePdfs([first, second], output);

    const merged = await PDFDocument.load(await fs.readFile(output));
    expect(merged.getPageCount()).toBe(2);
  });

  it("merges images vertically with stable dimensions", async () => {
    const dir = await makeTempDir();
    const first = path.join(dir, "one.png");
    const second = path.join(dir, "two.heif");
    const output = path.join(dir, "joined.png");
    await makeImage(first, 40, 20, "#b4483f");
    await makeHeif(second, 40, 30, "#1f6f68");

    await mergeImages([first, second], output, {
      layout: "vertical",
      gap: 6,
      background: "#f6f0df"
    });

    const metadata = await sharp(output).metadata();
    expect(metadata.width).toBe(40);
    expect(metadata.height).toBe(56);
  });

  it("merges images horizontally and in a grid with stable dimensions", async () => {
    const dir = await makeTempDir();
    const first = path.join(dir, "one.png");
    const second = path.join(dir, "two.heic");
    const third = path.join(dir, "three.png");
    const horizontal = path.join(dir, "horizontal.png");
    const grid = path.join(dir, "grid.png");
    await makeImage(first, 40, 20, "#b4483f");
    await makeImage(second, 30, 30, "#1f6f68");
    await makeImage(third, 20, 10, "#d49b3d");

    await mergeImages([first, second], horizontal, {
      layout: "horizontal",
      gap: 6,
      background: "#ffffff"
    });
    await mergeImages([first, second, third], grid, {
      layout: "grid",
      columns: 2,
      gap: 5,
      background: "#ffffff"
    });

    const horizontalMeta = await sharp(horizontal).metadata();
    expect(horizontalMeta.width).toBe(76);
    expect(horizontalMeta.height).toBe(30);
    const gridMeta = await sharp(grid).metadata();
    expect(gridMeta.width).toBe(85);
    expect(gridMeta.height).toBe(65);
  });

  it("rejects unsafe merge gaps before creating a huge canvas", async () => {
    const dir = await makeTempDir();
    const first = path.join(dir, "one.png");
    const second = path.join(dir, "two.png");
    const output = path.join(dir, "unsafe-gap.png");
    await makeImage(first, 40, 20, "#b4483f");
    await makeImage(second, 40, 30, "#1f6f68");

    await expect(
      mergeImages([first, second], output, {
        layout: "vertical",
        gap: 5000,
        background: "#ffffff"
      })
    ).rejects.toThrow("拼图间距不能超过");
    await expect(fs.stat(output)).rejects.toThrow();
  });

  it("creates an animated GIF from local images", async () => {
    const dir = await makeTempDir();
    const first = path.join(dir, "one.png");
    const second = path.join(dir, "two.png");
    const output = path.join(dir, "motion.gif");
    await makeImage(first, 32, 24, "#d49b3d");
    await makeHeif(second, 32, 24, "#1f6f68");

    await createGif([first, second], output, {
      width: 32,
      height: 24,
      delayMs: 120,
      loop: 0
    });

    const metadata = await sharp(output, { animated: true }).metadata();
    expect(metadata.format).toBe("gif");
    expect(metadata.pages).toBe(2);
  });

  it("preserves GIF frame colors when quantizing raw RGBA pixels", async () => {
    const dir = await makeTempDir();
    const first = path.join(dir, "colors.png");
    const second = path.join(dir, "colors2.png");
    const output = path.join(dir, "colors.gif");
    await makeTwoColorImage(first);
    await makeTwoColorImage(second);

    await createGif([first, second], output, {
      width: 2,
      height: 1,
      delayMs: 120,
      loop: 0
    });

    const pixels = await sharp(output, { animated: true })
      .extract({ left: 0, top: 0, width: 2, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();

    expect([...pixels.slice(0, 3)]).toEqual([255, 0, 0]);
    expect([...pixels.slice(3, 6)]).toEqual([0, 255, 0]);
  });
});

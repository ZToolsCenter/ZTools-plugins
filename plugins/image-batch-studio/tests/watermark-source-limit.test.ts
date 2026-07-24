import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const sharpCalls = vi.hoisted(() => [] as Array<{ input: unknown; options: unknown }>);

vi.mock("sharp", () => {
  const makePipeline = (width: number, height: number) => {
    const pipeline = {
      metadata: vi.fn(async () => ({ width, height, format: "png" })),
      rotate: vi.fn(() => pipeline),
      resize: vi.fn(() => pipeline),
      toColorspace: vi.fn(() => pipeline),
      ensureAlpha: vi.fn(() => pipeline),
      raw: vi.fn(() => pipeline),
      composite: vi.fn(() => pipeline),
      png: vi.fn(() => pipeline),
      toBuffer: vi.fn(async (options?: { resolveWithObject?: boolean }) => {
        const data = Buffer.alloc(width * height * 4, 255);
        return options?.resolveWithObject ? { data, info: { width, height, channels: 4 } } : data;
      })
    };
    return pipeline;
  };

  const sharpMock = vi.fn((input, options) => {
    sharpCalls.push({ input, options });
    if (typeof input === "string" && input.includes("watermark")) return makePipeline(2, 2);
    return makePipeline(10, 10);
  });
  return { default: sharpMock };
});

describe("watermark source limits", () => {
  it("opens image watermark sources with input pixel limits", async () => {
    const { processImages } = await import("../src/preload/processor");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "image-batch-watermark-source-"));
    const input = path.join(dir, "input.png");
    const watermark = path.join(dir, "watermark.png");
    await fs.writeFile(input, "input");
    await fs.writeFile(watermark, "watermark");

    const [result] = await processImages([input], {
      output: { directory: path.join(dir, "out"), namingPattern: "{name}.{ext}", overwrite: false },
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
    expect(sharpCalls.find((call) => call.input === watermark)?.options).toMatchObject({
      limitInputPixels: expect.any(Number)
    });
  });
});

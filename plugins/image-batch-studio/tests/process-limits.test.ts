import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const pipelineReached = vi.hoisted(() => vi.fn());

vi.mock("sharp", () => {
  const sharpMock = vi.fn(() => ({
    metadata: vi.fn(async () => ({ width: 10000, height: 10000, format: "png" })),
    rotate: vi.fn(() => {
      pipelineReached();
      throw new Error("processing pipeline should not run");
    })
  }));
  return { default: sharpMock };
});

describe("image processing limits", () => {
  it("rejects oversized images before entering the processing pipeline", async () => {
    const { processImages } = await import("../src/preload/processor");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "image-batch-process-limits-"));

    const [result] = await processImages([path.join(dir, "huge.png")], {
      output: { directory: path.join(dir, "out"), namingPattern: "{name}.{ext}", overwrite: false },
      format: { type: "png" }
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("图片尺寸过大");
    expect(pipelineReached).not.toHaveBeenCalled();
  });
});

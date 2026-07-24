import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const rawPipelineReached = vi.hoisted(() => vi.fn());

vi.mock("sharp", () => {
  const sharpMock = vi.fn(() => ({
    metadata: vi.fn(async () => ({ width: 10000, height: 10000 })),
    rotate: vi.fn(() => {
      rawPipelineReached();
      throw new Error("raw pipeline should not run");
    })
  }));
  return { default: sharpMock };
});

describe("merge image memory guard", () => {
  beforeEach(() => {
    rawPipelineReached.mockClear();
  });

  it("rejects oversized inputs from metadata before reading raw buffers", async () => {
    const { mergeImages } = await import("../src/preload/processor");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "image-batch-merge-memory-"));

    await expect(
      mergeImages([path.join(dir, "huge-a.png"), path.join(dir, "huge-b.png")], path.join(dir, "out.png"), {
        layout: "vertical",
        gap: 0,
        background: "#ffffff"
      })
    ).rejects.toThrow("拼图输入图片过大");
    expect(rawPipelineReached).not.toHaveBeenCalled();
  });
});

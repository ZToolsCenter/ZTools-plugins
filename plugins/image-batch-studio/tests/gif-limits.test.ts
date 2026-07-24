import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const rawPipelineReached = vi.hoisted(() => vi.fn());

vi.mock("sharp", () => {
  const sharpMock = vi.fn(() => ({
    rotate: vi.fn(() => {
      rawPipelineReached();
      throw new Error("raw pipeline should not run");
    })
  }));
  return { default: sharpMock };
});

describe("gif limits", () => {
  it("rejects oversized GIF canvases before reading frames", async () => {
    const { createGif } = await import("../src/preload/processor");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "image-batch-gif-limits-"));

    await expect(
      createGif([path.join(dir, "frame.png")], path.join(dir, "out.gif"), {
        width: 8000,
        height: 8000,
        delayMs: 120,
        loop: 0,
        background: "#ffffff"
      })
    ).rejects.toThrow("GIF 尺寸过大");
    expect(rawPipelineReached).not.toHaveBeenCalled();
  });

  it("rejects excessive GIF total work before reading frames", async () => {
    const { createGif } = await import("../src/preload/processor");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "image-batch-gif-work-"));
    const frames = Array.from({ length: 100 }, (_, index) => path.join(dir, `frame-${index}.png`));

    await expect(
      createGif(frames, path.join(dir, "out.gif"), {
        width: 1000,
        height: 1000,
        delayMs: 120,
        loop: 0,
        background: "#ffffff"
      })
    ).rejects.toThrow("GIF 总像素过大");
    expect(rawPipelineReached).not.toHaveBeenCalled();
  });
});

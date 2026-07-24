import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const sharpCalls = vi.hoisted(() => [] as Array<{ input: unknown; options: unknown }>);

vi.mock("sharp", () => {
  const sharpMock = vi.fn((input, options) => {
    sharpCalls.push({ input, options });
    const chain = {
      rotate: vi.fn(() => chain),
      resize: vi.fn(() => chain),
      ensureAlpha: vi.fn(() => chain),
      raw: vi.fn(() => chain),
      toBuffer: vi.fn(async () => Buffer.from([255, 0, 0, 255]))
    };
    return chain;
  });
  return { default: sharpMock };
});

describe("gif source limits", () => {
  it("opens GIF frame sources with input pixel limits", async () => {
    const { createGif } = await import("../src/preload/processor");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "image-batch-gif-source-"));
    const frame = path.join(dir, "frame.png");

    await createGif([frame], path.join(dir, "out.gif"), {
      width: 1,
      height: 1,
      delayMs: 120,
      loop: 0,
      background: "#ffffff"
    });

    expect(sharpCalls.find((call) => call.input === frame)?.options).toMatchObject({
      limitInputPixels: expect.any(Number)
    });
  });
});

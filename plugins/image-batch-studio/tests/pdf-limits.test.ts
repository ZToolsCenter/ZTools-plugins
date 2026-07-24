import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mergePdfs } from "../src/preload/processor";

describe("pdf merge limits", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects oversized PDF batches before reading them", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "image-batch-pdf-limits-"));
    const readFile = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("read should not run"));
    vi.spyOn(fs, "stat").mockResolvedValue({ size: 600 * 1024 * 1024 } as never);

    await expect(mergePdfs([path.join(dir, "huge.pdf")], path.join(dir, "out.pdf"))).rejects.toThrow("PDF 文件过大");
    expect(readFile).not.toHaveBeenCalled();
  });
});

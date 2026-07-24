import { describe, expect, it } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildOutputPath, normalizeExtension } from "../src/preload/paths";

describe("output path helpers", () => {
  it("normalizes jpeg extension to jpg for filenames", () => {
    expect(normalizeExtension("jpeg")).toBe("jpg");
    expect(normalizeExtension("webp")).toBe("webp");
  });

  it("builds collision-resistant output paths from naming patterns", () => {
    const output = buildOutputPath({
      inputPath: "/tmp/Product Hero.PNG",
      outputDirectory: "/tmp/out",
      targetFormat: "webp",
      namingPattern: "{name}-{index}-{width}x{height}.{ext}",
      index: 3,
      width: 1200,
      height: 800,
      existingPaths: new Set([path.join("/tmp/out", "Product Hero-3-1200x800.webp")])
    });

    expect(output).toBe(path.join("/tmp/out", "Product Hero-3-1200x800-1.webp"));
  });

  it("skips existing disk files when overwrite is disabled", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "image-batch-paths-"));
    const existingPath = path.join(dir, "sample.png");
    await fsp.writeFile(existingPath, "existing");

    const output = buildOutputPath({
      inputPath: path.join(dir, "sample.png"),
      outputDirectory: dir,
      targetFormat: "png",
      namingPattern: "{name}.{ext}",
      index: 1,
      overwrite: false
    });

    expect(fs.existsSync(existingPath)).toBe(true);
    expect(output).toBe(path.join(dir, "sample-1.png"));
  });

  it("keeps naming patterns inside the output directory", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "image-batch-paths-"));

    const output = buildOutputPath({
      inputPath: path.join(dir, "sample.png"),
      outputDirectory: dir,
      targetFormat: "png",
      namingPattern: "../nested\\{name}.{ext}",
      index: 1,
      overwrite: false
    });

    expect(path.dirname(output)).toBe(dir);
    expect(path.basename(output)).not.toContain("..");
    expect(path.basename(output)).not.toContain("/");
    expect(path.basename(output)).not.toContain("\\");
  });
});

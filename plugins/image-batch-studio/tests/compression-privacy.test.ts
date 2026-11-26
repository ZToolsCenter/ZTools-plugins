import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { processImages } from "../src/preload/processor";
import { decideCompressionFallback, hasPrivateMetadata } from "../src/preload/compression-fallback";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ibs-privacy-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

/**
 * 低质量、带 EXIF + GPS 的噪点 JPEG：噪点让 q98 重编码的体积远超去掉的 EXIF 字节，
 * 保证稳定命中“同格式压缩结果不小于原图”的回退分支。
 */
async function makeJpegWithGps(filePath: string) {
  const width = 96;
  const height = 96;
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 1234567;
  for (let i = 0; i < pixels.length; i += 1) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    pixels[i] = seed >>> 24;
  }
  await sharp(pixels, { raw: { width, height, channels: 3 } })
    .withExif({
      IFD0: { Artist: "privacy-probe", Copyright: "privacy-probe" },
      IFD3: { GPSLatitudeRef: "N", GPSLongitudeRef: "E" }
    })
    .jpeg({ quality: 60, mozjpeg: true })
    .toFile(filePath);
}

describe("decideCompressionFallback", () => {
  const base = { eligible: true, keepMetadata: false, inputBytes: 100, outputBytes: 120 };

  it("never falls back when the output is smaller", async () => {
    const decision = await decideCompressionFallback({ ...base, outputBytes: 80, sourceHasPrivateMetadata: async () => true });
    expect(decision).toEqual({ useOriginal: false, outputLargerForPrivacy: false });
  });

  it("refuses to fall back to a source that carries private metadata", async () => {
    const decision = await decideCompressionFallback({ ...base, sourceHasPrivateMetadata: async () => true });
    expect(decision).toEqual({ useOriginal: false, outputLargerForPrivacy: true });
  });

  it("treats unreadable metadata as private", async () => {
    const decision = await decideCompressionFallback({
      ...base,
      sourceHasPrivateMetadata: async () => {
        throw new Error("boom");
      }
    });
    expect(decision.useOriginal).toBe(false);
  });

  it("keeps the original when it has no private metadata", async () => {
    const decision = await decideCompressionFallback({ ...base, sourceHasPrivateMetadata: async () => false });
    expect(decision).toEqual({ useOriginal: true, outputLargerForPrivacy: false });
  });

  it("keeps the original when the user asked to keep metadata", async () => {
    let probed = false;
    const decision = await decideCompressionFallback({
      ...base,
      keepMetadata: true,
      sourceHasPrivateMetadata: async () => {
        probed = true;
        return true;
      }
    });
    expect(decision.useOriginal).toBe(true);
    expect(probed).toBe(false);
  });

  it("does nothing for ineligible jobs", async () => {
    const decision = await decideCompressionFallback({ ...base, eligible: false, sourceHasPrivateMetadata: async () => true });
    expect(decision).toEqual({ useOriginal: false, outputLargerForPrivacy: false });
  });
});

describe("hasPrivateMetadata", () => {
  it("detects exif, xmp, iptc and comments", () => {
    expect(hasPrivateMetadata({})).toBe(false);
    expect(hasPrivateMetadata({ exif: Buffer.alloc(0) })).toBe(false);
    expect(hasPrivateMetadata({ exif: Buffer.from([1]) })).toBe(true);
    expect(hasPrivateMetadata({ xmp: Buffer.from([1]) })).toBe(true);
    expect(hasPrivateMetadata({ iptc: Buffer.from([1]) })).toBe(true);
    expect(hasPrivateMetadata({ comments: [{ keyword: "Comment", text: "x" }] })).toBe(true);
  });
});

describe("processImages compression privacy", () => {
  it("strips EXIF/GPS even when re-encoding makes the file larger", async () => {
    const dir = await makeTempDir();
    const input = path.join(dir, "gps.jpg");
    await makeJpegWithGps(input);
    expect((await sharp(input).metadata()).exif?.byteLength ?? 0).toBeGreaterThan(0);

    const [result] = await processImages([input], {
      output: { directory: path.join(dir, "out"), namingPattern: "{name}-comp.{ext}", overwrite: false },
      compression: { quality: 98, keepMetadata: false }
    });

    expect(result.ok, result.error).toBe(true);
    const outputBytes = await fs.readFile(result.outputPath);
    const inputBytes = await fs.readFile(input);
    expect(outputBytes.equals(inputBytes)).toBe(false);
    const outMeta = await sharp(result.outputPath).metadata();
    expect(outMeta.exif).toBeUndefined();
    expect(outputBytes.includes(Buffer.from("privacy-probe"))).toBe(false);
    // 该样本在 quality 98 下重编码必然变大：这里必须真正命中“去元数据但变大”的分支。
    expect(result.outputBytes ?? 0).toBeGreaterThan(result.inputBytes ?? 0);
    expect(result.metadataStrippedLarger).toBe(true);
  });

  it("still falls back to the original when the user keeps metadata", async () => {
    const dir = await makeTempDir();
    const input = path.join(dir, "gps.jpg");
    await makeJpegWithGps(input);

    const [result] = await processImages([input], {
      output: { directory: path.join(dir, "out"), namingPattern: "{name}-keep.{ext}", overwrite: false },
      compression: { quality: 98, keepMetadata: true }
    });

    expect(result.ok, result.error).toBe(true);
    expect(result.outputBytes).toBeLessThanOrEqual(result.inputBytes ?? 0);
    expect(result.metadataStrippedLarger).toBeUndefined();
  });
});

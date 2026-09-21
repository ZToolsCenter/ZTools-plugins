import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { prepareCompatibleImageInput } from "../src/preload/heic-bridge";
import { sharp } from "../src/preload/sharp-runtime";

describe("HEIC bridge fallback for security limits", () => {
  it("converts Apple HEIC with large iref count transparently", async () => {
    const testFile = "/Users/harris/Downloads/IMG_6201.HEIC";
    let exists = false;
    try {
      await fs.access(testFile);
      exists = true;
    } catch {
      exists = false;
    }

    if (!exists) {
      // Skip if fixture not present in current env
      return;
    }

    const { effectivePath } = await prepareCompatibleImageInput(testFile);
    expect(effectivePath).not.toBe(testFile);
    const metadata = await sharp(effectivePath).metadata();
    expect(metadata.width).toBeGreaterThan(0);
    expect(metadata.height).toBeGreaterThan(0);
  });
});

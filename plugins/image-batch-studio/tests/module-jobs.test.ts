import { describe, expect, it } from "vitest";
import {
  buildModuleJobSettings,
  defaultCropForFile,
  isImageProcessingModule
} from "../src/shared/module-jobs";
import type { ImageJobSettings, SourceFile } from "../src/shared/types";

const output = {
  directory: "/tmp/out",
  namingPattern: "{name}-{index}.{ext}",
  overwrite: false
};

function fullSettings(): ImageJobSettings {
  return {
    output,
    format: { type: "webp", quality: 72, keepMetadata: true },
    compression: { quality: 64, keepMetadata: true },
    resize: { mode: "exact", width: 400, height: 300, withoutEnlargement: true },
    crop: { left: 12, top: 8, width: 180, height: 120 },
    rotate: 90,
    flip: "horizontal",
    border: { enabled: false, width: 8, color: "#d7a13a" },
    rounded: { enabled: false, radius: 18, background: "#101715" },
    watermark: {
      enabled: false,
      kind: "text",
      text: "ZTools",
      position: "southeast",
      opacity: 0.72,
      fontSize: 28,
      color: "#ffffff",
      margin: 16,
      rotation: 0
    }
  };
}

describe("module job settings", () => {
  it("keeps compression isolated from format conversion, watermarking, and transforms", () => {
    const job = buildModuleJobSettings("compress", fullSettings());

    expect(job).toEqual({
      output,
      compression: { quality: 64, keepMetadata: true }
    });
  });

  it("keeps format conversion isolated from compression and watermarking", () => {
    const job = buildModuleJobSettings("format", fullSettings());

    expect(job).toEqual({
      output,
      format: { type: "webp", quality: 72, keepMetadata: true }
    });
  });

  it("activates only the selected optional image module", () => {
    expect(buildModuleJobSettings("watermark", fullSettings())).toEqual({
      output,
      watermark: { ...fullSettings().watermark!, enabled: true }
    });
    expect(buildModuleJobSettings("border", fullSettings())).toEqual({
      output,
      border: { ...fullSettings().border!, enabled: true }
    });
    expect(buildModuleJobSettings("round", fullSettings())).toEqual({
      output,
      rounded: { ...fullSettings().rounded!, enabled: true }
    });
  });

  it("keeps crop modules limited to crop settings and falls back to selected image dimensions", () => {
    const file: Pick<SourceFile, "width" | "height"> = { width: 640, height: 480 };
    const settings = { ...fullSettings(), crop: undefined };

    expect(buildModuleJobSettings("crop", settings, file)).toEqual({
      output,
      crop: { left: 0, top: 0, width: 640, height: 480 },
      cropRelative: { left: 0, top: 0, width: 1, height: 1 }
    });
    expect(buildModuleJobSettings("manual", settings, file)).toEqual({
      output,
      crop: { left: 0, top: 0, width: 640, height: 480 },
      cropRelative: { left: 0, top: 0, width: 1, height: 1 }
    });
    expect(defaultCropForFile(file)).toEqual({ left: 0, top: 0, width: 640, height: 480 });
  });

  it("stores crop modules as relative geometry for mixed-size batches", () => {
    const file: Pick<SourceFile, "width" | "height"> = { width: 100, height: 80 };
    const settings = {
      ...fullSettings(),
      crop: { left: 25, top: 20, width: 50, height: 40 }
    };

    expect(buildModuleJobSettings("manual", settings, file)).toEqual({
      output,
      crop: { left: 25, top: 20, width: 50, height: 40 },
      cropRelative: { left: 0.25, top: 0.25, width: 0.5, height: 0.5 }
    });
  });

  it("routes non-image modules away from batch image processing", () => {
    expect(isImageProcessingModule("pdf")).toBe(false);
    expect(isImageProcessingModule("merge")).toBe(false);
    expect(isImageProcessingModule("gif")).toBe(false);
    expect(isImageProcessingModule("compress")).toBe(true);
  });
});

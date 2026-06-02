import { describe, expect, it } from "vitest";
import { mergeImageJobSettings } from "../src/ui/settings";
import type { ImageJobSettings } from "../src/shared/types";

const defaults: ImageJobSettings = {
  output: {
    directory: "/default/out",
    namingPattern: "{name}.{ext}",
    overwrite: false
  },
  format: {
    type: "jpeg",
    quality: 82,
    keepMetadata: true
  },
  resize: {
    mode: "fit",
    width: 1280,
    withoutEnlargement: true
  },
  border: {
    enabled: false,
    width: 12,
    color: "#7dd3fc"
  },
  rounded: {
    enabled: false,
    radius: 24
  },
  watermark: {
    enabled: false,
    kind: "text",
    text: "ZTools",
    position: "southeast",
    opacity: 0.5,
    fontSize: 28,
    color: "#ffffff",
    margin: 24,
    rotation: 0
  },
  compression: {
    quality: 82,
    keepMetadata: true
  }
};

describe("settings persistence", () => {
  it("deep merges partial saved settings with nested defaults", () => {
    const merged = mergeImageJobSettings(defaults, {
      output: {
        directory: "/saved/out"
      },
      format: {
        type: "webp"
      },
      watermark: {
        enabled: true,
        text: "Saved"
      },
      crop: {
        left: 2,
        top: 4,
        width: 32,
        height: 24
      }
    });

    expect(merged.output).toEqual({
      directory: "/saved/out",
      namingPattern: "{name}.{ext}",
      overwrite: false
    });
    expect(merged.format).toEqual({
      type: "webp",
      quality: 82,
      keepMetadata: true
    });
    expect(merged.watermark).toEqual({
      enabled: true,
      kind: "text",
      text: "Saved",
      position: "southeast",
      opacity: 0.5,
      fontSize: 28,
      color: "#ffffff",
      margin: 24,
      rotation: 0
    });
    expect(merged.resize).toEqual(defaults.resize);
    expect(merged.border).toEqual(defaults.border);
    expect(merged.rounded).toEqual(defaults.rounded);
    expect(merged.compression).toEqual(defaults.compression);
    expect(merged.crop).toEqual({
      left: 2,
      top: 4,
      width: 32,
      height: 24
    });
  });
});

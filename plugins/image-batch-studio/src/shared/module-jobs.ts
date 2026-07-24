import type { CropBox, ImageJobSettings, SourceFile } from "./types";
import { cropToRelative } from "./crop-ratio";

export type ModuleId =
  | "compress"
  | "watermark"
  | "format"
  | "resize"
  | "crop"
  | "rotate"
  | "border"
  | "round"
  | "pdf"
  | "merge"
  | "gif"
  | "manual";

const nonImageProcessingModules: ModuleId[] = ["pdf", "merge", "gif"];

export function isImageProcessingModule(moduleId: ModuleId) {
  return !nonImageProcessingModules.includes(moduleId);
}

export function defaultCropForFile(file?: Pick<SourceFile, "width" | "height">): CropBox {
  return {
    left: 0,
    top: 0,
    width: Math.max(1, file?.width ?? 1),
    height: Math.max(1, file?.height ?? 1)
  };
}

export function buildModuleJobSettings(
  moduleId: ModuleId,
  settings: ImageJobSettings,
  selectedFile?: Pick<SourceFile, "width" | "height">
): ImageJobSettings {
  const base: ImageJobSettings = { output: settings.output };

  switch (moduleId) {
    case "compress":
      return settings.compression ? { ...base, compression: settings.compression } : base;
    case "format":
      return settings.format ? { ...base, format: settings.format } : base;
    case "watermark":
      return settings.watermark ? { ...base, watermark: { ...settings.watermark, enabled: true } } : base;
    case "resize":
      return settings.resize ? { ...base, resize: settings.resize } : base;
    case "crop":
    case "manual": {
      const crop = settings.crop ?? defaultCropForFile(selectedFile);
      const cropRelative = cropToRelative(crop, selectedFile);
      return cropRelative ? { ...base, crop, cropRelative } : { ...base, crop };
    }
    case "rotate": {
      const job: ImageJobSettings = { ...base };
      if (settings.rotate !== undefined) job.rotate = settings.rotate;
      if (settings.flip) job.flip = settings.flip;
      return job;
    }
    case "border":
      return settings.border ? { ...base, border: { ...settings.border, enabled: true } } : base;
    case "round":
      return settings.rounded ? { ...base, rounded: { ...settings.rounded, enabled: true } } : base;
    case "pdf":
    case "merge":
    case "gif":
      return base;
  }
}

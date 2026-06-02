import type { ImageJobSettings } from "../shared/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeNested<T extends object>(defaults: T | undefined, saved: unknown): T | undefined {
  if (!isRecord(saved)) return defaults;
  return { ...(defaults ?? {}), ...saved } as T;
}

export function mergeImageJobSettings(defaults: ImageJobSettings, saved: unknown): ImageJobSettings {
  if (!isRecord(saved)) return defaults;

  return {
    ...defaults,
    ...saved,
    output: {
      ...defaults.output,
      ...(isRecord(saved.output) ? saved.output : {})
    },
    format: mergeNested(defaults.format, saved.format),
    resize: mergeNested(defaults.resize, saved.resize),
    crop: mergeNested(defaults.crop, saved.crop),
    border: mergeNested(defaults.border, saved.border),
    rounded: mergeNested(defaults.rounded, saved.rounded),
    watermark: mergeNested(defaults.watermark, saved.watermark),
    compression: mergeNested(defaults.compression, saved.compression)
  };
}

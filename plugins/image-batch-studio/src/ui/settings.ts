import type { ImageFormat, ImageJobSettings, WatermarkPosition } from "../shared/types";

const imageFormats: ImageFormat[] = ["jpeg", "png", "webp", "avif", "heif", "tiff", "gif"];
const resizeModes = ["fit", "cover", "contain", "exact", "long-edge", "short-edge"] as const;
const watermarkKinds = ["text", "image"] as const;
const watermarkPositions: WatermarkPosition[] = [
  "northwest",
  "north",
  "northeast",
  "west",
  "center",
  "east",
  "southwest",
  "south",
  "southeast"
];
const flipModes = ["horizontal", "vertical", "both"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeNested<T extends object>(defaults: T | undefined, saved: unknown): T | undefined {
  if (!isRecord(saved)) return defaults;
  return { ...(defaults ?? {}), ...saved } as T;
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function colorOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?$/.test(value)
    ? value
    : fallback;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function enumOrDefault<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : undefined;
}

function finiteNumberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function finiteOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positiveOptionalNumber(value: unknown): number | undefined {
  const numberValue = finiteOptionalNumber(value);
  return numberValue !== undefined && numberValue > 0 ? numberValue : undefined;
}

function nonNegativeOptionalNumber(value: unknown): number | undefined {
  const numberValue = finiteOptionalNumber(value);
  return numberValue !== undefined && numberValue >= 0 ? numberValue : undefined;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeCrop(value: unknown) {
  if (!isRecord(value)) return undefined;
  const left = finiteOptionalNumber(value.left);
  const top = finiteOptionalNumber(value.top);
  const width = positiveOptionalNumber(value.width);
  const height = positiveOptionalNumber(value.height);
  if (left === undefined || top === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  return { left, top, width, height };
}

function normalizeSettings(settings: ImageJobSettings, defaults: ImageJobSettings): ImageJobSettings {
  const normalized: ImageJobSettings = {
    output: {
      directory: stringOrDefault(settings.output?.directory, defaults.output.directory),
      namingPattern: stringOrDefault(settings.output?.namingPattern, defaults.output.namingPattern),
      overwrite: booleanOrDefault(settings.output?.overwrite, defaults.output.overwrite)
    }
  };

  if (settings.format && defaults.format) {
    normalized.format = {
      type: enumOrDefault(settings.format.type, imageFormats, defaults.format.type),
      quality: finiteOptionalNumber(settings.format.quality) ?? defaults.format.quality,
      effort: finiteOptionalNumber(settings.format.effort) ?? defaults.format.effort,
      lossless: typeof settings.format.lossless === "boolean" ? settings.format.lossless : defaults.format.lossless,
      keepMetadata: typeof settings.format.keepMetadata === "boolean" ? settings.format.keepMetadata : defaults.format.keepMetadata
    };
  }

  if (settings.resize && defaults.resize) {
    const mode = enumValue(settings.resize.mode, resizeModes);
    const savedWidth = nonNegativeOptionalNumber(settings.resize.width);
    const savedHeight = nonNegativeOptionalNumber(settings.resize.height);
    const hasSavedWidth = hasOwn(settings.resize, "width");
    const hasSavedHeight = hasOwn(settings.resize, "height");
    const invalidDimension =
      (hasSavedWidth && settings.resize.width !== undefined && savedWidth === undefined) ||
      (hasSavedHeight && settings.resize.height !== undefined && savedHeight === undefined);

    if (!mode || invalidDimension) {
      normalized.resize = defaults.resize;
    } else {
      const dimensionsWereSaved = hasSavedWidth || hasSavedHeight;
      normalized.resize = {
        mode,
        withoutEnlargement: typeof settings.resize.withoutEnlargement === "boolean" ? settings.resize.withoutEnlargement : defaults.resize.withoutEnlargement
      };
      if (dimensionsWereSaved) {
        if (savedWidth !== undefined) normalized.resize.width = savedWidth;
        if (savedHeight !== undefined) normalized.resize.height = savedHeight;
      } else {
        normalized.resize.width = defaults.resize.width;
        normalized.resize.height = defaults.resize.height;
      }
      const background = typeof settings.resize.background === "string" ? settings.resize.background : defaults.resize.background;
      if (background !== undefined) normalized.resize.background = background;
    }
  }

  normalized.crop = normalizeCrop(settings.crop);
  normalized.cropRelative = normalizeCrop(settings.cropRelative);

  if (settings.border && defaults.border) {
    normalized.border = {
      enabled: booleanOrDefault(settings.border.enabled, defaults.border.enabled),
      width: finiteNumberOrDefault(settings.border.width, defaults.border.width),
      color: colorOrDefault(settings.border.color, defaults.border.color)
    };
  }

  if (settings.rounded && defaults.rounded) {
    normalized.rounded = {
      enabled: booleanOrDefault(settings.rounded.enabled, defaults.rounded.enabled),
      radius: finiteNumberOrDefault(settings.rounded.radius, defaults.rounded.radius),
      background: typeof settings.rounded.background === "string" ? settings.rounded.background : defaults.rounded.background
    };
  }

  if (settings.watermark && defaults.watermark) {
    normalized.watermark = {
      enabled: booleanOrDefault(settings.watermark.enabled, defaults.watermark.enabled),
      kind: enumOrDefault(settings.watermark.kind, watermarkKinds, defaults.watermark.kind),
      text: typeof settings.watermark.text === "string" ? settings.watermark.text : defaults.watermark.text,
      position: enumOrDefault(settings.watermark.position, watermarkPositions, defaults.watermark.position),
      opacity: finiteNumberOrDefault(settings.watermark.opacity, defaults.watermark.opacity),
      fontSize: finiteNumberOrDefault(settings.watermark.fontSize, defaults.watermark.fontSize),
      color: colorOrDefault(settings.watermark.color, defaults.watermark.color),
      margin: finiteNumberOrDefault(settings.watermark.margin, defaults.watermark.margin),
      rotation: finiteNumberOrDefault(settings.watermark.rotation, defaults.watermark.rotation)
    };
    if (typeof settings.watermark.imagePath === "string") {
      normalized.watermark.imagePath = settings.watermark.imagePath;
    } else if (defaults.watermark.imagePath) {
      normalized.watermark.imagePath = defaults.watermark.imagePath;
    }
  }

  if (settings.compression && defaults.compression) {
    normalized.compression = {
      quality: finiteOptionalNumber(settings.compression.quality) ?? defaults.compression.quality,
      keepMetadata: typeof settings.compression.keepMetadata === "boolean" ? settings.compression.keepMetadata : defaults.compression.keepMetadata
    };
  }

  normalized.rotate = finiteOptionalNumber(settings.rotate) ?? defaults.rotate;
  normalized.flip = enumValue(settings.flip, flipModes);
  if (!normalized.flip) delete normalized.flip;

  return normalized;
}

export function mergeImageJobSettings(defaults: ImageJobSettings, saved: unknown): ImageJobSettings {
  if (!isRecord(saved)) return defaults;

  const merged = {
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
  return normalizeSettings(merged, defaults);
}

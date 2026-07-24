import type { CropBox, ImageJobSettings } from "../shared/types";
import { clampCropToSize, cropFromRelative } from "../shared/crop-ratio";
import { assertSafeProcessOutput, assertSafeProcessSource } from "./processing-limits";

interface Dimensions {
  width: number;
  height: number;
}

function dimensionsFromMetadata(width: number | undefined, height: number | undefined): Dimensions | undefined {
  if (!width || !height) return undefined;
  return { width, height };
}

function normalizedQuarterTurn(value: number | undefined): number {
  const degrees = Number.isFinite(value) ? Math.round(value as number) : 0;
  return ((degrees % 360) + 360) % 360;
}

function dimensionsAfterRotate(dimensions: Dimensions, rotate: number | undefined): Dimensions {
  const degrees = normalizedQuarterTurn(rotate);
  return degrees === 90 || degrees === 270
    ? { width: dimensions.height, height: dimensions.width }
    : dimensions;
}

function scaledDimensions(dimensions: Dimensions, scale: number): Dimensions {
  return {
    width: Math.max(1, Math.round(dimensions.width * scale)),
    height: Math.max(1, Math.round(dimensions.height * scale))
  };
}

function dimensionsAfterResize(dimensions: Dimensions, settings: ImageJobSettings): Dimensions {
  const resize = settings.resize;
  if (!resize?.width && !resize?.height) return dimensions;

  const width = resize.width;
  const height = resize.height;
  const withoutEnlargement = resize.withoutEnlargement ?? true;

  if (resize.mode === "exact") {
    return {
      width: Math.max(1, Math.round(width ?? dimensions.width)),
      height: Math.max(1, Math.round(height ?? dimensions.height))
    };
  }

  if (resize.mode === "long-edge" || resize.mode === "short-edge") {
    const target = width ?? height;
    if (!target) return dimensions;
    const sourceEdge =
      resize.mode === "long-edge"
        ? Math.max(dimensions.width, dimensions.height)
        : Math.min(dimensions.width, dimensions.height);
    const scale = withoutEnlargement ? Math.min(1, target / sourceEdge) : target / sourceEdge;
    return scaledDimensions(dimensions, scale);
  }

  if ((resize.mode === "cover" || resize.mode === "contain") && width && height) {
    return { width, height };
  }

  const widthScale = width ? width / dimensions.width : undefined;
  const heightScale = height ? height / dimensions.height : undefined;
  let scale = Math.min(widthScale ?? Number.POSITIVE_INFINITY, heightScale ?? Number.POSITIVE_INFINITY);
  if (scale === Number.POSITIVE_INFINITY) return dimensions;
  if (withoutEnlargement) scale = Math.min(1, scale);
  return scaledDimensions(dimensions, scale);
}

export function resolveCropBox(settings: ImageJobSettings, size: { width?: number; height?: number }): CropBox | undefined {
  if (settings.cropRelative) {
    return cropFromRelative(settings.cropRelative, size);
  }
  if (settings.crop) {
    return clampCropToSize(settings.crop, size);
  }
  return undefined;
}

export function estimatePreCropDimensions(settings: ImageJobSettings, source: Dimensions): Dimensions {
  let dimensions = dimensionsAfterRotate(source, settings.rotate);
  return dimensionsAfterResize(dimensions, settings);
}

function estimateProcessDimensions(settings: ImageJobSettings, source: Dimensions): Dimensions {
  let dimensions = estimatePreCropDimensions(settings, source);
  const crop = resolveCropBox(settings, dimensions);
  if (crop) {
    dimensions = { width: crop.width, height: crop.height };
  }
  if (settings.border?.enabled && settings.border.width > 0) {
    const borderWidth = Math.max(0, Math.round(settings.border.width));
    dimensions = {
      width: dimensions.width + borderWidth * 2,
      height: dimensions.height + borderWidth * 2
    };
  }
  return dimensions;
}

export function resolveProcessCropBox(settings: ImageJobSettings, width: number | undefined, height: number | undefined): CropBox | undefined {
  const source = dimensionsFromMetadata(width, height);
  if (!source) return resolveCropBox(settings, { width, height });
  return resolveCropBox(settings, estimatePreCropDimensions(settings, source));
}

export function assertSafeProcessPlan(settings: ImageJobSettings, width: number | undefined, height: number | undefined): void {
  assertSafeProcessSource(width, height);
  const source = dimensionsFromMetadata(width, height);
  if (!source) return;
  const estimated = estimateProcessDimensions(settings, source);
  assertSafeProcessOutput(estimated.width, estimated.height);
}

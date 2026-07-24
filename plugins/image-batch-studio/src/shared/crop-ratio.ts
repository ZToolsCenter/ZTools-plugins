import type { CropBox, RelativeCropBox } from "./types";

interface SizeLike {
  width?: number;
  height?: number;
}

function validSize(size?: SizeLike): { width: number; height: number } | undefined {
  if (!size?.width || !size.height || size.width < 1 || size.height < 1) return undefined;
  return { width: size.width, height: size.height };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function ratio(value: number): number {
  return Number(value.toFixed(6));
}

export function cropToRelative(crop: CropBox, size?: SizeLike): RelativeCropBox | undefined {
  const valid = validSize(size);
  if (!valid) return undefined;
  const left = clamp(crop.left / valid.width, 0, 1);
  const top = clamp(crop.top / valid.height, 0, 1);
  const width = clamp(crop.width / valid.width, 0, 1 - left);
  const height = clamp(crop.height / valid.height, 0, 1 - top);
  return {
    left: ratio(left),
    top: ratio(top),
    width: ratio(width),
    height: ratio(height)
  };
}

export function cropFromRelative(crop: RelativeCropBox, size?: SizeLike): CropBox | undefined {
  const valid = validSize(size);
  if (!valid) return undefined;
  const left = clamp(Math.round(crop.left * valid.width), 0, valid.width - 1);
  const top = clamp(Math.round(crop.top * valid.height), 0, valid.height - 1);
  const right = clamp(Math.round((crop.left + crop.width) * valid.width), left + 1, valid.width);
  const bottom = clamp(Math.round((crop.top + crop.height) * valid.height), top + 1, valid.height);
  return {
    left,
    top,
    width: right - left,
    height: bottom - top
  };
}

export function clampCropToSize(crop: CropBox, size?: SizeLike): CropBox {
  const valid = validSize(size);
  if (!valid) {
    return {
      left: Math.max(0, Math.round(crop.left)),
      top: Math.max(0, Math.round(crop.top)),
      width: Math.max(1, Math.round(crop.width)),
      height: Math.max(1, Math.round(crop.height))
    };
  }

  const left = clamp(Math.round(crop.left), 0, valid.width - 1);
  const top = clamp(Math.round(crop.top), 0, valid.height - 1);
  const right = clamp(Math.round(crop.left + crop.width), left + 1, valid.width);
  const bottom = clamp(Math.round(crop.top + crop.height), top + 1, valid.height);
  return {
    left,
    top,
    width: right - left,
    height: bottom - top
  };
}

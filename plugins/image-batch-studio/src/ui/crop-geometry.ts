import type { CropBox } from "../shared/types";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

function safeSize(size: Size): Size {
  return {
    width: Math.max(1, size.width || 1),
    height: Math.max(1, size.height || 1)
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function px(value: number) {
  const rounded = Number(value.toFixed(3));
  return `${rounded}px`;
}

export function containedImageRect(frame: Rect, natural: Size): Rect {
  const safeNatural = safeSize(natural);
  const frameWidth = Math.max(0, frame.width);
  const frameHeight = Math.max(0, frame.height);
  if (frameWidth === 0 || frameHeight === 0) {
    return { left: frame.left, top: frame.top, width: 0, height: 0 };
  }

  const scale = Math.min(frameWidth / safeNatural.width, frameHeight / safeNatural.height);
  const width = safeNatural.width * scale;
  const height = safeNatural.height * scale;
  return {
    left: frame.left + (frameWidth - width) / 2,
    top: frame.top + (frameHeight - height) / 2,
    width,
    height
  };
}

export function pointToImageCoordinates(point: Point, imageRect: Rect, natural: Size): Point {
  const safeNatural = safeSize(natural);
  const width = Math.max(1, imageRect.width);
  const height = Math.max(1, imageRect.height);
  const x = clamp(point.x - imageRect.left, 0, width);
  const y = clamp(point.y - imageRect.top, 0, height);
  return {
    x: Math.round((x / width) * safeNatural.width),
    y: Math.round((y / height) * safeNatural.height)
  };
}

export function cropFromDragPoints(start: Point, current: Point, natural: Size): CropBox {
  const safeNatural = safeSize(natural);
  const left = clamp(Math.min(start.x, current.x), 0, safeNatural.width);
  const top = clamp(Math.min(start.y, current.y), 0, safeNatural.height);
  const right = clamp(Math.max(start.x, current.x), 0, safeNatural.width);
  const bottom = clamp(Math.max(start.y, current.y), 0, safeNatural.height);

  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  return {
    left: Math.min(left, safeNatural.width - 1),
    top: Math.min(top, safeNatural.height - 1),
    width: Math.min(width, safeNatural.width - Math.min(left, safeNatural.width - 1)),
    height: Math.min(height, safeNatural.height - Math.min(top, safeNatural.height - 1))
  };
}

export function cropBoxStyle(crop: CropBox, stageRect: Rect, imageRect: Rect, natural: Size) {
  const safeNatural = safeSize(natural);
  const safeCrop = cropFromDragPoints(
    { x: crop.left, y: crop.top },
    { x: crop.left + crop.width, y: crop.top + crop.height },
    safeNatural
  );
  return {
    left: px(imageRect.left - stageRect.left + (safeCrop.left / safeNatural.width) * imageRect.width),
    top: px(imageRect.top - stageRect.top + (safeCrop.top / safeNatural.height) * imageRect.height),
    width: px((safeCrop.width / safeNatural.width) * imageRect.width),
    height: px((safeCrop.height / safeNatural.height) * imageRect.height)
  };
}

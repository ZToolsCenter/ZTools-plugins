export type Point = {
  x: number;
  y: number;
};

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const MIN_SELECTION_SIZE = 8;
const MIN_SCALE = 0.3;
const MAX_SCALE = 3;
const SCALE_STEP = 0.1;

const round = (value: number) => Math.round(value * 100) / 100;

export function normalizeRect(start: Point, end: Point): Rect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);

  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function isValidSelection(rect: Rect): boolean {
  return rect.width >= MIN_SELECTION_SIZE && rect.height >= MIN_SELECTION_SIZE;
}

export function outerBoundsForImage(imageBounds: Rect, frameSize: number): Rect {
  return {
    x: Math.round(imageBounds.x - frameSize),
    y: Math.round(imageBounds.y - frameSize),
    width: Math.round(imageBounds.width + frameSize * 2),
    height: Math.round(imageBounds.height + frameSize * 2),
  };
}

export function imageBoundsForScale(currentImageBounds: Rect, nextScale: number): Rect {
  const centerX = currentImageBounds.x + currentImageBounds.width / 2;
  const centerY = currentImageBounds.y + currentImageBounds.height / 2;
  const width = round(currentImageBounds.width * nextScale);
  const height = round(currentImageBounds.height * nextScale);

  return {
    x: round(centerX - width / 2),
    y: round(centerY - height / 2),
    width,
    height,
  };
}

export function clampScale(scale: number): number {
  return round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)));
}

export function scaleFromWheelDelta(currentScale: number, deltaY: number): number {
  const direction = deltaY < 0 ? 1 : -1;
  return clampScale(currentScale + direction * SCALE_STEP);
}

export function rectCenter(rect: Rect): Point {
  return {
    x: round(rect.x + rect.width / 2),
    y: round(rect.y + rect.height / 2),
  };
}

export function imageBoundsForOriginalSize(center: Point, originalSize: Pick<Rect, 'width' | 'height'>, scale: number): Rect {
  const width = round(originalSize.width * scale);
  const height = round(originalSize.height * scale);

  return {
    x: round(center.x - width / 2),
    y: round(center.y - height / 2),
    width,
    height,
  };
}

export function translateRect(rect: Rect, deltaX: number, deltaY: number): Rect {
  return {
    x: round(rect.x + deltaX),
    y: round(rect.y + deltaY),
    width: rect.width,
    height: rect.height,
  };
}

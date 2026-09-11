/** Artifact 图形缩放范围：相对适配比例，允许缩到 25%。 */

export const ARTIFACT_MAX_ZOOM_FACTOR = 5;
export const ARTIFACT_MIN_ZOOM_FACTOR = 0.25;
export const ARTIFACT_ABSOLUTE_MIN_SCALE = 0.08;
const FIT_PADDING = 24;
const FIT_HEIGHT_FLOOR = 0.55;

export function getArtifactScaleRange(fitScale: number) {
  const fit = fitScale > 0 && Number.isFinite(fitScale) ? fitScale : 1;
  return {
    minScale: Math.max(ARTIFACT_ABSOLUTE_MIN_SCALE, fit * ARTIFACT_MIN_ZOOM_FACTOR),
    maxScale: fit * ARTIFACT_MAX_ZOOM_FACTOR,
  };
}

export function readEditorScale(value: string): number {
  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function computeArtifactFitScale(args: {
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;
  contentHeight: number;
}): number {
  const widthFit = (args.viewportWidth - FIT_PADDING) / args.contentWidth;
  const heightFit = (args.viewportHeight - FIT_PADDING) / args.contentHeight;
  let nextFit = Math.min(1, widthFit);
  if (heightFit < nextFit) {
    nextFit = Math.max(FIT_HEIGHT_FLOOR, Math.min(nextFit, heightFit));
  }
  return Number.isFinite(nextFit) && nextFit > 0 ? nextFit : 1;
}

/**
 * 消息区用 CSS zoom，Cmd+= 后视口 clientWidth 仍按 --editor-scale 反比变小（视觉尺寸不变）。
 * 此时若强制重新适配，图会被缩回去，放大等于没发生，所以只在视口变大时才重新铺满。
 */
export function shouldSnapToFitOnResize(args: {
  currentScale: number;
  previousFit: number;
  nextFit: number;
}): boolean {
  const atFit = Math.abs(args.currentScale - args.previousFit) <= 0.001;
  if (!atFit) return false;
  return args.nextFit >= args.previousFit - 0.001;
}

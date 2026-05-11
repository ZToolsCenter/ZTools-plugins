export function getManualCropDisplaySize(width, height, angle = 0) {
  const sourceWidth = Math.max(1, Number(width) || 1)
  const sourceHeight = Math.max(1, Number(height) || 1)
  const normalizedAngle = Math.abs(Number(angle) || 0) % 180
  return normalizedAngle === 90
    ? { width: sourceHeight, height: sourceWidth }
    : { width: sourceWidth, height: sourceHeight }
}

export function getManualCropStageMetrics(options = {}) {
  const {
    sourceWidth = 1,
    sourceHeight = 1,
    angle = 0,
    stageWidth = 1600,
    stageHeight = 900,
    viewScale = 1,
    viewOffsetX = 0,
    viewOffsetY = 0,
  } = options
  const display = getManualCropDisplaySize(sourceWidth, sourceHeight, angle)
  const safeStageWidth = Math.max(320, Number(stageWidth) || 1600)
  const safeStageHeight = Math.max(240, Number(stageHeight) || 900)
  const safeViewScale = Math.max(0.5, Number(viewScale) || 1)
  const baseScale = Math.min(
    Math.max(1, safeStageWidth) / Math.max(1, display.width || 1),
    Math.max(1, safeStageHeight) / Math.max(1, display.height || 1),
  )
  const imageWidth = Math.max(1, Math.round(display.width * baseScale * safeViewScale))
  const imageHeight = Math.max(1, Math.round(display.height * baseScale * safeViewScale))
  return {
    width: safeStageWidth,
    height: safeStageHeight,
    imageX: Math.round((safeStageWidth - imageWidth) / 2 + (Number(viewOffsetX) || 0)),
    imageY: Math.round((safeStageHeight - imageHeight) / 2 + (Number(viewOffsetY) || 0)),
    imageWidth,
    imageHeight,
    sourceWidth: Math.max(1, display.width || 1),
    sourceHeight: Math.max(1, display.height || 1),
    baseScale,
    viewScale: safeViewScale,
  }
}

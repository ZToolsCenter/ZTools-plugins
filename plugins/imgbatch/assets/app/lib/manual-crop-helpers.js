import { getManualCropDisplaySize as computeManualCropDisplaySize, getManualCropStageMetrics as computeManualCropStageMetrics } from './manual-crop-stage.js'

export function findNextManualCropIndex(config, assets, startIndex) {
  if (!assets.length) return 0
  const handled = new Set(config.completedIds || [])
  for (let index = startIndex; index < assets.length; index += 1) {
    if (!handled.has(assets[index].id)) return index
  }
  for (let index = 0; index < startIndex; index += 1) {
    if (!handled.has(assets[index].id)) return index
  }
  return Math.min(startIndex, assets.length - 1)
}

export function getManualCropAssetState(asset, config) {
  const saved = asset?.id ? config?.cropAreas?.[asset.id] : null
  return {
    angle: Number(saved?.angle ?? config?.angle ?? 0) || 0,
    flipHorizontal: Boolean(saved?.flipHorizontal ?? config?.flipHorizontal),
    flipVertical: Boolean(saved?.flipVertical ?? config?.flipVertical),
    viewScale: Math.max(0.5, Math.min(3, Number(saved?.viewScale ?? config?.viewScale ?? 1) || 1)),
    viewOffsetX: Math.round(Number(saved?.viewOffsetX ?? config?.viewOffsetX ?? 0) || 0),
    viewOffsetY: Math.round(Number(saved?.viewOffsetY ?? config?.viewOffsetY ?? 0) || 0),
  }
}

export function getManualCropDisplaySize(asset, config) {
  const currentTransform = getManualCropAssetState(asset, config)
  return computeManualCropDisplaySize(asset?.width, asset?.height, currentTransform.angle)
}

export function getManualCropStageMetrics(asset, config) {
  const stageWidth = Math.max(320, Number(config.stageWidth) || 1600)
  const stageHeight = Math.max(240, Number(config.stageHeight) || 900)
  const currentState = getManualCropAssetState(asset, config)
  return computeManualCropStageMetrics({
    sourceWidth: asset?.width,
    sourceHeight: asset?.height,
    angle: currentState.angle,
    stageWidth,
    stageHeight,
    viewScale: currentState.viewScale,
    viewOffsetX: currentState.viewOffsetX,
    viewOffsetY: currentState.viewOffsetY,
  })
}

export function getManualCropSelection(state) {
  const config = state.configs['manual-crop']
  const currentIndex = Math.max(0, Number(config.currentIndex) || 0)
  return {
    config,
    currentIndex,
    asset: state.assets[currentIndex] || null,
  }
}

export function getManualCropSnapThreshold(asset, config, stage = getManualCropStageMetrics(asset, config)) {
  const ratioByStrength = {
    'very-low': 0.001,
    low: 0.005,
    medium: 0.01,
    high: 0.015,
    'very-high': 0.02,
  }
  const ratio = ratioByStrength[config?.snapStrength] ?? ratioByStrength['very-low']
  return Math.max(2, Math.round(Math.min(stage.width, stage.height) * ratio))
}

export function clampManualCropArea(area, asset, config, stage = getManualCropStageMetrics(asset, config)) {
  const assetWidth = Math.max(1, stage.width || 1)
  const assetHeight = Math.max(1, stage.height || 1)
  const width = Math.min(assetWidth, Math.max(40, Math.round(area.width)))
  const height = Math.min(assetHeight, Math.max(40, Math.round(area.height)))
  const x = Math.max(0, Math.min(assetWidth - width, Math.round(area.x)))
  const y = Math.max(0, Math.min(assetHeight - height, Math.round(area.y)))
  return { x, y, width, height }
}

export function applyManualCropSnap(area, asset, config, mode = 'move', handle = '', stage = getManualCropStageMetrics(asset, config)) {
  if (!config?.snapEnabled) return area
  const threshold = getManualCropSnapThreshold(asset, config, stage)
  const imageLeft = stage.imageX
  const imageTop = stage.imageY
  const imageRight = stage.imageX + stage.imageWidth
  const imageBottom = stage.imageY + stage.imageHeight
  const next = { ...area }
  const affectsLeft = mode === 'move' || handle.includes('l')
  const affectsRight = mode === 'move' || handle.includes('r')
  const affectsTop = mode === 'move' || handle.includes('t')
  const affectsBottom = mode === 'move' || handle.includes('b')
  const left = next.x
  const right = next.x + next.width
  const top = next.y
  const bottom = next.y + next.height

  if (mode === 'move') {
    if (Math.abs(left - imageLeft) <= threshold) next.x = imageLeft
    else if (Math.abs(right - imageRight) <= threshold) next.x = imageRight - next.width
    if (Math.abs(top - imageTop) <= threshold) next.y = imageTop
    else if (Math.abs(bottom - imageBottom) <= threshold) next.y = imageBottom - next.height
    return next
  }

  if (affectsLeft && Math.abs(left - imageLeft) <= threshold) {
    next.width += next.x - imageLeft
    next.x = imageLeft
  }
  if (affectsRight && Math.abs((next.x + next.width) - imageRight) <= threshold) {
    next.width = imageRight - next.x
  }
  if (affectsTop && Math.abs(top - imageTop) <= threshold) {
    next.height += next.y - imageTop
    next.y = imageTop
  }
  if (affectsBottom && Math.abs((next.y + next.height) - imageBottom) <= threshold) {
    next.height = imageBottom - next.y
  }
  return next
}

export function getInheritedManualCropArea(asset, config) {
  const seed = config?.lastCompletedCropSeed
  if (!seed) return null
  if (String(seed.ratioValue || '') !== String(config?.ratioValue || '16:9')) return null
  const { width: assetWidth, height: assetHeight } = getManualCropStageMetrics(asset, config)
  if (seed?.area && (seed.assetWidth || 0) === assetWidth && (seed.assetHeight || 0) === assetHeight) {
    return { ...seed.area }
  }
  if (!seed?.normalizedArea) return null
  const referenceSize = Math.max(1, Math.min(assetWidth, assetHeight))
  const ratio = Math.max(1 / 1000, Number(seed.normalizedArea.ratio) || 1)
  const width = Math.max(40, Math.round(Number(seed.normalizedArea.scale || 0) * referenceSize))
  const height = Math.max(40, Math.round(width / ratio))
  const centerX = Math.round(Number(seed.normalizedArea.centerX || 0.5) * assetWidth)
  const centerY = Math.round(Number(seed.normalizedArea.centerY || 0.5) * assetHeight)
  return clampManualCropArea({
    x: Math.round(centerX - width / 2),
    y: Math.round(centerY - height / 2),
    width,
    height,
  }, asset, config)
}

export function createDefaultManualCropArea(asset, ratioValue, config = {}) {
  const stage = getManualCropStageMetrics(asset, config)
  const width = Math.max(1, stage.imageWidth || 1)
  const height = Math.max(1, stage.imageHeight || 1)
  const [ratioX, ratioY] = String(ratioValue || '16:9').split(':').map((item) => Number(item) || 1)
  const targetRatio = ratioX / ratioY
  let cropWidth = width
  let cropHeight = Math.round(cropWidth / targetRatio)
  if (cropHeight > height) {
    cropHeight = height
    cropWidth = Math.round(cropHeight * targetRatio)
  }
  return {
    x: Math.round(stage.imageX + (width - cropWidth) / 2),
    y: Math.round(stage.imageY + (height - cropHeight) / 2),
    width: cropWidth,
    height: cropHeight,
  }
}

export function getManualCropArea(asset, config) {
  return (config.cropAreas && config.cropAreas[asset.id])
    || getInheritedManualCropArea(asset, config)
    || createDefaultManualCropArea(asset, config.ratioValue || '16:9', config)
}

export function createManualCropSeed(asset, config, area) {
  const stage = getManualCropStageMetrics(asset, config)
  const assetWidth = Math.max(1, stage.width || 1)
  const assetHeight = Math.max(1, stage.height || 1)
  const referenceSize = Math.max(1, Math.min(assetWidth, assetHeight))
  return {
    assetWidth,
    assetHeight,
    ratioValue: config.ratioValue || '16:9',
    area,
    normalizedArea: {
      centerX: (area.x + area.width / 2) / assetWidth,
      centerY: (area.y + area.height / 2) / assetHeight,
      scale: area.width / referenceSize,
      ratio: area.width / Math.max(1, area.height),
    },
  }
}

export function ensureManualCropAreaForAsset(nextAsset, config, seedAsset = null) {
  if (!nextAsset) return config.cropAreas || {}
  const cropAreas = { ...(config.cropAreas || {}) }
  if (cropAreas[nextAsset.id]) return cropAreas
  const seedArea = seedAsset ? getManualCropArea(seedAsset, config) : null
  cropAreas[nextAsset.id] = getInheritedManualCropArea(nextAsset, {
    ...config,
    lastCompletedCropSeed: seedAsset && seedArea ? createManualCropSeed(seedAsset, config, seedArea) : config.lastCompletedCropSeed,
  }) || cropAreas[nextAsset.id]
  return cropAreas
}

export function mergeManualCropAreaPatch(config, assetId, areaPatch) {
  return {
    cropAreas: {
      ...(config.cropAreas || {}),
      [assetId]: {
        ...((config.cropAreas || {})[assetId] || {}),
        ...areaPatch,
      },
    },
  }
}

export function moveManualCropArea(context, event, asset, config, stage = getManualCropStageMetrics(asset, config)) {
  const dx = ((event.clientX - context.startX) / Math.max(1, context.stageRect.width)) * stage.width
  const dy = ((event.clientY - context.startY) / Math.max(1, context.stageRect.height)) * stage.height
  let area = {
    ...context.area,
    x: Math.round(context.area.x + dx),
    y: Math.round(context.area.y + dy),
  }
  area = applyManualCropSnap(area, asset, config, 'move', '', stage)
  return clampManualCropArea(area, asset, config, stage)
}

export function resizeManualCropArea(context, event, asset, config, stage = getManualCropStageMetrics(asset, config)) {
  const dx = ((event.clientX - context.startX) / Math.max(1, context.stageRect.width)) * stage.width
  const dy = ((event.clientY - context.startY) / Math.max(1, context.stageRect.height)) * stage.height
  const start = context.area
  const left = start.x
  const top = start.y
  const right = start.x + start.width
  const bottom = start.y + start.height
  const handle = context.handle

  let width = start.width
  let height = start.height
  let x = start.x
  let y = start.y
  let lockedRatio = null

  if (handle === 'ml' || handle === 'mr') {
    const desiredWidth = handle === 'ml' ? right - (left + dx) : start.width + dx
    const maxWidth = handle === 'ml' ? right : Math.max(40, stage.width - left)
    width = Math.max(40, Math.min(desiredWidth, maxWidth))
    height = start.height
    x = handle === 'ml' ? right - width : left
    y = top
  } else if (handle === 'tm' || handle === 'bm') {
    const desiredHeight = handle === 'tm' ? bottom - (top + dy) : start.height + dy
    const maxHeight = handle === 'tm' ? bottom : Math.max(40, stage.height - top)
    height = Math.max(40, Math.min(desiredHeight, maxHeight))
    width = start.width
    y = handle === 'tm' ? bottom - height : top
    x = left
  } else {
    const desiredWidth = handle.includes('l') ? right - (left + dx) : start.width + dx
    const desiredHeight = handle.includes('t') ? bottom - (top + dy) : start.height + dy
    const maxWidth = handle.includes('l') ? right : Math.max(40, stage.width - left)
    const maxHeight = handle.includes('t') ? bottom : Math.max(40, stage.height - top)
    width = Math.max(40, Math.min(desiredWidth, maxWidth))
    height = Math.max(40, Math.min(desiredHeight, maxHeight))
    if (config?.lockAspectRatio) {
      const ratio = start.width / Math.max(1, start.height)
      lockedRatio = ratio
      const widthBase = Math.max(1, start.width)
      const heightBase = Math.max(1, start.height)
      const outwardDx = handle.includes('l') ? -dx : dx
      const outwardDy = handle.includes('t') ? -dy : dy
      const scaleX = 1 + outwardDx / widthBase
      const scaleY = 1 + outwardDy / heightBase
      const weightX = Math.abs(outwardDx)
      const weightY = Math.abs(outwardDy)
      let scale = 1
      if (weightX > 0 || weightY > 0) {
        scale = (scaleX * weightX + scaleY * weightY) / Math.max(1, weightX + weightY)
      }
      const minScale = 40 / Math.max(1, start.width)
      const maxScale = Math.min(
        maxWidth / Math.max(1, start.width),
        maxHeight / Math.max(1, start.height),
      )
      scale = Math.max(minScale, Math.min(scale, maxScale))
      width = Math.max(40, Math.round(start.width * scale))
      height = Math.max(40, Math.round(width / ratio))
      if (height > maxHeight) {
        height = Math.max(40, Math.min(maxHeight, height))
        width = Math.max(40, Math.round(height * ratio))
      }
    }
    x = handle.includes('l') ? right - width : left
    y = handle.includes('t') ? bottom - height : top
  }

  let nextArea = applyManualCropSnap(
    { x, y, width, height },
    asset,
    config,
    'resize',
    handle,
    stage,
  )
  if (
    config?.lockAspectRatio
    && lockedRatio
    && handle.includes('l')
    && (handle.includes('t') || handle.includes('b'))
  ) {
    const anchorX = handle.includes('l') ? right : left
    const anchorY = handle.includes('t') ? bottom : top
    const horizontalChanged = nextArea.x !== x || nextArea.width !== width
    const verticalChanged = nextArea.y !== y || nextArea.height !== height
    if (horizontalChanged && !verticalChanged) {
      const snappedHeight = Math.max(40, Math.round(nextArea.width / lockedRatio))
      nextArea = {
        ...nextArea,
        height: snappedHeight,
        y: handle.includes('t') ? anchorY - snappedHeight : anchorY,
      }
    } else if (verticalChanged && !horizontalChanged) {
      const snappedWidth = Math.max(40, Math.round(nextArea.height * lockedRatio))
      nextArea = {
        ...nextArea,
        width: snappedWidth,
        x: handle.includes('l') ? anchorX - snappedWidth : anchorX,
      }
    } else if (horizontalChanged && verticalChanged) {
      const scaleByWidth = nextArea.width / Math.max(1, start.width)
      const scaleByHeight = nextArea.height / Math.max(1, start.height)
      const scale = Math.min(scaleByWidth, scaleByHeight)
      const snappedWidth = Math.max(40, Math.round(start.width * scale))
      const snappedHeight = Math.max(40, Math.round(start.height * scale))
      nextArea = {
        x: handle.includes('l') ? anchorX - snappedWidth : anchorX,
        y: handle.includes('t') ? anchorY - snappedHeight : anchorY,
        width: snappedWidth,
        height: snappedHeight,
      }
    }
  }
  return clampManualCropArea(nextArea, asset, config, stage)
}

export function patchCurrentManualCropArea(config, asset, patch) {
  if (!asset) return patch
  const area = getManualCropArea(asset, config)
  const currentTransform = getManualCropAssetState(asset, config)
  const nextAngle = Number(patch.angle ?? currentTransform.angle ?? 0) || 0
  const nextFlipHorizontal = Boolean(patch.flipHorizontal ?? currentTransform.flipHorizontal)
  const nextFlipVertical = Boolean(patch.flipVertical ?? currentTransform.flipVertical)
  const nextViewScale = Math.max(0.5, Math.min(3, Number(patch.viewScale ?? currentTransform.viewScale ?? 1) || 1))
  const nextViewOffsetX = Math.round(Number(patch.viewOffsetX ?? currentTransform.viewOffsetX ?? 0) || 0)
  const nextViewOffsetY = Math.round(Number(patch.viewOffsetY ?? currentTransform.viewOffsetY ?? 0) || 0)
  const nextConfig = {
    ...config,
    angle: nextAngle,
    flipHorizontal: nextFlipHorizontal,
    flipVertical: nextFlipVertical,
    viewScale: nextViewScale,
    viewOffsetX: nextViewOffsetX,
    viewOffsetY: nextViewOffsetY,
  }
  const transformedArea = clampManualCropArea(area, asset, nextConfig)
  return {
    ...patch,
    angle: nextAngle,
    flipHorizontal: nextFlipHorizontal,
    flipVertical: nextFlipVertical,
    viewScale: nextViewScale,
    viewOffsetX: nextViewOffsetX,
    viewOffsetY: nextViewOffsetY,
    cropAreas: {
      ...(config.cropAreas || {}),
      [asset.id]: {
        ...transformedArea,
        angle: nextAngle,
        flipHorizontal: nextFlipHorizontal,
        flipVertical: nextFlipVertical,
        viewScale: nextViewScale,
        viewOffsetX: nextViewOffsetX,
        viewOffsetY: nextViewOffsetY,
      },
    },
  }
}

export function getManualCropGlobalTransformPatch(asset, config) {
  const saved = asset?.id ? config?.cropAreas?.[asset.id] : null
  return {
    angle: Number(saved?.angle ?? 0) || 0,
    flipHorizontal: Boolean(saved?.flipHorizontal),
    flipVertical: Boolean(saved?.flipVertical),
    viewScale: Math.max(0.5, Math.min(3, Number(saved?.viewScale ?? 1) || 1)),
    viewOffsetX: Math.round(Number(saved?.viewOffsetX ?? 0) || 0),
    viewOffsetY: Math.round(Number(saved?.viewOffsetY ?? 0) || 0),
  }
}

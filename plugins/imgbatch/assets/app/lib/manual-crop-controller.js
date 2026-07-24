import {
  createDefaultManualCropArea,
  ensureManualCropAreaForAsset,
  getManualCropArea,
  getManualCropAssetState,
  getManualCropGlobalTransformPatch,
  getManualCropSelection,
  mergeManualCropAreaPatch,
  clampManualCropArea,
  patchCurrentManualCropArea,
  moveManualCropArea,
  resizeManualCropArea,
} from './manual-crop-helpers.js'

const SNAP_STRENGTH_VALUES = new Set(['very-low', 'low', 'medium', 'high', 'very-high'])
let manualCropDragContext = null
let manualCropPanContext = null

function setManualCropDragHandleState(active) {
  if (typeof document === 'undefined' || !document.body) return
  document.body.classList.toggle('manual-crop--dragging-handle', Boolean(active))
}

export async function handleManualCropAction(action, target, deps) {
  const {
    advanceManualCropAfterSuccess,
    applyRunResult,
    closeConfigSelect,
    flushManualCropConfigUpdates,
    getState,
    notify,
    prepareRunPayload,
    runBusyAction,
    runTool,
    syncManualCropStageViewport,
    updateConfig,
    toolMap,
    ensureManualCropSessionOutputPath,
  } = deps

  if (action === 'set-manual-crop-ratio') {
    const state = getState()
    const { config, asset } = getManualCropSelection(state)
    const nextPatch = {
      ratio: target.dataset.label,
      ratioValue: target.dataset.value,
    }
    if (asset) {
      const transformState = getManualCropAssetState(asset, config)
      nextPatch.cropAreas = {
        ...(config.cropAreas || {}),
        [asset.id]: {
          ...((config.cropAreas || {})[asset.id] || {}),
          ...createDefaultManualCropArea(asset, target.dataset.value, config),
          ...transformState,
        },
      }
    }
    updateConfig('manual-crop', nextPatch)
    closeConfigSelect(target)
    return true
  }

  if (action === 'manual-crop-rotate-left' || action === 'manual-crop-rotate-right') {
    const state = getState()
    const { config, asset } = getManualCropSelection(state)
    const step = action === 'manual-crop-rotate-left' ? -90 : 90
    const currentTransform = getManualCropAssetState(asset, config)
    const nextAngle = (((Number(currentTransform.angle) || 0) + step + 540) % 360) - 180
    const patch = patchCurrentManualCropArea(
      config,
      asset,
      { angle: nextAngle },
    )
    updateConfig('manual-crop', patch)
    return true
  }

  if (action === 'manual-crop-flip-horizontal') {
    const state = getState()
    const { config, asset } = getManualCropSelection(state)
    const currentTransform = getManualCropAssetState(asset, config)
    updateConfig('manual-crop', patchCurrentManualCropArea(
      config,
      asset,
      { flipHorizontal: !currentTransform.flipHorizontal },
    ))
    return true
  }

  if (action === 'manual-crop-flip-vertical') {
    const state = getState()
    const { config, asset } = getManualCropSelection(state)
    const currentTransform = getManualCropAssetState(asset, config)
    updateConfig('manual-crop', patchCurrentManualCropArea(
      config,
      asset,
      { flipVertical: !currentTransform.flipVertical },
    ))
    return true
  }

  if (action === 'toggle-manual-crop-keep-format') {
    const config = getState().configs['manual-crop']
    updateConfig('manual-crop', { keepOriginalFormat: !config.keepOriginalFormat })
    return true
  }

  if (action === 'toggle-manual-crop-help') {
    const config = getState().configs['manual-crop']
    updateConfig('manual-crop', { helpOpen: !config.helpOpen })
    return true
  }

  if (action === 'toggle-manual-crop-lock-aspect') {
    const config = getState().configs['manual-crop']
    updateConfig('manual-crop', { lockAspectRatio: !config.lockAspectRatio })
    return true
  }

  if (action === 'toggle-manual-crop-snap') {
    const config = getState().configs['manual-crop']
    updateConfig('manual-crop', { snapEnabled: !config.snapEnabled })
    return true
  }

  if (action === 'set-manual-crop-snap-strength') {
    const nextStrength = SNAP_STRENGTH_VALUES.has(target.dataset.value)
      ? target.dataset.value
      : 'very-low'
    updateConfig('manual-crop', { snapStrength: nextStrength })
    closeConfigSelect(target)
    return true
  }

  if (action === 'set-manual-crop-outer-area-mode') {
    const config = getState().configs['manual-crop']
    const nextMode = target.dataset.value === 'white' ? 'white' : 'trim'
    updateConfig('manual-crop', { outerAreaMode: nextMode })
    closeConfigSelect(target)
    return true
  }

  if (action === 'manual-crop-prev' || action === 'manual-crop-next') {
    flushManualCropConfigUpdates()
    syncManualCropStageViewport()
    const state = getState()
    const { config, currentIndex, asset: currentAsset } = getManualCropSelection(state)
    const nextIndex = action === 'manual-crop-prev' ? currentIndex - 1 : currentIndex + 1
    if (nextIndex >= 0 && nextIndex < state.assets.length) {
      const nextAsset = state.assets[nextIndex]
      const cropAreas = ensureManualCropAreaForAsset(nextAsset, config, currentAsset)
      updateConfig('manual-crop', {
        currentIndex: nextIndex,
        cropAreas,
        ...getManualCropGlobalTransformPatch(nextAsset, config),
      })
    }
    return true
  }

  if (action === 'manual-crop-complete') {
    flushManualCropConfigUpdates()
    syncManualCropStageViewport()
    const state = getState()
    const tool = toolMap['manual-crop']
    const { config, asset } = getManualCropSelection(state)
    if (!asset || state.isProcessing) return true

    try {
      const destinationPath = state.destinationPath || state.settings.defaultSavePath || ''
      const nextConfig = await ensureManualCropSessionOutputPath(tool.id, config, asset, destinationPath)
      const result = await runBusyAction(() => runTool(tool.id, nextConfig, [asset], destinationPath))
      if (result?.processed?.length || result?.failed?.length) {
        applyRunResult(result)
      }
      if (!(result?.ok || result?.partial) || !result?.processed?.length) {
        notify({ type: 'info', message: result?.message || '当前图片裁剪未生成结果。' })
        return true
      }

      const latestState = getState()
      const { config: latestConfig, asset: latestAsset } = getManualCropSelection(latestState)
      if (!latestAsset || latestAsset.id !== asset.id) return true
      advanceManualCropAfterSuccess(asset, latestState, latestConfig)
      return true
    } catch (error) {
      notify({ type: 'error', message: error?.message || '当前图片裁剪失败。' })
      return true
    }
  }

  return false
}

export function handleManualCropKeydown(event, deps) {
  const {
    getState,
    isEditableTarget,
    queueManualCropConfigUpdate,
    updateConfig,
  } = deps

  if (event.code === 'Space' && getState().activeTool === 'manual-crop' && !isEditableTarget(event.target)) {
    if (!event.repeat) {
      const config = getState().configs['manual-crop']
      updateConfig('manual-crop', { snapEnabled: !config.snapEnabled })
    }
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return true
  }

  if (getState().activeTool === 'manual-crop' && !isEditableTarget(event.target)) {
    const arrowDelta = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    }[event.key]
    if (arrowDelta) {
      const state = getState()
      const config = state.configs['manual-crop']
      const asset = state.assets[config.currentIndex]
      if (asset) {
        const step = event.shiftKey ? 10 : 1
        queueManualCropConfigUpdate((latestConfig, latestState) => {
          const latestAsset = latestState.assets[latestConfig.currentIndex]
          if (!latestAsset) return null
          const latestArea = getManualCropArea(latestAsset, latestConfig)
          const movedArea = clampManualCropArea({
            ...latestArea,
            x: latestArea.x + arrowDelta.x * step,
            y: latestArea.y + arrowDelta.y * step,
          }, latestAsset, latestConfig)
          return mergeManualCropAreaPatch(latestConfig, latestAsset.id, movedArea)
        })
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return true
      }
    }
  }

  return false
}

export function handleManualCropKeyup(event, deps) {
  const { getState } = deps

  if (event.code === 'Space' && getState().activeTool === 'manual-crop') {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return true
  }

  if (getState().activeTool === 'manual-crop' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return true
  }

  return false
}

export function handleManualCropWheel(event, deps) {
  const {
    getState,
    queueManualCropConfigUpdate,
  } = deps
  const manualCropStage = event.target.closest('[data-role="manual-crop-stage"]')
  if (!manualCropStage || getState().activeTool !== 'manual-crop') return false
  const state = getState()
  const config = state.configs['manual-crop']
  const asset = state.assets[config.currentIndex]
  if (!asset) return false

  event.preventDefault()
  const currentState = getManualCropAssetState(asset, config)
  const delta = event.deltaY < 0 ? 0.08 : -0.08
  const nextScale = Math.max(0.5, Math.min(3, (Number(currentState.viewScale) || 1) + delta))
  queueManualCropConfigUpdate((latestConfig, latestState) => {
    const latestAsset = latestState.assets[latestConfig.currentIndex]
    if (!latestAsset) return null
    return patchCurrentManualCropArea(latestConfig, latestAsset, {
      viewScale: Number(nextScale.toFixed(2)),
    })
  })
  return true
}

export function beginManualCropDrag(event, target, deps) {
  const { getState, getManualCropStageMetrics } = deps
  const stage = target.closest('[data-role="manual-crop-stage"]')
  const box = target.closest('[data-role="manual-crop-box"]') || target
  if (!stage || !box) return false
  event.preventDefault()
  const state = getState()
  const config = state.configs['manual-crop']
  const asset = state.assets[config.currentIndex]
  if (!asset) return false
  const imageRect = stage.getBoundingClientRect()
  const stageMetrics = getManualCropStageMetrics(asset, config)
  const area = getManualCropArea(asset, config)
  manualCropDragContext = {
    assetId: asset.id,
    pointerId: event.pointerId,
    ratioValue: config.ratioValue || '16:9',
    stageRect: imageRect,
    stageMetrics,
    area,
    startX: event.clientX,
    startY: event.clientY,
    mode: target.dataset.action === 'manual-crop-resize' ? 'resize' : 'move',
    handle: target.dataset.handle || '',
  }
  target.setPointerCapture?.(event.pointerId)
  setManualCropDragHandleState(true)
  return true
}

export function beginManualCropPan(event, target, deps) {
  const { getState } = deps
  const stage = target.closest('[data-role="manual-crop-stage"]')
  if (!stage) return false
  event.preventDefault()
  const state = getState()
  const config = state.configs['manual-crop']
  const asset = state.assets[config.currentIndex]
  if (!asset) return false
  const currentState = getManualCropAssetState(asset, config)
  manualCropPanContext = {
    assetId: asset.id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: Number(currentState.viewOffsetX) || 0,
    originY: Number(currentState.viewOffsetY) || 0,
  }
  target.setPointerCapture?.(event.pointerId)
  return true
}

export function handleManualCropPan(event, deps) {
  const { queueManualCropConfigUpdate } = deps
  const context = manualCropPanContext
  if (!context) return false
  if (context.pointerId != null && event.pointerId != null && event.pointerId !== context.pointerId) return true
  const nextOffsetX = Math.round(context.originX + (event.clientX - context.startX))
  const nextOffsetY = Math.round(context.originY + (event.clientY - context.startY))
  queueManualCropConfigUpdate((latestConfig, latestState) => {
    const latestAsset = latestState.assets[latestConfig.currentIndex]
    if (!latestAsset || latestAsset.id !== context.assetId) return null
    return patchCurrentManualCropArea(latestConfig, latestAsset, {
      viewOffsetX: nextOffsetX,
      viewOffsetY: nextOffsetY,
    })
  })
  return true
}

export function handleManualCropDrag(event, deps) {
  const { queueManualCropConfigUpdate } = deps
  const context = manualCropDragContext
  if (!context) return false
  if (context.pointerId != null && event.pointerId != null && event.pointerId !== context.pointerId) return true
  queueManualCropConfigUpdate((latestConfig, latestState) => {
    const latestAsset = latestState.assets[latestConfig.currentIndex]
    if (!latestAsset || latestAsset.id !== context.assetId) return null
    const nextArea = context.mode === 'move'
      ? moveManualCropArea(context, event, latestAsset, latestConfig, context.stageMetrics)
      : resizeManualCropArea(context, event, latestAsset, latestConfig, context.stageMetrics)
    return mergeManualCropAreaPatch(latestConfig, latestAsset.id, nextArea)
  })
  return true
}

export function endManualCropDrag() {
  manualCropDragContext = null
  setManualCropDragHandleState(false)
}

export function endManualCropPan() {
  manualCropPanContext = null
}

export function hasManualCropDrag() {
  return !!manualCropDragContext
}

export function hasManualCropPan() {
  return !!manualCropPanContext
}

import {
  getManualCropAssetState,
  getManualCropStageMetrics,
} from './manual-crop-helpers.js'

export function createManualCropRuntime({ getState, updateConfig }) {
  let manualCropStageSyncFrame = 0
  let manualCropConfigUpdateFrame = 0
  let pendingManualCropConfigReducers = []

  function syncManualCropStageViewport() {
    const state = getState()
    if (state.activeTool !== 'manual-crop') return
    const stage = document.querySelector('[data-role="manual-crop-stage"]')
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    const width = Math.max(320, Math.round(rect.width))
    const height = Math.max(240, Math.round(rect.height))
    const config = state.configs['manual-crop']
    if (Math.abs((config.stageWidth || 0) - width) <= 1 && Math.abs((config.stageHeight || 0) - height) <= 1) return
    const currentAsset = state.assets[config.currentIndex]
    if (!currentAsset) {
      updateConfig('manual-crop', { stageWidth: width, stageHeight: height })
      return
    }
    const previousMetrics = getManualCropStageMetrics(currentAsset, config)
    const savedArea = config.cropAreas?.[currentAsset.id]
    const currentState = getManualCropAssetState(currentAsset, config)
    const nextViewOffsetX = Math.round(Number(currentState.viewOffsetX) || 0)
    const nextViewOffsetY = Math.round(Number(currentState.viewOffsetY) || 0)
    const nextMetrics = getManualCropStageMetrics(currentAsset, {
      ...config,
      stageWidth: width,
      stageHeight: height,
      viewOffsetX: nextViewOffsetX,
      viewOffsetY: nextViewOffsetY,
      cropAreas: {
        ...(config.cropAreas || {}),
        [currentAsset.id]: savedArea
          ? {
              ...savedArea,
              viewOffsetX: nextViewOffsetX,
              viewOffsetY: nextViewOffsetY,
            }
          : {
              angle: currentState.angle,
              flipHorizontal: currentState.flipHorizontal,
              flipVertical: currentState.flipVertical,
              viewScale: currentState.viewScale,
              viewOffsetX: nextViewOffsetX,
              viewOffsetY: nextViewOffsetY,
            },
      },
    })
    const nextPatch = {
      stageWidth: width,
      stageHeight: height,
      viewOffsetX: nextViewOffsetX,
      viewOffsetY: nextViewOffsetY,
    }
    if (savedArea) {
      const normalizedX = (savedArea.x - previousMetrics.imageX) / Math.max(1, previousMetrics.imageWidth)
      const normalizedY = (savedArea.y - previousMetrics.imageY) / Math.max(1, previousMetrics.imageHeight)
      const normalizedWidth = savedArea.width / Math.max(1, previousMetrics.imageWidth)
      const normalizedHeight = savedArea.height / Math.max(1, previousMetrics.imageHeight)
      nextPatch.cropAreas = {
        ...(config.cropAreas || {}),
        [currentAsset.id]: {
          ...savedArea,
          x: Math.round(nextMetrics.imageX + normalizedX * nextMetrics.imageWidth),
          y: Math.round(nextMetrics.imageY + normalizedY * nextMetrics.imageHeight),
          width: Math.round(normalizedWidth * nextMetrics.imageWidth),
          height: Math.round(normalizedHeight * nextMetrics.imageHeight),
          viewOffsetX: nextViewOffsetX,
          viewOffsetY: nextViewOffsetY,
        },
      }
    }
    updateConfig('manual-crop', nextPatch)
  }

  function queueManualCropStageSync() {
    if (getState().activeTool !== 'manual-crop') return
    if (manualCropStageSyncFrame) cancelAnimationFrame(manualCropStageSyncFrame)
    manualCropStageSyncFrame = requestAnimationFrame(() => {
      manualCropStageSyncFrame = 0
      syncManualCropStageViewport()
    })
  }

  function flushManualCropConfigUpdates() {
    if (!pendingManualCropConfigReducers.length) return
    if (manualCropConfigUpdateFrame) {
      cancelAnimationFrame(manualCropConfigUpdateFrame)
      manualCropConfigUpdateFrame = 0
    }
    const reducers = pendingManualCropConfigReducers
    pendingManualCropConfigReducers = []
    const state = getState()
    if (state.activeTool !== 'manual-crop') return
    let nextConfig = state.configs['manual-crop']
    let changed = false
    for (const reducer of reducers) {
      const patch = reducer(nextConfig, state)
      if (!patch || typeof patch !== 'object') continue
      nextConfig = { ...nextConfig, ...patch }
      changed = true
    }
    if (changed) {
      updateConfig('manual-crop', nextConfig)
    }
  }

  function queueManualCropConfigUpdate(reducer) {
    pendingManualCropConfigReducers.push(reducer)
    if (manualCropConfigUpdateFrame) return
    manualCropConfigUpdateFrame = requestAnimationFrame(() => {
      manualCropConfigUpdateFrame = 0
      flushManualCropConfigUpdates()
    })
  }

  return {
    flushManualCropConfigUpdates,
    queueManualCropConfigUpdate,
    queueManualCropStageSync,
    syncManualCropStageViewport,
  }
}

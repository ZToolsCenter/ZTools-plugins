import {
  createDefaultManualCropArea,
  createManualCropSeed,
  ensureManualCropAreaForAsset,
  findNextManualCropIndex,
  getManualCropGlobalTransformPatch,
} from './manual-crop-helpers.js'

export function getAssetsForTool(toolId, assets, manualCropConfig) {
  if (toolId !== 'manual-crop') return assets
  const completedIds = new Set(manualCropConfig?.completedIds || [])
  return assets.filter((asset) => completedIds.has(asset.id))
}

export async function ensureManualCropSessionOutputPath({
  toolId,
  config,
  asset,
  destinationPath,
  prepareRunPayload,
  updateConfig,
}) {
  if (config.sessionOutputPath) return config
  const prepared = await prepareRunPayload(toolId, config, [asset], destinationPath)
  const sessionOutputPath = prepared?.destinationPath || ''
  if (!sessionOutputPath) return config
  updateConfig('manual-crop', { sessionOutputPath })
  return { ...config, sessionOutputPath }
}

export function advanceManualCropAfterSuccess({
  asset,
  latestState,
  latestConfig,
  notify,
  setResultView,
  showManualCropSummaryResultView,
  updateConfig,
}) {
  const completedIds = [...latestConfig.completedIds]
  if (!completedIds.includes(asset.id)) completedIds.push(asset.id)

  const isFinishingOnLastImage = latestConfig.currentIndex >= latestState.assets.length - 1
  const isAllCompleted = latestState.assets.length > 0 && completedIds.length >= latestState.assets.length
  if (!isAllCompleted && !isFinishingOnLastImage) {
    setResultView(null)
  } else {
    showManualCropSummaryResultView(completedIds)
  }

  const completedArea = (latestConfig.cropAreas && latestConfig.cropAreas[asset.id])
    || createDefaultManualCropArea(asset, latestConfig.ratioValue || '16:9', latestConfig)
  const lastCompletedCropSeed = createManualCropSeed(asset, latestConfig, completedArea)

  if (isFinishingOnLastImage) {
    updateConfig('manual-crop', {
      completedIds,
      cropAreas: latestConfig.cropAreas || {},
      lastCompletedCropSeed,
      ...getManualCropGlobalTransformPatch(asset, latestConfig),
    })
    notify({ type: 'success', message: '当前图片已裁剪，本轮处理完成。' })
    return
  }

  const nextIndex = findNextManualCropIndex(
    { ...latestConfig, completedIds },
    latestState.assets,
    Math.min(latestConfig.currentIndex + 1, Math.max(latestState.assets.length - 1, 0)),
  )
  const nextAsset = latestState.assets[nextIndex]
  const cropAreas = ensureManualCropAreaForAsset(nextAsset, { ...latestConfig, lastCompletedCropSeed })
  updateConfig('manual-crop', {
    completedIds,
    currentIndex: nextIndex,
    cropAreas,
    lastCompletedCropSeed,
    ...getManualCropGlobalTransformPatch(nextAsset, latestConfig),
  })
  notify({ type: 'success', message: '当前图片已裁剪，并切换到下一张。' })
}

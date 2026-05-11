export function buildManualCropSummaryItems(state, completedIds, getSavedOutputPath, getPreviewMessage) {
  const handledIds = new Set(Array.isArray(completedIds) ? completedIds : [])
  return state.assets
    .filter((asset) => handledIds.has(asset.id))
    .map((asset) => {
      const outputPath = getSavedOutputPath(asset) || asset.outputPath || ''
      if (!outputPath) return null
      const normalizedOutputPath = String(outputPath).replaceAll('\\', '/')
      const resultName = normalizedOutputPath.split('/').pop() || asset.name || ''
      return {
        assetId: asset.id,
        name: asset.name,
        beforeUrl: asset.thumbnailUrl || '',
        afterUrl: outputPath,
        outputPath,
        source: {
          name: asset.name || '',
          sizeBytes: asset.sizeBytes || 0,
          width: asset.width || 0,
          height: asset.height || 0,
        },
        result: {
          name: resultName,
          sizeBytes: asset.stagedSizeBytes || asset.sizeBytes || 0,
          width: asset.stagedWidth || asset.width || 0,
          height: asset.stagedHeight || asset.height || 0,
        },
        summary: getPreviewMessage(asset),
      }
    })
    .filter(Boolean)
}

export function updateManualCropSummaryResultView({
  state,
  completedIds,
  getSavedOutputPath,
  getPreviewMessage,
  setResultView,
}) {
  const items = buildManualCropSummaryItems(
    state,
    completedIds,
    getSavedOutputPath,
    getPreviewMessage,
  )

  if (!items.length) {
    setResultView(null)
    return
  }

  setResultView({
    runId: state.activeRun?.runId || '',
    toolId: 'manual-crop',
    mode: 'direct',
    items,
    failed: [],
    createdAt: Date.now(),
  })
}

import { renderCompressionPage } from './tool-pages.js'
import { renderManualCropPage } from './manual-crop-page.js'

export function renderToolPage(toolId, state) {
  if (toolId === 'manual-crop') {
    return renderManualCropPage(state)
  }
  return renderCompressionPage(toolId, state)
}

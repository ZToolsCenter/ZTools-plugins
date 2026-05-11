import { getManualCropDisplaySize as computeManualCropDisplaySize, getManualCropStageMetrics as computeManualCropStageMetrics } from '../lib/manual-crop-stage.js'

const MANUAL_CROP_RATIO_OPTIONS = [
  { label: '1:1', value: '1:1' },
  { label: '4:5', value: '4:5' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '4:3', value: '4:3' },
  { label: '3:2', value: '3:2' },
  { label: '3:4', value: '3:4' },
  { label: '2:3', value: '2:3' },
  { label: '21:9', value: '21:9' },
]

const MANUAL_CROP_OUTER_AREA_OPTIONS = [
  { label: '忽略空白', value: 'trim' },
  { label: '白底填充', value: 'white' },
]

const MANUAL_CROP_SNAP_STRENGTH_OPTIONS = [
  { label: '极低', value: 'very-low' },
  { label: '低', value: 'low' },
  { label: '中等', value: 'medium' },
  { label: '高', value: 'high' },
  { label: '极高', value: 'very-high' },
]

export function renderManualCropPage(state) {
  const config = state.configs['manual-crop']
  const exitToolId = state.lastWorkspaceTool && state.lastWorkspaceTool !== 'manual-crop'
    ? state.lastWorkspaceTool
    : 'compression'
  const current = state.assets[config.currentIndex] || state.assets[0]
  const hasCurrent = Boolean(current)
  const progressLabel = state.assets.length
    ? `${Math.min(config.currentIndex + 1, state.assets.length)} / ${state.assets.length}`
    : '0 / 0'
  const currentRatio = MANUAL_CROP_RATIO_OPTIONS.find((item) => item.label === config.ratio) || MANUAL_CROP_RATIO_OPTIONS[2]
  const currentOuterAreaMode = MANUAL_CROP_OUTER_AREA_OPTIONS.find((item) => item.value === config.outerAreaMode) || MANUAL_CROP_OUTER_AREA_OPTIONS[0]
  const currentSnapStrength = MANUAL_CROP_SNAP_STRENGTH_OPTIONS.find((item) => item.value === config.snapStrength) || MANUAL_CROP_SNAP_STRENGTH_OPTIONS[0]
  const currentTransform = current ? getAssetTransformState(current, config) : { angle: 0, flipHorizontal: false, flipVertical: false }
  const isLastImage = !!current && config.currentIndex >= state.assets.length - 1
  const displaySize = current ? getPreviewDisplaySize(current, currentTransform) : { width: 1, height: 1 }
  const stageMetrics = current ? getPreviewStageMetrics(current, config, displaySize, currentTransform) : { width: 1, height: 1, imageX: 0, imageY: 0, imageWidth: 1, imageHeight: 1 }
  const cropArea = current ? resolveCropArea(current, config, stageMetrics) : null
  const cropStyle = cropArea
    ? `left:${cropArea.xPct}%;top:${cropArea.yPct}%;width:${cropArea.widthPct}%;height:${cropArea.heightPct}%;`
    : ''
  const previewStyle = current
    ? `style="left:${(stageMetrics.imageX / stageMetrics.width) * 100}%;top:${(stageMetrics.imageY / stageMetrics.height) * 100}%;width:${(stageMetrics.imageWidth / stageMetrics.width) * 100}%;height:${(stageMetrics.imageHeight / stageMetrics.height) * 100}%;"`
    : ''
  const svgMarkup = hasCurrent ? getPreviewSvgMarkup(current, displaySize, currentTransform) : ''

  return `
    <div class="manual-shell">
      <header class="manual-header">
        <h2 class="manual-title">手动裁剪</h2>
        <div class="manual-header__meta" data-horizontal-scroll>
          <span class="badge">${progressLabel}</span>
          <button class="icon-button" data-action="toggle-manual-crop-help" data-tooltip="操作说明" aria-label="操作说明">
            <span class="material-symbols-outlined">help</span>
          </button>
          <button class="icon-button" data-action="activate-tool" data-tool-id="${exitToolId}" data-apply-default-preset="false" data-tooltip="关闭" aria-label="关闭">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </header>
      ${config.helpOpen ? `
        <div class="preview-modal__help manual-crop__help">
          <div class="preview-modal__help-title">操作说明</div>
          <ul class="preview-modal__help-list">
            <li>滚轮：缩放图片</li>
            <li>鼠标右键拖动：平移图片</li>
            <li>方向键：移动裁剪框</li>
            <li>Shift + 方向键：快速移动裁剪框</li>
            <li>空格 / 吸附按钮：切换边缘吸附</li>
            <li>工具栏可调整吸附强度挡位</li>
          </ul>
        </div>
      ` : ''}
      <main class="manual-canvas" data-role="drop-surface" data-scroll-role="manual-canvas">
        <div class="manual-canvas__stage">
          <div
            class="manual-canvas__image"
            ${hasCurrent
              ? `data-role="manual-crop-stage" data-asset-id="${current.id}" data-stage-width="${stageMetrics.width}" data-stage-height="${stageMetrics.height}"`
              : ''}
          >
            ${hasCurrent ? `
              <div class="manual-canvas__content">
                <div class="manual-canvas__preview" data-role="manual-crop-preview" ${previewStyle}>
                  ${svgMarkup}
                </div>
                <div class="manual-crop-box" data-role="manual-crop-box" data-action="manual-crop-drag" style="${cropStyle}">
                  <span class="manual-handle manual-handle--tl" data-action="manual-crop-resize" data-handle="tl"></span>
                  <span class="manual-handle manual-handle--tr" data-action="manual-crop-resize" data-handle="tr"></span>
                  <span class="manual-handle manual-handle--bl" data-action="manual-crop-resize" data-handle="bl"></span>
                  <span class="manual-handle manual-handle--br" data-action="manual-crop-resize" data-handle="br"></span>
                  <span class="manual-handle manual-handle--tm" data-action="manual-crop-resize" data-handle="tm"></span>
                  <span class="manual-handle manual-handle--bm" data-action="manual-crop-resize" data-handle="bm"></span>
                  <span class="manual-handle manual-handle--ml" data-action="manual-crop-resize" data-handle="ml"></span>
                  <span class="manual-handle manual-handle--mr" data-action="manual-crop-resize" data-handle="mr"></span>
                </div>
              </div>
            ` : `
              <div class="manual-canvas__empty">先导入图片，再拖动裁剪框开始裁剪</div>
            `}
          </div>
        </div>
      </main>
      <footer class="manual-footer">
        <div class="manual-footer__left" data-horizontal-scroll>
          <div class="manual-toolbar manual-toolbar--crop">
            <button class="icon-button" data-action="open-folder-input" data-tooltip="选择文件夹" aria-label="选择文件夹">
              <span class="material-symbols-outlined">folder_open</span>
            </button>
            <button class="icon-button" data-action="open-file-input" data-tooltip="选择图片" aria-label="选择图片">
              <span class="material-symbols-outlined">add_photo_alternate</span>
            </button>
            <button class="icon-button" data-action="remove-asset" data-asset-id="${current?.id || ''}" data-tooltip="删除当前图片" aria-label="删除当前图片" ${!hasCurrent ? 'disabled' : ''}>
              <span class="material-symbols-outlined">delete</span>
            </button>
            <div class="select-shell select-shell--up manual-footer__ratio-shell">
              <button
                type="button"
                class="icon-button manual-footer__ratio-trigger"
                data-action="toggle-config-select"
                aria-haspopup="listbox"
                aria-expanded="false"
                data-tooltip="裁剪比例"
              >
                <span class="material-symbols-outlined">aspect_ratio</span>
              </button>
              <div class="select-shell__menu" role="listbox">
                ${MANUAL_CROP_RATIO_OPTIONS.map((item) => `
                  <button
                    type="button"
                    class="select-shell__option ${config.ratio === item.label ? 'is-active' : ''}"
                    data-action="set-manual-crop-ratio"
                    data-label="${item.label}"
                    data-value="${item.value}"
                  >${item.value}</button>
                `).join('')}
              </div>
            </div>
            <button class="icon-button" data-action="manual-crop-rotate-left" data-tooltip="向左旋转 90°" aria-label="向左旋转 90°">
              <span class="material-symbols-outlined">rotate_90_degrees_ccw</span>
            </button>
            <button class="icon-button" data-action="manual-crop-rotate-right" data-tooltip="向右旋转 90°" aria-label="向右旋转 90°">
              <span class="material-symbols-outlined">rotate_90_degrees_cw</span>
            </button>
            <button class="icon-button ${currentTransform.flipHorizontal ? 'is-active' : ''}" data-action="manual-crop-flip-horizontal" data-tooltip="左右翻转" aria-label="左右翻转" aria-pressed="${currentTransform.flipHorizontal ? 'true' : 'false'}">
              <span class="material-symbols-outlined">flip</span>
            </button>
            <button class="icon-button ${currentTransform.flipVertical ? 'is-active' : ''}" data-action="manual-crop-flip-vertical" data-tooltip="上下翻转" aria-label="上下翻转" aria-pressed="${currentTransform.flipVertical ? 'true' : 'false'}">
              <span class="material-symbols-outlined">swap_vert</span>
            </button>
            <button
              class="icon-button ${config.lockAspectRatio ? 'is-active' : ''}"
              data-action="toggle-manual-crop-lock-aspect"
              data-tooltip="${config.lockAspectRatio ? '自由拖动' : '保持比例'}"
              aria-label="${config.lockAspectRatio ? '自由拖动' : '保持比例'}"
              aria-pressed="${config.lockAspectRatio ? 'true' : 'false'}"
            >
              <span class="material-symbols-outlined">crop_free</span>
            </button>
            <button
              class="icon-button ${config.keepOriginalFormat ? 'is-active' : ''}"
              data-action="toggle-manual-crop-keep-format"
              data-tooltip="保持原格式"
              aria-label="保持原格式"
              aria-pressed="${config.keepOriginalFormat ? 'true' : 'false'}"
            >
              <span class="material-symbols-outlined">image</span>
            </button>
            <button
              class="icon-button ${config.snapEnabled ? 'is-active' : ''}"
              data-action="toggle-manual-crop-snap"
              data-tooltip="${config.snapEnabled ? '关闭边缘吸附' : '开启边缘吸附'}"
              aria-label="${config.snapEnabled ? '关闭边缘吸附' : '开启边缘吸附'}"
              aria-pressed="${config.snapEnabled ? 'true' : 'false'}"
            >
              <span class="material-symbols-outlined">attractions</span>
            </button>
            <div class="select-shell select-shell--up manual-footer__ratio-shell">
              <button
                type="button"
                class="icon-button manual-footer__ratio-trigger"
                data-action="toggle-config-select"
                aria-haspopup="listbox"
                aria-expanded="false"
                data-tooltip="吸附强度"
                aria-label="吸附强度"
              >
                <span class="material-symbols-outlined">tune</span>
              </button>
              <div class="select-shell__menu" role="listbox">
                ${MANUAL_CROP_SNAP_STRENGTH_OPTIONS.map((item) => `
                  <button
                    type="button"
                    class="select-shell__option ${config.snapStrength === item.value ? 'is-active' : ''}"
                    data-action="set-manual-crop-snap-strength"
                    data-value="${item.value}"
                  >${item.label}</button>
                `).join('')}
              </div>
            </div>
            <div class="select-shell select-shell--up manual-footer__ratio-shell">
              <button
                type="button"
                class="icon-button manual-footer__ratio-trigger"
                data-action="toggle-config-select"
                aria-haspopup="listbox"
                aria-expanded="false"
                data-tooltip="图片外空白"
              >
                <span class="material-symbols-outlined">background_replace</span>
              </button>
              <div class="select-shell__menu" role="listbox">
                ${MANUAL_CROP_OUTER_AREA_OPTIONS.map((item) => `
                  <button
                    type="button"
                    class="select-shell__option ${config.outerAreaMode === item.value ? 'is-active' : ''}"
                    data-action="set-manual-crop-outer-area-mode"
                    data-value="${item.value}"
                  >${item.label}</button>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
        <div class="manual-footer__right">
          <div class="manual-toolbar manual-toolbar--crop manual-toolbar--crop-actions">
            <button class="icon-button" data-action="manual-crop-prev" data-tooltip="上一张" aria-label="上一张" ${config.currentIndex <= 0 ? 'disabled' : ''}>
              <span class="material-symbols-outlined">chevron_left</span>
            </button>
            <button class="primary-button ${state.isProcessing ? 'is-processing' : ''}" data-action="manual-crop-complete" ${!hasCurrent || state.isProcessing ? 'disabled' : ''}>
              ${state.isProcessing ? '剪裁中...' : (isLastImage ? '剪裁并完成' : '剪裁并下一张')}
            </button>
            <button class="icon-button" data-action="manual-crop-next" data-tooltip="下一张" aria-label="下一张" ${!hasCurrent || config.currentIndex >= state.assets.length - 1 ? 'disabled' : ''}>
              <span class="material-symbols-outlined">chevron_right</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  `
}

function resolveCropArea(asset, config, stageMetrics = getPreviewStageMetrics(asset, config)) {
  const saved = config.cropAreas?.[asset.id]
  const { width, height } = stageMetrics
  const area = saved || getInheritedCropArea(asset, config, stageMetrics) || getDefaultCropArea(asset, config.ratioValue || currentRatioValue(config), config, stageMetrics)
  return {
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    xPct: (area.x / width) * 100,
    yPct: (area.y / height) * 100,
    widthPct: (area.width / width) * 100,
    heightPct: (area.height / height) * 100,
  }
}

function getInheritedCropArea(asset, config, stageMetrics = getPreviewStageMetrics(asset, config)) {
  const seed = config.lastCompletedCropSeed
  if (!seed) return null
  if (String(seed.ratioValue || '') !== String(config.ratioValue || currentRatioValue(config))) return null
  const { width, height } = stageMetrics
  if (seed?.area && (seed.assetWidth || 0) === width && (seed.assetHeight || 0) === height) {
    return { ...seed.area }
  }
  if (!seed?.normalizedArea) return null
  const referenceSize = Math.max(1, Math.min(width, height))
  const ratio = Math.max(1 / 1000, Number(seed.normalizedArea.ratio) || 1)
  const cropWidth = Math.max(40, Math.round(Number(seed.normalizedArea.scale || 0) * referenceSize))
  const cropHeight = Math.max(40, Math.round(cropWidth / ratio))
  const centerX = Math.round(Number(seed.normalizedArea.centerX || 0.5) * width)
  const centerY = Math.round(Number(seed.normalizedArea.centerY || 0.5) * height)
  return clampCropAreaToStage({
    x: Math.round(centerX - cropWidth / 2),
    y: Math.round(centerY - cropHeight / 2),
    width: cropWidth,
    height: cropHeight,
  }, width, height)
}

function clampCropAreaToStage(area, width, height) {
  const nextWidth = Math.min(width, Math.max(40, Math.round(area.width)))
  const nextHeight = Math.min(height, Math.max(40, Math.round(area.height)))
  return {
    x: Math.max(0, Math.min(width - nextWidth, Math.round(area.x))),
    y: Math.max(0, Math.min(height - nextHeight, Math.round(area.y))),
    width: nextWidth,
    height: nextHeight,
  }
}

function getDefaultCropArea(asset, ratioValue, config, stage = getPreviewStageMetrics(asset, config)) {
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

function currentRatioValue(config) {
  const matched = MANUAL_CROP_RATIO_OPTIONS.find((item) => item.label === config.ratio)
  return matched?.value || config.ratioValue || '16:9'
}

function getPreviewDisplaySize(asset, transform = getAssetTransformState(asset, {})) {
  return computeManualCropDisplaySize(asset?.width, asset?.height, transform.angle)
}

function getPreviewStageMetrics(asset, config, display = getPreviewDisplaySize(asset, getAssetTransformState(asset, config)), transform = getAssetTransformState(asset, config)) {
  return computeManualCropStageMetrics({
    sourceWidth: asset?.width,
    sourceHeight: asset?.height,
    angle: transform.angle,
    stageWidth: config.stageWidth,
    stageHeight: config.stageHeight,
    viewScale: transform.viewScale,
    viewOffsetX: transform.viewOffsetX,
    viewOffsetY: transform.viewOffsetY,
  })
}

function getPreviewSvgMarkup(asset, displaySize, transform = getAssetTransformState(asset, {})) {
  const sourceWidth = Math.max(1, Number(asset?.width) || 1)
  const sourceHeight = Math.max(1, Number(asset?.height) || 1)
  const matrix = getPreviewMatrix(sourceWidth, sourceHeight, transform)
  return `
    <svg class="manual-canvas__preview-svg" viewBox="0 0 ${displaySize.width} ${displaySize.height}" preserveAspectRatio="none" aria-hidden="true">
      <g transform="matrix(${matrix.join(' ')})">
        <image href="${asset.thumbnailUrl}" x="0" y="0" width="${sourceWidth}" height="${sourceHeight}" preserveAspectRatio="none"></image>
      </g>
    </svg>
  `
}

function getPreviewMatrix(sourceWidth, sourceHeight, transform) {
  let matrix = [1, 0, 0, 1, 0, 0]
  const normalizedAngle = ((Math.round(Number(transform.angle) || 0) % 360) + 360) % 360
  if (normalizedAngle === 90) matrix = composeSvgMatrix(matrix, [0, 1, -1, 0, sourceHeight, 0])
  if (normalizedAngle === 180) matrix = composeSvgMatrix(matrix, [-1, 0, 0, -1, sourceWidth, sourceHeight])
  if (normalizedAngle === 270) matrix = composeSvgMatrix(matrix, [0, -1, 1, 0, 0, sourceWidth])
  if (transform.flipHorizontal) matrix = composeSvgMatrix(matrix, [-1, 0, 0, 1, displayWidthForTransform(sourceWidth, sourceHeight, normalizedAngle), 0])
  if (transform.flipVertical) matrix = composeSvgMatrix(matrix, [1, 0, 0, -1, 0, displayHeightForTransform(sourceWidth, sourceHeight, normalizedAngle)])
  return matrix.map((value) => Number(value.toFixed(6)))
}

function displayWidthForTransform(sourceWidth, sourceHeight, normalizedAngle) {
  return normalizedAngle === 90 || normalizedAngle === 270 ? sourceHeight : sourceWidth
}

function displayHeightForTransform(sourceWidth, sourceHeight, normalizedAngle) {
  return normalizedAngle === 90 || normalizedAngle === 270 ? sourceWidth : sourceHeight
}

function getAssetTransformState(asset, config) {
  const saved = asset?.id ? config?.cropAreas?.[asset.id] : null
  return {
    angle: Number(saved?.angle ?? config?.angle ?? 0) || 0,
    flipHorizontal: Boolean(saved?.flipHorizontal ?? config?.flipHorizontal),
    flipVertical: Boolean(saved?.flipVertical ?? config?.flipVertical),
    viewScale: Math.max(0.5, Number(saved?.viewScale ?? config?.viewScale ?? 1) || 1),
    viewOffsetX: Math.round(Number(saved?.viewOffsetX ?? config?.viewOffsetX ?? 0) || 0),
    viewOffsetY: Math.round(Number(saved?.viewOffsetY ?? config?.viewOffsetY ?? 0) || 0),
  }
}

function composeSvgMatrix(first, second) {
  const [a1, b1, c1, d1, e1, f1] = first
  const [a2, b2, c2, d2, e2, f2] = second
  return [
    a2 * a1 + c2 * b1,
    b2 * a1 + d2 * b1,
    a2 * c1 + c2 * d1,
    b2 * c1 + d2 * d1,
    a2 * e1 + c2 * f1 + e2,
    b2 * e1 + d2 * f1 + f2,
  ]
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

import { TOOL_MAP } from '../config/tools.js'
import { renderSideNav } from './SideNav.js'
import { renderTopBar } from './TopBar.js'
import { renderImageQueue } from './ImageQueueList.js'
import { renderToolPage } from '../pages/index.js'
import { renderIcon } from './icons.js'

export function getAppShellMode(state) {
  const tool = TOOL_MAP[state.activeTool]
  const isResultView = !!state.resultView?.items?.length
  const isSettingsView = !!state.settingsDialog?.visible
  if (tool.mode === 'manual' && !isResultView) return 'manual'
  if (isSettingsView) return 'settings'
  if (isResultView) return 'result'
  return 'workspace'
}

export function renderAppShell(state, queueMarkup = null) {
  const mode = getAppShellMode(state)
  const fullScreenWorkspace = mode === 'result' || mode === 'settings'

  if (mode === 'manual') {
    return renderToolPage(TOOL_MAP[state.activeTool].id, state)
  }

  return `
    <div class="app-shell ${state.sidebarCollapsed ? 'app-shell--sidebar-collapsed' : ''} ${fullScreenWorkspace ? 'app-shell--workspace-overlay' : ''}">
      <div class="render-slot" data-root="side-nav">${renderShellSideNav(state, mode)}</div>
      <div class="render-slot" data-root="topbar">${renderShellTopBar(state, mode)}</div>
      <div class="render-slot" data-root="workspace">${renderShellWorkspace(state, queueMarkup, mode)}</div>
      <div class="render-slot" data-root="overlays">${renderShellOverlays(state)}</div>
    </div>
  `
}

export function renderShellSideNav(state, mode = getAppShellMode(state)) {
  if (mode === 'result' || mode === 'settings') return ''
  return renderSideNav(state.activeTool, state.sidebarCollapsed)
}

export function renderShellTopBar(state, mode = getAppShellMode(state)) {
  if (mode === 'result' || mode === 'settings') return ''
  return renderTopBar(state)
}

export function renderShellWorkspace(state, queueMarkup = null, mode = getAppShellMode(state)) {
  if (mode === 'settings') {
    return `<div class="workspace--settings" data-scroll-role="settings">${renderSettingsWorkspace(state.settingsDialog)}</div>`
  }
  if (mode === 'result') {
    return `<div class="workspace workspace--result">${renderResultWorkspace(state)}</div>`
  }
  const queueContent = queueMarkup ?? renderImageQueue(state)
  const tool = TOOL_MAP[state.activeTool]
  return `
    <div class="workspace">
      <div class="render-slot" data-root="panel">${renderToolPage(tool.id, state)}</div>
      <div class="render-slot" data-root="queue">${queueContent}</div>
    </div>
  `
}

export function renderShellOverlays(state) {
  return `
    ${renderPresetModal(state)}
    ${renderConfirmModal(state.confirmDialog)}
    ${renderPreviewModal(state.previewModal)}
  `
}

function renderSettingsWorkspace(dialog) {
  if (!dialog?.visible) return ''

  const mode = dialog.saveLocationMode || 'source'
  const customPath = dialog.saveLocationCustomPath || ''
  const performanceMode = dialog.performanceMode || 'balanced'
  const queueThumbnailSize = dialog.queueThumbnailSize || '128'
  const options = [
    ['source', '原图目录'],
    ['downloads', '下载目录'],
    ['pictures', '图片目录'],
    ['desktop', '桌面'],
    ['custom', '手动选择'],
  ]
  const performanceOptions = [
    ['compatible', '兼容'],
    ['balanced', '均衡'],
    ['max', '高性能'],
  ]
  const queueThumbnailOptions = [
    ['60', '极低'],
    ['100', '低'],
    ['128', '中'],
    ['160', '高'],
    ['192', '极高'],
  ]

  return `
    <section class="settings-page">
      <div class="settings-page__header">
        <div>
          <h2 class="hero-title">设置</h2>
          <div class="queue-subtitle">配置默认图片保存位置与基础偏好</div>
        </div>
        <button class="secondary-button settings-page__action settings-page__action--secondary" data-action="close-settings-modal">返回</button>
      </div>
      <div class="settings-page__content">
        <div class="settings-panel">
          <div class="settings-panel__group">
            <div class="settings-panel__label">默认保存位置</div>
            <div class="select-shell settings-select ${dialog.settingsSelectOpen ? 'is-open' : ''}">
              <button type="button" class="select-shell__value" data-action="toggle-config-select" aria-haspopup="listbox" aria-expanded="${dialog.settingsSelectOpen ? 'true' : 'false'}">
                <span class="select-shell__text">${escapeHtml((options.find(([value]) => value === mode) || options[0])[1])}</span>
                ${renderIcon('expand_more', 'select-shell__icon')}
              </button>
              <div class="select-shell__menu" role="listbox">
                ${options.map(([value, label]) => `
                <button
                  type="button"
                  class="select-shell__option ${mode === value ? 'is-active' : ''}"
                  data-action="set-settings-save-mode"
                  data-value="${value}"
                >${label}</button>
                `).join('')}
              </div>
            </div>
          </div>
          <div class="settings-panel__group">
            <div class="settings-panel__label">当前路径</div>
            <div class="settings-path-row">
              <div class="settings-path">${escapeHtml(getSaveLocationSummary(mode, customPath))}</div>
              ${mode === 'custom'
                ? `<button type="button" class="secondary-button" data-action="pick-settings-custom-path">选择位置</button>`
                : ''}
            </div>
          </div>
          <div class="settings-panel__group">
            <div class="settings-panel__label">性能模式</div>
            <div class="select-shell settings-select ${dialog.performanceSelectOpen ? 'is-open' : ''}">
              <button type="button" class="select-shell__value" data-action="toggle-config-select" aria-haspopup="listbox" aria-expanded="${dialog.performanceSelectOpen ? 'true' : 'false'}">
                <span class="select-shell__text">${escapeHtml((performanceOptions.find(([value]) => value === performanceMode) || performanceOptions[1])[1])}</span>
                ${renderIcon('expand_more', 'select-shell__icon')}
              </button>
              <div class="select-shell__menu" role="listbox">
                ${performanceOptions.map(([value, label]) => `
                <button
                  type="button"
                  class="select-shell__option ${performanceMode === value ? 'is-active' : ''}"
                  data-action="set-settings-performance-mode"
                  data-value="${value}"
                >${label}</button>
                `).join('')}
              </div>
            </div>
            <div class="queue-subtitle">${escapeHtml(getPerformanceSummary(performanceMode))}</div>
          </div>
          <div class="settings-panel__group">
            <div class="settings-panel__label">队列缩略图质量</div>
            <div class="select-shell settings-select">
              <button type="button" class="select-shell__value" data-action="toggle-config-select" aria-haspopup="listbox" aria-expanded="false">
                <span class="select-shell__text">${escapeHtml((queueThumbnailOptions.find(([value]) => value === queueThumbnailSize) || queueThumbnailOptions[2])[1])}</span>
                ${renderIcon('expand_more', 'select-shell__icon')}
              </button>
              <div class="select-shell__menu" role="listbox">
                ${queueThumbnailOptions.map(([value, label]) => `
                <button
                  type="button"
                  class="select-shell__option ${queueThumbnailSize === value ? 'is-active' : ''}"
                  data-action="set-settings-queue-thumbnail-size"
                  data-value="${value}"
                >${label}</button>
                `).join('')}
              </div>
            </div>
            <div class="queue-subtitle">${escapeHtml(getQueueThumbnailSummary(queueThumbnailSize))}</div>
            ${queueThumbnailSize === '192'
              ? '<div class="queue-subtitle">极高档位会生成更大的队列缩略图，并显著增加解码、内存与绘制开销。在大批量图片或全屏场景下，界面响应可能变慢，建议仅在确实需要更高清缩略图时启用。</div>'
              : ''}
          </div>
          <div class="settings-panel__group">
            <div class="settings-panel__label">预览缓存</div>
            <div class="settings-path-row">
              <div class="settings-path">清空当前设备临时目录下的 Imgbatch Preview 缓存</div>
              <button type="button" class="secondary-button settings-page__action settings-page__action--secondary" data-action="clear-preview-cache-directory">清空缓存</button>
            </div>
          </div>
        </div>
        <div class="settings-page__actions">
          <button type="button" class="secondary-button settings-page__action settings-page__action--secondary" data-action="close-settings-modal">取消</button>
          <button type="button" class="primary-button settings-page__action settings-page__action--primary" data-action="save-settings-dialog">保存设置</button>
        </div>
      </div>
    </section>
  `
}

function renderPresetModal(state) {
  const dialog = state.presetDialog
  if (!dialog?.visible) return ''
  if (dialog.mode === 'rotate-presets') {
    return renderRotatePresetModal(dialog)
  }

  const presets = state.presetsByTool?.[dialog.toolId] || []
  const toolLabel = TOOL_MAP[dialog.toolId]?.label || dialog.toolId
  const modeTitle = dialog.mode === 'save' ? '保存预设' : dialog.mode === 'rename' ? '重命名预设' : '使用预设'

  return `
    <div class="app-modal" data-action="close-preset-dialog">
      <div class="app-modal__dialog app-modal__dialog--preset">
        <button class="app-modal__close" data-action="close-preset-dialog" data-tooltip="关闭" aria-label="关闭">
          ${renderIcon('close')}
        </button>
        <div class="app-modal__header">
          <div class="app-modal__title">${modeTitle}</div>
          <div class="app-modal__subtitle">${escapeHtml(toolLabel)}</div>
        </div>
        ${(dialog.mode === 'save' || dialog.mode === 'rename')
          ? `
            <div class="preset-form">
              <label class="setting-row setting-row--stack">
                <span class="setting-row__header">
                  <span class="setting-row__label">预设名称</span>
                </span>
                <input class="text-input" data-action="change-preset-name" value="${escapeHtml(dialog.name || '')}" placeholder="例如：电商白底图" />
              </label>
              <label class="checkbox-row">
                <input type="checkbox" data-action="toggle-preset-default" ${dialog.setAsDefault ? 'checked' : ''} />
                <span>设为当前工具默认配置</span>
              </label>
            </div>
          `
          : `
            <div class="preset-picker">
              ${presets.length
                ? presets.map((preset) => `
                    <button
                      type="button"
                      class="preset-card ${dialog.selectedPresetId === preset.id ? 'is-active' : ''}"
                      data-action="select-preset"
                      data-preset-id="${preset.id}"
                    >
                      <span class="preset-card__name">${escapeHtml(preset.name || '未命名预设')}</span>
                      <span class="preset-card__meta">${escapeHtml(formatPresetTime(preset.createdAt))}</span>
                    </button>
                  `).join('')
                : '<div class="preset-empty">当前工具还没有保存过预设。</div>'}
              <label class="checkbox-row">
                <input type="checkbox" data-action="toggle-preset-default" ${dialog.setAsDefault ? 'checked' : ''} />
                <span>设为当前工具默认配置</span>
              </label>
            </div>
          `}
        <div class="app-modal__footer">
          <button type="button" class="secondary-button" data-action="close-preset-dialog">取消</button>
          ${dialog.mode === 'apply' && dialog.selectedPresetId
            ? `<button type="button" class="secondary-button" data-action="rename-selected-preset">重命名</button>`
            : ''}
          ${dialog.mode === 'apply' && dialog.selectedPresetId
            ? `<button type="button" class="secondary-button" data-action="delete-selected-preset">删除</button>`
            : ''}
          <button
            type="button"
            class="primary-button"
            data-action="${dialog.mode === 'save' ? 'confirm-save-preset' : dialog.mode === 'rename' ? 'confirm-rename-preset' : 'confirm-apply-preset'}"
            ${dialog.mode === 'apply' && !dialog.selectedPresetId ? 'disabled' : ''}
          >${dialog.mode === 'save' ? '保存预设' : dialog.mode === 'rename' ? '保存名称' : '应用预设'}</button>
        </div>
      </div>
    </div>
  `
}

function renderRotatePresetModal(dialog) {
  const draftAngles = Array.isArray(dialog.presetAnglesDraft) ? dialog.presetAnglesDraft : []

  return `
    <div class="app-modal" data-action="close-preset-dialog">
      <div class="app-modal__dialog app-modal__dialog--preset app-modal__dialog--rotate-presets">
        <button class="app-modal__close" data-action="close-preset-dialog" data-tooltip="关闭" aria-label="关闭">
          ${renderIcon('close')}
        </button>
        <div class="app-modal__header">
          <div class="app-modal__title">常用角度调整</div>
          <div class="app-modal__subtitle">旋转</div>
        </div>
        <div class="rotate-preset-manager">
          <div class="rotate-preset-manager__input-row">
            <label class="setting-row setting-row--stack">
              <span class="setting-row__header">
                <span class="setting-row__label">添加角度</span>
              </span>
              <span class="input-shell">
                <input
                  class="text-input"
                  type="number"
                  inputmode="numeric"
                  min="-360"
                  max="360"
                  step="1"
                  value="${escapeHtml(dialog.angleInput || '')}"
                  placeholder="例如 30"
                  data-action="change-rotate-preset-input"
                  aria-label="输入要加入常用角度的数值"
                />
              </span>
            </label>
            <div class="rotate-preset-manager__toolbar">
              <button type="button" class="secondary-button secondary-button--compact watermark-picker-button" data-action="add-rotate-preset-dialog-item">添加角度</button>
              <button type="button" class="secondary-button secondary-button--compact watermark-picker-button" data-action="sort-rotate-preset-dialog-items">按角度排序</button>
              <button type="button" class="secondary-button secondary-button--compact watermark-picker-button" data-action="reset-rotate-preset-dialog-items">恢复默认</button>
            </div>
          </div>
          <div class="rotate-preset-manager__list">
            ${draftAngles.length
              ? draftAngles.map((angle, index) => `
                  <div class="rotate-preset-manager__item">
                    <div class="rotate-preset-manager__value">${escapeHtml(`${angle}°`)}</div>
                    <div class="rotate-preset-manager__item-actions">
                      <button type="button" class="icon-button" data-action="move-rotate-preset-dialog-item" data-direction="up" data-index="${index}" aria-label="上移" ${index === 0 ? 'disabled' : ''}>
                        ${renderIcon('keyboard_arrow_up')}
                      </button>
                      <button type="button" class="icon-button" data-action="move-rotate-preset-dialog-item" data-direction="down" data-index="${index}" aria-label="下移" ${index === draftAngles.length - 1 ? 'disabled' : ''}>
                        ${renderIcon('keyboard_arrow_down')}
                      </button>
                      <button type="button" class="icon-button" data-action="remove-rotate-preset-dialog-item" data-index="${index}" aria-label="删除">
                        ${renderIcon('delete')}
                      </button>
                    </div>
                  </div>
                `).join('')
              : '<div class="preset-empty">当前还没有常用角度，添加后会显示在这里。</div>'}
          </div>
        </div>
        <div class="app-modal__footer">
          <button type="button" class="secondary-button" data-action="close-preset-dialog">取消</button>
          <button type="button" class="primary-button" data-action="confirm-rotate-preset-dialog">保存调整</button>
        </div>
      </div>
    </div>
  `
}

function renderConfirmModal(dialog) {
  if (!dialog?.visible) return ''

  return `
    <div class="app-modal" data-action="close-confirm-dialog">
      <div class="app-modal__dialog app-modal__dialog--preset">
        <button class="app-modal__close" data-action="close-confirm-dialog" data-tooltip="关闭" aria-label="关闭">
          ${renderIcon('close')}
        </button>
        <div class="app-modal__header">
          <div class="app-modal__title">${escapeHtml(dialog.title || '请确认')}</div>
          ${dialog.subtitle ? `<div class="app-modal__subtitle">${escapeHtml(dialog.subtitle)}</div>` : ''}
        </div>
        <div class="preset-empty">${escapeHtml(dialog.message || '')}</div>
        <div class="app-modal__footer">
          <button type="button" class="secondary-button" data-action="close-confirm-dialog">取消</button>
          <button type="button" class="primary-button" data-action="${escapeHtml(dialog.confirmAction || '')}">${escapeHtml(dialog.confirmLabel || '确认')}</button>
        </div>
      </div>
    </div>
  `
}

function renderResultWorkspace(state) {
  const resultView = state.resultView
  if (!resultView?.items?.length) return ''

  const failedCount = resultView.failed?.length || 0
  const summary = failedCount
    ? `共 ${resultView.items.length} 项，失败 ${failedCount} 项`
    : `共 ${resultView.items.length} 项`
  const subtitle = [
    summary,
    resultView.elapsedMs ? `耗时 ${formatElapsed(resultView.elapsedMs)}` : '',
    getResultTotalSizeText(resultView.totalSourceSizeBytes, resultView.totalResultSizeBytes),
  ].filter(Boolean).join(' · ')

  return `
    <section class="result-page">
      <div class="result-page__header">
        <div>
          <h2 class="hero-title">处理结果对比</h2>
          <div class="queue-subtitle">${subtitle}</div>
        </div>
      </div>
      <div class="result-page__list">
        ${resultView.items.map((item) => `
          <section class="result-page__card">
            <div class="result-page__stats">
              ${renderResultStrip(
                '原',
                formatBytes(item.source?.sizeBytes || 0),
                item.source?.dimensionsText || formatDimensions(item.source?.width, item.source?.height),
              )}
              ${renderResultStrip(
                '后',
                formatSizeWithDelta(
                  formatBytes(item.result?.sizeBytes || 0),
                  getSizeDeltaText(item.source?.sizeBytes || 0, item.result?.sizeBytes || 0),
                  getSizeDeltaPercentText(item.source?.sizeBytes || 0, item.result?.sizeBytes || 0),
                ),
                formatResultStat(
                  formatDimensions(item.result?.width, item.result?.height),
                  item.source?.isAggregate
                    ? ''
                    : formatDimensionDelta(
                      item.source?.width || 0,
                      item.source?.height || 0,
                      item.result?.width || 0,
                      item.result?.height || 0,
                    ),
                ),
              )}
            </div>
            ${item.outputPath
              ? `<button class="secondary-button result-page__open" data-action="open-result-path" data-path="${escapeHtml(item.outputPath)}">打开目录</button>`
              : ''}
          </section>
        `).join('')}
      </div>
    </section>
  `
}

function formatElapsed(value = 0) {
  const elapsedMs = Math.max(0, Number(value) || 0)
  if (elapsedMs < 1000) return `${elapsedMs} ms`
  const seconds = elapsedMs / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 1 : 2)} 秒`
  const minutes = Math.floor(seconds / 60)
  const remainSeconds = seconds % 60
  return `${minutes} 分 ${remainSeconds.toFixed(remainSeconds >= 10 ? 0 : 1)} 秒`
}

function renderResultStrip(label, size, dimensions) {
  const normalizedSize = String(size || '0 B')
  const normalizedDimensions = String(dimensions || '-')
  return `
    <div class="result-strip">
      <span class="result-strip__label">${escapeHtml(label)}</span>
      <span class="result-strip__value">
        <span class="result-strip__marquee">${escapeHtml(normalizedSize)}</span>
      </span>
      <span class="result-strip__meta">
        <span class="result-strip__marquee">${escapeHtml(normalizedDimensions)}</span>
      </span>
    </div>
  `
}

function renderPreviewModal(preview) {
  if (!preview?.url) return ''
  if (preview.compareMode !== 'split') {
    return renderInteractivePreviewModal(preview)
  }
  const beforeUrl = preview.beforeUrl || preview.url
  const afterUrl = preview.afterUrl || preview.url
  const beforeWidth = Number(preview.sourceWidth) || 1
  const beforeHeight = Number(preview.sourceHeight) || 1
  const afterWidth = Number(preview.compareWidth) || 1
  const afterHeight = Number(preview.compareHeight) || 1
  const beforeAspect = Math.max(0.1, beforeWidth / beforeHeight)
  const afterAspect = Math.max(0.1, afterWidth / afterHeight)
  const compareZoom = Number.isFinite(Number(preview.compareZoom))
    ? Math.max(1, Math.min(5, Number(preview.compareZoom)))
    : 1
  const compareOffsetX = Number(preview.compareOffsetX) || 0
  const compareOffsetY = Number(preview.compareOffsetY) || 0
  const isExpanded = !!preview.expanded
  const labelsHidden = !!preview.compareLabelsHidden
  const helpOpen = !!preview.helpOpen
  return `
    <div class="preview-modal ${isExpanded ? 'preview-modal--expanded' : ''}" data-preview-overlay="true">
      <div class="preview-modal__dialog preview-modal__dialog--compare ${isExpanded ? 'preview-modal__dialog--expanded' : ''}">
        ${renderPreviewActions({ mode: 'split', isExpanded, canSave: !!preview.canSave })}
        ${helpOpen ? renderPreviewHelp('split') : ''}
        <div class="preview-modal__compare preview-modal__compare--split">
          <section class="preview-compare-card">
            <div class="preview-modal__body preview-modal__body--split" style="--preview-split-aspect:${beforeAspect}; --preview-compare-zoom:${compareZoom}; --preview-compare-offset-x:${compareOffsetX}px; --preview-compare-offset-y:${compareOffsetY}px;">
              <img src="${beforeUrl}" alt="${escapeHtml(preview.name || '\u539f\u56fe')}" />
              <button class="preview-modal__split-label preview-modal__split-label--left ${labelsHidden ? 'is-hidden' : ''}" data-action="toggle-preview-compare-labels" type="button">\u539f\u56fe</button>
            </div>
          </section>
          <section class="preview-compare-card">
            <div class="preview-modal__body preview-modal__body--split" style="--preview-split-aspect:${afterAspect}; --preview-compare-zoom:${compareZoom}; --preview-compare-offset-x:${compareOffsetX}px; --preview-compare-offset-y:${compareOffsetY}px;">
              <img src="${afterUrl}" alt="${escapeHtml(preview.name || '\u5904\u7406\u540e')}" />
              <button class="preview-modal__split-label preview-modal__split-label--right ${labelsHidden ? 'is-hidden' : ''}" data-action="toggle-preview-compare-labels" type="button">\u5904\u7406\u540e</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  `
}

function renderInteractivePreviewModal(preview) {
  if (!preview?.url) return ''
  const beforeUrl = preview.beforeUrl || preview.url
  const afterUrl = preview.afterUrl || preview.url
  const compareRatio = Number.isFinite(Number(preview.compareRatio))
    ? Math.max(0, Math.min(1, Number(preview.compareRatio)))
    : 0.5
  const compareZoom = Number.isFinite(Number(preview.compareZoom))
    ? Math.max(1, Math.min(5, Number(preview.compareZoom)))
    : 1
  const compareOffsetX = Number(preview.compareOffsetX) || 0
  const compareOffsetY = Number(preview.compareOffsetY) || 0
  const compareWidth = Number(preview.compareWidth) || 1
  const compareHeight = Number(preview.compareHeight) || 1
  const compareAspect = Math.max(0.1, compareWidth / compareHeight)
  const comparePercent = `${Math.round(compareRatio * 1000) / 10}%`
  const isExpanded = !!preview.expanded
  const labelsHidden = !!preview.compareLabelsHidden
  const helpOpen = !!preview.helpOpen
  return `
    <div class="preview-modal ${isExpanded ? 'preview-modal--expanded' : ''}" data-preview-overlay="true">
      <div class="preview-modal__dialog preview-modal__dialog--compare ${isExpanded ? 'preview-modal__dialog--expanded' : ''}">
        ${renderPreviewActions({ mode: 'slider', isExpanded, canSave: !!preview.canSave })}
        ${helpOpen ? renderPreviewHelp('slider') : ''}
        <div class="preview-modal__compare-shell">
          <div class="preview-modal__compare">
            <div class="preview-compare-stage" data-action="drag-preview-compare" data-role="preview-compare-stage">
              <div class="preview-modal__body preview-modal__body--compare" style="--preview-compare-zoom:${compareZoom}; --preview-compare-aspect:${compareAspect}; --preview-compare-offset-x:${compareOffsetX}px; --preview-compare-offset-y:${compareOffsetY}px;">
                <div class="preview-compare-stage__layer preview-compare-stage__layer--after">
                  <img class="preview-compare-stage__image preview-compare-stage__image--after" src="${afterUrl}" alt="${escapeHtml(preview.name || '\u5904\u7406\u540e')}" draggable="false" />
                </div>
                <div class="preview-compare-stage__layer preview-compare-stage__layer--before" style="clip-path: inset(0 calc(100% - ${comparePercent}) 0 0);">
                  <img class="preview-compare-stage__image preview-compare-stage__image--before" src="${beforeUrl}" alt="${escapeHtml(preview.name || '\u539f\u56fe')}" draggable="false" />
                </div>
                <div class="preview-modal__compare-head ${labelsHidden ? 'is-hidden' : ''}" data-action="toggle-preview-compare-labels">
                  <span class="preview-compare-card__label">\u539f\u56fe</span>
                  <span class="preview-compare-card__label">\u5904\u7406\u540e</span>
                </div>
                <div class="preview-compare-stage__divider" style="left:${comparePercent}" data-action="drag-preview-compare">
                  <span class="preview-compare-stage__handle" aria-hidden="true"></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
}

function renderPreviewActions({ mode = 'slider', isExpanded = false, canSave = false } = {}) {
  const fullscreenButton = mode === 'split'
    ? `
          <button class="preview-modal__close" data-action="toggle-preview-compare-fullscreen" data-tooltip="${isExpanded ? '\u7f29\u5c0f\u663e\u793a' : '\u5168\u5c4f\u663e\u793a'}" aria-label="${isExpanded ? '\u7f29\u5c0f\u663e\u793a' : '\u5168\u5c4f\u663e\u793a'}">
            ${renderIcon(isExpanded ? 'fullscreen_exit' : 'fullscreen')}
          </button>`
    : ''
  const saveButton = canSave
    ? `
          <button class="preview-modal__close" data-action="save-preview-result" data-tooltip="保存当前预览" aria-label="保存当前预览">
            ${renderIcon('save')}
          </button>`
    : ''
  return `
        <div class="preview-modal__actions">
          ${saveButton}
          <button class="preview-modal__close" data-action="toggle-preview-help" data-tooltip="查看操作说明" aria-label="查看操作说明">
            ${renderIcon('help')}
          </button>${fullscreenButton}
          <button class="preview-modal__close" data-action="close-preview-modal" data-tooltip="\u5173\u95ed" aria-label="\u5173\u95ed">
            ${renderIcon('close')}
          </button>
        </div>`
}

function renderPreviewHelp(mode = 'slider') {
  const modeTips = mode === 'split'
    ? [
        '滚轮可同步放大或缩小两张图片。',
        '放大后可按住左键或右键拖拽图片位置查看边缘细节。',
        '点击左下角“原图”或右下角“处理后”可切换角标显示。',
        '点击右上角全屏按钮可在悬浮与全屏查看之间切换。',
      ]
    : [
        '滚轮可放大或缩小当前对比图片。',
        '放大后可按住右键拖拽图片位置查看边缘细节。',
        '按住左键拖动中线可调整处理前后的对比范围。',
        '双击图片可快速回到中线 50% 位置。',
        '点击底部角标可切换“原图 / 处理后”标签显示。',
      ]
  return `
    <div class="preview-modal__help">
      <div class="preview-modal__help-title">操作说明</div>
      <ul class="preview-modal__help-list">
        ${modeTips.map((item) => `<li>${item}</li>`).join('')}
        <li>按 Esc 可退出当前预览；双栏全屏模式下会先退出全屏。</li>
        <li>点击图片外区域或右上角关闭按钮也可退出预览。</li>
      </ul>
    </div>
  `
}

function formatBytes(bytes = 0) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

function formatDimensions(width = 0, height = 0) {
  return `${width || '-'} × ${height || '-'}`
}

function formatResultStat(value, delta) {
  if (!delta || delta === '0' || delta === '0 B' || delta === '0 / 0') return value
  return `${value} (${delta})`
}

function getSizeDeltaText(before = 0, after = 0) {
  const delta = Number(after || 0) - Number(before || 0)
  if (!delta) return '0 B'
  const prefix = delta > 0 ? '+' : '-'
  return `${prefix}${formatBytes(Math.abs(delta))}`
}

function getSizeDeltaPercentText(before = 0, after = 0) {
  const base = Number(before || 0)
  const next = Number(after || 0)
  if (!base) return next ? 'new' : '0%'
  const percent = ((next - base) / base) * 100
  if (!percent) return '0%'
  const prefix = percent > 0 ? '+' : ''
  return `${prefix}${percent.toFixed(Math.abs(percent) >= 10 ? 0 : 1)}%`
}

function formatSizeWithDelta(value, delta, percent) {
  const details = [delta, percent].filter((item) => item && item !== '0 B' && item !== '0%')
  return details.length ? `${value} (${details.join(' / ')})` : value
}

function getResultTotalSizeText(before = 0, after = 0) {
  return `总体积 ${formatSizeWithDelta(
    formatBytes(after || 0),
    getSizeDeltaText(before, after),
    getSizeDeltaPercentText(before, after),
  )}`
}

function getDimensionDeltaText(before = 0, after = 0) {
  const delta = Number(after || 0) - Number(before || 0)
  if (!delta) return '0'
  return `${delta > 0 ? '+' : ''}${delta}`
}

function formatDimensionDelta(beforeWidth = 0, beforeHeight = 0, afterWidth = 0, afterHeight = 0) {
  return `${getDimensionDeltaText(beforeWidth, afterWidth)} / ${getDimensionDeltaText(beforeHeight, afterHeight)}`
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function getSaveLocationSummary(mode, customPath) {
  if (mode === 'source') return '原图所在目录'
  if (mode === 'downloads') return '系统下载目录'
  if (mode === 'pictures') return '系统图片目录'
  if (mode === 'desktop') return '桌面'
  return customPath || '未选择自定义目录'
}

function getPerformanceSummary(mode) {
  if (mode === 'compatible') return '较低资源占用，适合老机器或后台并行工作。'
  if (mode === 'max') return '优先处理速度，会更积极使用 CPU 与内存。'
  return '默认推荐模式，兼顾速度、稳定性与资源占用。'
}

function getQueueThumbnailSummary(size) {
  if (size === '60') return '极低：最轻量，优先降低列表解码与绘制压力，清晰度最低。'
  if (size === '100') return '低：比默认更省资源，适合更关注流畅度的场景。'
  if (size === '160') return '高：缩略图更清晰，但会增加一定的内存与绘制开销。'
  if (size === '192') return '极高：优先保证列表缩略图清晰度，资源占用最高。'
  return '中：默认推荐档位，在清晰度与性能之间保持较均衡的表现。'
}

function formatPresetTime(value) {
  if (!value) return '未记录时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

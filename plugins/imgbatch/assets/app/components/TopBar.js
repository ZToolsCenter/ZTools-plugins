import { TOOL_MAP } from '../config/tools.js'
import { renderIcon } from './icons.js'

function isMergeProcessing(state) {
  if (!state?.isProcessing) return false
  const toolId = state.processingProgress?.toolId || state.activeTool
  return toolId === 'merge-pdf' || toolId === 'merge-image' || toolId === 'merge-gif'
}

function getProcessButtonLabel(state) {
  if (!state.isProcessing) return '开始处理'
  const progress = state.processingProgress
  const toolId = progress?.toolId || state.activeTool
  if (toolId === 'merge-pdf') {
    return progress?.phase === 'merge-pdf-prepare' ? '预处理中' : '生成 PDF 中'
  }
  return `${progress?.completed || 0}/${progress?.total || 0} 处理中`
}

export function renderTopBar(state) {
  const tool = TOOL_MAP[state.activeTool]
  const sidebarLabel = state.sidebarCollapsed ? '展开导航' : '收起导航'
  const sidebarIcon = state.sidebarCollapsed ? 'right_panel_open' : 'left_panel_close'
  const processButtonClassName = `primary-button${state.isProcessing ? ' is-processing' : ''}${isMergeProcessing(state) ? ' is-processing--merge' : ''}`

  return `
    <header class="topbar">
      <div class="topbar__heading">
        <button type="button" class="icon-button topbar__toggle" data-action="toggle-sidebar" data-tooltip="${sidebarLabel}" aria-label="${sidebarLabel}">
          ${renderIcon(sidebarIcon)}
        </button>
        <div class="topbar__title-block">
          <div class="topbar__title">${tool.label}</div>
        </div>
      </div>
      <div class="topbar__actions">
        <div class="topbar__meta">
          ${state.isProcessing
            ? `<button class="secondary-button topbar__stop-button" data-action="cancel-current-run" ${state.cancelRequested ? 'disabled' : ''}>
                ${state.cancelRequested ? '停止中' : '停止任务'}
              </button>`
            : ''}
          <button class="${processButtonClassName}" data-action="process-current" ${state.isProcessing ? 'disabled' : ''}>
            ${getProcessButtonLabel(state)}
          </button>
        </div>
      </div>
    </header>
  `
}

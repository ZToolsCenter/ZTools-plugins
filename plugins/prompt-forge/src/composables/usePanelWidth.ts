import { ref } from 'vue'
import { useAppSettings } from '../stores/app'

interface PanelWidthOptions {
  /** 未调节时的默认宽度（px） */
  defaultWidth: number
  min: number
  max: number
  /**
   * 拖拽手柄位于面板的哪一侧：
   * - `right`：手柄在面板右边缘，向右拖变宽（左侧面板）
   * - `left`：手柄在面板左边缘，向左拖变宽（右侧面板）
   */
  handleEdge?: 'left' | 'right'
}

/**
 * 面板宽度拖拽调节，松手后写入设置持久化，下次启动自动恢复。
 * 宽度通过 CSS 变量下发，组件媒体查询覆盖布局时不影响折叠态。
 * 拖拽基于 mouse 事件实现（见 startResize 注释）。
 */
export function usePanelWidth(key: string, options: PanelWidthOptions) {
  const appSettings = useAppSettings()
  const handleEdge = options.handleEdge ?? 'right'

  function clamp(value: number): number {
    return Math.min(options.max, Math.max(options.min, Math.round(value)))
  }

  const saved = appSettings.settings.value.panelWidths?.[key]
  const width = ref(clamp(typeof saved === 'number' && Number.isFinite(saved) ? saved : options.defaultWidth))

  async function persist() {
    appSettings.settings.value.panelWidths = {
      ...(appSettings.settings.value.panelWidths || {}),
      [key]: width.value,
    }
    try {
      await appSettings.save()
    } catch (error) {
      console.error(`[panel-width] 保存「${key}」宽度失败:`, error)
    }
  }

  // 用 mouse 事件而非 Pointer Events：ZTools 插件 WebView 中 pointermove 不可靠，
  // 而项目只面向桌面端，无需触屏支持
  function startResize(event: MouseEvent) {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width.value
    const direction = handleEdge === 'right' ? 1 : -1
    document.body.classList.add('pf-panel-resizing')

    const onMove = (ev: MouseEvent) => {
      width.value = clamp(startWidth + (ev.clientX - startX) * direction)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.classList.remove('pf-panel-resizing')
      void persist()
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  /** 双击手柄恢复默认宽度 */
  function resetWidth() {
    if (width.value === options.defaultWidth) return
    width.value = options.defaultWidth
    void persist()
  }

  return { width, startResize, resetWidth }
}

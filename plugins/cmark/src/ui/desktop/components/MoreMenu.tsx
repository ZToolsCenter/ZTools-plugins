/**
 * 「更多」菜单：V1.0.0 编辑器头部右上角第 4 个按钮
 *
 * 菜单项（顺序与 V1.0.0 一致）：
 *   源码模式 (Ctrl+Alt+/)   /  关闭源码模式
 *   [非源码模式] 隐藏编辑工具栏 / 显示编辑工具栏
 *   [非源码模式] 正文字号：紧凑 12 · 偏小 13 · 默认 14 · 偏大 15 · 舒适 16
 *   ─────────────
 *   导出为 Markdown 文件
 *   导出为 Html 文件
 *   导出为 PDF 文件
 *   导出为图像文件
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNotes } from '../../../service/store/notes'
import { exportNote, type ExportKind } from '../../../service/export/export-note'

/** V1.0.0 的五档字号 */
const SIZES: { size: number; label: string }[] = [
  { size: 12, label: '紧凑' },
  { size: 13, label: '偏小' },
  { size: 14, label: '默认' },
  { size: 15, label: '偏大' },
  { size: 16, label: '舒适' },
]

export function MoreMenu() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const currentRel = useNotes((s) => s.currentRel)
  const content = useNotes((s) => s.content)
  const setMessage = useNotes((s) => s.setMessage)
  const sourceMode = useNotes((s) => s.sourceMode)
  const toolbarHidden = useNotes((s) => s.toolbarHidden)
  const toggleToolbar = useNotes((s) => s.toggleToolbar)
  const bodyFontSize = useNotes((s) => s.bodyFontSize)
  const setBodyFontSize = useNotes((s) => s.setBodyFontSize)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const run = useCallback(
    async (kind: ExportKind) => {
      if (!currentRel) return
      setOpen(false)
      // 统一走 core/export-note：快照编辑区 DOM，所见即所得。
      // 以前这里自己用 marked 渲染了一遍，还读不存在的 window.services，
      // 点了导出什么都不发生。
      await exportNote(kind, { rel: currentRel, content, setMessage, setBusy })
    },
    [currentRel, content, setMessage]
  )

  if (!currentRel) return null

  return (
    <div className="more-wrap" ref={ref}>
      <button
        className={'iconbtn' + (open ? ' on' : '')}
        type="button"
        title="更多"
        onClick={() => setOpen((v) => !v)}
        disabled={!!busy}
      >
        {busy ? (
          <span className="export-spin" />
        ) : (
          <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor">
            <circle cx="8" cy="3" r="1.35" />
            <circle cx="8" cy="8" r="1.35" />
            <circle cx="8" cy="13" r="1.35" />
          </svg>
        )}
      </button>

      {open ? (
        <div className="more-menu">
          {!sourceMode ? (
            <>
              <button
                type="button"
                className="more-item"
                onClick={() => {
                  setOpen(false)
                  toggleToolbar()
                }}
              >
                {toolbarHidden ? '显示编辑工具栏' : '隐藏编辑工具栏'}
              </button>

              <div className="more-fontsize">
                <span className="more-flabel">正文字号</span>
                <div className="more-seg">
                  {SIZES.map((z) => (
                    <button
                      key={z.size}
                      type="button"
                      className={'more-segbtn' + (bodyFontSize === z.size ? ' on' : '')}
                      title={z.label + ' ' + z.size + 'px'}
                      onClick={() => setBodyFontSize(z.size)}
                    >
                      {z.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : null}

          <div className="more-divider" />

          <button type="button" className="more-item" onClick={() => void run('md')}>
            导出为 Markdown 文件
          </button>
          <button type="button" className="more-item" onClick={() => void run('html')}>
            导出为 Html 文件
          </button>
          <button type="button" className="more-item" onClick={() => void run('pdf')}>
            导出为 PDF 文件
          </button>
          <button type="button" className="more-item" onClick={() => void run('image')}>
            导出为图像文件
          </button>
        </div>
      ) : null}
    </div>
  )
}

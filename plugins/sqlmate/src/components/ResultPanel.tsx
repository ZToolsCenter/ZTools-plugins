/**
 * ResultPanel — 结果展示区
 * 支持：预览（前100行）、复制到剪贴板、保存文件
 */
import { useState } from 'react'
import './ResultPanel.css'

interface ResultPanelProps {
  content: string
  /** 统计信息，显示在结果上方 */
  meta?: React.ReactNode
  filename?: string
}

const PREVIEW_LINES = 100

export function ResultPanel({ content, meta, filename = 'output.sql' }: ResultPanelProps) {
  const [copied, setCopied] = useState(false)

  const lines = content.split('\n')
  const isLarge = lines.length > PREVIEW_LINES
  const preview = isLarge ? lines.slice(0, PREVIEW_LINES).join('\n') : content
  const bytes = new TextEncoder().encode(content).length

  function handleCopy() {
    window.ztools.copyText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleSave() {
    const p = window.ztools.showSaveDialog({
      defaultPath: filename,
      filters: [{ name: 'SQL', extensions: ['sql', 'txt'] }],
    })
    if (!p) return
    window.services.writeFile(p, content)
    window.ztools.showNotification('文件已保存')
  }

  return (
    <div className="result-panel">
      {meta && <div className="result-panel__meta">{meta}</div>}

      <pre className="result-panel__pre">{preview}</pre>

      {isLarge && (
        <div className="result-panel__truncated">
          共 {lines.length.toLocaleString()} 行 · {formatBytes(bytes)} · 仅预览前 {PREVIEW_LINES} 行
        </div>
      )}

      <div className="result-panel__actions">
        <button onClick={handleCopy}>{copied ? '✓ 已复制' : '复制'}</button>
        <button onClick={handleSave}>保存文件</button>
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

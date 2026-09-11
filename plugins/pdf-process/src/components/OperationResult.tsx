import { useState } from 'react'
import './OperationResult.css'

interface OperationResultProps {
  result: string | string[] | null
  onReset?: () => void
  /** default collapsed when true (default: true) */
  defaultCollapsed?: boolean
}

export default function OperationResult({
  result,
  onReset,
  defaultCollapsed = true,
}: OperationResultProps) {
  const [open, setOpen] = useState(!defaultCollapsed)

  if (!result) return null

  const items = Array.isArray(result) ? result : [result]
  const first = items[0]
  const title =
    items.length > 1 ? `操作完成，共 ${items.length} 个文件` : '操作完成'

  return (
    <div className="operation-result">
      <button
        type="button"
        className="result-summary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="result-summary-title">{title}</span>
        <span className="result-summary-chevron">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <>
          <ul className="result-list">
            {items.map((r, i) => (
              <li key={i} className="result-item" title={r}>
                {r.split(/[\\/]/).pop()}
              </li>
            ))}
          </ul>
          <div className="result-actions">
            <button
              type="button"
              className="result-btn primary"
              onClick={() => window.ztools.shellShowItemInFolder(first)}
            >
              打开文件位置
            </button>
            {onReset && (
              <button type="button" className="result-btn" onClick={onReset}>
                重新选择文件
              </button>
            )}
          </div>
        </>
      )}

      {!open && (
        <div className="result-actions result-actions--collapsed">
          <button
            type="button"
            className="result-btn primary"
            onClick={() => window.ztools.shellShowItemInFolder(first)}
          >
            打开文件位置
          </button>
        </div>
      )}
    </div>
  )
}

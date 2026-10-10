import type { ProcessResult } from '../../types'
import { formatBytes, pathBasename, savingsPercent } from '../../utils'

interface ResultBannerProps {
  results: ProcessResult[]
  mode?: 'process' | 'rename'
  maxItems?: number
  onOpenInFolder?: () => void
  onDismiss: () => void
}

function formatResultLine(item: ProcessResult, mode: 'process' | 'rename') {
  if (!item.success) return item.error || '处理失败'

  const from = pathBasename(item.inputPath || '')
  const to = pathBasename(item.outputPath || item.inputPath || '')

  if (mode === 'rename') {
    return from === to ? `${to}（文件名未变化）` : `${from} → ${to}`
  }

  return `${from || to} · ${formatBytes(item.inputSize || 0)} → ${formatBytes(item.outputSize || 0)} (${savingsPercent(item.inputSize || 0, item.outputSize || 0)}%)`
}

export default function ResultBanner({
  results,
  mode = 'process',
  maxItems = 6,
  onOpenInFolder,
  onDismiss
}: ResultBannerProps) {
  if (results.length === 0) return null

  const successCount = results.filter((item) => item.success).length

  return (
    <section className="result-card">
      <div className="result-card__head">
        <span>
          成功 {successCount}/{results.length}
        </span>
        <div className="result-card__actions">
          {onOpenInFolder ? (
            <button type="button" className="link-btn" onClick={onOpenInFolder}>
              在文件夹中显示
            </button>
          ) : null}
          <button type="button" className="link-btn result-card__close" onClick={onDismiss} aria-label="关闭">
            关闭
          </button>
        </div>
      </div>
      <ul>
        {results.slice(0, maxItems).map((item) => (
          <li
            key={`${item.inputPath || ''}-${item.outputPath || ''}-${item.success}`}
            className={item.success ? 'ok' : 'fail'}
          >
            {formatResultLine(item, mode)}
          </li>
        ))}
      </ul>
    </section>
  )
}

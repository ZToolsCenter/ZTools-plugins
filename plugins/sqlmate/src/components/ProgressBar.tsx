import './ProgressBar.css'

interface ProgressBarProps {
  pct?: number        // 0–100，indeterminate 时可不传
  label?: string
  indeterminate?: boolean  // 无法获取精确进度时使用滑动动画
}

export function ProgressBar({ pct, label, indeterminate }: ProgressBarProps) {
  return (
    <div className="progress">
      <div className="progress__track">
        <div
          className={`progress__fill${indeterminate ? ' progress__fill--indeterminate' : ''}`}
          style={indeterminate ? undefined : { width: `${pct ?? 0}%` }}
        />
      </div>
      <span className="progress__label">
        {indeterminate ? '处理中...' : (label ?? `${pct ?? 0}%`)}
      </span>
    </div>
  )
}

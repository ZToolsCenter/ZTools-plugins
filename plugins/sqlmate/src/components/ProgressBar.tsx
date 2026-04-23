import './ProgressBar.css'

interface ProgressBarProps {
  pct: number      // 0–100
  label?: string
}

export function ProgressBar({ pct, label }: ProgressBarProps) {
  return (
    <div className="progress">
      <div className="progress__track">
        <div className="progress__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="progress__label">{label ?? `${pct}%`}</span>
    </div>
  )
}

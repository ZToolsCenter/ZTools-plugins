interface ActionBarProps {
  imageCount: number
  recursive: boolean
  processing: boolean
  progress: number
  disabled?: boolean
  onPickFiles: () => void
  onPickFolder: () => void
  onRecursiveChange: (value: boolean) => void
  onProcess: () => void
}

export default function ActionBar({
  imageCount,
  recursive,
  processing,
  progress,
  disabled,
  onPickFiles,
  onPickFolder,
  onRecursiveChange,
  onProcess
}: ActionBarProps) {
  return (
    <footer className="action-bar">
      <div className="action-bar__inner">
        <div className="action-bar__left">
          <button type="button" className="btn btn--ghost" onClick={onPickFiles} disabled={disabled || processing}>
            <span className="btn__icon">+</span>
            添加图片
          </button>
          <button type="button" className="btn btn--ghost" onClick={onPickFolder} disabled={disabled || processing}>
            <span className="btn__icon">📁</span>
            添加文件夹
          </button>
          <label className="action-bar__check">
            <input
              type="checkbox"
              checked={recursive}
              onChange={(e) => onRecursiveChange(e.target.checked)}
              disabled={disabled || processing}
            />
            递归子目录
          </label>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={onProcess}
          disabled={disabled || processing || imageCount === 0}
        >
          {processing ? `处理中 ${progress}%` : `开始处理 (${imageCount})`}
        </button>
      </div>
      {processing && (
        <div className="action-bar__progress">
          <div className="action-bar__progress-bar" style={{ width: `${progress}%` }} />
        </div>
      )}
    </footer>
  )
}

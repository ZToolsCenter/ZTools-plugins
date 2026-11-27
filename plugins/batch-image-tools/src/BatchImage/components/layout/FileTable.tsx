import type { ImageItem } from '../../types'
import { formatBytes } from '../../utils'

interface FileTableProps {
  images: ImageItem[]
  disabled?: boolean
  onRemove: (path: string) => void
  onClear?: () => void
}

export default function FileTable({ images, disabled, onRemove, onClear }: FileTableProps) {
  if (images.length === 0) {
    return (
      <div className="file-table file-table--empty">
        <div className="file-table__empty-icon">🖼</div>
        <p>尚未添加图片</p>
        <span>点击底部「添加图片」或「添加文件夹」开始</span>
      </div>
    )
  }

  return (
    <div className="file-table">
      <div className="file-table__head">
        <span>文件名</span>
        <span>尺寸</span>
        <span>大小</span>
        <span>
          操作
          {onClear && images.length > 0 && (
            <button type="button" className="link-btn link-btn--inline" onClick={onClear} disabled={disabled}>
              清空
            </button>
          )}
        </span>
      </div>
      <ul className="file-table__body">
        {images.map((item) => (
          <li key={item.path}>
            <div className="file-table__name">
              {item.thumb ? (
                <img src={item.thumb} alt="" />
              ) : (
                <span className="file-table__thumb-placeholder" />
              )}
              <div className="file-table__meta">
                <span className="file-table__filename" title={item.name}>
                  {item.name}
                </span>
                <span className="file-table__format">{item.format.toUpperCase()}</span>
              </div>
            </div>
            <span className="file-table__dim">{item.width}×{item.height}</span>
            <span className="file-table__size">{formatBytes(item.size)}</span>
            <button
              type="button"
              className="link-btn link-btn--danger"
              onClick={() => onRemove(item.path)}
              disabled={disabled}
            >
              移除
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

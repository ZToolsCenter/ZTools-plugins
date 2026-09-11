import { useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import type { SharedFile } from '../context/SharedFilesContext'
import { formatFileSize } from '../utils/formatSize'
import './FileCardList.css'

interface FileCardListProps {
  files: SharedFile[]
  selectedIds?: string[]
  selectable?: boolean
  multiSelect?: boolean
  onSelect?: (id: string, opts?: { toggle?: boolean; exclusive?: boolean }) => void
  onRemove: (id: string) => void
  onReorder?: (fromIndex: number, toIndex: number) => void
  /** Optional status text shown on the right (compress-style). */
  statusFor?: (file: SharedFile) => string | undefined
  layout?: 'grid' | 'list'
  compact?: boolean
}

function resolvePath(file: SharedFile) {
  return file.rawFile ? window.ztools.getPathForFile(file.rawFile) : file.path
}

export default function FileCardList({
  files,
  selectedIds = [],
  selectable = true,
  multiSelect = true,
  onSelect,
  onRemove,
  onReorder,
  statusFor,
  layout = 'list',
  compact = true,
}: FileCardListProps) {
  const dragIndexRef = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  if (files.length === 0) return null

  const handleClick = (e: MouseEvent, id: string) => {
    if (!selectable || !onSelect) return
    if (multiSelect && (e.ctrlKey || e.metaKey)) {
      onSelect(id, { toggle: true })
      return
    }
    if (multiSelect) {
      onSelect(id, { toggle: true })
      return
    }
    onSelect(id, { exclusive: true })
  }

  const handleKeyDown = (e: KeyboardEvent, id: string) => {
    if (!selectable || !onSelect) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect(id, multiSelect ? { toggle: true } : { exclusive: true })
    }
  }

  const onDragStart = (index: number) => {
    dragIndexRef.current = index
  }

  const onDragOver = (e: DragEvent, index: number) => {
    if (!onReorder) return
    e.preventDefault()
    setDragOverIndex(index)
  }

  const onDrop = (e: DragEvent, index: number) => {
    e.preventDefault()
    const from = dragIndexRef.current
    dragIndexRef.current = null
    setDragOverIndex(null)
    if (from == null || !onReorder) return
    onReorder(from, index)
  }

  const onDragEnd = () => {
    dragIndexRef.current = null
    setDragOverIndex(null)
  }

  const openFolderFor = (file: SharedFile) => {
    try {
      window.ztools.shellShowItemInFolder(resolvePath(file))
    } catch {
      // ignore
    }
  }

  // List layout uses compress-style rows
  if (layout === 'list') {
    return (
      <div className="file-card-list file-card-list--list file-card-list--rows">
        {files.map((f, index) => {
          const selected = selectable && selectedIds.includes(f.id)
          const status = statusFor?.(f)
          return (
            <div
              key={f.id}
              className={
                'file-row' +
                (selected ? ' selected' : '') +
                (dragOverIndex === index ? ' drag-over' : '')
              }
              onClick={(e) => handleClick(e, f.id)}
              role={selectable ? 'button' : undefined}
              tabIndex={selectable ? 0 : undefined}
              onKeyDown={(e) => handleKeyDown(e, f.id)}
              draggable={!!onReorder}
              onDragStart={() => onDragStart(index)}
              onDragOver={(e) => onDragOver(e, index)}
              onDrop={(e) => onDrop(e, index)}
              onDragEnd={onDragEnd}
            >
              {selectable && multiSelect ? (
                <label
                  className="file-row-check"
                  onClick={(e) => e.stopPropagation()}
                  title="选择"
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onSelect?.(f.id, { toggle: true })}
                  />
                </label>
              ) : (
                <span className="file-row-check-spacer" aria-hidden />
              )}

              <div className="file-row-icon" aria-hidden>
                {f.thumbUrl ? (
                  <img src={f.thumbUrl} alt="" draggable={false} />
                ) : (
                  <span className="file-row-icon-fallback">
                    {f.thumbStatus === 'loading' || f.thumbStatus === 'idle' ? '…' : 'PDF'}
                  </span>
                )}
              </div>

              <div className="file-row-meta">
                <div className="file-row-name" title={f.name}>
                  {f.name}
                </div>
                <div className="file-row-sub">
                  {formatFileSize(f.size)}
                  {f.pageCount != null ? ' · ' + f.pageCount + ' 页' : ''}
                </div>
              </div>

              <div className="file-row-status">{status || ''}</div>

              <button
                type="button"
                className="file-row-btn"
                title="打开文件位置"
                onClick={(e) => {
                  e.stopPropagation()
                  openFolderFor(f)
                }}
              >
                ◎
              </button>
              <button
                type="button"
                className="file-row-btn danger"
                title="移除"
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(f.id)
                }}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div
      className={`file-card-list file-card-list--${layout} ${compact ? 'file-card-list--compact' : ''}`}
    >
      {files.map((f, index) => {
        const selected = selectable && selectedIds.includes(f.id)
        return (
          <div
            key={f.id}
            className={`file-card ${selected ? 'selected' : ''} ${dragOverIndex === index ? 'drag-over' : ''}`}
            onClick={(e) => handleClick(e, f.id)}
            role={selectable ? 'button' : undefined}
            tabIndex={selectable ? 0 : undefined}
            onKeyDown={(e) => handleKeyDown(e, f.id)}
            draggable={!!onReorder}
            onDragStart={() => onDragStart(index)}
            onDragOver={(e) => onDragOver(e, index)}
            onDrop={(e) => onDrop(e, index)}
            onDragEnd={onDragEnd}
          >
            {multiSelect && selectable && (
              <label className="file-card-check" onClick={(e) => e.stopPropagation()} title="多选">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onSelect?.(f.id, { toggle: true })}
                />
              </label>
            )}
            <div className="file-card-thumb">
              {f.thumbUrl ? (
                <img src={f.thumbUrl} alt="" draggable={false} />
              ) : (
                <div className={`file-card-placeholder ${f.thumbStatus}`}>
                  {f.thumbStatus === 'loading' || f.thumbStatus === 'idle' ? '…' : 'PDF'}
                </div>
              )}
            </div>
            <div className="file-card-meta">
              <div className="file-card-name" title={f.name}>
                {f.name}
              </div>
              <div className="file-card-sub">
                {f.pageCount != null ? `${f.pageCount} 页` : '—'}
                {' · '}
                {formatFileSize(f.size)}
              </div>
            </div>
            <button
              type="button"
              className="file-card-remove"
              title="移除"
              onClick={(e) => {
                e.stopPropagation()
                onRemove(f.id)
              }}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}

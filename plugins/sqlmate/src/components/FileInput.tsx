/**
 * FileInput — 文件拖拽 / 粘贴 / 选择 输入区
 *
 * 支持两种输入模式：
 *   - 文本模式：用户粘贴 SQL 文本（小文件）
 *   - 文件模式：用户拖拽或选择 .sql 文件（自动判断大小）
 *
 * 向父组件暴露：
 *   - value: SQL 字符串（文本模式）
 *   - filePath: 文件路径（文件模式，>10MB 时 value 为空）
 *   - isLarge: 是否大文件
 */
import { useRef, useState, DragEvent } from 'react'
import './FileInput.css'

interface FileInputProps {
  value: string
  filePath: string | null
  isLarge: boolean
  onChange: (value: string, filePath: string | null, isLarge: boolean) => void
  placeholder?: string
  accept?: string
}

const LARGE = 10 * 1024 * 1024

export function FileInput({
  value,
  filePath,
  isLarge,
  onChange,
  placeholder = '粘贴 SQL，或拖拽 / 选择 .sql 文件...',
  accept = '.sql,.txt',
}: FileInputProps) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFile(file: File) {
    const path = window.ztools.getPathForFile(file)
    const large = file.size > LARGE
    if (large) {
      onChange('', path, true)
    } else {
      const reader = new FileReader()
      reader.onload = (e) => onChange(e.target?.result as string, path, false)
      reader.readAsText(file, 'utf-8')
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(true)
  }

  function handleSelectFile() {
    const paths = window.ztools.showOpenDialog({
      filters: [{ name: 'SQL Files', extensions: ['sql', 'txt'] }],
    })
    if (!paths || paths.length === 0) return
    const p = paths[0]
    // 先获取文件大小，不读内容，避免大文件 OOM
    const size = window.services.getFileSize(p)
    const large = size > LARGE
    if (large) {
      onChange('', p, true)
    } else {
      const content = window.services.readFile(p)
      onChange(content, p, false)
    }
  }

  function handleClear() {
    onChange('', null, false)
  }

  return (
    <div
      className={`file-input ${dragging ? 'file-input--drag' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragging(false)}
    >
      {isLarge && filePath ? (
        <div className="file-input__large">
          <span className="file-input__large-icon">📄</span>
          <div className="file-input__large-info">
            <p className="file-input__large-name">{filePath.split(/[\\/]/).pop()}</p>
            <p className="file-input__large-hint">大文件模式（&gt;10MB），将使用流式处理</p>
          </div>
          <button className="file-input__clear" onClick={handleClear}>✕</button>
        </div>
      ) : (
        <textarea
          className="file-input__textarea"
          value={value}
          onChange={(e) => onChange(e.target.value, null, false)}
          placeholder={placeholder}
          spellCheck={false}
        />
      )}

      <div className="file-input__toolbar">
        <button className="file-input__btn" onClick={handleSelectFile}>
          选择文件
        </button>
        {(value || filePath) && (
          <button className="file-input__btn file-input__btn--ghost" onClick={handleClear}>
            清空
          </button>
        )}
        {filePath && (
          <span className="file-input__path" title={filePath}>
            {filePath.split(/[\\/]/).pop()}
          </span>
        )}
      </div>

      <input ref={inputRef} type="file" accept={accept} style={{ display: 'none' }} />
    </div>
  )
}

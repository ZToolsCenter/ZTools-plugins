import { useState, useRef, type DragEvent } from 'react'
import './FileUpload.css'

interface FileUploadProps {
  title: string
  subtitle?: string
  accept?: string
  multiple?: boolean
  onFilesSelected: (files: File[]) => void
}

export default function FileUpload({
  title,
  subtitle,
  accept = '.pdf',
  multiple = false,
  onFilesSelected,
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) onFilesSelected(files)
  }

  const handleClick = () => {
    inputRef.current?.click()
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) onFilesSelected(files)
  }

  return (
    <div
      className={`file-upload ${isDragging ? 'dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={handleChange}
        style={{ display: 'none' }}
      />
      <div className="file-upload-content">
        <h2 className="file-upload-title">{title}</h2>
        {subtitle && <p className="file-upload-subtitle">{subtitle}</p>}
        <button type="button" className="file-upload-btn">+ 选择文件</button>
        <p className="file-upload-hint">或拖入文件、粘贴文件</p>
      </div>
    </div>
  )
}

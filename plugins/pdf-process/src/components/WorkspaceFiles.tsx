import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import './WorkspaceFiles.css'
import FileUpload from './FileUpload'
import FileCardList from './FileCardList'
import { useSharedFiles } from '../context/SharedFilesContext'
import { pickPdfFiles } from '../utils/pickFiles'

interface WorkspaceFilesProps {
  title: string
  subtitle?: string
  accept?: string
  multiple?: boolean
  layout?: 'grid' | 'list'
  selectable?: boolean
  multiSelect?: boolean
  toolbarExtra?: ReactNode
  statusFor?: (file: import('../context/SharedFilesContext').SharedFile) => string | undefined
}

function isPdfFile(f: File) {
  return (
    f.type === 'application/pdf' ||
    f.name.toLowerCase().endsWith('.pdf')
  )
}

export default function WorkspaceFiles({
  title,
  subtitle,
  accept = '.pdf',
  multiple = true,
  layout = 'list',
  selectable = true,
  multiSelect = true,
  toolbarExtra,
  statusFor,
}: WorkspaceFilesProps) {
  const {
    files,
    selectedIds,
    addFiles,
    addPaths,
    removeFile,
    clear,
    selectFile,
    selectAll,
    clearSelection,
    reorder,
  } = useSharedFiles()

  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  const handleAddMore = async () => {
    const selected = await pickPdfFiles({
      multiple,
      title: '选择 PDF 文件',
    })
    if (selected.length) addPaths(selected)
  }

  const acceptDroppedFiles = (list: FileList | File[]) => {
    const arr = Array.from(list).filter(isPdfFile)
    if (!arr.length) return
    const take = multiple ? arr : arr.slice(0, 1)
    addFiles(take)
  }

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current += 1
    setDragging(true)
  }

  const onDragLeave = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  const onDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = 0
    setDragging(false)
    if (e.dataTransfer?.files?.length) {
      acceptDroppedFiles(e.dataTransfer.files)
    }
  }

  const allSelected = files.length > 0 && selectedIds.length === files.length

  return (
    <div
      className={'workspace-files' + (dragging ? ' is-dropping' : '')}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="workspace-toolbar">
        <div className="workspace-toolbar-left">
          {toolbarExtra}
          {files.length > 0 && (
            <button type="button" className="workspace-btn" onClick={handleAddMore}>
              <span className="workspace-btn-icon">+</span>
              添加文件
            </button>
          )}
          {files.length > 0 && selectable && multiSelect && (
            <>
              <button
                type="button"
                className="workspace-btn"
                onClick={() => (allSelected ? clearSelection() : selectAll())}
              >
                {allSelected ? '取消全选' : '全选'}
              </button>
              <span className="workspace-hint">
                已选 {selectedIds.length}/{files.length} · 点击多选 · 拖拽排序 · 可继续拖入 PDF
              </span>
            </>
          )}
          {files.length > 0 && !selectable && (
            <span className="workspace-hint">拖拽调整顺序 · 可继续拖入 PDF</span>
          )}
        </div>
        {files.length > 0 && (
          <button type="button" className="workspace-btn" onClick={clear}>
            <span className="workspace-btn-icon">×</span>
            清空列表
          </button>
        )}
      </div>

      {files.length === 0 ? (
        <FileUpload
          title={title}
          subtitle={subtitle}
          accept={accept}
          multiple={multiple}
          onFilesSelected={addFiles}
        />
      ) : (
        <div className="workspace-list-wrap">
          <FileCardList
            files={files}
            selectedIds={selectedIds}
            selectable={selectable}
            multiSelect={multiSelect}
            onSelect={selectFile}
            onRemove={removeFile}
            onReorder={reorder}
            statusFor={statusFor}
            layout={layout}
            compact
          />
          {dragging ? (
            <div className="workspace-drop-overlay" aria-hidden>
              松开以添加 PDF
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

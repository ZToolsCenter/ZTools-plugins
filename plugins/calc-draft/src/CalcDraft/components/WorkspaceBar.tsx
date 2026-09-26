import { useEffect, useRef, useState } from 'react'
import { WORKSPACE_NAME_MAX, type Workspace } from '../state'
import ConfirmDialog from './ConfirmDialog'

type WorkspaceBarProps = {
  workspaces: Workspace[]
  activeWorkspaceId: string
  onSwitch: (workspaceId: string) => void
  onCreate: () => void
  onRename: (workspaceId: string, name: string) => void
  onDelete: (workspaceId: string) => void
}

export default function WorkspaceBar(props: WorkspaceBarProps) {
  const { workspaces, activeWorkspaceId } = props
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0]

  // 点击外部关闭下拉
  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const startRename = (w: Workspace) => {
    setDraftName(w.name)
    setEditingId(w.id)
  }

  const commitRename = (workspaceId: string) => {
    const name = draftName.trim().slice(0, WORKSPACE_NAME_MAX)
    if (name) props.onRename(workspaceId, name)
    setEditingId(null)
  }

  const handleDelete = (workspaceId: string, name: string) => {
    if (workspaces.length === 1) return
    setConfirmDelete({ id: workspaceId, name })
  }

  return (
    <div className="cd-workspace-bar" ref={containerRef}>
      <button
        className="cd-workspace-current"
        onClick={() => setOpen((v) => !v)}
        title="切换工作空间"
      >
        <span className="cd-workspace-name">{activeWorkspace?.name ?? '工作空间'}</span>
        <span className={`cd-workspace-caret${open ? ' is-open' : ''}`}>▾</span>
      </button>

      {open && (
        <div className="cd-workspace-dropdown">
          <div className="cd-workspace-list">
            {workspaces.map((w) => (
              <div
                key={w.id}
                className={`cd-workspace-item${w.id === activeWorkspaceId ? ' is-active' : ''}`}
              >
                {editingId === w.id ? (
                  <input
                    className="cd-workspace-rename-input"
                    autoFocus
                    value={draftName}
                    maxLength={WORKSPACE_NAME_MAX}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => commitRename(w.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.stopPropagation()
                        commitRename(w.id)
                      }
                      if (e.key === 'Escape') {
                        e.stopPropagation()
                        setEditingId(null)
                      }
                    }}
                  />
                ) : (
                  <button
                    className="cd-workspace-item-name"
                    onClick={() => {
                      props.onSwitch(w.id)
                      setOpen(false)
                    }}
                  >
                    {w.name}
                  </button>
                )}

                {editingId !== w.id && w.id === activeWorkspaceId && (
                  <span className="cd-workspace-active-badge">当前</span>
                )}

                <div className="cd-workspace-item-actions">
                  <button
                    className="cd-workspace-action-btn"
                    title="重命名"
                    onClick={(e) => {
                      e.stopPropagation()
                      startRename(w)
                    }}
                  >
                    ✎
                  </button>
                  {workspaces.length > 1 && (
                    <button
                      className="cd-workspace-action-btn cd-workspace-delete-btn"
                      title="删除工作空间"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(w.id, w.name)
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="cd-workspace-dropdown-footer">
            <button className="cd-workspace-add" onClick={() => {
              props.onCreate()
              setOpen(false)
            }}>
              + 新建工作空间
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="删除工作空间"
        message={confirmDelete ? `删除「${confirmDelete.name}」？此操作不可恢复。` : ''}
        confirmText="删除"
        danger
        onConfirm={() => {
          if (confirmDelete) props.onDelete(confirmDelete.id)
          setConfirmDelete(null)
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}

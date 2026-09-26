import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export type ConfirmDialogProps = {
  open: boolean
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  /** 危险操作（删除类）：确认按钮为红笔样式 */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open,
  title = '确认操作',
  message,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    confirmRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, onCancel])

  if (!open) return null

  return createPortal(
    <div
      className="cd-dialog-mask"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="cd-dialog" role="dialog" aria-modal="true">
        <div className="cd-dialog-title">{title}</div>
        <div className="cd-dialog-message">{message}</div>
        <div className="cd-dialog-actions">
          <button className="cd-dialog-cancel" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            ref={confirmRef}
            className={`cd-dialog-confirm${danger ? ' is-danger' : ''}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

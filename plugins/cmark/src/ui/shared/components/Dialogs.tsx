/**
 * 自绘的输入 / 确认弹层
 *
 * 为什么不用 window.prompt / window.confirm：
 *   Electron 渲染进程里原生 prompt 不可用（返回 null），原生 confirm 会抢焦点，
 *   导致宿主把插件窗口隐藏掉。V1.0.0 也是自绘的（#znotes-rename）。
 */
import { useEffect, useRef, useState } from 'react'

type PromptProps = {
  title: string
  defaultValue?: string
  placeholder?: string
  maxLength?: number
  okText?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}

export function PromptDialog({
  title,
  defaultValue = '',
  placeholder = '',
  maxLength = 120,
  okText = '确定',
  onSubmit,
  onCancel,
}: PromptProps) {
  const [value, setValue] = useState(defaultValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = window.setTimeout(() => {
      const el = inputRef.current
      if (el) {
        el.focus()
        el.select()
      }
    }, 20)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        const v = value.trim()
        if (v) onSubmit(v)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [value, onSubmit, onCancel])

  return (
    <div className="zdlg-mask" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="zdlg-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="zdlg-title">{title}</div>
        <input
          ref={inputRef}
          className="zdlg-input"
          type="text"
          value={value}
          maxLength={maxLength}
          spellCheck={false}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="zdlg-btns">
          <button type="button" className="zdlg-btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="zdlg-btn primary"
            disabled={!value.trim()}
            onClick={() => {
              const v = value.trim()
              if (v) onSubmit(v)
            }}
          >
            {okText}
          </button>
        </div>
      </div>
    </div>
  )
}

type ConfirmProps = {
  message: string
  okText?: string
  danger?: boolean
  onOk: () => void
  onCancel: () => void
}

export function ConfirmDialog({ message, okText = '确定', danger, onOk, onCancel }: ConfirmProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  return (
    <div className="zdlg-mask" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="zdlg-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="zdlg-msg">{message}</div>
        <div className="zdlg-btns">
          <button type="button" className="zdlg-btn" onClick={onCancel}>
            取消
          </button>
          <button type="button" className={'zdlg-btn primary' + (danger ? ' danger' : '')} onClick={onOk}>
            {okText}
          </button>
        </div>
      </div>
    </div>
  )
}
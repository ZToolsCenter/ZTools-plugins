import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import Icon from './Icon'
import { useFieldNotes } from './FieldNoteContext'

export type FieldType = 'text' | 'secret' | 'textarea' | 'select'

export interface FieldProps {
  label: string
  hint?: string
  help?: string
  type?: FieldType
  value: string
  onChange: (v: string) => void
  options?: { value: string; label: string }[]
  error?: string
  readOnly?: boolean
  rows?: number
  placeholder?: string
  style?: CSSProperties
  variant?: 'input' | 'output'
  copyable?: boolean
  onClear?: () => void
  action?: ReactNode
}

export default function Field({
  label,
  hint,
  help,
  type = 'text',
  value,
  onChange,
  options,
  error,
  readOnly,
  rows = 3,
  placeholder,
  style,
  variant,
  copyable,
  onClear,
  action
}: FieldProps) {
  const generatedId = useId().replace(/:/g, '')
  const id = `field-${generatedId}`
  const helpId = `${id}-help`
  const isOutput = variant === 'output'
  const notes = useFieldNotes()
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
    }
  }, [])

  const fieldNote = { label, hint, help }

  const rememberNote = () => {
    notes?.setActiveNote(fieldNote)
  }

  const onCopy = () => {
    if (!value) return
    try {
      window.ztools?.copyText?.(value)
    } catch {
      return
    }
    setCopied(true)
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied(false), 1400)
  }

  const resolvedPlaceholder = placeholder ?? (isOutput ? '结果会显示在这里' : undefined)

  const controlProps = {
    id,
    readOnly,
    placeholder: resolvedPlaceholder,
    onFocus: rememberNote,
    'aria-describedby': help ? helpId : undefined
  }

  return (
    <div className={`ct-field ${isOutput ? 'ct-field-output' : ''}`} style={style}>
      <div className="ct-field-head">
        <label htmlFor={id}>{label}</label>
        {hint ? <span className="ct-field-hint">{hint}</span> : null}
        <div className="ct-field-side">
          {action ? <span className="ct-field-action">{action}</span> : null}
          <div className="ct-field-tools">
            {help && notes ? (
              <button
                type="button"
                className="ct-mini-btn"
                onClick={() => {
                  notes.setActiveNote(fieldNote)
                  notes.openNotes()
                }}
                title="查看字段说明"
                aria-label={`查看「${label}」的边注`}
              >
                <Icon name="note" size={13} />
              </button>
            ) : null}
            {copyable ? (
              <button
                type="button"
                className={`ct-mini-btn ${copied ? 'is-done' : ''}`}
                onClick={onCopy}
                disabled={!value}
                title={copied ? '已复制' : '复制'}
                aria-label={copied ? '已复制' : `复制${label}`}
              >
                <Icon name={copied ? 'check' : 'copy'} size={13} />
              </button>
            ) : null}
            {onClear ? (
              <button
                type="button"
                className="ct-mini-btn"
                onClick={onClear}
                title="清除"
                aria-label={`清除${label}`}
              >
                <Icon name="x" size={13} />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {type === 'textarea' ? (
        <textarea
          {...controlProps}
          rows={rows}
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : type === 'select' ? (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={rememberNote}
          aria-describedby={help ? helpId : undefined}
        >
          {(options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...controlProps}
          type={type === 'secret' ? 'password' : 'text'}
          value={value}
          spellCheck={false}
          autoComplete={type === 'secret' ? 'new-password' : 'off'}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {help && notes ? <p id={helpId} className="sr-only">{help}</p> : null}
      {help && !notes ? <p id={helpId} className="ct-field-help">{help}</p> : null}
      {error ? <p className="ct-field-error">{error}</p> : null}
    </div>
  )
}

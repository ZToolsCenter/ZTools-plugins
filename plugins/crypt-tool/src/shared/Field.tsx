import type { CSSProperties } from 'react'

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
  onClear
}: FieldProps) {
  const id = `f-${label.replace(/\s+/g, '-')}`
  const isOutput = variant === 'output'

  const onCopy = () => {
    window.ztools.copyText?.(value ?? '')
  }

  return (
    <div className={`ct-field ${isOutput ? 'ct-field-output' : ''}`} style={style}>
      <label htmlFor={id}>
        <span>{label}</span>
        {hint ? <em>{hint}</em> : null}
        {copyable ? (
          <button
            type="button"
            className="ct-field-copy"
            onClick={onCopy}
            title="复制"
          >
            ⧉
          </button>
        ) : null}
        {onClear ? (
          <button
            type="button"
            className="ct-field-clear"
            onClick={onClear}
            title="清除"
          >
            ×
          </button>
        ) : null}
      </label>
      {type === 'textarea' ? (
        <textarea
          id={id}
          rows={rows}
          value={value}
          readOnly={readOnly}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : type === 'select' ? (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {(options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={type === 'secret' ? 'password' : 'text'}
          value={value}
          readOnly={readOnly}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {error ? <div className="ct-field-error">{error}</div> : null}
      {help ? <div className="ct-field-help">{help}</div> : null}
    </div>
  )
}

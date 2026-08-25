import type { ReactNode } from 'react'

export function FieldRow({
  label,
  children,
  wide
}: {
  label: string
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className={`field-row${wide ? ' field-row--wide' : ''}`}>
      <label>{label}</label>
      <div className="field-row__control">{children}</div>
    </div>
  )
}

export function SegmentedButtons<T extends string>({
  value,
  options,
  onChange,
  disabled
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  disabled?: boolean
}) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? 'is-active' : ''}
          onClick={() => onChange(option.value)}
          disabled={disabled}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

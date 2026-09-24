export interface ActionItem {
  label: string
  onClick: () => void
  variant?: 'primary' | 'ghost'
  disabled?: boolean
}

export default function Actions({ items }: { items: ActionItem[] }) {
  return (
    <div className="ct-actions">
      {items.map((a) => (
        <button
          key={a.label}
          type="button"
          className={`ct-btn ${a.variant === 'primary' ? 'ct-btn-primary' : 'ct-btn-ghost'}`}
          disabled={a.disabled}
          onClick={a.onClick}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}

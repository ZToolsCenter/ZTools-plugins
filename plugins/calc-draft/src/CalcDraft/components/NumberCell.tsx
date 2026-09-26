interface NumberCellProps {
  text: string
  onCopy: (text: string) => void
  onInject: (text: string) => void
  className?: string
}

export default function NumberCell({ text, onCopy, onInject, className }: NumberCellProps) {
  return (
    <button
      type="button"
      className={`cd-num${className ? ` ${className}` : ''}`}
      title="点击复制 · Alt+点击注入"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation()
        if (e.altKey) onInject(text)
        else onCopy(text)
      }}
    >
      {text}
    </button>
  )
}

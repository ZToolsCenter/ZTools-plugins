export default function CopyButton({ text, label = '复制结果' }: { text: string; label?: string }) {
  const onCopy = () => {
    if (!text) {
      window.ztools.showNotification('没有可复制的内容')
      return
    }
    try {
      window.ztools.copyText(text)
      window.ztools.showNotification('已复制')
    } catch {
      window.ztools.showNotification('复制失败')
    }
  }
  return (
    <button type="button" className="ct-btn ct-btn-ghost" onClick={onCopy}>
      {label}
    </button>
  )
}

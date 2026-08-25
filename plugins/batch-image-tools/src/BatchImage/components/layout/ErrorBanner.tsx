interface ErrorBannerProps {
  message: string
  onDismiss: () => void
}

export default function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  if (!message) return null

  return (
    <div className="batch-app__error" role="alert">
      <span>!</span>
      <div className="batch-app__error-text">{message}</div>
      <button type="button" className="link-btn batch-app__error-close" onClick={onDismiss} aria-label="关闭错误">
        关闭
      </button>
    </div>
  )
}

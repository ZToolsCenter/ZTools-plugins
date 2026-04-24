/**
 * PageLayout — 所有功能页统一布局
 * 标题 + 描述 + 内容区
 */
import './PageLayout.css'

interface PageLayoutProps {
  title: string
  description?: string
  children: React.ReactNode
}

export function PageLayout({ title, description, children }: PageLayoutProps) {
  return (
    <div className="page">
      <div className="page__header">
        <h2 className="page__title">{title}</h2>
        {description && <p className="page__desc">{description}</p>}
      </div>
      <div className="page__body">{children}</div>
    </div>
  )
}

import './FeatureLayout.css'
import type { ReactNode } from 'react'

interface FeatureLayoutProps {
  title: string
  subtitle?: string
  children: ReactNode
  action?: ReactNode
  result?: ReactNode
}

/** Shared feature page chrome (no bottom-left exit — leave via sidebar). */
export default function FeatureLayout({
  title,
  subtitle,
  children,
  action,
  result,
}: FeatureLayoutProps) {
  return (
    <div className="feature-page">
      <h1 className="feature-title">{title}</h1>
      {subtitle ? <p className="feature-subtitle">{subtitle}</p> : null}
      <div className="feature-content">{children}</div>
      {action ? <div className="feature-action">{action}</div> : null}
      {result ? <div className="feature-result">{result}</div> : null}
    </div>
  )
}

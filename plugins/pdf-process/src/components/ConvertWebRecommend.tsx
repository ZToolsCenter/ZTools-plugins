import { useEffect, useState } from 'react'
import {
  type ConvertWebFormat,
  type WebConvertLink,
  resolveWebConvertLinks,
} from '../config/webConvertLinks'
import { assertSafeExternalUrl } from '../utils/safeUrl'
import './ConvertWebRecommend.css'

interface ConvertWebRecommendProps {
  format: ConvertWebFormat
  onOpenSettings?: () => void
}

export default function ConvertWebRecommend({ format, onOpenSettings }: ConvertWebRecommendProps) {
  const [links, setLinks] = useState<WebConvertLink[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const saved = await window.services.getSettings()
        const parsed = saved
          ? typeof saved === 'string'
            ? JSON.parse(saved)
            : saved
          : null
        if (cancelled) return
        const resolved = resolveWebConvertLinks(parsed?.webConvertLinks)
        setLinks(resolved[format])
      } catch {
        if (!cancelled) {
          setLinks(resolveWebConvertLinks(null)[format])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [format])

  const openLink = (url: string) => {
    let safe: string
    try {
      safe = assertSafeExternalUrl(url)
    } catch {
      window.ztools.showNotification('仅允许打开 https 链接')
      return
    }
    if (typeof window.ztools.shellOpenExternal === 'function') {
      window.ztools.shellOpenExternal(safe)
      return
    }
    window.open(safe, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="convert-web-recommend">
      <p className="convert-web-recommend-text">
        本地效果有限；非隐私文件建议使用网站转换。
      </p>
      {links.length > 0 ? (
        <div className="convert-web-recommend-links">
          {links.map((link) => (
            <button
              key={`${link.name}-${link.url}`}
              type="button"
              className="convert-web-recommend-link-btn"
              onClick={() => openLink(link.url)}
            >
              {link.name}
            </button>
          ))}
        </div>
      ) : (
        <p className="convert-web-recommend-empty">
          可在设置中添加推荐网站
          {onOpenSettings && (
            <>
              {' · '}
              <button
                type="button"
                className="convert-web-recommend-settings-link"
                onClick={onOpenSettings}
              >
                打开设置
              </button>
            </>
          )}
        </p>
      )}
    </div>
  )
}

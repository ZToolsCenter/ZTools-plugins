import { useState, useEffect } from 'react'
import {
  type ConvertWebFormat,
  type WebConvertLinks,
  CONVERT_WEB_FORMAT_LABELS,
  DEFAULT_WEB_CONVERT_LINKS,
  cloneWebConvertLinks,
  resolveWebConvertLinks,
} from '../config/webConvertLinks'
import { isSafeExternalUrl } from '../utils/safeUrl'
import './Settings.css'

interface SettingsProps { onClose: () => void }

interface S {
  webConvertLinks: WebConvertLinks
}

const defaultSettings: S = {
  webConvertLinks: cloneWebConvertLinks(DEFAULT_WEB_CONVERT_LINKS),
}

const FORMAT_KEYS: ConvertWebFormat[] = ['word', 'excel', 'ppt']

export default function Settings({ onClose }: SettingsProps) {
  const [settings, setSettings] = useState<S>(defaultSettings)
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadSettings() }, [])

  const loadSettings = async () => {
    try {
      const saved = await window.services.getSettings()
      if (saved) {
        const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved
        setSettings({
          ...defaultSettings,
          ...parsed,
          webConvertLinks: resolveWebConvertLinks(parsed?.webConvertLinks),
        })
      }
    } catch {}
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const normalize = (list: { name: string; url: string }[]) =>
        list
          .map((item) => ({ name: item.name.trim(), url: item.url.trim() }))
          .filter((item) => item.name && item.url && isSafeExternalUrl(item.url))

      const webConvertLinks: WebConvertLinks = {
        word: normalize(settings.webConvertLinks.word),
        excel: normalize(settings.webConvertLinks.excel),
        ppt: normalize(settings.webConvertLinks.ppt),
      }

      const dropped =
        settings.webConvertLinks.word.length +
          settings.webConvertLinks.excel.length +
          settings.webConvertLinks.ppt.length -
          (webConvertLinks.word.length +
            webConvertLinks.excel.length +
            webConvertLinks.ppt.length)

      await window.services.saveSettings({ webConvertLinks })
      if (dropped > 0) {
        window.ztools.showNotification(
          `已保存（忽略 ${dropped} 条非 https 链接）`,
        )
      } else {
        window.ztools.showNotification('设置已保存')
      }
      onClose()
    } catch {
      window.ztools.showNotification('保存失败')
    } finally { setSaving(false) }
  }

  const updateLink = (
    format: ConvertWebFormat,
    index: number,
    field: 'name' | 'url',
    value: string,
  ) => {
    setSettings((prev) => {
      const list = prev.webConvertLinks[format].map((item, i) =>
        i === index ? { ...item, [field]: value } : item,
      )
      return {
        ...prev,
        webConvertLinks: { ...prev.webConvertLinks, [format]: list },
      }
    })
  }

  const addLink = (format: ConvertWebFormat) => {
    setSettings((prev) => ({
      ...prev,
      webConvertLinks: {
        ...prev.webConvertLinks,
        [format]: [...prev.webConvertLinks[format], { name: '', url: '' }],
      },
    }))
  }

  const removeLink = (format: ConvertWebFormat, index: number) => {
    setSettings((prev) => ({
      ...prev,
      webConvertLinks: {
        ...prev.webConvertLinks,
        [format]: prev.webConvertLinks[format].filter((_, i) => i !== index),
      },
    }))
  }

  const restoreDefaultLinks = () => {
    setSettings((prev) => ({
      ...prev,
      webConvertLinks: cloneWebConvertLinks(DEFAULT_WEB_CONVERT_LINKS),
    }))
  }

  return (
    <div className="settings-overlay">
      <div className="settings-modal">
        <div className="settings-header">
          <h2>设置</h2>
          <button className="settings-close" onClick={onClose}>x</button>
        </div>
        <div className="settings-body">
          <div className="settings-section">
            <h3 className="settings-section-title">推荐网站</h3>
            <p className="settings-hint">
              本地转换效果有限；非隐私文件建议使用网站转换。可为每种格式增删推荐站点，点击名称按钮将在系统浏览器中打开。
            </p>
            <button
              type="button"
              className="settings-restore-defaults"
              onClick={restoreDefaultLinks}
            >
              恢复默认
            </button>
            {FORMAT_KEYS.map((format) => (
              <div key={format} className="web-links-group">
                <div className="web-links-group-header">
                  <span>{CONVERT_WEB_FORMAT_LABELS[format]}</span>
                  <button
                    type="button"
                    className="web-links-add"
                    onClick={() => addLink(format)}
                  >
                    添加
                  </button>
                </div>
                {settings.webConvertLinks[format].length === 0 && (
                  <p className="web-links-empty">暂无链接，可添加或恢复默认</p>
                )}
                {settings.webConvertLinks[format].map((link, index) => (
                  <div key={`${format}-${index}`} className="web-link-row">
                    <input
                      type="text"
                      placeholder="名称"
                      aria-label={`${CONVERT_WEB_FORMAT_LABELS[format]} 名称 ${index + 1}`}
                      value={link.name}
                      onChange={(e) => updateLink(format, index, 'name', e.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="https://"
                      aria-label={`${CONVERT_WEB_FORMAT_LABELS[format]} 链接 ${index + 1}`}
                      value={link.url}
                      onChange={(e) => updateLink(format, index, 'url', e.target.value)}
                    />
                    <button
                      type="button"
                      className="web-links-remove"
                      onClick={() => removeLink(format, index)}
                      aria-label={`删除 ${CONVERT_WEB_FORMAT_LABELS[format]} 链接 ${index + 1}`}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="settings-footer">
          <button className="settings-cancel" onClick={onClose}>取消</button>
          <button className="settings-save" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

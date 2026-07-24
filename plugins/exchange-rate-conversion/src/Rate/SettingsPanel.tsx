import { memo, useCallback, useEffect, useRef, useState } from 'react'
import './index.css'
import {
  PROVIDERS,
  loadConfig,
  saveConfig,
  type ProviderConfig,
  type ProviderRegion,
} from '../api/providers'
import { testConnection } from '../api/exchangeApi'

interface SettingsPanelProps {
  onClose: () => void
  onSaved: () => void
}

const TABS: { key: ProviderRegion; label: string }[] = [
  { key: 'overseas', label: '海外数据源' },
  { key: 'cn', label: '国内数据源' },
]

const SettingsPanel = memo(function SettingsPanel({ onClose, onSaved }: SettingsPanelProps) {
  // 一次读盘，同时决定初始 cfg 与初始 tab，避免调用两次 loadConfig
  const [cfg, setCfg] = useState<ProviderConfig>(() => loadConfig())
  const [tab, setTab] = useState<ProviderRegion>(() => {
    const initial = loadConfig()
    return PROVIDERS.find((p) => p.id === initial.active)?.region || 'overseas'
  })
  const [testing, setTesting] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const onSetActive = useCallback((id: string) => {
    setCfg((c) => ({ ...c, active: id }))
    setTestResult(null)
  }, [])

  const onKeyChange = useCallback((id: string, val: string) => {
    setCfg((c) => ({ ...c, keys: { ...c.keys, [id]: val } }))
    setTestResult(null)
  }, [])

  const onSave = useCallback(() => {
    saveConfig(cfg)
    setSavedFlash(true)
    const timer = setTimeout(() => {
      if (mountedRef.current) setSavedFlash(false)
    }, 1500)
    onSaved()
  }, [cfg, onSaved])

  const onTest = useCallback(async () => {
    setTesting(true)
    setTestResult(null)
    const key = cfg.keys[cfg.active] || ''
    const r = await testConnection(cfg.active, key)
    if (mountedRef.current) {
      setTestResult(r)
      setTesting(false)
    }
  }, [cfg.active, cfg.keys])

  const active = PROVIDERS.find((p) => p.id === cfg.active)
  const providers = PROVIDERS.filter((p) => p.region === tab)

  // 阻止点击遮罩时的事件冒泡
  const onMaskClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }, [onClose])

  return (
    <div className="settings-mask" onClick={onMaskClick}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <div className="settings-head-title">
            <h2>数据源设置</h2>
            <span className="settings-head-sub">选择汇率数据供应商并配置 API Key</span>
          </div>
          <button className="settings-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        {/* 标签页切换 */}
        <div className="settings-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`settings-tab ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="settings-body">
          {/* 渠道列表 */}
          <div className="settings-providers">
            {providers.map((p) => (
              <label
                key={p.id}
                className={`provider-card ${cfg.active === p.id ? 'active' : ''}`}
              >
                <input
                  type="radio"
                  name="provider"
                  checked={cfg.active === p.id}
                  onChange={() => onSetActive(p.id)}
                  hidden
                />
                <div className="provider-main">
                  <div className="provider-name">
                    <span className="provider-radio" />
                    {p.name}
                  </div>
                  <div className="provider-desc">{p.desc}</div>
                  <div className="provider-meta">
                    <span className="provider-quota">{p.freeQuota}</span>
                    {p.supportsHistory ? (
                      <span className="provider-tag">历史走势</span>
                    ) : (
                      <span className="provider-tag provider-tag-muted">仅实时</span>
                    )}
                    {p.fixedBase && (
                      <span className="provider-tag provider-tag-warn">
                        base 限 {p.fixedBase}
                      </span>
                    )}
                  </div>
                </div>
              </label>
            ))}
          </div>

          {/* API Key 输入 */}
          {active && (
            <div className="settings-key">
              <div className="settings-key-label">
                <span>{active.name} 的 API Key</span>
                <a
                  className="settings-signup"
                  href={active.signupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  没有账号？去注册 →
                </a>
              </div>
              <input
                type="password"
                className="settings-key-input"
                placeholder={`粘贴 ${active.name} API Key`}
                value={cfg.keys[cfg.active] || ''}
                onChange={(e) => onKeyChange(cfg.active, e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <div className="settings-key-foot">
                <a
                  href={active.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="settings-docs"
                >
                  查看接口文档
                </a>
              </div>
            </div>
          )}

          {/* 测试结果 */}
          {testResult && (
            <div className={`settings-test ${testResult.ok ? 'ok' : 'fail'}`}>
              {testResult.ok ? '✓ ' : '✗ '}
              {testResult.msg}
            </div>
          )}
        </div>

        <div className="settings-foot">
          <button
            className="settings-btn secondary"
            onClick={onTest}
            disabled={testing || !cfg.keys[cfg.active]}
          >
            {testing ? '测试中…' : '测试连接'}
          </button>
          <button
            className="settings-btn primary"
            onClick={onSave}
            disabled={!cfg.keys[cfg.active]}
          >
            {savedFlash ? '已保存 ✓' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
})

export default SettingsPanel
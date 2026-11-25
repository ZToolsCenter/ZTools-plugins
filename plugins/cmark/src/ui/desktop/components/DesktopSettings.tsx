import { useEffect, useState } from 'react'
import { getPorts } from '../../../runtime/ports'
import { useNotes } from '../../../service/store/notes'

/**
 * 独立端（Tauri）的设置面板。
 *
 * 插件端的设置面板是 preload 里手写的 DOM（#zgs-root，由 window.__zgsToggle 控制），
 * 独立端没有 preload，所以这里用 React 重做一份。
 *
 * 这里只放「不依赖 Git」的设置项：工作区、字号、主题、笔记库操作、快捷键、关于。
 * 仓库/远程/自动同步属于 Git 面板的职责，等 Git 面板 React 化后一起放进来，
 * 避免两套面板各存一份 git 配置。
 */
export default function DesktopSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const bodyFontSize = useNotes((s) => s.bodyFontSize)
  const setBodyFontSize = useNotes((s) => s.setBodyFontSize)

  const [root, setRoot] = useState<string | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!open) return
    setRoot(getPorts().ws.root())
    const cur = document.documentElement.dataset.theme
    setTheme(cur === 'dark' ? 'dark' : 'light')
    setMsg('')
  }, [open])

  if (!open) return null

  const changeWorkspace = async () => {
    setBusy(true)
    setMsg('')
    try {
      const picked = await getPorts().ws.pick()
      if (!picked.ok) {
        setMsg('选择失败：' + (picked.message || ''))
        return
      }
      if (!picked.value) return // 用户取消了
      const adopted = await getPorts().ws.adopt(picked.value)
      if (!adopted.ok) {
        setMsg('切换失败：' + (adopted.message || ''))
        return
      }
      setRoot(getPorts().ws.root())
      useNotes.getState().refreshTree()
      void useNotes.getState().buildIndex()
      setMsg('已切换工作区')
    } finally {
      setBusy(false)
    }
  }

  const applyTheme = (next: 'light' | 'dark') => {
    setTheme(next)
    document.documentElement.dataset.theme = next
    try {
      window.localStorage.setItem('cmark-desktop-theme', next)
    } catch (e) {}
  }

  const rebuildIndex = () => {
    setBusy(true)
    setMsg('')
    void useNotes
      .getState()
      .buildIndex()
      .then(() => setMsg('全文索引已重建'))
      .catch(() => setMsg('重建失败'))
      .finally(() => setBusy(false))
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.28)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 400,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: '92vw',
          maxHeight: '86vh',
          overflowY: 'auto',
          background: 'var(--bg-card, #fff)',
          color: 'var(--fg, #1f2328)',
          border: '1px solid var(--bd-soft, #d8dee4)',
          borderRadius: 10,
          boxShadow: '0 12px 40px rgba(0,0,0,.18)',
          padding: '18px 20px 16px',
          fontSize: 13,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>设置</div>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
            style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 16, color: 'var(--fg-mute, #6e7781)' }}
            title="关闭"
          >
            ×
          </button>
        </div>

        {/* 工作区 */}
        <div style={{ marginBottom: 16 }}>
          <div style={labelStyle}>笔记库</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              title={root || ''}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '6px 9px',
                border: '1px solid var(--bd-soft, #d8dee4)',
                borderRadius: 6,
                background: 'var(--bg-sunken, #f6f8fa)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontFamily: 'Consolas, monospace',
                fontSize: 12,
              }}
            >
              {root || '（未绑定）'}
            </div>
            <button type="button" onClick={changeWorkspace} disabled={busy} style={btnStyle}>
              {busy ? '处理中…' : '更改文件夹'}
            </button>
            <button type="button" onClick={() => void getPorts().shell.revealInFolder('')} style={btnStyle}>
              打开
            </button>
          </div>
        </div>

        {/* 正文字号 */}
        <div style={{ marginBottom: 16 }}>
          <div style={labelStyle}>正文字号</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="range"
              min={12}
              max={20}
              step={1}
              value={bodyFontSize}
              onChange={(e) => setBodyFontSize(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={{ width: 44, textAlign: 'right', fontFamily: 'Consolas, monospace' }}>{bodyFontSize}px</span>
          </div>
        </div>

        {/* 主题 */}
        <div style={{ marginBottom: 16 }}>
          <div style={labelStyle}>外观</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['light', 'dark'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => applyTheme(t)}
                style={{
                  ...btnStyle,
                  borderColor: theme === t ? 'var(--accent, #0969da)' : 'var(--bd-soft, #d8dee4)',
                  color: theme === t ? 'var(--accent, #0969da)' : undefined,
                }}
              >
                {t === 'light' ? '浅色' : '深色'}
              </button>
            ))}
          </div>
        </div>

        {/* 索引 */}
        <div style={{ marginBottom: 16 }}>
          <div style={labelStyle}>全文索引</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" onClick={rebuildIndex} disabled={busy} style={btnStyle}>
              重建索引
            </button>
            <span style={{ fontSize: 12, color: 'var(--fg-mute, #6e7781)' }}>
              搜索用的索引只在启动时建一次，笔记在外部改动过多时可以重建
            </span>
          </div>
        </div>

        {/* 快捷键 */}
        <div style={{ marginBottom: 6 }}>
          <div style={labelStyle}>常用快捷键</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 14px', fontSize: 12, lineHeight: 1.9 }}>
            <span>搜索<kbd style={kbdStyle}>Ctrl+F</kbd></span>
            <span>加粗<kbd style={kbdStyle}>Ctrl+B</kbd></span>
            <span>标题 1/2/3<kbd style={kbdStyle}>Ctrl+1/2/3</kbd></span>
            <span>保存<kbd style={kbdStyle}>Ctrl+S</kbd></span>
          </div>
        </div>

        {msg ? <div style={{ marginTop: 10, color: 'var(--fg-mute, #6e7781)', fontSize: 12 }}>{msg}</div> : null}

        <div
          style={{
            marginTop: 16,
            paddingTop: 12,
            borderTop: '1px solid var(--bd-soft, #d8dee4)',
            fontSize: 12,
            color: 'var(--fg-mute, #6e7781)',
            lineHeight: 1.7,
          }}
        >
          CMark 桌面版 1.3.0
          <br />
          笔记与配置和插件端共用同一份（~/.cmark-config.json + 本地 Markdown）
        </div>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = { color: 'var(--fg-mute, #6e7781)', marginBottom: 6 }

const kbdStyle: React.CSSProperties = {
  marginLeft: 6,
  padding: '1px 5px',
  border: '1px solid var(--bd-soft, #d8dee4)',
  borderRadius: 4,
  fontSize: 11,
  fontFamily: 'Consolas, monospace',
  color: 'var(--fg-mute, #6e7781)',
}

const btnStyle: React.CSSProperties = {
  padding: '5px 12px',
  border: '1px solid var(--bd-soft, #d8dee4)',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 12,
  flex: '0 0 auto',
}

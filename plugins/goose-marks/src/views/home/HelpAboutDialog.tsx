/**
 * HelpAboutDialog —— 帮助与关于弹窗
 * 居中弹窗，支持 Esc / 点击 backdrop 关闭。
 */
import { useEffect } from 'react'

export interface HelpAboutDialogProps {
  open: boolean
  onClose: () => void
  onToast: (title?: string) => void
}

export default function HelpAboutDialog({ open, onClose, onToast }: HelpAboutDialogProps) {
  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const copyEmail = () => {
    const email = 'each1026@gmail.com'
    navigator.clipboard.writeText(email).then(() => {
      onToast(`邮箱已复制：${email}`)
    }).catch(() => {
      onToast('复制失败，请手动复制')
    })
  }

  return (
    <div className="help-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="help-panel">
        <div className="help-header">
          <span className="help-title">帮助与关于</span>
          <button className="help-close" onClick={onClose} title="关闭 (Esc)">
            <svg className="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="help-body">
          {/* 键盘快捷键 */}
          <div className="set-section">
            <div className="set-section-title">键盘快捷键</div>
            <div className="set-card">
              <div className="help-kv"><span className="help-key">⌘K</span><span>聚焦搜索框</span></div>
              <div className="set-row-sep" />
              <div className="help-kv"><span className="help-key">直接键入</span><span>即时搜索</span></div>
              <div className="set-row-sep" />
              <div className="help-kv"><span className="help-key">↑ ↓ ← →</span><span>选择书签</span></div>
              <div className="set-row-sep" />
              <div className="help-kv"><span className="help-key">Enter</span><span>打开选中书签</span></div>
              <div className="set-row-sep" />
              <div className="help-kv"><span className="help-key">Esc</span><span>清除搜索 / 关闭弹窗</span></div>
              <div className="set-row-sep" />
              <div className="help-kv"><span className="help-key">右键</span><span>打开操作菜单</span></div>
            </div>
          </div>

          {/* 小技巧 */}
          <div className="set-section">
            <div className="set-section-title">小技巧</div>
            <div className="set-card">
              <div className="help-tip">拖拽分组 Tab 可排序</div>
              <div className="set-row-sep" />
              <div className="help-tip">分组栏末尾「+」可新建分组</div>
              <div className="set-row-sep" />
              <div className="help-tip">粘贴链接快速收集书签</div>
              <div className="set-row-sep" />
              <div className="help-tip">AI 可自动补全书签标题与简介</div>
              <div className="set-row-sep" />
              <div className="help-tip">浏览器扩展一键收藏当前页面</div>
              <div className="set-row-sep" />
              <div className="help-tip">回收站可恢复误删书签</div>
            </div>
          </div>

          {/* 关于 */}
          <div className="set-section">
            <div className="set-section-title">关于</div>
            <div className="set-card">
              <div className="help-kv">
                <span>应用名</span>
                <span className="help-val">鹅的书签 · goose-marks</span>
              </div>
              <div className="set-row-sep" />
              <div className="help-kv">
                <span>版本</span>
                <span className="help-val">v{__APP_VERSION__}</span>
              </div>
              <div className="set-row-sep" />
              <div className="help-kv">
                <span>反馈邮箱</span>
                <button className="help-email" onClick={copyEmail}>
                  each1026@gmail.com
                  <svg className="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ width: '13px', height: '13px', marginLeft: '4px' }}>
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

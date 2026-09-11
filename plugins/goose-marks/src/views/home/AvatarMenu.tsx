/**
 * AvatarMenu —— 头像按钮弹出的个人菜单
 * 支持 Esc / 点击外部关闭。
 * 外观设置（主题/视图）+ 快捷入口（设置/回收站/帮助）
 */
import { useEffect, useRef } from 'react'
import { Image } from '@/components/ui/image'
import { Ico } from './icon'
import logoUrl from '@/assets/logo.png'

type ThemePref = 'light' | 'dark' | 'system'
type ViewMode = 'list' | 'grid'
type Theme = 'light' | 'dark'
type UIScale = 'large' | 'normal' | 'small'

export interface AvatarMenuProps {
  open: boolean
  theme: Theme
  themePref: ThemePref
  view: ViewMode
  uiScale: UIScale
  trashN: number
  onClose: () => void
  onThemePrefChange: (pref: ThemePref) => void
  onViewChange: (v: ViewMode) => void
  onUiScaleChange: (s: UIScale) => void
  onOpenSettings: () => void
  onOpenTrash: () => void
  onOpenHelp: () => void
}

const THEME_OPTS: { pref: ThemePref; label: string }[] = [
  { pref: 'system', label: '系统' },
  { pref: 'light', label: '明亮' },
  { pref: 'dark', label: '暗黑' },
]

const VIEW_OPTS: { v: ViewMode; label: string }[] = [
  { v: 'list', label: '列表' },
  { v: 'grid', label: '网格' },
]

const SCALE_OPTS: { s: UIScale; label: string }[] = [
  { s: 'large', label: '放大' },
  { s: 'normal', label: '正常' },
  { s: 'small', label: '缩小' },
]

export default function AvatarMenu({
  open,
  themePref,
  view,
  uiScale,
  trashN,
  onClose,
  onThemePrefChange,
  onViewChange,
  onUiScaleChange,
  onOpenSettings,
  onOpenTrash,
  onOpenHelp,
}: AvatarMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      // 顶栏设置钮现为 .header-icon-btn，兼容旧 .avatar
      if (!t.closest('.pa-menu') && !t.closest('.header-icon-btn') && !t.closest('.avatar')) {
        onClose()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div ref={menuRef} className="pa-menu">
      {/* 顶部信息 */}
      <div className="pp-top">
        <div className="pp-avatar-lg">
          <Image src={logoUrl} alt="鹅的书签" bare />
        </div>
        <div className="pp-top-info">
          <span className="pp-name">鹅的书签</span>
          <span className="pp-sub">goose-marks</span>
        </div>
      </div>

      <div className="pa-sep" />

      {/* 外观：主题三段 */}
      <div className="pp-field">
        <span className="pp-field-lbl">外观</span>
        <div className="radio-seg">
          {THEME_OPTS.map(({ pref, label }) => (
            <button
              key={pref}
              className={themePref === pref ? 'on' : ''}
              onClick={() => onThemePrefChange(pref)}
            >
              {pref === 'system' && <Ico name="monitor" />}
              {pref === 'light' && <Ico name="sun" />}
              {pref === 'dark' && <Ico name="moon-star" />}
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 视图：列表/网格两段 */}
      <div className="pp-field">
        <span className="pp-field-lbl">视图</span>
        <div className="radio-seg">
          {VIEW_OPTS.map(({ v, label }) => (
            <button
              key={v}
              className={view === v ? 'on' : ''}
              onClick={() => { onViewChange(v); onClose() }}
            >
              <Ico name={v === 'list' ? 'list' : 'layout-grid'} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 缩放：大 / 正常 / 小 */}
      <div className="pp-field">
        <span className="pp-field-lbl">缩放</span>
        <div className="radio-seg">
          {SCALE_OPTS.map(({ s, label }) => (
            <button
              key={s}
              className={uiScale === s ? 'on' : ''}
              onClick={() => onUiScaleChange(s)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="pa-sep" />

      <button type="button" className="pa-row" onClick={onOpenSettings}>
        <Ico name="settings" />
        <span>设置</span>
      </button>
      <button type="button" className="pa-row" onClick={onOpenTrash}>
        <Ico name="trash-2" />
        <span>回收站</span>
        {trashN > 0 && <span className="pa-badge">{trashN}</span>}
      </button>
      <button type="button" className="pa-row" onClick={onOpenHelp}>
        <Ico name="info" />
        <span>帮助与关于</span>
      </button>
    </div>
  )
}

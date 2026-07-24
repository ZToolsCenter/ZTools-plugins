import { useState, useEffect, useRef } from 'react'
import type { Settings, TriggerKey, HideActions, Preset } from '@/shared/types'
import { TRIGGER_OPTIONS, detectConflicts, DEFAULT_SETTINGS, FONT_OPTIONS } from '@/shared/constants'
import { saveSettings, getPresets, addPreset, updatePreset, deletePreset, autoPresetName } from '@/shared/storage'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'

const PAGE_KEYS: { key: 'arrow' | 'wheel' | 'click' | 'pgupdn' | 'space'; label: string }[] = [
  { key: 'arrow', label: '键盘 ←→' },
  { key: 'wheel', label: '滚轮' },
  { key: 'click', label: '点击左右' },
  { key: 'pgupdn', label: 'PageUp/Down' },
  { key: 'space', label: '空格' },
]

export function SettingsDialog(props: {
  open: boolean
  onOpenChange: (v: boolean) => void
  settings: Settings
  setSettings: (s: Settings) => void
  setTheme: (t: Settings['theme']) => void
}) {
  const [draft, setDraft] = useState<Settings>(props.settings)
  const [presets, setPresets] = useState<Preset[]>([])
  const [presetName, setPresetName] = useState('')
  const conflicts = detectConflicts(draft.hide)
  const conflictCount = Object.values(conflicts).filter(Boolean).length

  useEffect(() => { setDraft(props.settings) }, [props.settings, props.open])
  useEffect(() => { if (props.open) setPresets(getPresets()) }, [props.open])

  function patch(p: Partial<Settings>) { setDraft({ ...draft, ...p }) }
  function patchReader(p: Partial<Settings['reader']>) { setDraft({ ...draft, reader: { ...draft.reader, ...p } }) }
  function patchPage(p: Partial<Settings['page']>) { setDraft({ ...draft, page: { ...draft.page, ...p } }) }
  function patchHide(p: Partial<HideActions>) { setDraft({ ...draft, hide: { ...draft.hide, ...p } }) }

  function toggleTrigger(group: keyof HideActions, key: TriggerKey) {
    const arr = draft.hide[group]
    patchHide({ [group]: arr.includes(key) ? arr.filter((k) => k !== key) : [...arr, key] } as any)
  }

  function applyPreset(p: Preset) {
    setDraft(JSON.parse(JSON.stringify(p.settings)))
    saveSettings(p.settings)
    props.setSettings(p.settings)
    ;(window as any).services?.sendToReader?.('sr:settings', p.settings)
    setPresetName(p.name)
  }

  function handleDeletePreset(id: string) {
    deletePreset(id)
    setPresets(getPresets())
  }

  function save() {
    if (conflictCount > 0) return
    saveSettings(draft)
    props.setSettings(draft)
    ;(window as any).services?.sendToReader?.('sr:settings', draft)
    // 保存为预设（同名更新，否则新建）
    const name = presetName.trim() || autoPresetName()
    const existing = getPresets().find((p) => p.name === name)
    if (existing) updatePreset(existing.id, draft)
    else addPreset(name, draft)
    setPresets(getPresets())
    props.onOpenChange(false)
  }
  function reset() { setDraft(JSON.parse(JSON.stringify(DEFAULT_SETTINGS))) }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 配置方案 */}
          <Section title="配置方案">
            {presets.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1 rounded-md border bg-muted/50 px-2 py-1 text-xs cursor-pointer hover:bg-muted"
                    onClick={() => applyPreset(p)}
                  >
                    {p.name}
                    <span
                      className="text-muted-foreground hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); handleDeletePreset(p.id) }}
                    >
                      ×
                    </span>
                  </span>
                ))}
              </div>
            )}
            <Input
              placeholder="保存为配置名称（留空自动命名）"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              className="h-8 text-sm"
            />
          </Section>

          {/* 主题 */}
          <Section title="界面主题">
            <div className="flex gap-2">
              {(['auto', 'light', 'dark'] as const).map((t) => (
                <Button key={t} size="sm" variant={draft.theme === t ? 'default' : 'outline'} onClick={() => { patch({ theme: t }); props.setTheme(t) }}>
                  {t === 'auto' ? '跟随系统' : t === 'light' ? '明亮' : '暗黑'}
                </Button>
              ))}
            </div>
          </Section>

          {/* 阅读外观 */}
          <Section title="阅读外观">
            <div className="grid grid-cols-2 gap-3">
              <Field label="背景色"><ColorPicker value={draft.reader.bgColor} onChange={(v) => patchReader({ bgColor: v })} /></Field>
              <Field label="文字色"><ColorPicker value={draft.reader.textColor} onChange={(v) => patchReader({ textColor: v })} /></Field>
              <Field label={`透明度 ${Math.round(draft.reader.opacity * 100)}%`}>
                <Slider min={10} max={100} step={5} value={[draft.reader.opacity * 100]} onValueChange={(v) => patchReader({ opacity: v[0] / 100 })} />
              </Field>
              <Field label={`字号 ${draft.reader.fontSize}px`}>
                <Slider min={8} max={32} step={1} value={[draft.reader.fontSize]} onValueChange={(v) => patchReader({ fontSize: v[0] })} />
              </Field>
              <Field label={`行高 ${draft.reader.lineHeight.toFixed(2)}`}>
                <Slider min={1} max={3} step={0.05} value={[draft.reader.lineHeight]} onValueChange={(v) => patchReader({ lineHeight: v[0] })} />
              </Field>
              <Field label={`字重 ${draft.reader.fontWeight}`}>
                <Slider min={50} max={1000} step={1} value={[draft.reader.fontWeight]} onValueChange={(v) => patchReader({ fontWeight: v[0] })} />
              </Field>
               <Field label="字体">
                 <FontSelect value={draft.reader.fontFamily} onChange={(v) => patchReader({ fontFamily: v })} />
               </Field>
              <Field label="清理空行">
                <Switch checked={draft.reader.cleanEmptyLines} onCheckedChange={(v) => patchReader({ cleanEmptyLines: v })} />
              </Field>
            </div>
          </Section>

          {/* 窗口 */}
          <Section title="窗口">
            <div className="grid grid-cols-4 gap-2">
              <Field label="宽"><Input type="number" value={draft.window.width} onChange={(e) => patch({ window: { ...draft.window, width: +e.target.value || 520 } })} /></Field>
              <Field label="高"><Input type="number" value={draft.window.height} onChange={(e) => patch({ window: { ...draft.window, height: +e.target.value || 780 } })} /></Field>
              <Field label="X(−1=默认)"><Input type="number" value={draft.window.x} onChange={(e) => patch({ window: { ...draft.window, x: +e.target.value } })} /></Field>
              <Field label="Y(−1=默认)"><Input type="number" value={draft.window.y} onChange={(e) => patch({ window: { ...draft.window, y: +e.target.value } })} /></Field>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">阅读窗可见时可原地拖动边缘缩放、拖拽移动，无需在此修改。</p>
          </Section>

          {/* 翻页 */}
          <Section title="翻页方式">
            <div className="flex flex-wrap gap-3">
              {PAGE_KEYS.map((p) => (
                <label key={p.key} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={draft.page[p.key]} onCheckedChange={(v) => patchPage({ [p.key]: !!v } as any)} />
                  {p.label}
                </label>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">翻页过渡</span>
              <Button size="sm" variant={draft.page.transition === 'none' ? 'default' : 'outline'} onClick={() => patchPage({ transition: 'none' })}>无动画</Button>
              <Button size="sm" variant={draft.page.transition === 'slide' ? 'default' : 'outline'} onClick={() => patchPage({ transition: 'slide' })}>滑动</Button>
            </div>
          </Section>

          {/* 隐藏动作（三功能 · 冲突检测） */}
          <Section title="隐藏 / 伪装（三功能可自定义绑定）">
            {(['stealthHide', 'stealthShow', 'realHide'] as const).map((g) => (
              <div key={g} className="mb-2">
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  {g === 'stealthHide' ? '隐身（显→隐）' : g === 'stealthShow' ? '显示（隐→显）' : '真隐藏（彻底消失，命令恢复）'}
                </div>
                <div className="flex flex-nowrap gap-2">
                  {TRIGGER_OPTIONS.map((o) => (
                    <label key={o.key} className={`flex items-center gap-1 rounded px-0.5 text-sm whitespace-nowrap ${conflicts[o.key] ? 'text-destructive' : ''}`}>
                      <Checkbox checked={draft.hide[g].includes(o.key)} onCheckedChange={() => toggleTrigger(g, o.key)} />
                      {o.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {conflictCount > 0 && (
              <p className="text-sm font-medium text-destructive">⚠ 触发动作冲突：{Object.entries(conflicts).filter(([,v]) => v).map(([k,v]) => `${k}(${v})`).join('、')}，每个动作只能绑一个功能。</p>
            )}
          </Section>

          {/* 自动翻页 */}
          <Section title="自动翻页">
            <Field label={`间隔 ${draft.autoPage.interval}s（0=关闭）`}>
              <Slider min={0} max={120} step={1} value={[draft.autoPage.interval]} onValueChange={(v) => setDraft({ ...draft, autoPage: { ...draft.autoPage, interval: v[0] } })} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={draft.autoPage.pauseOnStealth} onCheckedChange={(v) => setDraft({ ...draft, autoPage: { ...draft.autoPage, pauseOnStealth: v } })} />
              stealth 隐藏时自动暂停
            </label>
          </Section>

          {/* 进度条 */}
          <Section title="阅读窗进度条">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={draft.showProgressBar} onCheckedChange={(v) => patch({ showProgressBar: v })} />
              显示底部进度条
            </label>
          </Section>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={reset}>恢复默认</Button>
          <Button onClick={save} disabled={conflictCount > 0}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-primary">{title}</div>
      {children}
    </div>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [hex, setHex] = useState(value)
  const [picking, setPicking] = useState(false)
  const [screenImg, setScreenImg] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const magRef = useRef<HTMLCanvasElement>(null)
  const [hoverColor, setHoverColor] = useState<string | null>(null)
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 })
  useEffect(() => { setHex(value) }, [value])

  useEffect(() => {
    if (!screenImg || !canvasRef.current) return
    const img = new Image()
    img.onload = () => {
      const el = canvasRef.current!
      el.width = img.width; el.height = img.height
      el.getContext('2d')?.drawImage(img, 0, 0)
    }
    img.src = screenImg
  }, [screenImg])

  async function startPick() {
    const zt = window.ztools
    if (!zt?.screenCapture) { ref.current?.click(); return }
    zt.hideMainWindow?.(true)
    setTimeout(() => {
      try {
        zt.screenCapture!((img) => {
          zt.showMainWindow?.()
          if (typeof img === 'string' && img.startsWith('data:')) { setScreenImg(img); setPicking(true) }
          else { ref.current?.click() }
        })
      } catch { zt.showMainWindow?.(); ref.current?.click() }
    }, 300)
  }

  function getColorAt(clientX: number, clientY: number): string | null {
    if (!canvasRef.current) return null
    const c = canvasRef.current
    const rect = c.getBoundingClientRect()
    const sx = c.width / rect.width, sy = c.height / rect.height
    const x = Math.floor((clientX - rect.left) * sx)
    const y = Math.floor((clientY - rect.top) * sy)
    const ctx = c.getContext('2d')
    if (!ctx) return null
    const px = ctx.getImageData(x, y, 1, 1).data
    return '#' + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('')
  }

  function drawMagnifier(clientX: number, clientY: number) {
    if (!canvasRef.current || !magRef.current) return
    const src = canvasRef.current, mag = magRef.current
    const mctx = mag.getContext('2d')
    if (!mctx) return
    const rect = src.getBoundingClientRect()
    const sx = src.width / rect.width, sy = src.height / rect.height
    const cx = Math.floor((clientX - rect.left) * sx), cy = Math.floor((clientY - rect.top) * sy)
    const size = 100, zoom = 10
    mag.width = size; mag.height = size
    mctx.imageSmoothingEnabled = false
    mctx.fillStyle = '#000'; mctx.fillRect(0, 0, size, size)
    const half = Math.floor(size / zoom / 2)
    mctx.drawImage(src, cx - half, cy - half, size / zoom, size / zoom, 0, 0, size, size)
    mctx.strokeStyle = '#fff'; mctx.lineWidth = 1
    mctx.beginPath(); mctx.moveTo(size / 2, 0); mctx.lineTo(size / 2, size); mctx.moveTo(0, size / 2); mctx.lineTo(size, size / 2); mctx.stroke()
    mctx.strokeStyle = 'rgba(255,255,255,0.8)'; mctx.lineWidth = 2
    mctx.beginPath(); mctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2); mctx.stroke()
  }

  function handlePickMove(e: React.MouseEvent<HTMLDivElement>) {
    const c = getColorAt(e.clientX, e.clientY)
    if (c) setHoverColor(c)
    setCursorPos({ x: e.clientX, y: e.clientY })
    drawMagnifier(e.clientX, e.clientY)
  }

  function handlePickClick(e: React.MouseEvent<HTMLDivElement>) {
    const c = getColorAt(e.clientX, e.clientY)
    if (c) { onChange(c); setHex(c) }
    setPicking(false); setScreenImg(null); setHoverColor(null)
  }

  const magOff = 24
  const magX = cursorPos.x + magOff + 100 > window.innerWidth ? cursorPos.x - magOff - 100 : cursorPos.x + magOff
  const magY = cursorPos.y + magOff + 100 > window.innerHeight ? cursorPos.y - magOff - 100 : cursorPos.y + magOff

  return (
    <>
      {picking && screenImg && (
        <div className="fixed inset-0 z-[9999] cursor-crosshair" onMouseMove={handlePickMove} onClick={handlePickClick} onKeyDown={(e) => { if (e.key === 'Escape') { setPicking(false); setScreenImg(null); setHoverColor(null) } }}>
          <canvas ref={canvasRef} className="h-full w-full" />
          <div className="pointer-events-none fixed" style={{ left: magX, top: magY }}>
            <canvas ref={magRef} width={100} height={100} className="rounded-full border-2 border-white shadow-xl" />
          </div>
          {hoverColor && (
            <div className="pointer-events-none fixed flex items-center gap-2 rounded bg-black/70 px-3 py-1.5 text-sm text-white" style={{ left: magX, top: magY + 108 }}>
              <div className="h-4 w-4 rounded border border-white/50" style={{ background: hoverColor }} />
              <span className="font-mono">{hoverColor.toUpperCase()}</span>
            </div>
          )}
          <div className="pointer-events-none fixed top-4 left-1/2 -translate-x-1/2 rounded bg-black/70 px-4 py-2 text-sm text-white">点击取色 · Esc 取消</div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <div
          className="h-9 w-9 shrink-0 rounded border cursor-pointer flex items-center justify-center text-[10px] font-bold"
          style={{ background: hex, color: isLight(hex) ? '#000' : '#fff' }}
          onClick={startPick}
          title="点击全屏取色"
        >
          吸
        </div>
        <input ref={ref} type="color" value={hex} onChange={(e) => { onChange(e.target.value); setHex(e.target.value) }} className="h-9 flex-1 rounded border" />
      </div>
    </>
  )
}

function isLight(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 128
}

function FontSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const current = FONT_OPTIONS.find((f) => f.value === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-9 w-full items-center justify-between rounded-md border bg-background px-3 text-sm">
          <span style={{ fontFamily: value === 'default' ? 'inherit' : value }}>{current?.label ?? value}</span>
          <span className="text-muted-foreground">▾</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-60 overflow-y-auto">
        {FONT_OPTIONS.map((f) => (
          <DropdownMenuItem key={f.value} onClick={() => onChange(f.value)} style={{ fontFamily: f.value === 'default' ? 'inherit' : f.value }}>
            {f.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
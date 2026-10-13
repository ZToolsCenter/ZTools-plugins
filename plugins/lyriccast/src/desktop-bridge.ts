/**
 * 桌面歌词桥:主窗口 → 独立置顶透明窗口(ztools.createBrowserWindow)的状态推送与生命周期。
 *
 * 架构:
 * - 悬浮窗只是"哑渲染器"(dist/desktop.html),不加载 preload、不跑 WebSocket 服务;
 * - bridge 自持 250ms 定时器驱动推送(主窗口隐藏时 rAF 会暂停,定时器不受影响),
 *   按"内容签名变化即推、无变化 2s 心跳"的节奏,
 *   通过 webContents.executeJavaScript 调用悬浮窗暴露的 window.__applyDesktopState;
 *   ok 状态推送整首行文本 + 平行译文 + 当前行下标,悬浮窗据此自建统一行高的
 *   滚动轨道(行间平滑滑动,与首页歌词同款手感),悬浮窗不感知时间轴;
 * - 悬浮窗顶部工具栏(字号/翻译/对齐/锁定/透明度/配色/校准/关闭)与边缘/角落缩放区写入
 *   window.__drainDesktopMessages 队列,
 *   主窗口每 100ms 轮询一次消费(同批 resize 只应用最后一条),统一走 updateSettings
 *   持久化(关闭即联动销毁窗口);窗口尺寸用一次 setBounds 原子完成移动+缩放,
 *   w/n 方向的位移补偿用记账尺寸而非 getSize()(OS 延迟应用会读到过期值来回游移);
 * - 胶囊是拖拽区,渲染层收不到其上的鼠标事件,悬停 UI 由主窗口以 120ms 轮询
 *   getCursorScreenPoint + 窗口边界判定,进入/离开即推送 hovered 标志驱动;
 * - 窗口位置每 3s 采样持久化,重开时恢复;拖动靠 -webkit-app-region,无 JS 参与。
 */
import { applyOffset, displayAnchor, lyric, offsetUi, userOffset } from './store'
import {
  DESKTOP_FONT_RANGE,
  DESKTOP_SIZE_RANGE,
  desktopRowMetrics,
  settings,
  updateSettings,
  type DesktopAlign,
  type DesktopTheme
} from './settings'
import { renderProgress } from './progress'
import { findActiveLine } from './lyric/parse-lrc'
import type { LyricsLine } from './lyric/types'
import type { ProtocolStateMessage } from './env.d'
import type { DesktopActionMessage, DesktopResizeDir } from './desktop-state'

const STAGE_PADDING = 5 // 与 DesktopLyrics.vue 的 .stage padding 一致:窗口 = 胶囊 + 四周透明留白
const POSITION_KEY = 'lanlyrics.desktop.position'
const HEARTBEAT_MS = 2_000
const DRAIN_INTERVAL_MS = 100
const POSITION_SAMPLE_MS = 3_000
const SYNC_INTERVAL_MS = 250
const HOVER_POLL_MS = 120

export interface DesktopPush {
  /** 主窗口轮询判定:光标是否落在悬浮窗内(胶囊是拖拽区,渲染层收不到 mousemove) */
  hovered: boolean
  style: {
    fontSize: number
    theme: DesktopTheme
    /** 文本水平对齐:左对齐(旧版观感)/ 居中 */
    align: DesktopAlign
    translation: boolean
    locked: boolean
    /** 背景不透明度(%) */
    opacity: number
    /** 胶囊宽度(px) */
    width: number
    /** 胶囊高度(px) */
    height: number
    /** 行间距(px):当前句与预备句之间的额外垂直间距,负值收紧 */
    lineGap: number
    /** 行区垂直偏移(px):歌词块整体上下平移,正值下移 */
    lineOffset: number
    /** 自定义 CSS:原始样式,悬浮窗注入 <style> 覆盖内置外观 */
    customCss: string
  }
  status: 'ok' | 'loading' | 'nolyrics' | 'noplayback' | 'offline'
  track: { title: string; artist: string } | null
  /**
   * 整首歌词的行文本快照(仅 status === 'ok' 时携带,空文本行已替换为 ♪);
   * 悬浮窗据此自建统一行高的滚动轨道,行间平滑滑动,不再整句突换
   */
  lines: string[]
  /** 与 lines 平行的译文快照(未开启翻译时为空数组;无译文的行为 '') */
  translations: string[]
  /** 当前行在 lines 中的下标(已应用手动偏移);-1 表示尚未唱到第一句 */
  activeIndex: number
  /**
   * 歌词内容版本号:lyric.lines 引用被整体替换(切歌/重新匹配/繁简切换)时自增。
   * 悬浮窗据此区分「轨道内容重建」与「行推进」,前者直接落位不播放滚动动画
   */
  linesVersion: number
  /** 当前生效的手动校准偏移(ms,正值 = 歌词提前,已计入 activeIndex):校准面板展示用 */
  offsetMs: number
  /** 校准偏移的记忆维度(记住本曲/记住此应用):工具栏调整由主窗口写入此维度 */
  offsetScope: 'track' | 'app'
  /** 进度锚点:悬浮窗按 speed 本地插值,避免高频推送 */
  progress: {
    atMs: number
    positionMs: number
    speed: number
    playing: boolean
    durationMs: number
  } | null
}

interface WindowInstanceShim {
  isDestroyed?: () => boolean
  show: () => void
  hide?: () => void
  close?: () => void
  destroy?: () => void
  getPosition: () => [number, number]
  setPosition: (x: number, y: number) => void
  setSize: (width: number, height: number) => void
  /** 原子移动+缩放,优于 setPosition+setSize 两步(中间帧会闪);旧版 ZTools 可能未提供 */
  setBounds?: (bounds: { x: number; y: number; width: number; height: number }) => void
  getSize?: () => [number, number]
  getBounds: () => { x: number; y: number; width: number; height: number }
  setAlwaysOnTop?: (flag: boolean) => void
  webContents: {
    executeJavaScript: <T>(code: string, userGesture?: boolean) => Promise<T>
    /** Electron webContents 透传;旧版 ZTools 可能未代理,打开 DevTools 前需判存 */
    openDevTools?: (options?: { mode?: string }) => void
  }
}

let winRef: WindowInstanceShim | null = null
let savedPosition = readPosition()
let lastSignature = ''
let lastPushAt = 0
let timers: number[] = []
let cursorInside = false
/** 歌词行版本号:lyric.lines 引用被整体替换(切歌/重新匹配/繁简切换)时自增,
 * 随推送下发给悬浮窗用于识别轨道内容重建;只在 ok 分支比对与推进 */
let lastLinesRef: LyricsLine[] | null = null
let linesVersion = 0

function readPosition(): { x: number; y: number } | null {
  try {
    const raw = window.ztools?.dbStorage?.getItem(POSITION_KEY)
    if (raw && typeof raw.x === 'number' && typeof raw.y === 'number') return { x: raw.x, y: raw.y }
  } catch (_) { /* 无 ztools 环境 */ }
  return null
}

function persistPosition(position: { x: number; y: number }): void {
  savedPosition = position
  try {
    window.ztools?.dbStorage?.setItem(POSITION_KEY, position)
  } catch (_) { /* 持久化失败不影响本次会话 */ }
}

/** 窗口尺寸 = 胶囊内容尺寸 + 四周透明留白(胶囊尺寸存 settings,可由悬浮窗把手调整) */
function windowSize(): { width: number; height: number } {
  return {
    width: settings.desktopWidth + STAGE_PADDING * 2,
    height: settings.desktopHeight + STAGE_PADDING * 2
  }
}

/** 默认落在主屏工作区底部居中(任务栏之上) */
function defaultPosition(): { x: number; y: number } {
  const size = windowSize()
  try {
    const workArea = window.ztools?.getPrimaryDisplay?.().workArea
    if (workArea) {
      return {
        x: workArea.x + Math.max(0, Math.round((workArea.width - size.width) / 2)),
        y: workArea.y + workArea.height - size.height - 48
      }
    }
  } catch (_) { /* screen API 不可用 */ }
  return { x: 60, y: 60 }
}

/** 恢复的位置必须落在某块屏幕内(分辨率变化/外接屏拔掉时回默认位) */
function isOnSomeDisplay(position: { x: number; y: number }): boolean {
  const size = windowSize()
  try {
    const displays = window.ztools?.getAllDisplays?.() ?? []
    return displays.some(
      (d) =>
        position.x >= d.bounds.x - size.width + 120 &&
        position.x < d.bounds.x + d.bounds.width - 120 &&
        position.y >= d.bounds.y &&
        position.y < d.bounds.y + d.bounds.height - 60
    )
  } catch (_) {
    return true // 查不到屏幕信息时不强制重置
  }
}

function overlayUrl(): string {
  // createBrowserWindow 只接受相对路径或 file://,dev 模式的 http 源会被主进程拒掉;
  // 两种模式下插件根都是 src-ztools/,悬浮窗统一加载构建产物 dist/desktop.html,
  // 开发时配合 `pnpm dev:full` 的 watch build 保持产物新鲜
  return 'dist/desktop.html'
}

/** createWindow 的返回:成功时 instance 为窗口实例,失败时 error 为可直接展示的原因 */
type CreateWindowResult =
  | { instance: WindowInstanceShim; error: null }
  | { instance: null; error: string }

function createWindow(): CreateWindowResult {
  const ztools = window.ztools
  if (!ztools?.createBrowserWindow) {
    return { instance: null, error: '当前 ZTools 版本未提供 createBrowserWindow API' }
  }
  const position = savedPosition && isOnSomeDisplay(savedPosition) ? savedPosition : defaultPosition()
  persistPosition(position)
  const size = windowSize()
  try {
    const instance = ztools.createBrowserWindow(
      overlayUrl(),
      {
        width: size.width,
        height: size.height,
        x: position.x,
        y: position.y,
        show: false,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        hasShadow: false,
        focusable: false,
        title: '桌面歌词',
        // devTools 保持开启:设置页开发者选项可按需打开悬浮窗 DevTools,平时不自动弹出
        webPreferences: { zoomFactor: 1, devTools: true, nodeIntegration: false }
      },
      () => {
        // load 完成后再显示,避免闪白底
        try {
          winRef?.show()
        } catch (_) { /* 已销毁 */ }
      }
    )
    instance.setAlwaysOnTop?.(true)
    return { instance: instance as unknown as WindowInstanceShim, error: null }
  } catch (err) {
    // 主进程拒绝(http URL/越权等)或窗口参数非法时,把真实原因交给调用方展示
    console.error('[desktop-lyrics] createBrowserWindow failed:', (err as Error)?.message)
    return { instance: null, error: (err as Error)?.message || String(err) }
  }
}

/** 窗口内歌词轨道的布局常量(与 DesktopLyrics.vue 保持同值):
 * 胶囊上下内边距 14+18;裁剪窗口在预备句文本盒之下保留的底部余量 */
const PILL_PADDING_V = 32
const WINDOW_TAIL = 6

/** 当前字号/行间距下,悬浮窗完整展示两行轨道所需的胶囊高度。
 * 翻译按「当前歌曲确实携带译文」计:无译文的歌行高不含译文槽,与悬浮窗渲染同源 */
function desktopNeededHeight(): number {
  const translation = settings.desktopTranslation && lyric.translationMap.size > 0
  const { textHeight, rowHeight } = desktopRowMetrics(
    settings.desktopFontSize,
    translation,
    settings.desktopLineGap
  )
  const needed = rowHeight + textHeight + WINDOW_TAIL + PILL_PADDING_V
  return Math.min(DESKTOP_SIZE_RANGE.maxHeight, Math.max(DESKTOP_SIZE_RANGE.minHeight, needed))
}

/** 胶囊装不下两行轨道时自动加高(只增不减,不回收手动缩小的高度):
 * 字号/翻译/行间距调大后预备句会被裁剪窗口裁出胶囊外,这里保证内容始终完整可见 */
function ensureCapsuleFitsContent(): void {
  const needed = desktopNeededHeight()
  if (settings.desktopHeight < needed) updateSettings({ desktopHeight: needed })
}

/** 开启桌面歌词;悬浮窗已存在(主窗口重载后模块状态保留)则直接复用。
 * 失败时 error 携带真实原因(如 URL 校验拒绝),供设置页直接展示 */
export function enableDesktopLyrics(): { ok: boolean; error?: string } {
  ensureCapsuleFitsContent()
  if (winRef && !winRef.isDestroyed?.()) {
    winRef.show()
    applyWindowSize()
    startTimers()
    syncDesktopLyrics(undefined, true)
    return { ok: true }
  }
  const result = createWindow()
  if (!result.instance) {
    return { ok: false, error: result.error }
  }
  winRef = result.instance
  startTimers()
  // 页面加载需要一点时间;加载完成后 __applyDesktopState 已就绪,失败由下次心跳兜底
  setTimeout(() => syncDesktopLyrics(undefined, true), 600)
  return { ok: true }
}

export function disableDesktopLyrics(): void {
  stopTimers()
  lastSignature = ''
  const instance = winRef
  winRef = null
  if (!instance) return
  try {
    if (!instance.isDestroyed?.()) {
      if (instance.close) instance.close()
      else instance.destroy?.()
    }
  } catch (_) { /* 已销毁 */ }
}

/** 最近一次应用到窗口的尺寸(记账):w/n 方向补偿位移时不能用 getSize(),OS 应用
 * setSize 有延迟,连发时读到过期值会让对侧边缘来回游移;用自己记账的值做差是确定的 */
let lastAppliedSize = { width: 0, height: 0 }

/** 把当前设置的胶囊尺寸同步到悬浮窗;w/n 方向缩放时同步移动窗口,保持对侧边缘不动。
 * 用一次 setBounds 原子完成移动+缩放(setPosition/setSize 两步中间会闪一帧),
 * 位置取实时值,尺寸差用记账值,避免 OS 延迟应用造成的抖动 */
function applyWindowSize(dir?: DesktopResizeDir): void {
  const instance = winRef
  if (!instance || instance.isDestroyed?.()) return
  const size = windowSize()
  try {
    const [curX, curY] = instance.getPosition()
    let x = curX
    let y = curY
    if (dir && (dir.includes('w') || dir.includes('n'))) {
      const prevWidth = lastAppliedSize.width || size.width
      const prevHeight = lastAppliedSize.height || size.height
      if (dir.includes('w')) x = Math.round(curX + (prevWidth - size.width))
      if (dir.includes('n')) y = Math.round(curY + (prevHeight - size.height))
    }
    if (typeof instance.setBounds === 'function') {
      instance.setBounds({ x, y, width: size.width, height: size.height })
    } else {
      // 旧版 ZTools 无 setBounds:退化为两步调用(可能有单帧跳动,功能等价)
      if (x !== curX || y !== curY) instance.setPosition(x, y)
      instance.setSize(size.width, size.height)
    }
    lastAppliedSize = { width: size.width, height: size.height }
  } catch (_) { /* 已销毁 */ }
}

/** 样式/尺寸相关设置变化后调用:胶囊高度不足时自动加高,同步窗口尺寸并立即重推
 * (字号/主题/翻译/锁定/透明度/尺寸/行间距);加高会再触发一次本函数,幂等无环 */
export function notifyStyleChanged(): void {
  if (!winRef) return
  ensureCapsuleFitsContent()
  applyWindowSize()
  syncDesktopLyrics(undefined, true)
}

/** 回到默认位置(用户在设置页点"恢复默认位置") */
export function resetDesktopPosition(): void {
  const position = defaultPosition()
  persistPosition(position)
  try {
    winRef?.setPosition(position.x, position.y)
  } catch (_) { /* 窗口已销毁 */ }
}

/** 打开悬浮窗 DevTools(设置页开发者选项):detach 模式开独立窗口,不改变悬浮窗
 * 自身尺寸(透明置顶窗不适合停靠);窗口未开启/旧版 ZTools 未透传方法时报错给设置页 */
export function openDesktopDevTools(): { ok: boolean; error?: string } {
  const instance = winRef
  if (!instance || instance.isDestroyed?.()) return { ok: false, error: '悬浮歌词窗口未开启' }
  try {
    if (typeof instance.webContents.openDevTools !== 'function') {
      return { ok: false, error: '当前 ZTools 版本未提供 webContents.openDevTools' }
    }
    instance.webContents.openDevTools({ mode: 'detach' })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || String(err) }
  }
}

/**
 * 推送一次状态(一般由 startTimers 的 250ms 定时器驱动,也可手动调用)。
 * rendered 缺省时自行按 store 锚点插值;内容签名变化立即推,
 * 否则最多 2s 心跳一次(进度锚点保鲜);force 跳过节流。
 */
export function syncDesktopLyrics(
  rendered?: { positionMs: number; known: boolean; status: string },
  force = false
): void {
  if (!winRef || winRef.isDestroyed?.()) return
  const anchor = displayAnchor.value
  const resolved =
    rendered ??
    (anchor
      ? renderProgress(anchor, Date.now())
      : { positionMs: -1, known: false, status: 'connected' as const })
  const now = Date.now()
  const payload = buildPush(resolved)
  if (!force && signatureOf(payload) === lastSignature && now - lastPushAt < HEARTBEAT_MS) return
  push(payload)
}

/** 内容签名:任一展示相关字段变化即触发立即推送。
 * 行推进靠 activeIndex 感知;歌词内容重建靠 linesVersion 感知 */
function signatureOf(payload: DesktopPush): string {
  return [
    payload.hovered,
    payload.status,
    payload.track?.title ?? '',
    payload.activeIndex,
    payload.linesVersion,
    payload.offsetMs,
    payload.offsetScope,
    payload.style.fontSize,
    payload.style.theme,
    payload.style.align,
    payload.style.translation,
    payload.style.locked,
    payload.style.opacity,
    payload.style.width,
    payload.style.height,
    payload.style.lineGap,
    payload.style.lineOffset,
    payload.style.customCss
  ].join('|')
}

function push(payload: DesktopPush): void {
  const instance = winRef
  if (!instance || instance.isDestroyed?.()) return
  lastPushAt = Date.now()
  lastSignature = signatureOf(payload)
  try {
    Promise.resolve(instance.webContents.executeJavaScript(`window.__applyDesktopState(${JSON.stringify(payload)})`)).catch(
      () => { /* 子页面未就绪/已销毁:静默,心跳会重试 */ }
    )
  } catch (_) { /* 同上 */ }
}

/** 组装一次推送;数据全部来自 store/settings,保证与主界面同一套状态源。
 * ok 状态携带整首行文本 + 平行译文 + 当前行下标,悬浮窗据此自建滚动轨道 */
function buildPush(rendered: { positionMs: number; known: boolean; status: string }): DesktopPush {
  const hovered = cursorInside
  const style = {
    fontSize: settings.desktopFontSize,
    theme: settings.desktopTheme,
    align: settings.desktopAlign,
    translation: settings.desktopTranslation,
    locked: settings.desktopLocked,
    opacity: settings.desktopOpacity,
    width: settings.desktopWidth,
    height: settings.desktopHeight,
    lineGap: settings.desktopLineGap,
    lineOffset: settings.desktopLineOffset,
    customCss: settings.desktopCustomCss
  }
  const anchor = displayAnchor.value
  // 校准展示信息与具体状态无关(无播放也要在面板里可见),统一并入每条返回
  const calibration = { offsetMs: userOffset.value, offsetScope: offsetUi.scope }
  if (!anchor) {
    return {
      hovered, style, ...calibration, status: 'noplayback', track: null,
      lines: [], translations: [], activeIndex: -1, linesVersion, progress: null
    }
  }
  const state = anchor.state
  const track = { title: state.track.title || '', artist: state.track.artist || '' }
  if (rendered.status === 'disconnected') {
    return {
      hovered, style, ...calibration, status: 'offline', track,
      lines: [], translations: [], activeIndex: -1, linesVersion, progress: null
    }
  }
  const positionKnown = rendered.known && rendered.positionMs >= 0
  const searchPosition = positionKnown ? rendered.positionMs + userOffset.value : Number.NaN
  const activeIndex =
    Number.isFinite(searchPosition) && lyric.lines.length > 0
      ? findActiveLine(lyric.lines, searchPosition)
      : -1
  if (lyric.loading) {
    return {
      hovered, style, ...calibration, status: 'loading', track,
      lines: [], translations: [], activeIndex: -1, linesVersion, progress: null
    }
  }
  if (activeIndex < 0 && lyric.lines.length === 0) {
    return {
      hovered, style, ...calibration, status: 'nolyrics', track,
      lines: [], translations: [], activeIndex: -1, linesVersion, progress: null
    }
  }
  // 行快照:引用被整体替换(切歌/重新匹配/繁简切换)才推进版本号,行推进不触发
  if (lyric.lines !== lastLinesRef) {
    lastLinesRef = lyric.lines
    linesVersion++
  }
  const lines = lyric.lines.map((line) => line.text || '♪')
  const translations = settings.desktopTranslation
    ? lyric.lines.map((line) => lyric.translationMap.get(line.timeMs) ?? '')
    : []
  const playbackState: ProtocolStateMessage['playback'] = state.playback
  return {
    hovered,
    style,
    ...calibration,
    status: 'ok',
    track,
    lines,
    translations,
    activeIndex,
    linesVersion,
    progress: positionKnown
      ? {
          atMs: Date.now(),
          positionMs: rendered.positionMs,
          speed: playbackState.state === 'playing' ? playbackState.speed || 0 : 0,
          playing: playbackState.state === 'playing',
          durationMs: state.track.durationMs || 0
        }
      : null
  }
}

/**
 * 轮询光标是否落在悬浮窗边界内。
 * 胶囊整体是 -webkit-app-region: drag 拖拽区,渲染层在其上收不到 mousemove,
 * CSS :hover 不触发,只能由主窗口用屏幕光标坐标 + 窗口边界判定后推送 hovered。
 */
function pollCursor(): void {
  const instance = winRef
  if (!instance || instance.isDestroyed?.()) return
  try {
    const point = window.ztools?.getCursorScreenPoint?.()
    const inside = !!(
      point &&
      typeof point.x === 'number' &&
      (() => {
        const bounds = instance.getBounds()
        return (
          point.x >= bounds.x &&
          point.x < bounds.x + bounds.width &&
          point.y >= bounds.y &&
          point.y < bounds.y + bounds.height
        )
      })()
    )
    if (inside !== cursorInside) {
      cursorInside = inside
      syncDesktopLyrics(undefined, true) // 进入/离开立即推送,延迟 ≈ 轮询间隔
    }
  } catch (_) { /* API 不可用时保持 false */ }
}

function startTimers(): void {
  if (timers.length > 0) return
  timers = [
    // 自驱同步:主窗口隐藏时 rAF 会暂停,而桌面歌词恰恰在这时使用,
    // 因此不依赖 App 的 tick,由本定时器驱动(backgroundRunning 已关闭后台节流)
    window.setInterval(() => syncDesktopLyrics(), SYNC_INTERVAL_MS),
    window.setInterval(drainMessages, DRAIN_INTERVAL_MS),
    window.setInterval(samplePosition, POSITION_SAMPLE_MS),
    window.setInterval(pollCursor, HOVER_POLL_MS)
  ]
}

function stopTimers(): void {
  for (const id of timers) clearInterval(id)
  timers = []
}

/** 消费悬浮窗工具栏消息(字号/翻译/对齐/锁定/透明度/尺寸/配色/校准/关闭),统一落回 settings 或 store。
 * 同一批里可能堆了多条 resize(子窗口 ~33ms 节流入队,本函数 100ms 轮询一次):
 * 中间尺寸没有意义,只应用最后一条,避免 settings 连写和窗口连续缩放 */
async function drainMessages(): Promise<void> {
  const instance = winRef
  if (!instance || instance.isDestroyed?.()) return
  try {
    const messages = (await instance.webContents.executeJavaScript<any[]>(
      '(window.__drainDesktopMessages && window.__drainDesktopMessages()) || []'
    )) as DesktopActionMessage[]
    if (!Array.isArray(messages) || messages.length === 0) return
    let lastResize: DesktopActionMessage | null = null
    for (const message of messages) {
      if (message?.type === 'font') {
        const delta = message.delta === -1 ? -2 : 2
        updateSettings({
          desktopFontSize: Math.min(
            DESKTOP_FONT_RANGE.max,
            Math.max(DESKTOP_FONT_RANGE.min, settings.desktopFontSize + delta)
          )
        })
      } else if (message?.type === 'theme') {
        const order: DesktopTheme[] = ['auto', 'dark', 'light']
        const next = order[(order.indexOf(settings.desktopTheme) + 1) % order.length]
        updateSettings({ desktopTheme: next ?? 'auto' })
      } else if (message?.type === 'translation') {
        updateSettings({ desktopTranslation: !settings.desktopTranslation })
      } else if (message?.type === 'align') {
        updateSettings({ desktopAlign: settings.desktopAlign === 'center' ? 'left' : 'center' })
      } else if (message?.type === 'lock') {
        updateSettings({ desktopLocked: !settings.desktopLocked })
      } else if (message?.type === 'offset') {
        // 校准:复用设置页的 applyOffset(按当前记忆维度写入 OffsetStore 并持久化,
        // delta 0 = 复位本曲记录),立即重推让校准面板即时读到新值,不等 250ms 节拍
        applyOffset(message.delta ?? 0)
        syncDesktopLyrics(undefined, true)
      } else if (message?.type === 'opacity') {
        // sanitize 会把越界/非法值裁剪回 0~100
        updateSettings({ desktopOpacity: message.value as number })
      } else if (message?.type === 'resize' && message.size) {
        lastResize = message
      } else if (message?.type === 'close') {
        updateSettings({ desktopEnabled: false })
      }
    }
    if (lastResize?.size) {
      const { width, height } = lastResize.size
      // 与当前设置一致说明已应用过(含 sanitize 裁剪后的重复推送),跳过即可
      if (width !== settings.desktopWidth || height !== settings.desktopHeight) {
        updateSettings({ desktopWidth: width, desktopHeight: height })
        applyWindowSize(lastResize.dir)
      }
    }
  } catch (_) { /* 子页面未就绪,下轮重试 */ }
}

/** 定期记录拖动后的窗口位置(无拖动结束事件可订阅) */
async function samplePosition(): Promise<void> {
  const instance = winRef
  if (!instance || instance.isDestroyed?.()) return
  try {
    const [x, y] = instance.getPosition()
    if (typeof x === 'number' && typeof y === 'number' && (x !== savedPosition.x || y !== savedPosition.y)) {
      persistPosition({ x, y })
    }
  } catch (_) { /* 已销毁 */ }
}

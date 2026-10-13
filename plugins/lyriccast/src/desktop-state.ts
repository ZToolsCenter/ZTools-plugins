/**
 * 桌面悬浮歌词的状态容器(仅悬浮窗页面使用)。
 *
 * 主窗口通过 executeJavaScript 调用 applyDesktopState 推送状态;
 * 本窗口的按钮动作进消息队列,由主窗口轮询 drainDesktopMessages 消费。
 * 故意与主窗口的 store 隔离:悬浮窗是哑渲染器,拿不到 preload 服务。
 */
import { reactive } from 'vue'
import type { DesktopPush } from './desktop-bridge'

export type DesktopStatus = DesktopPush['status']

export interface DesktopState {
  /** 主窗口轮询判定:光标是否落在悬浮窗内(拖拽区收不到鼠标事件,悬停 UI 由此驱动) */
  hovered: boolean
  style: {
    fontSize: number
    theme: 'auto' | 'light' | 'dark'
    /** 文本水平对齐:左对齐(旧版观感)/ 居中 */
    align: 'left' | 'center'
    translation: boolean
    /** 锁定:禁止拖动、工具栏只留解锁按钮 */
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
    /** 自定义 CSS:主窗口推送的原始样式,注入 <style> 覆盖内置外观 */
    customCss: string
  }
  status: DesktopStatus
  track: { title: string; artist: string } | null
  /** 整首歌词行文本快照(status==='ok' 时携带);悬浮窗据此自建滚动轨道 */
  lines: string[]
  /** 与 lines 平行的译文快照(未开启翻译为空数组,无译文的行为 '') */
  translations: string[]
  /** 当前行在 lines 中的下标(已应用手动偏移);-1 表示尚未唱到第一句 */
  activeIndex: number
  /** 歌词内容版本号:行快照被整体替换(切歌/重新匹配)时自增,用于区分轨道重建与行推进 */
  linesVersion: number
  /** 当前生效的手动校准偏移(ms,正值 = 歌词提前,已计入 activeIndex):校准面板展示用 */
  offsetMs: number
  /** 校准偏移的记忆维度(记住本曲/记住此应用):工具栏调整由主窗口写入此维度 */
  offsetScope: 'track' | 'app'
  progress: {
    atMs: number
    positionMs: number
    speed: number
    playing: boolean
    durationMs: number
  } | null
}

export const desktopState = reactive<DesktopState>({
  hovered: false,
  style: { fontSize: 26, theme: 'auto', align: 'left', translation: true, locked: false, opacity: 90, width: 870, height: 138, lineGap: 0, lineOffset: 0, customCss: '' },
  status: 'noplayback',
  track: null,
  lines: [],
  translations: [],
  activeIndex: -1,
  linesVersion: 0,
  offsetMs: 0,
  offsetScope: 'track',
  progress: null
})

/** 主窗口推送入口(由 desktop-main.ts 挂到 window.__applyDesktopState)。
 * 各字段带类型兜底:旧版主窗口/异常负载缺字段时退回「无歌词」安全态 */
export function applyDesktopState(payload: DesktopPush): void {
  if (!payload || typeof payload !== 'object') return
  desktopState.hovered = !!payload.hovered
  if (payload.style) Object.assign(desktopState.style, payload.style)
  desktopState.status = payload.status ?? 'noplayback'
  desktopState.track = payload.track ?? null
  desktopState.lines = Array.isArray(payload.lines) ? payload.lines : []
  desktopState.translations = Array.isArray(payload.translations) ? payload.translations : []
  desktopState.activeIndex =
    typeof payload.activeIndex === 'number' && Number.isFinite(payload.activeIndex)
      ? payload.activeIndex
      : -1
  desktopState.linesVersion = typeof payload.linesVersion === 'number' ? payload.linesVersion : 0
  desktopState.offsetMs =
    typeof payload.offsetMs === 'number' && Number.isFinite(payload.offsetMs) ? payload.offsetMs : 0
  desktopState.offsetScope = payload.offsetScope === 'app' ? 'app' : 'track'
  desktopState.progress = payload.progress ?? null
}

/** 悬浮窗缩放方位:n/s/e/w 为四边,nw/ne/sw/se 为四角 */
export type DesktopResizeDir = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'

/** 悬浮窗工具栏动作消息;delta 仅 font/offset,value 仅 opacity,align 等开关类无参,size/dir 仅 resize 使用 */
export interface DesktopActionMessage {
  type: 'font' | 'theme' | 'close' | 'translation' | 'align' | 'lock' | 'opacity' | 'resize' | 'offset'
  delta?: number
  value?: number
  /** resize:目标胶囊尺寸(px,窗口 = 胶囊 + 四周各 5px 留白) */
  size?: { width: number; height: number }
  /** resize:被拖拽的边缘/角方向,主窗口据此移动窗口保持对侧边固定 */
  dir?: DesktopResizeDir
}

const messageQueue: DesktopActionMessage[] = []

/** 主窗口轮询取走积压的按钮消息(取走即清空) */
export function drainDesktopMessages(): DesktopActionMessage[] {
  return messageQueue.splice(0)
}

/** 悬浮窗工具栏动作统一入口,由主窗口轮询消费后落回 settings */
export function desktopAction(message: DesktopActionMessage): void {
  messageQueue.push(message)
}

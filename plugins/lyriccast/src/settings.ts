/**
 * 用户设置:单一 reactive 对象 + 整块 JSON 持久化(ztools.dbStorage)。
 *
 * 与 port/token(preload 侧的 lanlyrics.config)分离:那边是"服务配置",
 * 这边是"展示偏好"。持久化粒度为整个对象,键值量级小,避免散落十几个 key。
 */
import { reactive } from 'vue'
import { createMemoryStorage, type KVStorage } from './lyric/cache'

export type DesktopTheme = 'auto' | 'light' | 'dark'

/** 桌面歌词文本水平对齐方式:left 还原旧版观感,center 与首页歌词一致 */
export type DesktopAlign = 'left' | 'center'

export interface Settings {
  /** 桌面悬浮歌词开关(独立置顶透明窗口) */
  desktopEnabled: boolean
  /** 桌面歌词主行字号(px) */
  desktopFontSize: number
  /** 桌面歌词配色:跟随系统 / 浅底深字 / 深底浅字 */
  desktopTheme: DesktopTheme
  /** 桌面歌词文本水平对齐:左对齐(默认,旧版观感)/ 居中 */
  desktopAlign: DesktopAlign
  /** 桌面歌词是否在当前行下方显示翻译(无翻译时显示下一句) */
  desktopTranslation: boolean
  /** 桌面歌词是否锁定:禁止拖动、隐藏悬浮工具栏(仅留解锁按钮),防误触 */
  desktopLocked: boolean
  /** 桌面歌词背景不透明度(%,0~100;0 为全透明,仅显示文字与进度) */
  desktopOpacity: number
  /** 桌面歌词胶囊宽度(px;悬浮窗宽 = 胶囊宽 + 左右各 5px 透明留白) */
  desktopWidth: number
  /** 桌面歌词胶囊高度(px;悬浮窗高 = 胶囊高 + 上下各 5px 透明留白) */
  desktopHeight: number
  /** 桌面歌词行间距(px):当前句与预备句之间的额外垂直间距,负值收紧 */
  desktopLineGap: number
  /** 桌面歌词行区垂直偏移(px):歌词块整体上下平移,正值下移;不设上下限 */
  desktopLineOffset: number
  /** 桌面歌词自定义 CSS:原始样式注入悬浮歌词窗口,覆盖内置外观 */
  desktopCustomCss: string
  /** 歌词来源:LRCLIB(主源)开关 */
  providerLrclib: boolean
  /** 歌词来源:网易云(中文回退)开关 */
  providerNetease: boolean
  /** 歌词来源:酷狗(中文补充)开关 */
  providerKugou: boolean
  /** 歌词来源:lrcmux(聚合源,LRCLIB/Musixmatch/酷狗/Genius/Deezer)开关 */
  providerLrcmux: boolean
  /** 歌词来源:Better Lyrics(TTML 逐字,热歌缓存命中)开关 */
  providerBetterLyrics: boolean
  /** 并行请求各来源(时间预算模式);关闭退化为按路由顺序串行 */
  parallelProviders: boolean
  /** 封面 API 兜底:手机未推送封面时,按曲目元数据从 LrcAPI/MusicBrainz 拉取封面 */
  coverFromApi: boolean
  /** 主界面滚动歌词字号(px) */
  mainFontSize: number
  /** 主界面歌词是否显示翻译 */
  translation: boolean
  /** 繁体转简体:歌词判定为繁体时,经内置字表(OpenCC)逐字转换为简体显示 */
  traditionalToSimplified: boolean
}

export const SETTINGS_KEY = 'lanlyrics.settings.v1'
const LEGACY_FONT_KEY = 'lyric.fontSize'

export const DESKTOP_FONT_RANGE = { min: 16, max: 42 }
export const DESKTOP_OPACITY_RANGE = { min: 0, max: 100 }
/** 胶囊尺寸范围;下限保证顶部工具栏放得下,悬浮窗是哑渲染器,范围在 DesktopLyrics.vue 内有同值副本 */
export const DESKTOP_SIZE_RANGE = { minWidth: 360, maxWidth: 1600, minHeight: 96, maxHeight: 400 }
/** 桌面歌词行间距(px):当前句与预备句之间的额外垂直间距,负值收紧;
 * 下限保证开翻译时预备句不与译文文字重叠(悬浮窗为同值副本) */
export const DESKTOP_LINE_GAP_RANGE = { min: -4, max: 32 }
/** 自定义 CSS 长度上限(字符):防误粘贴超大文本撑爆推送负载与持久化 */
export const DESKTOP_CUSTOM_CSS_MAX_LENGTH = 20_000
export const MAIN_FONT_RANGE = { min: 12, max: 30 }

const DEFAULTS: Settings = {
  providerLrclib: true,
  providerNetease: true,
  providerKugou: true,
  providerLrcmux: true,
  providerBetterLyrics: true,
  parallelProviders: true,
  coverFromApi: true,
  desktopEnabled: false,
  desktopFontSize: 26,
  desktopTheme: 'auto',
  desktopAlign: 'left',
  desktopTranslation: true,
  desktopLocked: false,
  desktopOpacity: 90,
  desktopWidth: 870,
  desktopHeight: 138,
  desktopLineGap: 0,
  desktopLineOffset: 0,
  desktopCustomCss: '',
  mainFontSize: 16,
  translation: true,
  traditionalToSimplified: false
}

function storage(): KVStorage {
  try {
    if (window.ztools?.dbStorage) return window.ztools.dbStorage
  } catch (_) { /* 无 ztools 环境(纯浏览器调试)退化为内存 */ }
  return createMemoryStorage()
}

/** 校验并合并持久化值:字段缺失/越界/类型不对时回落默认,保证结构永远完整 */
function sanitize(raw: unknown): Settings {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
    const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : NaN
    return Number.isNaN(n) ? fallback : Math.min(max, Math.max(min, n))
  }
  // 无上下限的数值字段:只要求有限数并取整,大小不裁剪(如行区垂直偏移)
  const finite = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return {
    providerLrclib: typeof input.providerLrclib === 'boolean' ? input.providerLrclib : DEFAULTS.providerLrclib,
    providerNetease: typeof input.providerNetease === 'boolean' ? input.providerNetease : DEFAULTS.providerNetease,
    providerKugou: typeof input.providerKugou === 'boolean' ? input.providerKugou : DEFAULTS.providerKugou,
    providerLrcmux: typeof input.providerLrcmux === 'boolean' ? input.providerLrcmux : DEFAULTS.providerLrcmux,
    providerBetterLyrics:
      typeof input.providerBetterLyrics === 'boolean' ? input.providerBetterLyrics : DEFAULTS.providerBetterLyrics,
    parallelProviders:
      typeof input.parallelProviders === 'boolean' ? input.parallelProviders : DEFAULTS.parallelProviders,
    coverFromApi: typeof input.coverFromApi === 'boolean' ? input.coverFromApi : DEFAULTS.coverFromApi,
    desktopEnabled: typeof input.desktopEnabled === 'boolean' ? input.desktopEnabled : DEFAULTS.desktopEnabled,
    desktopFontSize: clamp(input.desktopFontSize, DESKTOP_FONT_RANGE.min, DESKTOP_FONT_RANGE.max, DEFAULTS.desktopFontSize),
    desktopTheme:
      input.desktopTheme === 'light' || input.desktopTheme === 'dark' || input.desktopTheme === 'auto'
        ? input.desktopTheme
        : DEFAULTS.desktopTheme,
    desktopAlign:
      input.desktopAlign === 'left' || input.desktopAlign === 'center'
        ? input.desktopAlign
        : DEFAULTS.desktopAlign,
    desktopTranslation: typeof input.desktopTranslation === 'boolean' ? input.desktopTranslation : DEFAULTS.desktopTranslation,
    desktopLocked: typeof input.desktopLocked === 'boolean' ? input.desktopLocked : DEFAULTS.desktopLocked,
    desktopOpacity: clamp(input.desktopOpacity, DESKTOP_OPACITY_RANGE.min, DESKTOP_OPACITY_RANGE.max, DEFAULTS.desktopOpacity),
    desktopWidth: clamp(input.desktopWidth, DESKTOP_SIZE_RANGE.minWidth, DESKTOP_SIZE_RANGE.maxWidth, DEFAULTS.desktopWidth),
    desktopHeight: clamp(input.desktopHeight, DESKTOP_SIZE_RANGE.minHeight, DESKTOP_SIZE_RANGE.maxHeight, DEFAULTS.desktopHeight),
    desktopLineGap: clamp(
      input.desktopLineGap,
      DESKTOP_LINE_GAP_RANGE.min,
      DESKTOP_LINE_GAP_RANGE.max,
      DEFAULTS.desktopLineGap
    ),
    desktopLineOffset: finite(input.desktopLineOffset, DEFAULTS.desktopLineOffset),
    desktopCustomCss:
      typeof input.desktopCustomCss === 'string'
        ? input.desktopCustomCss.slice(0, DESKTOP_CUSTOM_CSS_MAX_LENGTH)
        : DEFAULTS.desktopCustomCss,
    mainFontSize: clamp(input.mainFontSize, MAIN_FONT_RANGE.min, MAIN_FONT_RANGE.max, DEFAULTS.mainFontSize),
    translation: typeof input.translation === 'boolean' ? input.translation : DEFAULTS.translation,
    traditionalToSimplified:
      typeof input.traditionalToSimplified === 'boolean'
        ? input.traditionalToSimplified
        : DEFAULTS.traditionalToSimplified
  }
}

export const settings = reactive<Settings>({ ...DEFAULTS })

/** 从持久化载入(应用启动时调用一次);旧版散写的 lyric.fontSize 迁移为 mainFontSize */
export function loadSettings(): void {
  const store = storage()
  let raw: unknown = null
  try {
    raw = store.getItem(SETTINGS_KEY)
  } catch (_) { /* 存储损坏按默认 */ }
  if (raw === null || raw === undefined) {
    try {
      const legacy = store.getItem(LEGACY_FONT_KEY)
      if (typeof legacy === 'number') settings.mainFontSize = legacy
    } catch (_) { /* 忽略 */ }
    return
  }
  Object.assign(settings, sanitize(typeof raw === 'string' ? safeParse(raw) : raw))
}

/** 写入任意字段子集并持久化;越界值裁剪到合法区间 */
export function updateSettings(patch: Partial<Settings>): void {
  Object.assign(settings, sanitize({ ...settings, ...patch }))
  try {
    storage().setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch (_) { /* 持久化失败不影响本次会话 */ }
}

/**
 * 桌面歌词滚动轨道的行几何(与 DesktopLyrics.vue 内的渲染公式保持同源):
 * - 文本盒高 = ceil(字号×1.22),行内文字的固定槽;
 * - 译文槽高 = ceil(max(12, 字号×0.5)×1.3),translation 为 true 时计入行高
 *   (调用方按「当前歌曲确实携带译文」传入,无译文的歌不留空档);
 * - 行高 = 文本盒 + 译文槽 + 行间距(带译文行的行高),胶囊高度计算基于它。
 * 主窗口据此计算胶囊最小高度(悬浮窗不加载本模块,渲染侧有同式副本)。
 */
export function desktopRowMetrics(
  fontSize: number,
  translation: boolean,
  lineGap: number
): { textHeight: number; transHeight: number; rowHeight: number } {
  const textHeight = Math.ceil(fontSize * 1.22)
  const transHeight = translation ? Math.ceil(Math.max(12, fontSize * 0.5) * 1.3) : 0
  const rowHeight = textHeight + transHeight + lineGap
  return { textHeight, transHeight, rowHeight }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (_) {
    return null
  }
}

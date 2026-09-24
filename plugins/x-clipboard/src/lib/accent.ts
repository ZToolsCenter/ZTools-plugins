/*
 * 强调色的纯计算：给一个强调色，算出「铺在它上面的字色」和「它的淡底」。
 *
 * 这里**不碰 DOM、不碰宿主**，纯粹是色值数学 —— 所以能脱离浏览器直接单测
 * （和 `query.ts` 一个路子）。真正读宿主变量、写 CSS 变量的胶水在 `theme.ts`。
 *
 * 为什么需要它：宿主只给强调色本身，而强调色**深浅差别很大**——
 * 浅色主题下是 `#0284c7` / `#059669` 这类深色（配白字没问题），
 * 深色主题下是 `#38bdf8` / `#34d399` / `#f472b6` 这类**亮**色，
 * 照样配白字的话对比度会掉到 2:1 上下，直接糊成一片。
 */

/** 万一读不到宿主变量时的兜底 —— 设计稿里那个绿 */
export const FALLBACK_ACCENT = '#1fa84e'
/** 当前行底下那层淡底的透明度：只有 13%，够看出「选着」但不抢眼 */
export const SOFT_ALPHA = 0.13
/**
 * 亮度分界。宿主浅色主题的 6 个强调色亮度都在 0.13~0.25，
 * 深色主题的 6 个都在 0.33~0.50，取 0.3 正好卡在两档中间。
 * 比 WCAG 的 0.179 保守 —— 宁可提前切黑字，也别在 `#34d399` 这种亮绿上留白字。
 */
const LIGHT_BG_THRESHOLD = 0.3
/** 亮底上用近黑字（不用纯黑，纯黑在彩底上显脏） */
const DARK_TEXT = '#101114'
const DARK_TEXT_RGB = '16, 17, 20'
const LIGHT_TEXT = '#ffffff'
const LIGHT_TEXT_RGB = '255, 255, 255'

function toRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = Number.parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** WCAG 相对亮度 */
function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

export interface AccentDerived {
  /** 铺在强调色上的字色 */
  text: string
  /** 同上，`r, g, b` 形式，方便在 CSS 里做半透明底（缩略图底、行尾按钮的 hover 底） */
  rgb: string
  /** 强调色**自身**的 `r, g, b` —— 搜索命中那层底要用它调透明度 */
  accentRgb: string
  /** 强调色 13% 的淡底（当前行） */
  soft: string
}

/** 强调色 → 派生值 */
export function deriveFrom(hex: string): AccentDerived {
  const rgb = toRgb(hex)
  const light = luminance(rgb) > LIGHT_BG_THRESHOLD
  return {
    text: light ? DARK_TEXT : LIGHT_TEXT,
    rgb: light ? DARK_TEXT_RGB : LIGHT_TEXT_RGB,
    accentRgb: rgb.join(', '),
    soft: `rgba(${rgb.join(', ')}, ${SOFT_ALPHA})`
  }
}

/* ------------------------------------------------------------------ *
 * 插件设置里的「强调色」
 *
 * 默认 `auto` —— 跟着 ZTools 走。宿主本来就提供主题色，插件再自作主张设一套，
 * 用户在宿主换了色这边不跟着变，两边就打架了。这里只给「我就想这个插件自己一个样」
 * 的人留一个覆盖口子。
 *
 * 注意这里**没有「深浅色」**：那个插件不提供覆盖，一律听宿主的（理由写在 `settings.ts`）。
 * ------------------------------------------------------------------ */

export type AccentKey =
  | 'blue'
  | 'indigo'
  | 'purple'
  | 'fuchsia'
  | 'pink'
  | 'red'
  | 'orange'
  | 'amber'
  | 'lime'
  | 'green'
  | 'teal'
  | 'slate'
export type AccentMode = 'auto' | AccentKey

/*
 * 调色板。按色相绕一圈排（蓝 → 靛 → 紫 → 品红 → 粉 → 红 → 橙 → 琥珀 → 青柠 → 绿 → 青 → 灰），
 * 设置面板里那排色点就是这个顺序，顺着看像一道彩虹。
 *
 * 前 6 个（blue / purple / green / orange / red / pink）**跟宿主那套完全一致**，
 * 用户从 ZTools 设置里挑惯了，插件里再看到他熟悉的色值不会觉得是两套东西；
 * 后 6 个（indigo / fuchsia / amber / lime / teal / slate）是插件额外给的，
 * 补上宿主没有的靛蓝、品红、琥珀、青柠、青绿和中性灰。
 *
 * 每个色两版：
 *   light —— 用在浅色主题，是**深**的那版（`#0284c7`、`#059669` 这类），配白字；
 *   dark  —— 用在深色主题，是**亮**的那版（`#38bdf8`、`#34d399` 这类），配近黑字。
 * 不是"好看就行"：宿主深色主题给的亮色配白字对比度只有 2:1 上下，直接糊成一片。
 * `tests/accent.test.ts` 会遍历这 12 组，逐一验证「浅的那版配白字、亮的那版配近黑字」，
 * 所以往这里加色**必须**先过那条测试，别手滑放一个中间调的进去。
 */
export const ACCENT_PRESETS: Record<AccentKey, { light: string; dark: string }> = {
  blue: { light: '#0284c7', dark: '#38bdf8' },
  indigo: { light: '#4f46e5', dark: '#a5b4fc' },
  purple: { light: '#7c3aed', dark: '#a78bfa' },
  fuchsia: { light: '#c026d3', dark: '#e879f9' },
  pink: { light: '#db2777', dark: '#f472b6' },
  red: { light: '#dc2626', dark: '#f87171' },
  orange: { light: '#ea580c', dark: '#fb923c' },
  amber: { light: '#d97706', dark: '#fbbf24' },
  lime: { light: '#4d7c0f', dark: '#a3e635' },
  green: { light: '#059669', dark: '#34d399' },
  teal: { light: '#0d9488', dark: '#2dd4bf' },
  slate: { light: '#475569', dark: '#94a3b8' }
}

export const ACCENT_KEYS = Object.keys(ACCENT_PRESETS) as AccentKey[]

/** 强调色：`auto` 返回 null（表示「沿用宿主注入的那个」），否则给出具体色值 */
export function resolveAccent(mode: AccentMode, isDark: boolean): string | null {
  if (mode === 'auto') return null
  // 「按深浅挑哪一版」只在 accentSwatch 里写一次 —— 这里原来又抄了一遍同样那个三元
  return ACCENT_PRESETS[mode] ? accentSwatch(mode, isDark) : null
}

/** 调色板：给设置面板画那几个圆点用 */
export function accentSwatch(key: AccentKey, isDark: boolean): string {
  return isDark ? ACCENT_PRESETS[key].dark : ACCENT_PRESETS[key].light
}

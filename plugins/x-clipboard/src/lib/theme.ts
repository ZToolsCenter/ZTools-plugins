/*
 * 把「主题 / 强调色」落到插件的 CSS 变量上。
 *
 *   深浅色 —— **一律跟随 ZTools**（`getThemeInfo().isDark`），不是操作系统的 `prefers-color-scheme`。
 *             宿主深色、系统浅色时，以前插件会白得刺眼，那是个真错误，现在按宿主的来。
 *             插件**不提供**「强制浅 / 强制深」的覆盖：宿主窗口的毛玻璃底色跟着 ZTools 主题走，
 *             插件硬切成反面的话，那块面板会显得「破」了。所以这里没有可选项，只有跟随。
 *   强调色 —— 默认沿用宿主注入的 `--plugin-primary-color`（宿主把用户在 ZTools 设置里
 *             挑的主题色以 !important 写进插件文档的 :root，换色时重新注入）。
 *             只有用户在插件设置里显式挑了一个色，我们才覆盖它。
 *
 * 本文件只做纯计算之外的胶水：读宿主状态、写 CSS 变量、订阅变更。
 * 色值数学在 `accent.ts`（无 DOM，可单测）。
 */

import { ref } from 'vue'

import { FALLBACK_ACCENT, deriveFrom, resolveAccent } from './accent'
import { zt } from './clipboard'
import { DEFAULT_SETTINGS, type Settings } from './settings'
import { resolveBg, resolveFloatBg } from './surface'

/** 当前生效的设置。App 挂载时灌进来，改了设置再灌一次 */
let current: Settings = { ...DEFAULT_SETTINGS }

/** 最终是深色还是浅色 —— 设置面板画那几个色点要用 */
export const isDark = ref(false)

/** 读宿主注入的强调色。读不到（老宿主 / 还没注入）就用兜底色 */
function readHostAccent(): string {
  try {
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue('--plugin-primary-color')
      .trim()
    if (/^#([\da-f]{3}|[\da-f]{6})$/i.test(v)) return v
  } catch {
    /* 读不到就兜底 */
  }
  return FALLBACK_ACCENT
}

/** 宿主自己是深色还是浅色；拿不到就退回系统偏好 */
function readHostDark(): boolean {
  try {
    const info = zt().getThemeInfo?.()
    if (typeof info?.isDark === 'boolean') return info.isDark
  } catch {
    /* 老宿主没这个接口 */
  }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

function apply(): void {
  const style = document.documentElement.style
  // 深浅色没有可选项：宿主说什么就是什么
  const dark = readHostDark()
  isDark.value = dark
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'

  // 选「默认」时把覆盖撤掉，让宿主那个变量重新说话
  const forced = resolveAccent(current.accent, dark)
  if (forced) style.setProperty('--accent', forced)
  else style.removeProperty('--accent')

  const d = deriveFrom(forced ?? readHostAccent())
  style.setProperty('--accent-soft', d.soft)
  style.setProperty('--accent-rgb', d.accentRgb)
  style.setProperty('--row-on-tx', d.text)
  style.setProperty('--on-accent-rgb', d.rgb)

  // 面板底色。`auto`（默认）写进去的是 `transparent` —— 宿主窗口自己的材质透上来，
  // 跟顶部那行天然同色，深浅色也自动跟着走（见 surface.ts 的说明）。
  style.setProperty('--surface', resolveBg(current.bg, dark))

  /*
   * 浮层底色（详情 `.peek` / 设置 `.sheet` / 确认框 `.box` / 淡入底栏 `.foot.fade`）。
   *
   * 面板有实底就跟面板同色号；面板「默认」（不画底）时**撤掉覆盖**，回落 `base.css` 那层中性实底。
   * 为什么浮层不能跟着一起透明 —— 试过了，见 `surface.ts` 的 `resolveFloatBg`。
   */
  const floatBg = resolveFloatBg(current.bg, dark)
  if (floatBg) style.setProperty('--surface-float', floatBg)
  else style.removeProperty('--surface-float')
}

/** 挂载前调一次（先用默认值，免得首帧闪），设置读出来之后再调一次 */
export function applyTheme(next?: Settings): void {
  if (next) current = next
  apply()
}

/** 订阅宿主的主题变更：系统深浅色变了、用户在 ZTools 里换了主题色都会回调 */
export function initTheme(): void {
  apply()
  try {
    // 宿主是「先广播 update-theme-info、再执行脚本写 CSS 变量」，
    // 所以等两帧再读，免得算的是上一个颜色
    zt().onThemeChange?.(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => apply()))
    })
  } catch {
    /* 老宿主没这个接口，就用初始那一次的结果 */
  }
}

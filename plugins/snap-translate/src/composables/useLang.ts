/**
 * 语言相关工具：目标语言推断 + 语言列表（对齐宿主中性语言码）。
 *
 * 语言码使用宿主 Provider 契约的中性字符串（auto / zh-CN / en / ja / ...），
 * 各 provider 内部自行映射到自家 API 的语种代码，本插件不做映射。
 */

/** 常用目标语言选项（结果窗口 / 文本翻译页的下拉共用）。 */
export const LANG_OPTIONS = [
  { label: '自动检测', value: 'auto' },
  { label: '中文（简体）', value: 'zh-CN' },
  { label: '中文（繁體）', value: 'zh-TW' },
  { label: '英语', value: 'en' },
  { label: '日语', value: 'ja' },
  { label: '韩语', value: 'ko' },
  { label: '法语', value: 'fr' },
  { label: '西班牙语', value: 'es' },
  { label: '俄语', value: 'ru' },
  { label: '德语', value: 'de' },
  { label: '意大利语', value: 'it' },
  { label: '泰语', value: 'th' },
  { label: '越南语', value: 'vi' },
  { label: '阿拉伯语', value: 'ar' }
]

/** 目标语言选项（不含 auto，结果窗口的目标语切换用）。 */
export const TARGET_LANG_OPTIONS = LANG_OPTIONS.filter((o) => o.value !== 'auto')

/**
 * 依据文本内容推断目标语言：
 *   - 中文字符占比 > 30% → 翻译为英文（en）
 *   - 其余 → 翻译为中文（zh-CN）
 * 与 f-provider 的 _resolveDefaultTargetLang 策略保持一致，符合中文用户直觉。
 */
export function resolveTargetLang(text: string): string {
  if (!text) return 'zh-CN'
  const chars = Array.from(text).filter((c) => !/\s/.test(c))
  if (chars.length === 0) return 'zh-CN'
  const cjk = chars.filter((c) => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(c)).length
  return cjk / chars.length > 0.3 ? 'en' : 'zh-CN'
}

const TARGET_LANG_KEY = 'snap-translate.targetLang'
const FROM_LANG_KEY = 'snap-translate.fromLang'

function readLang(key: string): string | null {
  try {
    const v = window.ztools.dbStorage.getItem(key)
    return typeof v === 'string' && v ? v : null
  } catch (_) {
    return null
  }
}

function writeLang(key: string, lang: string | null): void {
  try {
    if (lang) window.ztools.dbStorage.setItem(key, lang)
    else window.ztools.dbStorage.removeItem(key)
  } catch (_) {
    /* ignore */
  }
}

/** 读取用户上次手动选择的目标语言（无则返回 null → 走自动推断）。 */
export function loadSavedTargetLang(): string | null {
  return readLang(TARGET_LANG_KEY)
}

/** 记忆用户手动选择的目标语言。传 null 清除（回到自动推断）。 */
export function saveTargetLang(lang: string | null): void {
  writeLang(TARGET_LANG_KEY, lang)
}

export function loadSavedFromLang(): string | null {
  return readLang(FROM_LANG_KEY)
}

export function saveFromLang(lang: string | null): void {
  writeLang(FROM_LANG_KEY, lang && lang !== 'auto' ? lang : null)
}

export function persistLangPair(from: string, to: string): void {
  saveFromLang(from)
  saveTargetLang(!to || to === 'auto' ? null : to)
}

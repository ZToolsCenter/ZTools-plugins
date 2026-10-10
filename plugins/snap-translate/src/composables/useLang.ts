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

/**
 * 判断文本是否已经属于目标语言。
 * 若已是目标语言，跳过翻译直接保留原文，避免二次翻译导致乱码或变异。
 * 例如：文本本身是中文且目标语言是 zh-CN 时，返回 true。
 */
export function isTextInTargetLang(text: string, toLang: string, fromLang?: string): boolean {
  if (!text || !toLang || toLang === 'auto') return false
  const trimmed = text.trim()
  if (!trimmed) return true

  const to = toLang.toLowerCase()
  const from = fromLang?.toLowerCase()

  // 若明确指定了源语言与目标语言且一致（如 zh-CN → zh-CN），直接判定匹配
  if (from && from !== 'auto' && (from === to || (from.startsWith('zh') && to.startsWith('zh')))) {
    return true
  }

  // 纯符号、数字、标点（如 "123", "---", "..."），无需翻译，视为保留
  const hasLetters = /[a-zA-Z\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F\u3040-\u30FF\uAC00-\uD7AF\u4E00-\u9FFF\u3400-\u4DBF]/.test(trimmed)
  if (!hasLetters) return true

  // 各语种脚本特征字符计数
  const cjkChars = (trimmed.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || []).length
  const kanaChars = (trimmed.match(/[\u3040-\u30ff]/g) || []).length
  const hangulChars = (trimmed.match(/[\uac00-\ud7af\u1100-\u11ff]/g) || []).length
  const cyrillicChars = (trimmed.match(/[\u0400-\u04ff]/g) || []).length
  const arabicChars = (trimmed.match(/[\u0600-\u06ff]/g) || []).length
  const thaiChars = (trimmed.match(/[\u0e00-\u0e7f]/g) || []).length
  const latinChars = (trimmed.match(/[a-zA-Z]/g) || []).length

  if (to.startsWith('zh')) {
    // 目标语言是中文（zh / zh-CN / zh-TW）：
    // 若含有汉字，且无日文假名、无韩文字母：
    // 即使夹杂少量英文单词/缩写（如“打开 Chrome”、“点击确定(OK)”），整体也是中文，不需要译为中文
    if (cjkChars > 0 && kanaChars === 0 && hangulChars === 0) {
      if (cjkChars >= latinChars || cjkChars / (cjkChars + latinChars) >= 0.25) {
        return true
      }
    }
    return false
  }

  if (to.startsWith('ja')) {
    return kanaChars > 0
  }

  if (to.startsWith('ko')) {
    return hangulChars > 0
  }

  if (to.startsWith('ru')) {
    return cyrillicChars > 0
  }

  if (to.startsWith('ar')) {
    return arabicChars > 0
  }

  if (to.startsWith('th')) {
    return thaiChars > 0
  }

  if (to.startsWith('en')) {
    // 目标是英文：有拉丁字母且不含中、日、韩、俄、阿、泰等字符，且为长文本或带空格（排除单字母测试数据）
    const hasNonLatin = cjkChars > 0 || kanaChars > 0 || hangulChars > 0 || cyrillicChars > 0 || arabicChars > 0 || thaiChars > 0
    if (latinChars >= 4 && !hasNonLatin) {
      if (/\s/.test(trimmed) || latinChars >= 8) {
        return true
      }
    }
    return false
  }

  return false
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

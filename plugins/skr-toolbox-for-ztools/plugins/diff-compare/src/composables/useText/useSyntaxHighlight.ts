/**
 * 语法高亮Composable
 * 提供代码语法高亮和差异高亮功能
 */

import { ref, computed } from 'vue'
import hljs from 'highlight.js'
import { LANGUAGES } from '@/utils/formatter'

/**
 * 差异行类型定义
 */
export type DiffLineType = 'equal' | 'delete' | 'insert' | 'modify'

/**
 * 语言选项列表（去重 + 排序）
 * 用于语言选择下拉框
 */
export const langOptions = computed(() => {
  const seen = new Set<string>()
  const options: { label: string; value: string }[] = [{ label: 'auto', value: 'auto' }]

  for (const lang of LANGUAGES) {
    if (!seen.has(lang.label)) {
      seen.add(lang.label)
      options.push({ label: lang.label, value: lang.value })
    }
  }
  return options.sort((a, b) => {
    if (a.value === 'auto') return -1
    if (b.value === 'auto') return 1
    return a.label.localeCompare(b.label)
  })
})

/**
 * 语法高亮Composable
 * 提供源代码和目标代码的语法高亮功能
 */
export function useSyntaxHighlight() {
  /** 源文本的高亮结果 */
  const highlightedSource = ref('')
  /** 目标文本的高亮结果 */
  const highlightedTarget = ref('')
  /** 源文本的语言类型 */
  const sourceLang = ref('')
  /** 目标文本的语言类型 */
  const targetLang = ref('')

  /**
   * 根据用户选择的语言值查找highlight.js使用的语言名
   * @param value - 用户选择的语言值
   * @returns highlight.js 语言名或undefined
   */
  const toHljsLang = (value: string): string | undefined => {
    const lang = LANGUAGES.find(l => l.value === value.toLowerCase())
    return lang?.hljs
  }

  const highlight = (code: string, lang: string): string => {
    if (!code) return ''
    if (!lang) return code

    const hljsLang = toHljsLang(lang)
    if (!hljsLang) return code

    try {
      if (hljs.getLanguage(hljsLang)) {
        return hljs.highlight(code, { language: hljsLang }).value
      }
    } catch (e) {
      console.warn('Highlight failed:', e)
    }
    return code
  }

  const highlightWithDiff = (code: string, lang: string, diffType?: DiffLineType): string => {
    if (!code) return ''

    let highlighted: string
    if (!lang) {
      highlighted = escapeHtml(code)
    } else {
      const hljsLang = toHljsLang(lang)
      if (!hljsLang) {
        highlighted = escapeHtml(code)
      } else {
        try {
          if (hljs.getLanguage(hljsLang)) {
            highlighted = hljs.highlight(code, { language: hljsLang }).value
          } else {
            highlighted = escapeHtml(code)
          }
        } catch (e) {
          console.warn('Highlight failed:', e)
          highlighted = escapeHtml(code)
        }
      }
    }

    // 始终应用差异高亮
    if (diffType === 'delete') {
      return `<span class="diff-line-delete">${highlighted}</span>`
    } else if (diffType === 'insert') {
      return `<span class="diff-line-insert">${highlighted}</span>`
    } else if (diffType === 'modify') {
      return `<span class="diff-line-modify">${highlighted}</span>`
    }
    return highlighted
  }

  const escapeHtml = (text: string): string => {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  const highlightSource = (code: string, lang: string) => {
    sourceLang.value = lang
    highlightedSource.value = highlight(code, lang)
  }

  const highlightTarget = (code: string, lang: string) => {
    targetLang.value = lang
    highlightedTarget.value = highlight(code, lang)
  }

  const isSourceHighlighted = computed(() => highlightedSource.value.length > 0)
  const isTargetHighlighted = computed(() => highlightedTarget.value.length > 0)

  return {
    highlightedSource,
    highlightedTarget,
    sourceLang,
    targetLang,
    highlightSource,
    highlightTarget,
    highlightWithDiff,
    isSourceHighlighted,
    isTargetHighlighted,
    highlight,
  }
}
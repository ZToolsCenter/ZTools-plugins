import { computed, ref } from 'vue'
import { tokenizeRegex } from '../utils/regexTokenizer'
import { explainRegex } from '../utils/regexExplainer'
import type { RegexExample } from '../data/examples'

export interface MatchSegment {
  text: string
  matched: boolean
  groupIndex?: number
}

export interface MatchInfo {
  index: number
  length: number
  groups: string[]
}

const FLAG_OPTIONS = [
  { key: 'g', label: 'g', title: '全局匹配' },
  { key: 'i', label: 'i', title: '忽略大小写' },
  { key: 'm', label: 'm', title: '多行模式' },
  { key: 's', label: 's', title: 'dotAll（. 匹配换行）' },
  { key: 'u', label: 'u', title: 'Unicode 模式' },
  { key: 'y', label: 'y', title: '粘性匹配' }
] as const

export function useRegexEditor() {
  const pattern = ref('')
  const flags = ref('g')
  const testText = ref('')
  const regexError = ref('')
  const activeCategory = ref('全部')

  const tokenResult = computed(() => tokenizeRegex(pattern.value))
  const explanation = computed(() =>
    explainRegex(pattern.value, tokenResult.value.tokens, tokenResult.value.errors)
  )

  const compiledRegex = computed(() => {
    regexError.value = ''
    if (!pattern.value) return null
    try {
      return new RegExp(pattern.value, flags.value)
    } catch (e) {
      regexError.value = e instanceof Error ? e.message : '无效的正则表达式'
      return null
    }
  })

  const matchResults = computed((): MatchInfo[] => {
    const text = testText.value
    const regex = compiledRegex.value
    if (!text || !regex) return []

    const results: MatchInfo[] = []
    const global = flags.value.includes('g')

    if (global) {
      const re = new RegExp(regex.source, flags.value)
      let match: RegExpExecArray | null
      while ((match = re.exec(text)) !== null) {
        results.push({
          index: match.index,
          length: match[0].length,
          groups: match.slice(1)
        })
        if (match[0].length === 0) re.lastIndex++
      }
    } else {
      const match = regex.exec(text)
      if (match) {
        results.push({
          index: match.index,
          length: match[0].length,
          groups: match.slice(1)
        })
      }
    }
    return results
  })

  const matchSegments = computed((): MatchSegment[] => {
    const text = testText.value
    const results = matchResults.value
    if (!text) return [{ text: '', matched: false }]
    if (results.length === 0) return [{ text, matched: false }]

    const segments: MatchSegment[] = []
    let cursor = 0
    const sorted = [...results].sort((a, b) => a.index - b.index)

    for (const m of sorted) {
      if (m.index > cursor) {
        segments.push({ text: text.slice(cursor, m.index), matched: false })
      }
      segments.push({ text: text.slice(m.index, m.index + m.length), matched: true })
      cursor = m.index + m.length
    }
    if (cursor < text.length) {
      segments.push({ text: text.slice(cursor), matched: false })
    }
    return segments
  })

  const matchCount = computed(() => matchResults.value.length)
  const captureGroups = computed(() => {
    if (!matchResults.value.length) return []
    return matchResults.value[0].groups.map((g, i) => ({ index: i + 1, value: g ?? '' }))
  })

  function loadExample(example: RegexExample) {
    pattern.value = example.pattern
    flags.value = example.flags || 'g'
    testText.value = example.testText
  }

  function toggleFlag(flag: string) {
    if (flags.value.includes(flag)) {
      flags.value = flags.value.replace(flag, '')
    } else {
      flags.value = [...flags.value, flag].sort().join('')
    }
  }

  async function copyPattern() {
    const full = `/${pattern.value}/${flags.value}`
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(full)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = full
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        const success = document.execCommand('copy')
        document.body.removeChild(textarea)
        if (!success) throw new Error('Copy command failed')
      }
      window.ztools?.showNotification?.('已复制到剪贴板')
    } catch {
      window.ztools?.showNotification?.('复制失败')
    }
  }

  return {
    pattern,
    flags,
    testText,
    regexError,
    tokenResult,
    explanation,
    compiledRegex,
    matchSegments,
    matchCount,
    captureGroups,
    activeCategory,
    flagOptions: FLAG_OPTIONS,
    loadExample,
    toggleFlag,
    copyPattern
  }
}

import { onUnmounted, ref, watch } from 'vue'
import { useZtoolsAi } from './useZtoolsAi'

const EXPLAIN_SYSTEM = `你是正则表达式老师。请用中文大白话解释用户给出的正则，要求：
1. 先说「这段正则能匹配什么」，再说「不能匹配什么」（如有必要）
2. 避免堆砌术语，像给同事讲解一样自然
3. 150～250 字，不要 markdown，不要列表符号
4. 如果正则本身有语法错误，直接指出问题`

const GENERATE_SYSTEM = `你是正则表达式专家。用户会用中文描述想匹配的文本规则。
请只输出两行：
第一行：JavaScript 正则的 pattern（不要带 / 斜杠）
第二行：flags 字母（如 gim，没有则留空）
不要输出其他任何说明。`

export function useAiRegex(
  pattern: () => string,
  flags: () => string,
  onGenerated?: (p: string, f: string) => void
) {
  const ai = useZtoolsAi()

  const aiExplanation = ref('')
  const aiLoading = ref(false)
  const aiError = ref('')
  const requirement = ref('')

  let explainAbort: (() => void) | null = null
  let explainTimer: ReturnType<typeof setTimeout> | null = null

  onUnmounted(() => {
    if (explainTimer) clearTimeout(explainTimer)
    explainAbort?.()
  })

  async function explainPattern(manual = false) {
    const p = pattern().trim()
    if (!p) {
      aiExplanation.value = ''
      aiError.value = ''
      return
    }

    if (!ai.available.value) {
      if (manual) aiError.value = '请先在 ZTools 中配置 AI 模型'
      return
    }

    explainAbort?.()
    explainAbort = null
    aiLoading.value = true
    aiError.value = ''
    aiExplanation.value = ''

    const userContent = `正则：/${p}/${flags()}`

    try {
      const ztools = window.ztools
      if (!ztools?.ai) throw new Error('AI 不可用')

      const promise = ztools.ai(
        {
          model: ai.selectedModelId.value || undefined,
          messages: [
            { role: 'system', content: EXPLAIN_SYSTEM },
            { role: 'user', content: userContent }
          ]
        },
        (chunk) => {
          if (chunk.content) aiExplanation.value += chunk.content
        }
      )

      explainAbort = promise.abort.bind(promise)
      await promise
    } catch (err) {
      if (err instanceof Error && err.message !== 'Aborted') {
        aiError.value = err.message || 'AI 解释失败'
      }
    } finally {
      aiLoading.value = false
      explainAbort = null
    }
  }

  function scheduleExplain() {
    if (explainTimer) clearTimeout(explainTimer)
    explainTimer = setTimeout(() => explainPattern(false), 900)
  }

  watch(
    () => [pattern(), flags(), ai.available.value] as const,
    ([p, , avail]) => {
      if (avail && String(p).trim()) {
        scheduleExplain()
      } else if (!String(p).trim()) {
        aiExplanation.value = ''
        aiError.value = ''
      }
    }
  )

  async function generateFromRequirement() {
    const req = requirement.value.trim()
    if (!req) {
      aiError.value = '请先描述你想匹配的内容'
      return
    }
    if (!ai.available.value) {
      aiError.value = '请先在 ZTools 中配置 AI 模型'
      return
    }

    aiLoading.value = true
    aiError.value = ''

    try {
      const raw = await ai.chat([
        { role: 'system', content: GENERATE_SYSTEM },
        { role: 'user', content: req }
      ])

      const match = /```[a-z]*\n([\s\S]*?)\n```/i.exec(raw)
      const text = (match ? match[1] : raw).trim()
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
      const newPattern = lines[0]?.replace(/^\/|\/$/g, '') ?? ''
      const newFlags = (lines[1] ?? '').replace(/[^gimsuy]/gi, '')

      if (!newPattern) throw new Error('AI 未返回有效正则')

      onGenerated?.(newPattern, newFlags || 'g')
      requirement.value = ''
      window.ztools?.showNotification?.('已生成正则')
    } catch (err) {
      aiError.value = err instanceof Error ? err.message : 'AI 生成失败'
    } finally {
      aiLoading.value = false
    }
  }

  return {
    ...ai,
    aiExplanation,
    aiLoading,
    aiError,
    requirement,
    explainPattern,
    generateFromRequirement
  }
}

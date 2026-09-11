import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_AI_MODEL } from '@/constants/ai'
import { useSettingsStore, selectAiSettings } from '@/stores/settings'
import { probeUrl } from '@/services/siteProbe'
import { normalizeAIConfidence, parseAIJsonObject, truncateAIText } from '@/lib/aiOutput'
import {
  AIProviderRequestError,
  getAIAvailability,
  runAIText,
  type AIMessage
} from '@/lib/aiProvider'
import {
  METADATA_SYSTEM_PROMPT,
  METADATA_OUTPUT,
  buildMetadataUserPrompt,
  CATEGORY_SYSTEM_PROMPT,
  CATEGORY_OUTPUT,
  type AIStructuredOutput,
  buildCategoryUserPrompt
} from '@/constants/aiPrompts'

/**
 * AI 元信息 / 分类建议（React 版）
 * --------------------------------------------------------------------------
 * 旧版 Vue ref 状态 → useState；useDebounceFn → 自定义 useRef + setTimeout 防抖。
 * 仅保留业务逻辑。
 * AI 配置从 settings store 实时读取（useSettingsStore.getState()），与旧版等价。
 */

const MODEL_ERROR_KEYWORDS = ['model', '模型', 'not found', 'unknown', 'unsupported', 'invalid', '不存在', '不可用', '无效']

export type MetadataSource = 'page' | 'ai' | 'network'

export interface GenerateMetadataInput {
  url: string
  title?: string
  desc?: string
  forceNetworkFallback?: boolean
}

export interface GenerateMetadataResult {
  title: string
  desc: string
  source: MetadataSource
  usedNetworkFallback: boolean
}

export interface CategorySuggestion {
  groupId: string
  groupName: string
  subGroupId: string
  subGroupName: string
  confidence: number
  reason: string
}

export interface GroupInfo {
  id: string
  name: string
  subGroups: { id: string; name: string }[]
}

type ActiveModelInfo = {
  model: string
  isCustom: boolean
}

export function useAI() {
  const [isUrlAccessible, setIsUrlAccessible] = useState(false)
  const [isCheckingUrl, setIsCheckingUrl] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSuggestingCategory, setIsSuggestingCategory] = useState(false)
  const [aiError, setAiError] = useState('')

  // 实时读取 AI 设置（非响应式快照，调用时取最新值，等价旧版 settingsStore.aiSettings）
  const getAiSettings = useCallback(() => selectAiSettings(useSettingsStore.getState()), [])

  const checkAiAvailable = useCallback((): { available: boolean; reason: string } => {
    const availability = getAIAvailability(getAiSettings())
    return availability.ok ? { available: true, reason: '' } : { available: false, reason: availability.reason }
  }, [getAiSettings])

  const isModelError = useCallback((errMsg: string) => {
    const lower = errMsg.toLowerCase()
    return MODEL_ERROR_KEYWORDS.some((key) => lower.includes(key.toLowerCase()))
  }, [])

  const getActiveModelInfo = useCallback((): ActiveModelInfo => {
    const settings = getAiSettings()
    return {
      model: settings.selectedModelId || DEFAULT_AI_MODEL,
      isCustom: settings.useCustomProvider
    }
  }, [getAiSettings])

  const resolveErrorMessage = useCallback(
    (error: unknown, action: '生成' | '分类') => {
      const providerError = error instanceof AIProviderRequestError ? error : null
      const errMsg = error instanceof Error ? error.message : String(error)
      const modelInfo = providerError
        ? { model: providerError.model || getActiveModelInfo().model, isCustom: providerError.isCustomModel }
        : getActiveModelInfo()

      if (errMsg.includes('余额') || errMsg.includes('balance') || errMsg.includes('quota')) {
        return 'AI 余额不足，请检查当前供应商额度'
      }
      if (errMsg.includes('network') || errMsg.includes('timeout') || errMsg.includes('连接')) {
        return 'AI 服务连接失败，请检查网络'
      }
      if (isModelError(errMsg)) {
        if (modelInfo.isCustom) {
          return `自定义模型“${modelInfo.model}”不可用，请检查供应商配置或模型名后重试`
        }
        if (providerError?.fallbackAttempted) {
          return `uTools 模型“${modelInfo.model}”不可用，自动回退后仍失败，请检查 AI 配置后重试`
        }
        return `uTools 模型“${modelInfo.model}”当前不可用，请重新选择或稍后重试`
      }
      if (modelInfo.isCustom) {
        return `AI ${action}失败，请稍后重试；若持续失败，请检查接口配置和模型“${modelInfo.model}”`
      }
      return `AI ${action}失败，请稍后重试`
    },
    [getActiveModelInfo, isModelError]
  )

  const callAi = useCallback(
    (messages: AIMessage[], output: AIStructuredOutput) =>
      runAIText(getAiSettings(), messages, { output }),
    [getAiSettings]
  )

  // checkUrl 防抖（500ms），等价旧版 useDebounceFn
  const checkUrlTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const checkUrl = useCallback((url: string) => {
    if (checkUrlTimer.current) clearTimeout(checkUrlTimer.current)
    checkUrlTimer.current = setTimeout(async () => {
      if (!url) {
        setIsUrlAccessible(false)
        return
      }
      if (!window.utools) {
        setIsUrlAccessible(true)
        return
      }

      setIsCheckingUrl(true)
      let target = url
      if (!/^https?:\/\//i.test(target)) target = 'https://' + target
      setIsUrlAccessible(true)

      try {
        const res = await probeUrl(target)
        if (!res.ok) setIsUrlAccessible(false)
      } catch {
        setIsUrlAccessible(false)
      } finally {
        setIsCheckingUrl(false)
      }
    }, 500)
  }, [])

  useEffect(() => {
    return () => {
      if (checkUrlTimer.current) clearTimeout(checkUrlTimer.current)
    }
  }, [])

  const generateMetadata = useCallback(
    async (input: string | GenerateMetadataInput): Promise<GenerateMetadataResult | null> => {
      const params =
        typeof input === 'string'
          ? { url: input, title: '', desc: '', forceNetworkFallback: false }
          : {
              url: input.url,
              title: input.title?.trim() || '',
              desc: input.desc?.trim() || '',
              forceNetworkFallback: !!input.forceNetworkFallback
            }
      if (!params.url) return null

      const { available, reason } = checkAiAvailable()
      if (!available) {
        setAiError(reason)
        return null
      }

      setIsGenerating(true)
      setAiError('')

      try {
        const prompt = buildMetadataUserPrompt(params)

        const res = await callAi([
          {
            role: 'system',
            content: METADATA_SYSTEM_PROMPT
          },
          { role: 'user', content: prompt }
        ], METADATA_OUTPUT)

        let data: Record<string, unknown>
        try {
          data = parseAIJsonObject(res)
        } catch (parseErr) {
          console.warn('[AI] generateMetadata JSON 解析失败，原始内容片段:', res.slice(0, 200), parseErr)
          return null
        }
        const result = {
          title: truncateAIText(data.title, 15),
          desc: truncateAIText(data.desc, 40),
          source: data.source === 'network' || params.forceNetworkFallback ? 'network' : 'ai',
          usedNetworkFallback: params.forceNetworkFallback
        } satisfies GenerateMetadataResult

        return result
      } catch (error) {
        console.error('[AI] 调用失败:', error)
        setAiError(resolveErrorMessage(error, '生成'))
        return null
      } finally {
        setIsGenerating(false)
      }
    },
    [callAi, checkAiAvailable, resolveErrorMessage]
  )

  const suggestCategory = useCallback(
    async (url: string, existingGroups: GroupInfo[], currentGroupId?: string): Promise<CategorySuggestion | null> => {
      if (!url || existingGroups.length === 0) return null

      const { available, reason } = checkAiAvailable()
      if (!available) {
        setAiError(reason)
        return null
      }

      setIsSuggestingCategory(true)
      setAiError('')

      try {
        const currentGroup = currentGroupId ? existingGroups.find((group) => group.id === currentGroupId) : null
        const prompt = buildCategoryUserPrompt({
          url,
          groups: existingGroups.map((group) => ({
            name: group.name,
            subGroups: group.subGroups,
            isCurrent: !!(currentGroup && group.id === currentGroupId)
          })),
          currentGroupName: currentGroup?.name
        })

        const res = await callAi([
          {
            role: 'system',
            content: CATEGORY_SYSTEM_PROMPT
          },
          { role: 'user', content: prompt }
        ], CATEGORY_OUTPUT)

        let data: Record<string, unknown>
        try {
          data = parseAIJsonObject(res)
        } catch (parseErr) {
          console.warn('[AI] suggestCategory JSON 解析失败，原始内容片段:', res.slice(0, 200), parseErr)
          return null
        }

        const dataGroupName = typeof data.groupName === 'string' ? data.groupName : ''
        const dataSubGroupName = typeof data.subGroupName === 'string' ? data.subGroupName : ''
        const matchedGroup = existingGroups.find((group) => group.name === dataGroupName)
        if (!matchedGroup) return null

        const matchedSubGroup = dataSubGroupName
          ? matchedGroup.subGroups.find((subGroup) => subGroup.name === dataSubGroupName)
          : matchedGroup.subGroups[0]
        if (!matchedSubGroup) return null

        const result = {
          groupId: matchedGroup.id,
          groupName: matchedGroup.name,
          subGroupId: matchedSubGroup?.id || matchedGroup.subGroups[0]?.id || '',
          subGroupName: matchedSubGroup?.name || matchedGroup.subGroups[0]?.name || '',
          confidence: normalizeAIConfidence(data.confidence),
          reason: truncateAIText(data.reason, 30) || '基于 URL 内容推荐'
        } satisfies CategorySuggestion

        return result
      } catch (error) {
        console.error('[AI] 分类建议失败:', error)
        setAiError(resolveErrorMessage(error, '分类'))
        return null
      } finally {
        setIsSuggestingCategory(false)
      }
    },
    [callAi, checkAiAvailable, resolveErrorMessage]
  )

  return {
    isUrlAccessible,
    isCheckingUrl,
    isGenerating,
    isSuggestingCategory,
    aiError,
    checkUrl,
    checkAiAvailable,
    generateMetadata,
    suggestCategory
  }
}

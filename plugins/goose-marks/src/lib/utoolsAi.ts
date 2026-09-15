import { DEFAULT_AI_MODEL } from '@/constants/ai'

type UToolsAiModel = {
  id: string
  label: string
  description?: string
  icon?: string
  cost?: string
}

type UToolsApi = {
  ai?: (option: unknown, streamCallback?: (chunk: { text?: string; content?: string }) => void) => Promise<string | { text?: string; content?: string }>
  allAiModels?: () => Promise<UToolsAiModel[]>
}

type UToolsAiApi = Pick<UToolsApi, 'ai' | 'allAiModels'>

function getUToolsApi(): UToolsAiApi | null {
  if (typeof window === 'undefined') return null
  return (window.utools as UToolsAiApi | undefined) ?? null
}

export function isUToolsAiSupported() {
  const api = getUToolsApi()
  return Boolean(api?.ai && api?.allAiModels)
}

export async function getAvailableUToolsAiModels() {
  const api = getUToolsApi()
  if (!api?.allAiModels) {
    throw new Error('当前 uTools 版本未提供 AI 模型列表')
  }

  const models = await api.allAiModels()
  return Array.isArray(models) ? models.filter(model => model?.id && model?.label) : []
}

export async function resolvePreferredUToolsModel(selectedModelId: string | null) {
  try {
    const models = await getAvailableUToolsAiModels()
    if (!models.length) {
      return selectedModelId?.trim() || DEFAULT_AI_MODEL
    }

    const normalizedSelectedModelId = selectedModelId?.trim()
    if (normalizedSelectedModelId && models.some(model => model.id === normalizedSelectedModelId)) {
      return normalizedSelectedModelId
    }

    const defaultModel = models.find(model => model.id === DEFAULT_AI_MODEL)
    return defaultModel?.id ?? models[0].id
  } catch {
    return selectedModelId?.trim() || DEFAULT_AI_MODEL
  }
}

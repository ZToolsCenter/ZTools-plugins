import { onMounted, ref } from 'vue'

export interface AiModel {
  id: string
  label: string
  description: string
}

function getZtools() {
  return typeof window !== 'undefined' ? window.ztools : undefined
}

export function useZtoolsAi() {
  const available = ref(false)
  const models = ref<AiModel[]>([])
  const selectedModelId = ref('')

  onMounted(async () => {
    const ztools = getZtools()
    if (!ztools?.allAiModels) return

    try {
      const list = await ztools.allAiModels()
      models.value = list.map((m) => ({ id: m.id, label: m.label, description: m.description }))
      selectedModelId.value = list[0]?.id ?? ''
      available.value = list.length > 0
    } catch {
      available.value = false
    }
  })

  function openAiSettings() {
    getZtools()?.redirectAiModelsSetting?.()
  }

  async function chat(messages: { role: 'system' | 'user' | 'assistant'; content: string }[]): Promise<string> {
    const ztools = getZtools()
    if (!ztools?.ai) throw new Error('当前环境不支持 ZTools AI')

    const model = selectedModelId.value || undefined
    const result = await ztools.ai({ model, messages })
    return result.content?.trim() ?? ''
  }

  async function chatStream(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    onDelta: (text: string) => void
  ): Promise<string> {
    const ztools = getZtools()
    if (!ztools?.ai) throw new Error('当前环境不支持 ZTools AI')

    const model = selectedModelId.value || undefined
    let full = ''

    await ztools.ai({ model, messages }, (chunk) => {
      const delta = chunk.content ?? ''
      if (!delta) return
      full += delta
      onDelta(full)
    })

    return full.trim()
  }

  return {
    available,
    models,
    selectedModelId,
    openAiSettings,
    chat,
    chatStream
  }
}

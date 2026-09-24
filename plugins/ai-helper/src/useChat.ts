import { ref, computed } from 'vue'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  images?: string[] // base64 data URLs
  reasoning?: string
  timestamp: number
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

export type StreamPhase = 'idle' | 'waiting' | 'thinking' | 'answering' | 'done'

export interface StreamState {
  messageId: string
  phase: StreamPhase
  version: number
  reasoningChanged: boolean
  contentChanged: boolean
}

const DB_PREFIX = 'conv/'
const conversations = ref<Conversation[]>([])
const currentConvId = ref<string>('')
const isLoading = ref(false)
const selectedModel = ref('')
const models = ref<any[]>([])
const streamState = ref<StreamState>({
  messageId: '',
  phase: 'idle',
  version: 0,
  reasoningChanged: false,
  contentChanged: false
})
let abortHandle: any = null
let streamVersion = 0

interface ActiveStream {
  message: Message
  reasoning: string
  content: string
  phase: StreamPhase
  lastFlushAt: number
  flushTimer: ReturnType<typeof setTimeout> | null
}

let activeStream: ActiveStream | null = null

function getStreamFlushDelay(totalLength: number) {
  if (totalLength > 8000) return 400
  if (totalLength > 4000) return 250
  if (totalLength > 1500) return 160
  return 100
}

function asErrorRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null
}

function parseErrorPayload(value: unknown): Record<string, any> | null {
  const record = asErrorRecord(value)
  if (record) return record
  if (typeof value !== 'string') return null

  try {
    return asErrorRecord(JSON.parse(value.trim()))
  } catch {
    return null
  }
}

/** 保留宿主或服务端返回的可读错误消息，兼容旧版 API 的不同包装方式。 */
function getAiErrorMessage(error: unknown): string {
  const source = asErrorRecord(error)
  const response = asErrorRecord(source?.response)
  const responseData = parseErrorPayload(response?.data)
  const responseBody = parseErrorPayload(
    source?.responseBody ?? source?.body ?? response?.body ?? response?.text
  )
  const payloads = [
    source,
    parseErrorPayload(source?.message),
    parseErrorPayload(source?.error),
    responseData,
    parseErrorPayload(responseData?.error),
    responseBody,
    parseErrorPayload(responseBody?.error)
  ].filter((payload): payload is Record<string, any> => Boolean(payload))

  const messages = payloads
    .flatMap(payload => [payload.message, payload.errorMessage, payload.detail])
    .filter(value => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean)

  return messages[0] || '请求失败，请重试'
}

function publishStreamState(
  messageId: string,
  phase: StreamPhase,
  reasoningChanged = false,
  contentChanged = false
) {
  streamState.value = {
    messageId,
    phase,
    version: ++streamVersion,
    reasoningChanged,
    contentChanged
  }
}

function flushActiveStream(): { reasoningChanged: boolean; contentChanged: boolean } {
  const stream = activeStream
  if (!stream) return { reasoningChanged: false, contentChanged: false }

  if (stream.flushTimer) {
    clearTimeout(stream.flushTimer)
    stream.flushTimer = null
  }

  const reasoningChanged = (stream.message.reasoning || '') !== stream.reasoning
  const contentChanged = stream.message.content !== stream.content
  if (reasoningChanged) stream.message.reasoning = stream.reasoning
  if (contentChanged) stream.message.content = stream.content

  stream.lastFlushAt = Date.now()
  if (reasoningChanged || contentChanged) {
    publishStreamState(stream.message.id, stream.phase, reasoningChanged, contentChanged)
  }
  return { reasoningChanged, contentChanged }
}

function scheduleActiveStreamFlush() {
  const stream = activeStream
  if (!stream) return

  const delay = getStreamFlushDelay(stream.reasoning.length + stream.content.length)
  const remaining = delay - (Date.now() - stream.lastFlushAt)
  if (remaining <= 0) {
    flushActiveStream()
    return
  }

  if (!stream.flushTimer) {
    stream.flushTimer = setTimeout(() => {
      if (activeStream === stream) flushActiveStream()
    }, remaining)
  }
}

function finishActiveStream() {
  const stream = activeStream
  if (!stream) return

  const changes = flushActiveStream()
  activeStream = null
  publishStreamState(stream.message.id, 'done', changes.reasoningChanged, changes.contentChanged)
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function currentConv() {
  return conversations.value.find(c => c.id === currentConvId.value)
}

const currentMessages = computed(() => currentConv()?.messages ?? [])

function saveConv(conv: Conversation) {
  const docId = DB_PREFIX + conv.id
  const existing = window.ztools.db.get(docId)
  const doc: any = { _id: docId, data: JSON.stringify(conv) }
  if (existing?._rev) {
    doc._rev = existing._rev
  }
  window.ztools.db.put(doc)
}

function deleteConv(id: string) {
  const docId = DB_PREFIX + id
  const existing = window.ztools.db.get(docId)
  if (existing) {
    window.ztools.db.remove(existing)
  }
}

function loadConversations() {
  const docs = window.ztools.db.allDocs(DB_PREFIX)
  conversations.value = docs
    .map((d: any) => JSON.parse(d.data) as Conversation)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  if (conversations.value.length && !currentConvId.value) {
    currentConvId.value = conversations.value[0].id
  }
}

function newConversation() {
  const conv: Conversation = {
    id: genId(),
    title: '新对话',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  conversations.value.unshift(conv)
  currentConvId.value = conv.id
  saveConv(conv)
}

function switchConversation(id: string) {
  currentConvId.value = id
}

function removeConversation(id: string) {
  deleteConv(id)
  conversations.value = conversations.value.filter(c => c.id !== id)
  if (currentConvId.value === id) {
    currentConvId.value = conversations.value[0]?.id ?? ''
  }
}

function stopGeneration() {
  if (abortHandle) {
    abortHandle.abort()
    finishActiveStream()
    abortHandle = null
    isLoading.value = false
  }
}

async function sendMessage(content: string, images?: string[]) {
  if ((!content.trim() && (!images || !images.length)) || isLoading.value) return

  let conv = currentConv()
  if (!conv) {
    newConversation()
    conv = currentConv()!
  }

  const userMsg: Message = { id: genId(), role: 'user', content: content.trim(), timestamp: Date.now() }
  if (images?.length) userMsg.images = images
  conv.messages.push(userMsg)

  // 用第一条消息的前20字作为标题
  if (conv.messages.length === 1) {
    conv.title = content.trim().slice(0, 20) || '图片对话'
  }

  conv.messages.push({ id: genId(), role: 'assistant', content: '', timestamp: Date.now() })
  const assistantMsg = conv.messages[conv.messages.length - 1]

  activeStream = {
    message: assistantMsg,
    reasoning: '',
    content: '',
    phase: 'waiting',
    lastFlushAt: 0,
    flushTimer: null
  }
  publishStreamState(assistantMsg.id, 'waiting')

  isLoading.value = true
  conv.updatedAt = Date.now()

  // 构建 messages 历史（不含空的 assistant 消息）
  const history = conv.messages.slice(0, -1).map(m => {
    // 带图片的消息用多模态格式
    if (m.role === 'user' && m.images?.length) {
      const parts: any[] = []
      if (m.content) parts.push({ type: 'text', text: m.content })
      for (const img of m.images) {
        parts.push({ type: 'image_url', image_url: { url: img } })
      }
      return { role: m.role as 'user', content: parts }
    }
    return { role: m.role as 'user' | 'assistant', content: m.content }
  })

  try {
    const aiParams: any = { messages: history }
    if (selectedModel.value) {
      aiParams.model = selectedModel.value
    }

    abortHandle = window.ztools.ai(aiParams, (chunk: any) => {
      if (chunk?.reasoning_content) {
        const stream = activeStream
        if (stream?.message === assistantMsg) {
          stream.reasoning += chunk.reasoning_content
          if (stream.phase === 'waiting') stream.phase = 'thinking'
        }
      }
      if (chunk?.content) {
        const stream = activeStream
        if (stream?.message === assistantMsg) {
          stream.content += chunk.content
          stream.phase = 'answering'
        }
      }
      scheduleActiveStreamFlush()
    })

    await abortHandle
  } catch (e: any) {
    if (e?.name !== 'AbortError') {
      const stream = activeStream
      if (stream?.message === assistantMsg && !stream.content) {
        stream.content = getAiErrorMessage(e)
        stream.phase = 'answering'
      }
    }
  } finally {
    finishActiveStream()
    isLoading.value = false
    abortHandle = null
    saveConv(conv)
  }
}

const SELECTED_MODEL_KEY = 'selected_model'

async function loadModels() {
  try {
    const result = await window.ztools.allAiModels()
    models.value = result || []
    // 恢复上次选择的模型
    const saved = window.ztools.dbStorage.getItem(SELECTED_MODEL_KEY)
    if (saved && models.value.some(m => (m?.id || m) === saved)) {
      selectedModel.value = saved
    } else if (models.value.length && !selectedModel.value) {
      selectedModel.value = models.value[0].id || models.value[0]
    }
  } catch {}
}

function setSelectedModel(modelId: string) {
  selectedModel.value = modelId
  window.ztools.dbStorage.setItem(SELECTED_MODEL_KEY, modelId)
}

// 编辑消息：截断该消息及之后的所有消息，用新内容重新发送
async function editMessage(msgId: string, newContent: string, newImages?: string[]) {
  const conv = currentConv()
  if (!conv || isLoading.value) return
  const idx = conv.messages.findIndex(m => m.id === msgId)
  if (idx < 0) return
  conv.messages.splice(idx)
  saveConv(conv)
  await sendMessage(newContent, newImages)
}

// 重新生成：删掉指定 assistant 消息，重新发送其前面的 user 消息
async function regenerateMessage(msgId: string) {
  const conv = currentConv()
  if (!conv || isLoading.value) return
  const idx = conv.messages.findIndex(m => m.id === msgId)
  if (idx < 0) return
  // 截断从该 assistant 消息开始的所有消息
  conv.messages.splice(idx)
  saveConv(conv)
  // 找到最后一条 user 消息重新发送
  const lastUser = [...conv.messages].reverse().find(m => m.role === 'user')
  if (lastUser) {
    // 先删掉这条 user 消息（sendMessage 会重新添加）
    conv.messages.splice(conv.messages.indexOf(lastUser), 1)
    await sendMessage(lastUser.content, lastUser.images)
  }
}

export function useChat() {
  return {
    conversations,
    currentConvId,
    currentMessages,
    isLoading,
    streamState,
    selectedModel,
    models,
    loadConversations,
    newConversation,
    switchConversation,
    removeConversation,
    sendMessage,
    stopGeneration,
    loadModels,
    setSelectedModel,
    editMessage,
    regenerateMessage,
    currentConv
  }
}

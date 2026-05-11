import { ref, reactive, computed, nextTick } from 'vue'
import { marked } from 'marked'

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

// 配置 marked
marked.setOptions({ breaks: true, gfm: true })

const DB_PREFIX = 'conv/'
const conversations = ref<Conversation[]>([])
const currentConvId = ref<string>('')
const isLoading = ref(false)
const selectedModel = ref('')
const models = ref<any[]>([])
let abortHandle: any = null

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
        assistantMsg.reasoning = (assistantMsg.reasoning || '') + chunk.reasoning_content
      }
      if (chunk?.content) {
        assistantMsg.content += chunk.content
      }
    })

    await abortHandle
  } catch (e: any) {
    if (e?.name !== 'AbortError') {
      assistantMsg.content = assistantMsg.content || '请求失败，请重试'
    }
  } finally {
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

function renderMarkdown(text: string): string {
  if (!text) return ''
  return marked.parse(text, { async: false }) as string
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
    renderMarkdown,
    editMessage,
    regenerateMessage,
    currentConv
  }
}

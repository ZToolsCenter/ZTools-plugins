<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue'
import { useChat } from '../useChat'

const { currentMessages, currentConvId, isLoading, selectedModel, models, sendMessage, stopGeneration, renderMarkdown, loadModels, setSelectedModel, editMessage, regenerateMessage } = useChat()

const inputText = ref('')
const messagesRef = ref<HTMLElement>()
const textareaRef = ref<HTMLTextAreaElement>()
const fileInputRef = ref<HTMLInputElement>()
const isMultiline = ref(false)
const autoScroll = ref(true)
const pendingImages = ref<string[]>([])
const editingMsgId = ref('')
const editingText = ref('')
const isComposing = ref(false)

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function handleImageUpload(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files) return
  for (const file of Array.from(files)) {
    if (!file.type.startsWith('image/')) continue
    pendingImages.value.push(await fileToBase64(file))
  }
  if (fileInputRef.value) fileInputRef.value.value = ''
}

function removeImage(index: number) {
  pendingImages.value.splice(index, 1)
}

async function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  // 同步收集所有图片文件（异步后 DataTransferItemList 会被清空）
  const files: File[] = []
  for (const item of Array.from(items)) {
    if (!item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) files.push(file)
  }
  if (!files.length) return
  e.preventDefault()
  for (const file of files) {
    pendingImages.value.push(await fileToBase64(file))
  }
}

function onUserScrollIntent(e: WheelEvent | TouchEvent) {
  if (e instanceof WheelEvent && e.deltaY < 0) {
    autoScroll.value = false
  }
}

let touchStartY = 0
function onTouchStart(e: TouchEvent) {
  touchStartY = e.touches[0].clientY
}
function onTouchMove(e: TouchEvent) {
  if (e.touches[0].clientY > touchStartY) {
    autoScroll.value = false
  }
}

function onMessagesScroll() {
  const el = messagesRef.value
  if (!el) return
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 30) {
    autoScroll.value = true
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesRef.value && autoScroll.value) {
      messagesRef.value.scrollTop = messagesRef.value.scrollHeight
    }
  })
}

function autoResize() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = '0'
  const h = Math.min(el.scrollHeight, 120)
  el.style.height = h + 'px'
  isMultiline.value = h > 32
}

watch(inputText, () => nextTick(autoResize))

watch(currentMessages, scrollToBottom, { deep: true })

watch(currentConvId, () => {
  nextTick(() => textareaRef.value?.focus())
})

async function handleSend() {
  const hasContent = inputText.value.trim() || pendingImages.value.length
  if (!hasContent || isLoading.value) return
  const text = inputText.value
  const images = pendingImages.value.length ? [...pendingImages.value] : undefined
  inputText.value = ''
  pendingImages.value = []
  isMultiline.value = false
  autoScroll.value = true
  nextTick(() => {
    if (textareaRef.value) {
      textareaRef.value.style.height = 'auto'
    }
  })
  await sendMessage(text, images)
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !isComposing.value) {
    e.preventDefault()
    handleSend()
  }
}

function getModelName(m: any): string {
  return m?.name || m?.id || m
}

function getModelId(m: any): string {
  return m?.id || m
}

function copyMessage(content: string) {
  window.ztools.copyText(content)
}

function handleEdit(msgId: string, content: string) {
  editingMsgId.value = msgId
  editingText.value = content
  nextTick(() => {
    const el = document.querySelector('.edit-textarea') as HTMLTextAreaElement
    el?.focus()
  })
}

function cancelEdit() {
  editingMsgId.value = ''
  editingText.value = ''
}

async function confirmEdit(msgId: string, images?: string[]) {
  if (!editingText.value.trim() && !images?.length) return
  const text = editingText.value
  editingMsgId.value = ''
  editingText.value = ''
  autoScroll.value = true
  await editMessage(msgId, text, images)
}

onMounted(() => {
  loadModels()
  scrollToBottom()
})
</script>

<template>
  <div class="chat-area">
    <div class="messages" ref="messagesRef" @scroll="onMessagesScroll" @wheel="onUserScrollIntent" @touchstart="onTouchStart" @touchmove="onTouchMove">
      <div v-if="!currentMessages.length" class="empty-state">
        <svg class="empty-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h.01"/><path d="M12 10h.01"/><path d="M16 10h.01"/></svg>
        <div>开始一段新对话吧</div>
      </div>
      <div v-for="msg in currentMessages" :key="msg.id" class="msg-row" :class="msg.role">
        <div class="msg-wrapper">
          <div class="msg-bubble" :class="{ 'cursor-blink': isLoading && msg.role === 'assistant' && msg === currentMessages[currentMessages.length - 1] && !msg.content && !msg.reasoning, 'is-editing': editingMsgId === msg.id }">
            <div v-if="msg.role === 'user'">
              <template v-if="editingMsgId === msg.id">
                <textarea class="edit-textarea" v-model="editingText" rows="3" @keydown.ctrl.enter="confirmEdit(msg.id, msg.images)" @keydown.meta.enter="confirmEdit(msg.id, msg.images)" @keydown.esc="cancelEdit"></textarea>
                <div class="edit-actions">
                  <span class="edit-hint">Ctrl+Enter 确认 / Esc 取消</span>
                  <button class="msg-action-btn" @click="cancelEdit" title="取消">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                  <button class="msg-action-btn" @click="confirmEdit(msg.id, msg.images)" title="确定">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </button>
                </div>
              </template>
              <template v-else>
                <div v-if="msg.images?.length" class="msg-images">
                  <img v-for="(img, i) in msg.images" :key="i" :src="img" class="msg-img" />
                </div>
                <div v-if="msg.content">{{ msg.content }}</div>
              </template>
            </div>
            <template v-else>
              <details v-if="msg.reasoning" class="reasoning-block" :open="isLoading && msg === currentMessages[currentMessages.length - 1] && !msg.content">
                <summary>思考过程</summary>
                <div class="reasoning-content" v-html="renderMarkdown(msg.reasoning)"></div>
              </details>
              <div v-html="renderMarkdown(msg.content)"></div>
            </template>
          </div>
          <div class="msg-actions">
            <template v-if="msg.role === 'user'">
              <button class="msg-action-btn" @click="handleEdit(msg.id, msg.content)" title="编辑">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="msg-action-btn" @click="copyMessage(msg.content)" title="复制">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
            </template>
            <template v-else-if="msg.content">
              <button class="msg-action-btn" @click="regenerateMessage(msg.id)" title="重新生成" :disabled="isLoading">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              </button>
              <button class="msg-action-btn" @click="copyMessage(msg.content)" title="复制">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>
    <div class="toolbar">
      <select class="model-select" :value="selectedModel" @change="setSelectedModel(($event.target as HTMLSelectElement).value)" v-if="models.length">
        <option v-for="m in models" :key="getModelId(m)" :value="getModelId(m)">{{ getModelName(m) }}</option>
      </select>
    </div>
    <div class="input-area">
      <div v-if="pendingImages.length" class="image-preview-bar">
        <div v-for="(img, i) in pendingImages" :key="i" class="preview-item">
          <img :src="img" />
          <button class="preview-remove" @click="removeImage(i)">&times;</button>
        </div>
      </div>
      <div class="input-wrapper" :class="{ multiline: isMultiline }">
        <textarea
          ref="textareaRef"
          v-model="inputText"
          @keydown="handleKeydown"
          @input="autoResize"
          @paste="handlePaste"
          @compositionstart="isComposing = true"
          @compositionend="isComposing = false"
          placeholder="输入消息，Enter 发送，Shift+Enter 换行，可粘贴图片"
          rows="1"
        ></textarea>
        <div class="btn-row">
          <input ref="fileInputRef" type="file" accept="image/*" multiple hidden @change="handleImageUpload" />
          <button class="btn-attach" @click="fileInputRef?.click()" title="上传图片">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
          </button>
          <button v-if="isLoading" class="btn-stop" @click="stopGeneration" title="停止生成">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          </button>
          <button v-else class="btn-send" @click="handleSend" :disabled="!inputText.trim() && !pendingImages.length" title="发送">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  font-size: 14px;
  gap: 8px;
}
.empty-icon { font-size: 36px; opacity: 0.4; }
.msg-row {
  display: flex;
  margin-bottom: 16px;
}
.msg-row.user { justify-content: flex-end; }
.msg-row.assistant { justify-content: flex-start; }
.msg-wrapper {
  max-width: 80%;
  position: relative;
}
.msg-wrapper:has(.is-editing) {
  max-width: 100%;
  min-width: 80%;
}
.msg-wrapper:hover .msg-actions {
  opacity: 1;
}
.msg-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;
  padding-top: 4px;
}
.msg-row.user .msg-actions { justify-content: flex-end; }
.msg-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--input-bg);
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.msg-action-btn:hover {
  color: var(--primary);
  border-color: var(--primary);
}
.msg-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.msg-bubble {
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 13.5px;
  line-height: 1.6;
  word-break: break-word;
}
.msg-row.user .msg-bubble {
  background: var(--primary);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.msg-row.assistant .msg-bubble {
  background: var(--msg-ai-bg);
  color: var(--text);
  border-bottom-left-radius: 4px;
}
.msg-bubble :deep(p) { margin: 0 0 8px; }
.msg-bubble :deep(p:last-child) { margin-bottom: 0; }
.msg-bubble :deep(pre) {
  background: var(--code-bg);
  padding: 10px 12px;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 12.5px;
  margin: 8px 0;
}
.msg-bubble :deep(code) {
  font-family: 'SF Mono', Monaco, Menlo, monospace;
  font-size: 12.5px;
}
.msg-bubble :deep(p code) {
  background: var(--code-bg);
  padding: 1px 5px;
  border-radius: 3px;
}
.cursor-blink::after {
  content: '▍';
  animation: blink 1s infinite;
  color: var(--text-secondary);
}
@keyframes blink { 50% { opacity: 0; } }

.reasoning-block {
  margin-bottom: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.reasoning-block summary {
  padding: 4px 8px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}
.reasoning-block summary:hover {
  background: var(--hover);
}
.reasoning-content {
  padding: 6px 10px;
  font-size: 12.5px;
  color: var(--text-secondary);
  border-top: 1px solid var(--border);
  max-height: 200px;
  overflow-y: auto;
}

.input-area {
  padding: 0 20px 12px;
}
.input-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 12px;
  background: var(--input-bg);
  transition: border-color 0.15s;
}
.input-wrapper.multiline {
  flex-direction: column;
  align-items: stretch;
}
.input-wrapper:focus-within { border-color: var(--primary); }
.input-wrapper textarea {
  flex: 1;
  border: none;
  background: none;
  color: var(--text);
  font-size: 13.5px;
  line-height: 1.5;
  resize: none;
  outline: none;
  font-family: inherit;
  overflow-y: hidden;
}
.input-wrapper.multiline textarea {
  flex: none;
  overflow-y: auto;
  max-height: 120px;
}
.btn-row {
  display: flex;
  justify-content: flex-end;
  flex-shrink: 0;
}
.btn-send {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: var(--primary);
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;
  transition: opacity 0.15s;
}
.btn-send:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-send:not(:disabled):hover { opacity: 0.85; }
.btn-stop {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--hover);
  color: var(--text);
  cursor: pointer;
  flex-shrink: 0;
}
.toolbar {
  display: flex;
  align-items: center;
  padding: 4px 20px 8px;
  gap: 8px;
}
.model-select {
  font-size: 12px;
  padding: 3px 6px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--input-bg);
  color: var(--text);
  outline: none;
  max-width: 200px;
}

/* 消息中的图片 */
.msg-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.msg-img {
  max-width: 200px;
  max-height: 150px;
  border-radius: 8px;
  object-fit: cover;
  cursor: pointer;
}

/* 图片预览栏 */
.image-preview-bar {
  display: flex;
  gap: 8px;
  padding: 8px 0 4px;
  overflow-x: auto;
}
.preview-item {
  position: relative;
  flex-shrink: 0;
}
.preview-item img {
  width: 56px;
  height: 56px;
  border-radius: 8px;
  object-fit: cover;
  border: 1px solid var(--border);
}
.preview-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: none;
  background: var(--text-secondary);
  color: #fff;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.preview-remove:hover {
  background: #e53e3e;
}

/* 上传按钮 */
.btn-attach {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.15s;
}
.btn-attach:hover {
  color: var(--primary);
}

/* 就地编辑 */
.edit-textarea {
  width: 100%;
  border: 1px solid rgba(255,255,255,0.3);
  border-radius: 6px;
  padding: 8px;
  background: transparent;
  color: inherit;
  font-size: 13.5px;
  line-height: 1.6;
  font-family: inherit;
  resize: vertical;
  outline: none;
  min-height: 60px;
  max-height: 200px;
  box-sizing: border-box;
}
.edit-textarea:focus {
  border-color: rgba(255,255,255,0.6);
}
.edit-actions {
  display: flex;
  gap: 4px;
  align-items: center;
  justify-content: flex-end;
  margin-top: 6px;
}
.edit-hint {
  font-size: 11px;
  color: rgba(255,255,255,0.5);
  margin-right: auto;
}
.edit-actions .msg-action-btn {
  border-color: rgba(255,255,255,0.3);
  color: rgba(255,255,255,0.6);
  background: transparent;
}
.edit-actions .msg-action-btn:hover {
  border-color: rgba(255,255,255,0.6);
  color: #fff;
}
</style>

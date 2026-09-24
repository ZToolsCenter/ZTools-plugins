<script setup>
import { computed, ref, watch } from 'vue'
import { Check, ChevronDown, ChevronUp, ListPlus, Pencil, Trash2, X, Zap } from '@lucide/vue'

const props = defineProps({
  messages: { type: Array, default: () => [] },
  running: { type: Boolean, default: false },
})

const emit = defineEmits(['edit', 'remove', 'steer'])
const collapsed = ref(true)
const editingId = ref('')
const editingText = ref('')
const expanded = computed(() => props.messages.length === 1 || !collapsed.value || Boolean(editingId.value))

/**
 * 生成排队消息的单行预览，并在纯附件消息中显示图片数量。
 * @param {Record<string, unknown>} message 待展示消息。
 * @returns {string} 紧凑消息摘要。
 */
function getMessagePreview(message) {
  const text = String(message.text || '').replace(/\s+/g, ' ').trim()
  const count = Array.isArray(message.attachments) ? message.attachments.length : 0
  if (text && count) return `${text} · ${count} 张图片`
  if (text) return text
  return `${count} 张图片`
}

/**
 * 进入指定排队消息的行内编辑状态。
 * @param {Record<string, unknown>} message 待编辑消息。
 * @returns {void} 无返回值。
 */
function beginEdit(message) {
  editingId.value = String(message.id || '')
  editingText.value = String(message.text || '')
}

/**
 * 退出行内编辑并丢弃尚未提交的文本。
 * @returns {void} 无返回值。
 */
function cancelEdit() {
  editingId.value = ''
  editingText.value = ''
}

/**
 * 提交当前行内编辑结果。
 * @returns {void} 无返回值。
 */
function saveEdit() {
  const text = editingText.value.trim()
  if (!editingId.value || !text) return
  emit('edit', { id: editingId.value, text })
  cancelEdit()
}

/**
 * 处理编辑输入框快捷键。
 * @param {KeyboardEvent} event 键盘事件。
 * @returns {void} 无返回值。
 */
function handleEditorKeydown(event) {
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Escape') cancelEdit()
  if (event.key === 'Enter') {
    event.preventDefault()
    saveEdit()
  }
}

/**
 * 在 Inbox 变化后清理已经失效的编辑状态并恢复默认折叠状态。
 * @returns {void} 无返回值。
 */
function syncEditingState() {
  // 消息已被领取或删除时退出悬空编辑状态。
  if (editingId.value && !props.messages.some((message) => message.id === editingId.value)) cancelEdit()
  if (!props.messages.length) collapsed.value = true
}

watch(() => props.messages.map((message) => message.id).join('\n'), syncEditingState)
</script>

<template>
  <div v-if="messages.length" class="queue-dock" aria-label="待处理消息">
    <div class="queue-dock-panel">
      <button v-if="messages.length > 1" class="queue-dock-header" type="button" :aria-expanded="expanded" @click="collapsed = !collapsed">
        <ListPlus :size="15" />
        <strong>已排队 {{ messages.length }} 条</strong>
        <ChevronDown v-if="expanded" :size="15" />
        <ChevronUp v-else :size="15" />
      </button>
      <div v-if="expanded" class="queue-dock-list">
        <div v-for="message in messages" :key="message.id" class="queue-dock-row">
          <ListPlus v-if="messages.length === 1" :size="15" class="queue-dock-leading" />
          <span v-if="message.placement === 'steering'" class="queue-placement">等待插话</span>
          <input
            v-if="editingId === message.id"
            v-model="editingText"
            class="queue-dock-editor"
            aria-label="编辑排队消息"
            autofocus
            @keydown="handleEditorKeydown"
          />
          <span v-else class="queue-dock-preview" v-tooltip="{ label: getMessagePreview(message), side: 'bottom', maxWidth: 360 }" tabindex="0">{{ getMessagePreview(message) }}</span>
          <div class="queue-dock-actions">
            <template v-if="editingId === message.id">
              <button type="button" v-tooltip.bottom="'保存'" aria-label="保存" :disabled="!editingText.trim()" @click="saveEdit"><Check :size="14" /></button>
              <button type="button" v-tooltip.bottom="'取消编辑'" aria-label="取消编辑" @click="cancelEdit"><X :size="14" /></button>
            </template>
            <template v-else>
              <button v-if="message.placement === 'queued'" type="button" v-tooltip.bottom="'编辑'" aria-label="编辑" :disabled="!message.text" @click="beginEdit(message)"><Pencil :size="14" /></button>
              <button type="button" v-tooltip.bottom="'删除'" aria-label="删除" @click="emit('remove', message.id)"><Trash2 :size="14" /></button>
              <button v-if="message.placement === 'queued'" type="button" v-tooltip.bottom="'插入当前 Turn'" aria-label="插入当前 Turn" :disabled="!running" @click="emit('steer', message.id)"><Zap :size="14" /></button>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

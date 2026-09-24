<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { Trash2, X } from 'lucide-vue-next'

const props = defineProps<{ busy: boolean; messageCount: number }>()
const emit = defineEmits<{ close: []; confirm: [] }>()
const dialog = ref<HTMLElement | null>(null)
const cancelButton = ref<HTMLButtonElement | null>(null)
let previouslyFocused: HTMLElement | null = null

function close() {
  if (!props.busy) emit('close')
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    close()
    return
  }
  if (event.key !== 'Tab') return

  const focusable = Array.from(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled)') || [])
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(() => {
  previouslyFocused = document.activeElement as HTMLElement | null
  void nextTick(() => cancelButton.value?.focus())
})

onUnmounted(() => previouslyFocused?.focus())
</script>

<template>
  <div class="overlay" @mousedown.self="close">
    <section
      ref="dialog"
      class="dialog dialog--compact clear-history-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="clear-history-title"
      aria-describedby="clear-history-description"
      @keydown="handleKeyDown"
    >
      <button class="dialog__close" type="button" aria-label="关闭" :disabled="busy" @click="close"><X :size="16" aria-hidden="true" /></button>
      <span class="clear-history-dialog__icon"><Trash2 :size="20" aria-hidden="true" /></span>
      <div class="dialog__eyebrow">本地数据管理</div>
      <h2 id="clear-history-title">清理历史消息？</h2>
      <p id="clear-history-description">
        将删除此电脑中的 <strong>{{ messageCount }} 条消息</strong>和插件接收的本地附件。设备配对、匹配码与同步设置会保留；WebDAV 下次同步时会同步这些删除操作。
      </p>
      <div class="dialog-actions">
        <button ref="cancelButton" class="button button--secondary" type="button" :disabled="busy" @click="close">取消</button>
        <button class="button button--danger" type="button" :disabled="busy || !messageCount" @click="emit('confirm')">
          <span v-if="busy" class="spinner spinner--small" aria-hidden="true" />
          {{ busy ? '正在清理…' : '清理历史' }}
        </button>
      </div>
    </section>
  </div>
</template>

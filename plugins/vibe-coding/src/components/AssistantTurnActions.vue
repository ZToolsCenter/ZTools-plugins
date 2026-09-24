<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { Check, Copy, GitFork } from '@lucide/vue'
import { writeClipboard } from '../utils/clipboard.js'

const props = defineProps({
  text: { type: String, default: '' },
  timeLabel: { type: String, default: '' },
})

const emit = defineEmits(['branch'])
const copied = ref(false)
let copyPending = false
let copyResetTimer = 0
let copyGeneration = 0

/**
 * 复制完整 Turn 的最终助手正文，并短暂显示成功反馈。
 * @returns {Promise<void>} 剪贴板写入和界面状态更新完成后的 Promise。
 */
async function copyAssistantText() {
  if (copied.value || copyPending || !props.text) return
  const generation = copyGeneration
  copyPending = true
  const accepted = await writeClipboard(props.text)
  if (generation !== copyGeneration) return
  copyPending = false
  if (!accepted) return

  // 写入成功后用勾选图标确认，反馈期间忽略重复点击。
  copied.value = true
  if (copyResetTimer) window.clearTimeout(copyResetTimer)
  copyResetTimer = window.setTimeout(() => {
    copyResetTimer = 0
    copied.value = false
  }, 1000)
}

onBeforeUnmount(() => {
  // 组件卸载后使未完成写入失效，并释放反馈计时器。
  copyGeneration += 1
  copyPending = false
  if (copyResetTimer) window.clearTimeout(copyResetTimer)
})
</script>

<template>
  <div class="assistant-turn-actions">
    <button
      class="assistant-action-button assistant-copy-button"
      type="button"
      v-tooltip.bottom.instant="copied ? '已复制' : '复制'"
      :aria-label="copied ? '已复制' : '复制'"
      @click.stop="copyAssistantText"
    >
      <Check v-if="copied" :size="16" />
      <Copy v-else :size="16" />
    </button>
    <button
      class="assistant-action-button assistant-branch-button"
      type="button"
      v-tooltip.bottom.instant="'在新会话中分叉'"
      aria-label="在新会话中分叉"
      @click.stop="emit('branch')"
    >
      <GitFork :size="16" />
    </button>
    <time v-if="timeLabel" class="message-time assistant-turn-time">{{ timeLabel }}</time>
  </div>
</template>

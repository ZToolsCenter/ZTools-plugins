<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'

const props = withDefaults(defineProps<{
  title: string
  message: string
  confirmText?: string
  cancelText?: string
}>(), { confirmText: '删除', cancelText: '取消' })

const emit = defineEmits<{ confirm: []; cancel: [] }>()

/**
 * Esc 关闭弹窗，和点「取消」等价。
 * @param event 键盘事件。
 */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('cancel')
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="dialog-mask" role="dialog" aria-modal="true" aria-labelledby="confirm-title"
    @click.self="emit('cancel')">
    <section class="dialog">
      <h2 id="confirm-title">{{ props.title }}</h2>
      <p>{{ props.message }}</p>
      <div class="dialog-actions">
        <button type="button" class="secondary" @click="emit('cancel')">{{ props.cancelText }}</button>
        <button type="button" class="dialog-danger" @click="emit('confirm')">{{ props.confirmText }}</button>
      </div>
    </section>
  </div>
</template>

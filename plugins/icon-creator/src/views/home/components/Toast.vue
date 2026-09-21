<template>
  <Transition name="toast-fade">
    <div v-if="visible" class="toast-container" :class="`toast-${type}`">
      <Icon v-if="icon" :icon="icon" class="toast-icon" />
      <span class="toast-message">{{ message }}</span>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Icon } from '@iconify/vue'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

const props = defineProps<{
  message: string
  type?: ToastType
  duration?: number
}>()

const visible = ref(false)
const icon = ref('')

watch(() => props.message, (newMessage) => {
  if (newMessage) {
    visible.value = true

    // 设置图标
    switch (props.type) {
      case 'success':
        icon.value = 'mdi:check-circle'
        break
      case 'error':
        icon.value = 'mdi:alert-circle'
        break
      case 'warning':
        icon.value = 'mdi:alert'
        break
      case 'info':
      default:
        icon.value = 'mdi:information'
        break
    }

    // 自动隐藏
    const duration = props.duration ?? 3000
    setTimeout(() => {
      visible.value = false
    }, duration)
  }
}, { immediate: true })
</script>

<style lang="scss" scoped>
.toast-container {
  position: fixed;
  top: 80px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10000;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  font-size: 14px;
  max-width: 90%;
  pointer-events: none;
}

.toast-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.toast-message {
  line-height: 1.5;
}

.toast-success {
  color: #52c41a;
  border-left: 4px solid #52c41a;
}

.toast-error {
  color: #ff4d4f;
  border-left: 4px solid #ff4d4f;
}

.toast-warning {
  color: #faad14;
  border-left: 4px solid #faad14;
}

.toast-info {
  color: #1890ff;
  border-left: 4px solid #1890ff;
}

.toast-fade-enter-active,
.toast-fade-leave-active {
  transition: all 0.3s ease;
}

.toast-fade-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(-20px);
}

.toast-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-10px);
}
</style>

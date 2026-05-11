<script setup lang="ts">
/**
 * 提示消息组件
 * 单个提示消息的展示，支持不同类型（success, error, warning, info）
 */
import { computed } from 'vue'
import { CheckCircle2, XCircle, AlertCircle, Info, X } from 'lucide-vue-next'
import type { ToastType } from '@/libs/toast'

// 组件属性
const props = defineProps<{
  message: string    // 消息文本
  type: ToastType   // 消息类型
}>()

// 组件事件
const emit = defineEmits<{
  (e: 'close'): void  // 关闭消息事件
}>()

/**
 * 根据消息类型获取对应的图标组件
 * @returns 对应类型的图标组件
 */
const icon = computed(() => {
  switch (props.type) {
    case 'success': return CheckCircle2
    case 'error': return XCircle
    case 'warning': return AlertCircle
    case 'info':
    default: return Info
  }
})
</script>

<template>
  <div class="cs-toast" :class="[`is-${type}`]">
    <div class="cs-toast-icon">
      <component :is="icon" :size="18" />
    </div>
    <div class="cs-toast-content">
      {{ message }}
    </div>
    <button class="cs-toast-close" @click="emit('close')">
      <X :size="14" />
    </button>
  </div>
</template>

<style lang="scss" scoped>
.cs-toast {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 280px;
  max-width: 450px;
  padding: 12px 16px;
  background: var(--color-dropdown-bg);
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid var(--color-dropdown-border);
  border-radius: 16px;
  box-shadow:
    0 12px 32px rgba(0, 0, 0, 0.4),
    0 0 0 1px rgba(255, 255, 255, 0.05) inset;
  pointer-events: auto;
  margin-bottom: 10px;
  transition: all 0.3s ease;

  :global(.light-theme) & {
    background: rgba(255, 255, 255, 0.95);
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.08);
  }

  &.is-success {
    --toast-accent: #10b981;

    .cs-toast-icon {
      color: #10b981;
    }
  }

  &.is-error {
    --toast-accent: #f43f5e;

    .cs-toast-icon {
      color: #f43f5e;
    }
  }

  &.is-warning {
    --toast-accent: #f59e0b;

    .cs-toast-icon {
      color: #f59e0b;
    }
  }

  &.is-info {
    --toast-accent: #38bdf8;

    .cs-toast-icon {
      color: #38bdf8;
    }
  }
}

.cs-toast-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cs-toast-content {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
  line-height: 1.4;

  :global(.light-theme) & {
    color: #18181b;
  }
}

.cs-toast-close {
  flex-shrink: 0;
  background: transparent;
  border: none;
  color: var(--color-text-muted-darker);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--color-text);
  }

  :global(.light-theme) &:hover {
    background: rgba(0, 0, 0, 0.05);
    color: #000;
  }
}
</style>

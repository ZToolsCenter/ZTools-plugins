<script setup lang="ts">
/**
 * 通用按钮组件
 * 支持多种变体（primary, secondary, danger 等）和尺寸
 */
// 组件属性定义
const props = defineProps<{
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success' | 'warning' | 'info' | 'outline' | 'link'  // 按钮样式变体
  size?: 'sm' | 'md' | 'lg'  // 按钮尺寸
  iconOnly?: boolean  // 是否仅显示图标
  disabled?: boolean  // 是否禁用
}>()

// 组件事件定义
const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void  // 点击事件
}>()

/**
 * 处理按钮点击事件
 * @param e - 鼠标事件对象
 */
const handleClick = (e: MouseEvent) => {
  if (!props.disabled) emit('click', e)
}
</script>

<template>
  <button class="cs-button" :class="[
    `variant-${(variant || 'secondary').toLowerCase()}`,
    `size-${size || 'md'}`,
    { 'icon-only': iconOnly },
    { 'is-disabled': disabled }
  ]" :disabled="disabled" @click="handleClick" type="button">
    <slot></slot>
  </button>
</template>

<style lang="scss" scoped>
@use "sass:color";

// ── Base Styles ───────────────────────────────────────────────────────────────

.cs-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-family: var(--font-sans);
  font-weight: 600;
  letter-spacing: -0.01em;
  border: 1px solid transparent;
  outline: none;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  overflow: hidden;

  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease,
    box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
    filter 0.2s ease;

  :deep(svg) {
    flex-shrink: 0;
    transition: transform 0.2s ease;
  }

  &:active:not(.is-disabled) {
    transform: scale(0.96);
  }

  &.is-disabled {
    opacity: 0.4;
    cursor: not-allowed;
    filter: grayscale(0.5);
    box-shadow: none !important;
    transform: none !important;

    :global(.light-theme) & {
      background: #f3f4f6 !important;
      color: #9ca3af !important;
      border-color: #e5e7eb !important;
    }
  }
}

// ── Variants ──────────────────────────────────────────────────────────────────

// 1. Primary - Brand Gradient
.variant-primary {
  background: linear-gradient(135deg, #38bdf8 0%, #818cf8 50%, #c084fc 100%);
  background-size: 200% auto;
  color: #fff;
  border: none;
  box-shadow: 0 4px 15px rgba(129, 140, 248, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.2) inset;

  &:hover:not(.is-disabled) {
    background-position: right center;
    box-shadow: 0 8px 25px rgba(129, 140, 248, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.3) inset;
    transform: translateY(-2px);
  }

  :global(.light-theme) & {
    box-shadow: 0 4px 12px rgba(129, 140, 248, 0.3);

    &:hover:not(.is-disabled) {
      box-shadow: 0 8px 20px rgba(129, 140, 248, 0.4);
    }
  }
}

// 2. Secondary - Glassmorphism
.variant-secondary {
  background: var(--color-btn-bg); // Controlled by :root and .light-theme in variables.scss
  backdrop-filter: blur(12px);
  border: 1px solid var(--color-btn-border);
  color: var(--color-text-lighter);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);

  :global(.light-theme) & {
    background: #fff;
    border-color: #e5e7eb;
    color: #374151;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);

    &:hover:not(.is-disabled) {
      background: #f9fafb;
      border-color: #d1d5db;
      color: #111827;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    }
  }

  &:hover:not(.is-disabled) {
    background: var(--color-btn-hover);
    border-color: rgba(255, 255, 255, 0.15);
    color: #fff;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.25);
  }
}

// 3. Danger - Red
.variant-danger {
  background: rgba(244, 63, 94, 0.1);
  border: 1px solid rgba(244, 63, 94, 0.2);
  color: #fb7185;

  :global(.light-theme) & {
    background: #fef2f2;
    border-color: #fecaca;
    color: #ef4444;

    &:hover:not(.is-disabled) {
      background: #ef4444;
      border-color: #ef4444;
      color: #fff;
    }
  }

  &:hover:not(.is-disabled) {
    background: #f43f5e;
    color: #fff;
    border-color: #f43f5e;
    box-shadow: 0 8px 20px rgba(244, 63, 94, 0.3);
    transform: translateY(-1px);
  }
}

// 4. Ghost
.variant-ghost {
  background: transparent;
  color: var(--color-text-muted);

  :global(.light-theme) & {
    color: #6b7280;

    &:hover:not(.is-disabled) {
      background: #f3f4f6;
      color: #111827;
    }
  }

  &:hover:not(.is-disabled) {
    background: rgba(0, 0, 0, 0.06);
    color: #fff;
  }
}

// 5. Success
.variant-success {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: #fff;
  box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3);

  :global(.light-theme) & {
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
  }

  &:hover:not(.is-disabled) {
    box-shadow: 0 8px 25px rgba(16, 185, 129, 0.4);
    transform: translateY(-1px);
  }
}

// 6. Warning
.variant-warning {
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  color: #fff;
  box-shadow: 0 4px 15px rgba(245, 158, 11, 0.3);

  :global(.light-theme) & {
    box-shadow: 0 4px 12px rgba(245, 158, 11, 0.2);
  }

  &:hover:not(.is-disabled) {
    box-shadow: 0 8px 25px rgba(245, 158, 11, 0.4);
    transform: translateY(-1px);
  }
}

// 7. Info
.variant-info {
  background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
  color: #fff;
  box-shadow: 0 4px 15px rgba(14, 165, 233, 0.3);

  :global(.light-theme) & {
    box-shadow: 0 4px 12px rgba(14, 165, 233, 0.2);
  }
}

// 8. Outline
.variant-outline {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: var(--color-text-lighter);

  :global(.light-theme) & {
    border-color: #d1d5db;
    color: #4b5563;

    &:hover:not(.is-disabled) {
      border-color: #111827;
      background: #f9fafb;
      color: #111827;
    }
  }

  &:hover:not(.is-disabled) {
    background: rgba(255, 255, 255, 0.03);
    border-color: var(--color-accent-blue);
    color: var(--color-accent-blue);
    box-shadow: 0 0 15px rgba(56, 189, 248, 0.1);
  }
}

// 9. Link
.variant-link {
  background: transparent;
  color: var(--color-accent-blue);
  padding: 0;
  height: auto;

  &:hover:not(.is-disabled) {
    text-decoration: underline;
    opacity: 0.8;
  }
}

// ── Sizes ─────────────────────────────────────────────────────────────────────

.size-sm {
  height: 32px;
  padding: 0 12px;
  font-size: 13px;
  border-radius: 10px;

  &.icon-only {
    width: 32px;
    padding: 0;
  }
}

.size-md {
  height: 40px;
  padding: 0 16px;
  font-size: 14px;
  border-radius: 12px;

  &.icon-only {
    width: 40px;
    padding: 0;
  }
}

.size-lg {
  height: 52px;
  padding: 0 24px;
  font-size: 16px;
  border-radius: 14px;
  font-weight: 700;

  &.icon-only {
    width: 52px;
    padding: 0;
  }
}
</style>

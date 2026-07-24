<template>
  <div
    class="ui-button"
    :class="[
      `ui-button--${variant}`,
      `ui-button--${size}`,
      { 'ui-button--disabled': disabled, 'ui-button--icon': iconOnly }
    ]"
    :tabindex="disabled ? -1 : 0"
    role="button"
    :aria-disabled="disabled ? 'true' : 'false'"
    @click="handleClick"
    @keydown.enter="handleClick"
    @keydown.space.prevent="handleClick"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warning'
type ButtonSize = 'xs' | 'sm' | 'md'

const props = withDefaults(defineProps<{
  variant?: ButtonVariant
  size?: ButtonSize
  disabled?: boolean
  iconOnly?: boolean
}>(), {
  variant: 'secondary',
  size: 'md',
  disabled: false,
  iconOnly: false
})

const emit = defineEmits<{
  click: [event: MouseEvent | KeyboardEvent]
}>()

function handleClick(event: MouseEvent | KeyboardEvent) {
  if (!props.disabled) {
    emit('click', event)
  }
}
</script>

<style scoped>
.ui-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  border-radius: var(--radius-sm);
  font-weight: 500;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  outline: none;
  border: 1px solid transparent;
  transition: all var(--transition-base);
  letter-spacing: 0.01em;
}

.ui-button:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

.ui-button--primary {
  background: var(--accent-primary);
  color: #ffffff;
  border-color: var(--accent-primary);
}

.ui-button--primary:hover:not(.ui-button--disabled) {
  background: #e55c2b;
  border-color: #e55c2b;
}

.ui-button--primary:active:not(.ui-button--disabled) {
  background: #d14917;
  border-color: #d14917;
}

.ui-button--secondary {
  background: var(--bg-surface);
  color: var(--text-primary);
  border-color: var(--border-color);
}

.ui-button--secondary:hover:not(.ui-button--disabled) {
  background: var(--bg-elevated);
  border-color: var(--border-color-hover);
}

.ui-button--secondary:active:not(.ui-button--disabled) {
  background: var(--bg-overlay);
}

.ui-button--ghost {
  background: transparent;
  color: var(--text-secondary);
  border-color: transparent;
}

.ui-button--ghost:hover:not(.ui-button--disabled) {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.ui-button--danger {
  background: var(--bg-surface);
  color: var(--error-color);
  border-color: var(--border-color);
}

.ui-button--danger:hover:not(.ui-button--disabled) {
  background: var(--error-color);
  color: #ffffff;
  border-color: var(--error-color);
}

.ui-button--success {
  background: var(--bg-surface);
  color: var(--success-color);
  border-color: var(--border-color);
}

.ui-button--success:hover:not(.ui-button--disabled) {
  background: var(--success-color);
  color: #ffffff;
  border-color: var(--success-color);
}

.ui-button--warning {
  background: var(--bg-surface);
  color: var(--warning-color);
  border-color: var(--border-color);
}

.ui-button--warning:hover:not(.ui-button--disabled) {
  background: var(--warning-color);
  color: #ffffff;
  border-color: var(--warning-color);
}

.ui-button--xs {
  padding: 4px 8px;
  font-size: 11px;
}

.ui-button--sm {
  padding: 6px 12px;
  font-size: 12px;
}

.ui-button--md {
  padding: 8px 16px;
  font-size: 13px;
}

.ui-button--icon {
  width: 32px;
  height: 32px;
  padding: 0;
  min-width: 32px;
  min-height: 32px;
}

.ui-button--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

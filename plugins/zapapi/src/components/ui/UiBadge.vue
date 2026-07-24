<template>
  <span class="ui-badge" :class="[`ui-badge--${variant}`, `ui-badge--${size}`]">
    <slot />
  </span>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info'
  size?: 'sm' | 'md'
}>(), {
  variant: 'default',
  size: 'sm'
})
</script>

<style scoped>
.ui-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-pill);
  font-weight: 500;
  white-space: nowrap;
}

.ui-badge--sm {
  padding: 1px 6px;
  font-size: 11px;
}

.ui-badge--md {
  padding: 2px 8px;
  font-size: 12px;
}

.ui-badge--default {
  background: var(--bg-overlay);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.ui-badge--success {
  background: var(--bg-elevated);
  color: var(--success-color);
  border: 1px solid var(--success-color);
}

.ui-badge--warning {
  background: var(--bg-elevated);
  color: var(--warning-color);
  border: 1px solid var(--warning-color);
}

.ui-badge--error {
  background: var(--bg-elevated);
  color: var(--error-color);
  border: 1px solid var(--error-color);
}

.ui-badge--info {
  background: var(--bg-elevated);
  color: var(--info-color);
  border: 1px solid var(--info-color);
}
</style>

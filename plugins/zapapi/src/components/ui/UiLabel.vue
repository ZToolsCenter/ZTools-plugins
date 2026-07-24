<template>
  <label class="ui-label" :class="[`ui-label--${size}`, { 'ui-label--disabled': disabled }]">
    <slot />
    <span v-if="required" class="ui-label__required">*</span>
  </label>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  size?: 'sm' | 'md'
  required?: boolean
  disabled?: boolean
}>(), {
  size: 'sm'
})
</script>

<style scoped>
.ui-label {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  cursor: inherit;
}

.ui-label--sm {
  font-size: 11px;
  color: var(--text-secondary);
}

.ui-label--md {
  font-size: 12px;
  color: var(--text-secondary);
}

.ui-label__required {
  color: var(--error-color);
}

.ui-label--disabled {
  opacity: 0.5;
}
</style>

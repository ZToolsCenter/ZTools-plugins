<template>
  <div class="ui-textarea-wrapper" :class="{ 'ui-textarea-wrapper--focused': isFocused }">
    <textarea
      ref="textareaRef"
      class="ui-textarea"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :rows="rows"
      @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      @focus="isFocused = true"
      @blur="isFocused = false"
    ></textarea>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

withDefaults(defineProps<{
  modelValue?: string
  placeholder?: string
  disabled?: boolean
  rows?: number
}>(), {
  modelValue: '',
  placeholder: '',
  rows: 4
})

defineEmits<{
  'update:modelValue': [value: string]
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)
const isFocused = ref(false)

defineExpose({ focus: () => textareaRef.value?.focus() })
</script>

<style scoped>
.ui-textarea-wrapper {
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  background: var(--input-bg);
  transition: border-color var(--transition-fast);
  overflow: hidden;
}

.ui-textarea-wrapper:hover:not(.ui-textarea-wrapper--focused) {
  border-color: var(--border-color-hover);
}

.ui-textarea-wrapper--focused {
  border-color: var(--border-active);
  box-shadow: none;
}

.ui-textarea {
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  line-height: 1.6;
  outline: none;
  resize: vertical;
}

.ui-textarea::placeholder {
  color: var(--text-muted);
}

.ui-textarea:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>

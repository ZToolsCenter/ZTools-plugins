<template>
  <div class="ui-input-wrapper" :class="{ 'ui-input-wrapper--focused': isFocused }">
    <div v-if="$slots.prefix || prefix" class="ui-input__prefix">
      <slot name="prefix">{{ prefix }}</slot>
    </div>
    <input
      ref="inputRef"
      class="ui-input"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :readonly="readonly"
      @input="handleInput"
      @focus="isFocused = true"
      @blur="isFocused = false"
      @keydown="handleKeydown"
    />
    <div v-if="$slots.suffix || suffix" class="ui-input__suffix">
      <slot name="suffix">{{ suffix }}</slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(defineProps<{
  modelValue?: string
  type?: string
  placeholder?: string
  disabled?: boolean
  readonly?: boolean
  prefix?: string
  suffix?: string
}>(), {
  modelValue: '',
  type: 'text',
  placeholder: '',
  disabled: false,
  readonly: false
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  keydown: [event: KeyboardEvent]
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const isFocused = ref(false)

function handleInput(event: Event) {
  const target = event.target as HTMLInputElement
  emit('update:modelValue', target.value)
}

function handleKeydown(event: KeyboardEvent) {
  emit('keydown', event)
}

function focus() {
  inputRef.value?.focus()
}

function select() {
  inputRef.value?.select()
}

function focusAndSelect() {
  inputRef.value?.focus()
  inputRef.value?.select()
}

defineExpose({
  focus,
  select,
  focusAndSelect
})
</script>

<style scoped>
.ui-input-wrapper {
  display: inline-flex;
  align-items: center;
  gap: 0;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  background: var(--input-bg);
  transition: border-color var(--transition-fast);
  min-height: 32px;
}

.ui-input-wrapper:hover:not(.ui-input-wrapper--focused) {
  border-color: var(--border-color-hover);
}

.ui-input-wrapper--focused {
  border-color: var(--border-active);
  box-shadow: none;
}

.ui-input {
  flex: 1;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  min-width: 0;
}

.ui-input::placeholder {
  color: var(--text-muted);
}

.ui-input:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.ui-input__prefix,
.ui-input__suffix {
  display: flex;
  align-items: center;
  padding: 0 10px;
  color: var(--text-secondary);
  font-size: 13px;
  flex-shrink: 0;
}
</style>

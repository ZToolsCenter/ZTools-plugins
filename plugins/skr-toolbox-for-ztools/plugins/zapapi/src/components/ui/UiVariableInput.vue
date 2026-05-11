<template>
  <div
    class="ui-variable-input-wrapper"
    :class="{ 'ui-variable-input-wrapper--focused': isFocused, 'ui-variable-input-wrapper--disabled': props.disabled }"
    @mousedown="onWrapperMouseDown"
  >
    <input
      ref="inputRef"
      class="ui-variable-input"
      type="text"
      :value="props.modelValue"
      :disabled="props.disabled"
      :readonly="props.readonly"
      :placeholder="props.placeholder"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
      @scroll="onScroll"
      @keydown="$emit('keydown', $event)"
      @keyup="$emit('keyup', $event)"
      @mouseup="$emit('mouseup', $event)"
      @select="$emit('select', $event)"
    />
    <div class="ui-variable-input__overlay" aria-hidden="true">
      <div class="ui-variable-input__overlay-content" :style="overlayStyle">
        <span v-if="segments.length === 0" class="ui-variable-input__placeholder">{{ props.placeholder }}</span>
        <template v-for="segment in segments" :key="segment.id">
          <span v-if="segment.type === 'text'">{{ segment.value }}</span>
          <UiTooltip v-else :content="segment.tooltip" placement="bottom">
            <span
              class="ui-variable-input__token"
              :class="{ 'ui-variable-input__token--missing': segment.missing }"
              @mousedown.prevent="focus"
            >
              {{ segment.raw }}
            </span>
          </UiTooltip>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEnvironmentStore } from '../../store/environments'
import UiTooltip from './UiTooltip.vue'

type Segment =
  | { id: string; type: 'text'; value: string }
  | { id: string; type: 'var'; raw: string; tooltip: string; missing: boolean }

const props = withDefaults(defineProps<{
  modelValue?: string
  placeholder?: string
  disabled?: boolean
  readonly?: boolean
}>(), {
  modelValue: '',
  placeholder: ''
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  keydown: [event: KeyboardEvent]
  keyup: [event: KeyboardEvent]
  mouseup: [event: MouseEvent]
  select: [event: Event]
  blur: [event: FocusEvent]
  focus: [event: FocusEvent]
}>()

const envStore = useEnvironmentStore()
const inputRef = ref<HTMLInputElement | null>(null)
const isFocused = ref(false)
const scrollLeft = ref(0)

const segments = computed<Segment[]>(() => {
  const source = props.modelValue || ''
  if (!source) return []

  const vars = envStore.getVariables()
  const regex = /\{\{\s*([^}]+?)\s*\}\}/g
  const result: Segment[] = []
  let lastIndex = 0
  let tokenIndex = 0
  let match: RegExpExecArray | null = regex.exec(source)

  while (match) {
    if (match.index > lastIndex) {
      result.push({
        id: `text-${tokenIndex}-${lastIndex}`,
        type: 'text',
        value: source.slice(lastIndex, match.index)
      })
    }

    const raw = match[0]
    const key = match[1].trim()
    const resolved = vars[key]
    result.push({
      id: `var-${tokenIndex}-${match.index}`,
      type: 'var',
      raw,
      tooltip: resolved !== undefined ? `${key} = ${resolved}` : `${key} = (undefined)`,
      missing: resolved === undefined
    })

    lastIndex = match.index + raw.length
    tokenIndex += 1
    match = regex.exec(source)
  }

  if (lastIndex < source.length) {
    result.push({
      id: `text-tail-${lastIndex}`,
      type: 'text',
      value: source.slice(lastIndex)
    })
  }

  return result
})

const overlayStyle = computed(() => ({
  transform: `translateX(-${scrollLeft.value}px)`
}))

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

function onScroll(event: Event) {
  scrollLeft.value = (event.target as HTMLInputElement).scrollLeft
}

function focus() {
  inputRef.value?.focus()
}

function onWrapperMouseDown(event: MouseEvent) {
  if (event.target instanceof HTMLInputElement) return
  event.preventDefault()
  inputRef.value?.focus()
}

function onFocus(e: FocusEvent) {
  isFocused.value = true
  emit('focus', e)
}

function onBlur(e: FocusEvent) {
  isFocused.value = false
  emit('blur', e)
}

defineExpose({ focus, inputRef })
</script>

<style scoped>
.ui-variable-input-wrapper {
  position: relative;
  display: inline-flex;
  width: 100%;
  min-height: 32px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  background: var(--bg-surface);
  transition: border-color var(--transition-base);
  overflow: hidden;
}

.ui-variable-input-wrapper:hover:not(.ui-variable-input-wrapper--focused):not(.ui-variable-input-wrapper--disabled) {     
  border-color: var(--text-muted);
}

.ui-variable-input-wrapper--focused {
  border-color: var(--accent-primary);
  outline: 1px solid var(--accent-primary);
}

.ui-variable-input-wrapper--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ui-variable-input {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: transparent;
  caret-color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  line-height: normal;
  outline: none;
  position: relative;
  z-index: 1;
}

.ui-variable-input:disabled {
  cursor: not-allowed;
}

.ui-variable-input::placeholder {
  color: transparent;
}

.ui-variable-input__overlay {
  position: absolute;
  inset: 0;
  padding: 6px 12px;
  font-size: 13px;
  font-family: inherit;
  line-height: normal;
  color: var(--text-primary);
  pointer-events: none;
  overflow: hidden;
  z-index: 2;
}

.ui-variable-input__overlay-content {
  white-space: pre;
  min-width: 100%;
}

.ui-variable-input__placeholder {
  color: var(--text-muted);
}

.ui-variable-input__token {
  display: inline;
  background: color-mix(in srgb, var(--accent-primary) 18%, transparent);
  color: var(--accent-primary);
  border-radius: 2px;
  pointer-events: auto;
}

.ui-variable-input__token--missing {
  color: var(--warning-color);
  background: color-mix(in srgb, var(--warning-color) 18%, transparent);
}

.ui-variable-input__overlay :deep(.ui-tooltip-trigger) {
  display: inline;
  pointer-events: auto;
}
</style>

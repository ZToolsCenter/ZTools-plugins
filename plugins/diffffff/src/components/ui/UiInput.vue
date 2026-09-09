<!--
  UiInput：北欧风文本输入框（替代 ztools-ui ZInput）。

  能力对齐原用法：v-model 双向绑定、type（text/number）、placeholder、
  clearable（尾部 × 清空钮，hover/focus 或有值时显示）、status="error"（陶土红
  描边，SettingsDialog 规则校验用）、min/max/step 透传 number 输入。
  update:modelValue 恒发 string（number 输入也是原始字符串，钳制归调用方 ——
  SettingsDialog 的 handleContextInput 本就接受 string）。
-->
<script setup lang="ts">
import { computed } from 'vue'
import UiIcon from './UiIcon.vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    type?: 'text' | 'number'
    placeholder?: string
    clearable?: boolean
    status?: 'error'
    disabled?: boolean
    ariaLabel?: string
    min?: number | string
    max?: number | string
    step?: number | string
  }>(),
  {
    type: 'text',
    placeholder: '',
    clearable: false,
    status: undefined,
    disabled: false,
    ariaLabel: undefined,
    min: undefined,
    max: undefined,
    step: undefined,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

function handleInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

/** clearable：有值才显示清空钮（空值时无物可清） */
const showClear = computed(() => props.clearable && props.modelValue !== '')
</script>

<template>
  <span class="ui-input" :class="{ 'is-error': status === 'error' }">
    <input
      class="ui-input-native"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :min="min"
      :max="max"
      :step="step"
      @input="handleInput"
    />
    <button
      v-if="showClear"
      type="button"
      class="ui-input-clear"
      aria-label="清空输入"
      @click="emit('update:modelValue', '')"
    >
      <UiIcon name="x" :size="12" />
    </button>
  </span>
</template>

<style scoped>
.ui-input {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 100%;
}

/* 纸面输入：白底细描边，focus 描边转主色（无边框加粗、无发光） */
.ui-input-native {
  width: 100%;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--control-border, #ddd7cb);
  border-radius: var(--radius-s, 6px);
  background-color: var(--surface, #ffffff);
  color: var(--text-color, #2e2c28);
  font-family: inherit;
  font-size: 12px;
  line-height: 1;
  outline: none;
  transition: border-color 0.12s var(--ease-quiet), background-color 0.12s var(--ease-quiet);
}

.ui-input-native::placeholder {
  color: var(--placeholder-color, #b6afa2);
}

.ui-input-native:hover {
  border-color: var(--border-strong, #d7d1c4);
}

.ui-input-native:focus-visible {
  border-color: var(--primary-color, #4e7a60);
}

.ui-input-native:disabled {
  opacity: 0.45;
}

/* 有清空钮时为输入文字留出钮位 */
.ui-input-native {
  padding-right: 8px;
}

.ui-input:has(.ui-input-clear) .ui-input-native {
  padding-right: 22px;
}

/* number 输入去掉 Chromium 上下箭头（保持极简；键盘上下键仍可步进） */
.ui-input-native::-webkit-outer-spin-button,
.ui-input-native::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.ui-input-native[type='number'] {
  -moz-appearance: textfield;
  appearance: textfield;
}

/* 校验失败：陶土红描边（SettingsDialog 逐条规则错误态） */
.ui-input.is-error .ui-input-native {
  border-color: var(--danger-color, #b3563e);
}

/* 清空钮：压在输入框右缘的小 ghost 钮 */
.ui-input-clear {
  position: absolute;
  right: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: var(--radius-s, 6px);
  background: transparent;
  color: var(--placeholder-color, #b6afa2);
  cursor: pointer;
  transition: background-color 0.12s var(--ease-quiet), color 0.12s var(--ease-quiet);
}

.ui-input-clear:hover {
  background-color: var(--hover-bg, #f2f0ea);
  color: var(--text-color, #2e2c28);
}
</style>

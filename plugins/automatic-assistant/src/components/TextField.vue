<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  label?: string
  modelValue: string | number | undefined
  type?: string
  placeholder?: string
  hiddenLabel?: boolean
  autofocus?: boolean
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const focused = ref(false)
// MUI：有值或聚焦时 label 上浮缩小
const shrink = computed(
  () => focused.value || (props.modelValue !== undefined && props.modelValue !== null && props.modelValue !== '')
)
</script>

<template>
  <div class="text-field" :class="{ focused, shrink }">
    <label v-if="label && !hiddenLabel">{{ label }}</label>
    <span class="input-root">
      <input
        :type="type || 'text'"
        :value="modelValue"
        :placeholder="placeholder"
        :autofocus="autofocus"
        @focus="focused = true"
        @blur="focused = false"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
    </span>
  </div>
</template>

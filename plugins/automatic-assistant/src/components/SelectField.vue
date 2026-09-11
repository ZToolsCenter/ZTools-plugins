<script setup lang="ts">
import { ref } from 'vue'

defineProps<{ label?: string; modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()
const focused = ref(false)
</script>

<template>
  <div class="text-field focused shrink" :class="{ focused }">
    <label v-if="label">{{ label }}</label>
    <span class="input-root">
      <select
        :value="modelValue"
        @focus="focused = true"
        @blur="focused = false"
        @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
      >
        <slot />
      </select>
    </span>
  </div>
</template>

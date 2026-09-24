<template>
  <MilkdownProvider>
    <MilkdownEditorInner
      :model-value="modelValue"
      @update:model-value="$emit('update:modelValue', $event)"
    />
  </MilkdownProvider>
</template>

<script setup lang="ts">
import { MilkdownProvider } from '@milkdown/vue'
import MilkdownEditorInner from './MilkdownEditorInner.vue'

defineProps<{ modelValue: string }>()
defineEmits<{ (e: 'update:modelValue', v: string): void }>()
</script>

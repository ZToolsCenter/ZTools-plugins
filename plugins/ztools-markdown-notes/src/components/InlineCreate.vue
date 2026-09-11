<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
defineProps<{
  kind: 'note' | 'directory'
  name: string
  error: string
}>()

const emit = defineEmits<{
  'update:name': [name: string]
  submit: []
  cancel: []
}>()

const input = ref<HTMLInputElement | null>(null)

onMounted(async () => {
  await nextTick()
  input.value?.focus()
  input.value?.select()
})

function finish() {
  emit('submit')
}
</script>

<template>
  <div class="inline-create">
    <input
      ref="input"
      class="inline-create-input"
      :value="name"
      autofocus
      :placeholder="kind === 'note' ? '笔记名称' : '文件夹名称'"
      @input="emit('update:name', ($event.target as HTMLInputElement).value)"
      @blur="finish"
      @keydown.enter.prevent="finish"
      @keydown.esc.prevent="emit('cancel')"
    />
    <small v-if="error" class="error-message">{{ error }}</small>
  </div>
</template>

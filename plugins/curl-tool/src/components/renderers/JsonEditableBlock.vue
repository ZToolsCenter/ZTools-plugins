<script setup lang="ts">
import JsonCodeMirrorBlock from './JsonCodeMirrorBlock.vue'

defineProps<{
  content: string
}>()

const emit = defineEmits<{
  'update:content': [value: string]
}>()
</script>

<template>
  <JsonCodeMirrorBlock :content="content" language="json" editable @update:content="emit('update:content', $event)" />
</template>

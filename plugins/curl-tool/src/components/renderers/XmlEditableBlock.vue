<script setup lang="ts">
import JsonCodeMirrorBlock from './JsonCodeMirrorBlock.vue'

defineProps<{
  content: string
}>()

const emit = defineEmits<{
  'update:content': [value: string]
}>()

function update(value: string) {
  emit('update:content', value)
}

async function onPaste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData('text/plain')
  if (!text) return
  try {
    event.preventDefault()
    const { default: formatXml } = await import('xml-formatter')
    update(formatXml(text, { indentation: '  ' }))
  } catch {
    update(text)
  }
}
</script>

<template>
  <div class="xml-editable" @paste="onPaste">
    <JsonCodeMirrorBlock :content="content" language="xml" editable @update:content="update" />
  </div>
</template>

<style scoped>
.xml-editable {
  height: 100%;
  min-height: 0;
}
</style>

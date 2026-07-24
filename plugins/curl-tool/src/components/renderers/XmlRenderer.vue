<script setup lang="ts">
import { ref, watch } from 'vue'
import CodeBlock from './CodeBlock.vue'

const props = defineProps<{
  content: string
  query?: string
  activeIndex?: number
}>()

const pretty = ref(props.content)

watch(
  () => props.content,
  async (content) => {
    pretty.value = await formatXmlContent(content)
  },
  { immediate: true }
)

async function formatXmlContent(content: string) {
  try {
    const { default: formatXml } = await import('xml-formatter')
    return formatXml(content, { indentation: '  ' })
  } catch {
    return content
  }
}
</script>

<template>
  <CodeBlock :content="pretty" kind="xml" :query="query" :active-index="activeIndex" />
</template>

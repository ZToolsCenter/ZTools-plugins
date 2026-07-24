<script setup lang="ts">
import { computed } from 'vue'
import CodeBlock from './CodeBlock.vue'
import HtmlRenderer from './HtmlRenderer.vue'
import JsonRenderer from './JsonRenderer.vue'
import MediaRenderer from './MediaRenderer.vue'
import XmlRenderer from './XmlRenderer.vue'
import type { ContentKind } from '../../utils/content'
import { detectContentKind, prettyJson } from '../../utils/content'

const props = defineProps<{
  content: string
  contentType?: string
  bodyBase64?: string
  size?: number
  kind?: ContentKind | 'auto'
  query?: string
  activeIndex?: number
}>()

const emit = defineEmits<{
  download: []
}>()

const resolvedKind = computed(() => {
  if (props.kind && props.kind !== 'auto') return props.kind
  return detectContentKind(props.contentType || '', props.content, props.bodyBase64 || '')
})

const textContent = computed(() => (resolvedKind.value === 'json' ? prettyJson(props.content) : props.content))
</script>

<template>
  <JsonRenderer v-if="resolvedKind === 'json'" :content="content" :query="query" :active-index="activeIndex" />
  <XmlRenderer v-else-if="resolvedKind === 'xml'" :content="content" :query="query" :active-index="activeIndex" />
  <HtmlRenderer v-else-if="resolvedKind === 'html'" :content="content" :query="query" :active-index="activeIndex" />
  <MediaRenderer
    v-else-if="resolvedKind === 'image' || resolvedKind === 'binary'"
    :content-type="contentType || ''"
    :size="size || 0"
    :body-base64="bodyBase64 || ''"
    :image="resolvedKind === 'image'"
    @download="emit('download')"
  />
  <CodeBlock v-else :content="textContent" kind="text" :query="query" :active-index="activeIndex" />
</template>

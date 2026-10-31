<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { normalizeContentUrl, openExternalUrl, renderRichContent } from '../v2ex/rich-content'

const props = defineProps<{
  contentRendered?: string
  content?: string
  emptyText: string
}>()

const html = computed(() => {
  const sanitized = renderRichContent(props.contentRendered)
  return sanitized || props.content || ''
})
const contentElement = ref<HTMLElement | null>(null)

function applyImageLayout() {
  const images = [...(contentElement.value?.querySelectorAll<HTMLImageElement>('img') ?? [])]
  for (const image of images) {
    const small = image.naturalWidth > 0 && Math.max(image.naturalWidth, image.naturalHeight) <= 64
    const anchor = image.closest('a')
    const adjacentText = Boolean(anchor?.nextSibling?.textContent?.trim() || anchor?.previousSibling?.textContent?.trim())
    image.classList.toggle('rich-content-emoji', small && (images.length > 1 || adjacentText))
  }
}

function attachImageLayout() {
  const images = [...(contentElement.value?.querySelectorAll<HTMLImageElement>('img') ?? [])]
  for (const image of images) {
    if (image.complete) applyImageLayout()
    else image.addEventListener('load', applyImageLayout, { once: true })
  }
}

onMounted(() => {
  attachImageLayout()
  applyImageLayout()
})

function followLink(event: MouseEvent) {
  const anchor = (event.target as Element).closest('a[href]')
  if (!anchor) return
  event.preventDefault()
  openExternalUrl(normalizeContentUrl(anchor.getAttribute('href') ?? ''))
}
</script>

<template>
  <div v-if="html" ref="contentElement" class="rich-content" @click="followLink" v-html="html"></div>
  <p v-else class="rich-content-text">{{ emptyText }}</p>
</template>

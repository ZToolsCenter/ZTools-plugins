<script setup lang="ts">
import { computed, ref } from 'vue'
import CodeBlock from './CodeBlock.vue'

const props = defineProps<{
  content: string
  query?: string
  activeIndex?: number
}>()

const mode = ref<'preview' | 'source'>('source')
const srcdoc = computed(() => sanitizeHtmlForPreview(props.content))

function sanitizeHtmlForPreview(value: string) {
  try {
    const parser = new DOMParser()
    const document = parser.parseFromString(value, 'text/html')
    document.querySelectorAll('script, link[rel="prefetch"], link[rel="preload"], link[rel="modulepreload"]').forEach((node) => node.remove())
    document.querySelectorAll('[src], [href]').forEach((node) => {
      const element = node as HTMLElement
      const src = element.getAttribute('src')
      const href = element.getAttribute('href')
      if (src && !isSafePreviewUrl(src)) element.removeAttribute('src')
      if (href && !isSafePreviewUrl(href)) element.removeAttribute('href')
    })
    return `<!doctype html>${document.documentElement.outerHTML}`
  } catch {
    return value.replace(/<script[\s\S]*?<\/script>/gi, '')
  }
}

function isSafePreviewUrl(value: string) {
  return /^(data:|blob:|#|\/(?!\/))/i.test(value)
}
</script>

<template>
  <div class="html-renderer">
    <div class="html-toolbar">
      <button :class="{ active: mode === 'preview' }" @click="mode = 'preview'">Preview</button>
      <button :class="{ active: mode === 'source' }" @click="mode = 'source'">Source</button>
    </div>
    <iframe v-if="mode === 'preview' && !query" sandbox="" :srcdoc="srcdoc"></iframe>
    <CodeBlock v-else :content="content" kind="html" :query="query" :active-index="activeIndex" />
  </div>
</template>

<style scoped>
.html-renderer {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  min-height: 100%;
  box-sizing: border-box;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
}

.html-toolbar {
  display: flex;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid #eef2f7;
}

.html-toolbar button {
  height: 26px;
  padding: 0 9px;
  border: 0;
  border-radius: 6px;
  color: #64748b;
  background: transparent;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.html-toolbar button.active,
.html-toolbar button:hover {
  color: #4f46e5;
  background: #eef2ff;
}

iframe {
  width: 100%;
  height: 100%;
  border: 0;
  background: #fff;
}
</style>

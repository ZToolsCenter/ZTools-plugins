<script setup lang="ts">
import { computed } from 'vue'
import { XMarkdown } from 'vue-element-plus-x'
import { preprocessMarkdownLatex, restoreProtectedLatexCodePlugin } from '../utils/markdown'

const props = defineProps<{
  markdown: string
  isDark: boolean
}>()

const themes = {
  light: 'github-light',
  dark: 'github-dark-default'
}
const rehypePlugins = [restoreProtectedLatexCodePlugin]
const processedMarkdown = computed(() => preprocessMarkdownLatex(props.markdown))
</script>

<template>
  <div class="markdown-content">
    <XMarkdown
      :markdown="processedMarkdown"
      :is-dark="isDark"
      :enable-latex="true"
      :enable-breaks="true"
      :sanitize="false"
      :allow-html="false"
      :rehype-plugins="rehypePlugins"
      :default-theme-mode="isDark ? 'dark' : 'light'"
      :themes="themes"
    />
  </div>
</template>

<style scoped>
.markdown-content {
  width: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}
</style>

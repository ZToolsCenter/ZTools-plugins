<script setup lang="ts">
import 'highlight.js/styles/atom-one-dark.css'
import { toRef } from 'vue'
import type { PluginDetailReadme, PluginMarketUiPlugin } from '../../../types/pluginMarket'
import { usePluginReadme } from './usePluginReadme'

const props = defineProps<{
  plugin: PluginMarketUiPlugin
  remoteReadme?: PluginDetailReadme | null
}>()

const { readmeLoading, readmeError, renderedMarkdown, showAiGeneratedBadge } = usePluginReadme(
  toRef(props, 'plugin'),
  toRef(props, 'remoteReadme'),
)
</script>

<template>
  <div class="readme-panel">
    <div v-if="!readmeLoading && showAiGeneratedBadge" class="readme-meta">
      <span class="readme-meta-badge readme-meta-badge--ai">AI 生成</span>
    </div>
    <div v-if="readmeLoading" class="loading-container">
      <div class="spinner"></div>
      <span>加载中...</span>
    </div>
    <div v-else-if="readmeError" class="error-container">
      <span>{{ readmeError }}</span>
    </div>
    <div v-else-if="renderedMarkdown" class="markdown-content" v-html="renderedMarkdown"></div>
    <div v-else class="empty-message">该插件暂无详情说明</div>
  </div>
</template>

<style scoped>
.readme-panel {
  min-height: 200px;
}

.readme-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.readme-meta-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--surface-elevated);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.readme-meta-badge--ai {
  color: var(--purple-color);
  background: var(--purple-light-bg);
}

.loading-container,
.error-container,
.empty-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 200px;
  padding: 20px;
  text-align: center;
}

.error-container {
  color: var(--danger-color);
}

.empty-message {
  color: var(--text-secondary);
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid transparent;
  border-top-color: var(--primary-color);
  border-right-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

.markdown-content {
  color: var(--text-color);
  line-height: 1.7;
  word-break: break-word;
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4) {
  margin-top: 24px;
  margin-bottom: 12px;
  color: var(--text-color);
}

.markdown-content :deep(p) {
  margin: 12px 0;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 12px 0;
  padding-inline-start: 1.5em;
  list-style-position: outside;
}

.markdown-content :deep(li) {
  margin: 4px 0;
}

.markdown-content :deep(code:not(.hljs)) {
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--surface-elevated);
}

.markdown-content :deep(pre) {
  padding: 0;
  border-radius: 12px;
  overflow: auto;
  background: var(--surface-elevated);
}

.markdown-content :deep(img) {
  max-width: 100%;
  height: auto;
}

.markdown-content :deep(table) {
  width: 100%;
  margin: 12px 0;
  border-collapse: collapse;
  border: 1px solid var(--divider-color);
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  padding: 8px 12px;
  border: 1px solid var(--divider-color);
  text-align: left;
  vertical-align: top;
}

.markdown-content :deep(th) {
  background: var(--surface-elevated);
  font-weight: 600;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

<script setup lang="ts">
import { CommandTag, FeatureCard } from '@/components'
import type { DocItem, PluginDocContent, PluginItem, TabId, TabItem } from './types'
import { cmdKey, formatDate, formatJsonData, normalizeCommand } from './utils'

defineProps<{
  plugin: PluginItem
  activeTab: TabId
  availableTabs: TabItem[]
  readmeLoading: boolean
  readmeError: string
  renderedMarkdown: string
  readmeContent: string
  docKeys: DocItem[]
  dataLoading: boolean
  dataError: string
  expandedDataId: string
  currentDocContent: PluginDocContent
  currentDocType: 'document' | 'attachment'
  isClearing: boolean
}>()

const emit = defineEmits<{
  (e: 'switch-tab', tabId: TabId): void
  (e: 'toggle-data-detail', item: DocItem): void
  (e: 'clear-all-data'): void
}>()
</script>

<template>
  <div class="tab-container">
    <div class="tab-header">
      <button
        v-for="tab in availableTabs"
        :key="tab.id"
        class="tab-button"
        :class="{ active: activeTab === tab.id }"
        @click="emit('switch-tab', tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="tab-content">
      <div v-if="activeTab === 'detail'" class="tab-panel">
        <div v-if="readmeLoading" class="loading-container">
          <div class="spinner"></div>
          <span>加载中...</span>
        </div>
        <div v-else-if="readmeError" class="error-container">
          <span>{{ readmeError }}</span>
        </div>
        <div v-else-if="readmeContent" class="markdown-content" v-html="renderedMarkdown"></div>
        <div v-else class="empty-message">该插件暂无详情说明</div>
      </div>

      <div v-if="activeTab === 'commands'" class="tab-panel">
        <div v-if="plugin.features && plugin.features.length > 0" class="feature-list">
          <FeatureCard v-for="feature in plugin.features" :key="feature.code" :feature="feature">
            <CommandTag
              v-for="cmd in feature.cmds"
              :key="cmdKey(cmd)"
              :command="normalizeCommand(cmd)"
            />
          </FeatureCard>
        </div>
        <div v-else class="empty-message">暂无指令</div>
      </div>

      <div v-if="activeTab === 'data'" class="tab-panel">
        <div v-if="dataLoading" class="loading-container">
          <div class="spinner"></div>
          <span>加载中...</span>
        </div>
        <div v-else-if="dataError" class="error-container">
          <span>{{ dataError }}</span>
        </div>
        <div v-else-if="docKeys.length > 0" class="data-container">
          <div class="data-header-actions">
            <button
              class="btn btn-sm btn-danger"
              :disabled="isClearing"
              @click="emit('clear-all-data')"
            >
              {{ isClearing ? '清除中...' : '清除全部数据' }}
            </button>
          </div>
          <div class="data-list">
            <div
              v-for="item in docKeys"
              :key="item.key"
              class="card data-item"
              :class="{ expanded: expandedDataId === item.key }"
              @click="emit('toggle-data-detail', item)"
            >
              <div class="data-header">
                <span class="data-key">{{ item.key }}</span>
                <div class="data-header-right">
                  <span class="doc-type-badge" :class="`type-${item.type}`">
                    {{ item.type === 'document' ? '文档' : '附件' }}
                  </span>
                  <svg
                    class="expand-icon"
                    :class="{ rotated: expandedDataId === item.key }"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M9 18L15 12L9 6"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </div>
              </div>
              <Transition name="expand">
                <div v-if="expandedDataId === item.key" class="data-content">
                  <div class="data-meta">
                    <div class="data-meta-item">
                      <span class="label">类型:</span>
                      <span class="value type-badge" :class="`type-${currentDocType}`">
                        {{ currentDocType === 'document' ? '文档' : '附件' }}
                      </span>
                    </div>
                    <div
                      v-if="
                        currentDocContent &&
                        typeof currentDocContent === 'object' &&
                        '_rev' in currentDocContent
                      "
                      class="data-meta-item"
                    >
                      <span class="label">版本:</span>
                      <span class="value">{{ currentDocContent._rev }}</span>
                    </div>
                    <div
                      v-if="
                        currentDocContent &&
                        typeof currentDocContent === 'object' &&
                        ('_updatedAt' in currentDocContent || 'updatedAt' in currentDocContent)
                      "
                      class="data-meta-item"
                    >
                      <span class="label">更新时间:</span>
                      <span class="value">{{
                        formatDate(
                          String(currentDocContent._updatedAt || currentDocContent.updatedAt || '')
                        )
                      }}</span>
                    </div>
                  </div>
                  <div class="data-json">
                    <pre>{{ formatJsonData(currentDocContent) }}</pre>
                  </div>
                </div>
              </Transition>
            </div>
          </div>
        </div>
        <div v-else class="empty-message">该插件暂无存储数据</div>
      </div>

      <slot name="extra-tabs" />
    </div>
  </div>
</template>

<style scoped>
.tab-container {
  margin-top: 20px;
  margin-left: 10px;
  margin-right: 10px;
}

.tab-header {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--divider-color);
  margin-bottom: 16px;
}

.tab-button {
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  bottom: -1px;
}

.tab-button:hover {
  color: var(--text-color);
  background: var(--hover-bg);
}

.tab-button.active {
  color: var(--primary-color);
  border-bottom-color: var(--primary-color);
}

.tab-content {
  min-height: 200px;
}

.tab-panel {
  animation: fadeIn 0.2s;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.loading-container,
.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  gap: 12px;
  color: var(--text-secondary);
}

.error-container {
  color: var(--error-color);
}

.empty-message {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-secondary);
  font-size: 14px;
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid transparent;
  border-top-color: currentColor;
  border-right-color: currentColor;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.markdown-content {
  padding: 12px;
  font-size: 14px;
  line-height: 1.6;
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3) {
  margin-top: 1em;
  margin-bottom: 0.5em;
  font-weight: 600;
}

.markdown-content :deep(h1) {
  font-size: 1.8em;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 0.3em;
}

.markdown-content :deep(h2) {
  font-size: 1.5em;
}

.markdown-content :deep(h3) {
  font-size: 1.2em;
}

.markdown-content :deep(p) {
  margin: 0.8em 0;
}

.markdown-content :deep(a) {
  color: var(--primary-color);
}

.markdown-content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  margin: 1em 0;
}

.markdown-content :deep(code) {
  padding: 2px 6px;
  background: var(--card-bg);
  border-radius: 4px;
  font-family: monospace;
  font-size: 0.9em;
}

.markdown-content :deep(pre) {
  padding: 12px;
  background: var(--card-bg);
  border-radius: 6px;
  overflow-x: auto;
  margin: 1em 0;
}

.markdown-content :deep(pre code) {
  padding: 0;
  background: transparent;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  padding-left: 1.5em;
  margin: 0.8em 0;
}

.markdown-content :deep(blockquote) {
  margin: 1em 0;
  padding: 0.5em 1em;
  border-left: 3px solid var(--primary-color);
  background: var(--card-bg);
  color: var(--text-secondary);
}

.markdown-content :deep(table) {
  border-collapse: collapse;
  margin: 1em 0;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  padding: 8px 12px;
  border: 1px solid var(--border-color);
}

.markdown-content :deep(th) {
  background: var(--card-bg);
  font-weight: 600;
}

.feature-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.data-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.data-header-actions {
  display: flex;
  justify-content: flex-end;
}
</style>

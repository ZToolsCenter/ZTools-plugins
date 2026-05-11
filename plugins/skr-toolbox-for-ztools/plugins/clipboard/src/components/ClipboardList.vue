<script setup>
import TextItem from './items/TextItem.vue'
import ImageItem from './items/ImageItem.vue'
import FileItem from './items/FileItem.vue'

defineProps({
  items: { type: Array, required: true },
  loading: { type: Boolean, default: false },
  loadingMore: { type: Boolean, default: false },
  hasMore: { type: Boolean, default: true },
  selectedIndex: { type: Number, default: 0 },
  activeTab: { type: String, required: true },
  expandedItems: { type: Set, default: () => new Set() },
  needsExpand: { type: Object, default: () => ({}) }
})

const emit = defineEmits([
  'select',
  'dblclick',
  'contextmenu',
  'scroll',
  'toggle-expand',
  'delete-favorite'
])

</script>

<template>
  <div class="clipboard-list" @scroll="emit('scroll', $event)">
    <!-- 空状态 -->
    <div v-if="!loading && items.length === 0" class="empty-state">
      <div class="empty-icon">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
            stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1"
            stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <line x1="9" y1="12" x2="15" y2="12"
            stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="9" y1="16" x2="13" y2="16"
            stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="empty-text">暂无剪贴板记录</div>
    </div>

    <!-- 列表项 -->
    <div
      v-for="(item, index) in items"
      :key="item.id || index"
      class="clipboard-item"
      :class="{ selected: selectedIndex === index }"
      @click="emit('select', index)"
      @dblclick="emit('dblclick', item.id)"
      @contextmenu="emit('contextmenu', $event, item)"
    >
      <TextItem
        v-if="item.type === 'text'"
        :item="item"
        :is-expanded="expandedItems.has(item.id)"
        :needs-expand="!!needsExpand[item.id]"
        :is-favorite-tab="activeTab === 'favorite'"
        @toggle-expand="emit('toggle-expand', item.id)"
        @delete-favorite="emit('delete-favorite', index)"
      />
      <ImageItem
        v-else-if="item.type === 'image'"
        :item="item"
        :is-favorite-tab="activeTab === 'favorite'"
        @delete-favorite="emit('delete-favorite', index)"
      />
      <FileItem
        v-else-if="item.type === 'file'"
        :item="item"
        :is-expanded="expandedItems.has(item.id)"
        @toggle-expand="emit('toggle-expand', item.id)"
      />
    </div>

    <!-- 加载更多状态 -->
    <div v-if="loadingMore" class="loading-more">
      <div class="loading-more-spinner"></div>
      <span class="loading-more-text">加载更多...</span>
    </div>
  </div>
</template>

<style scoped>
.clipboard-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 3px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  background: var(--bg-surface);
}

.empty-icon {
  width: 48px;
  height: 48px;
  color: var(--text-tertiary);
  opacity: 0.3;
  margin-bottom: 16px;
}

.empty-icon svg {
  width: 100%;
  height: 100%;
}

.empty-text {
  color: var(--text-tertiary);
  font-size: 14px;
}

.clipboard-item {
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
}

.clipboard-item:hover {
  background: var(--bg-hover);
}

@media (prefers-color-scheme: dark) {
  .clipboard-item:hover {
    background: rgba(72, 72, 72, 0.72);
  }
}

.clipboard-item.selected {
  border: 2px solid var(--primary-color);
  border-radius: 5px;
}

.loading-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 20px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-color);
}

.loading-more-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--spinner-bg);
  border-top: 2px solid var(--primary-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.loading-more-text {
  color: var(--text-secondary);
  font-size: 14px;
}
</style>

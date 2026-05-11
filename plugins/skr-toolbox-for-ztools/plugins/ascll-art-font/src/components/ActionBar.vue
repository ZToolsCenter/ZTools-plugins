<script lang="ts" setup>
defineProps<{
  isFavorited: boolean
}>()

const emit = defineEmits<{
  toggleFavorite: []
  prevFont: []
  nextFont: []
  copy: []
}>()
</script>

<template>
  <div class="action-bar">
    <button
      class="action-btn"
      :class="{ favorited: isFavorited }"
      title="收藏字体"
      @click="emit('toggleFavorite')"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" :fill="isFavorited ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>
    </button>
    <button class="action-btn" title="上一个字体" @click="emit('prevFont')">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
    </button>
    <button class="action-btn" title="下一个字体" @click="emit('nextFont')">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </button>
    <button class="action-btn" title="复制到剪贴板" @click="emit('copy')">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
    </button>
  </div>
</template>

<style scoped>
.action-bar {
  display: flex;
  gap: 4px;
  align-items: center;
}

.action-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1.5px solid #d0d5dd;
  color: #555;
  cursor: pointer;
  transition: all 0.15s;
  padding: 0;
  line-height: 1;
}

.action-btn:hover {
  background: #f0f0f0;
  border-color: #999;
  color: #333;
}

.action-btn:active {
  opacity: 0.6;
}

.action-btn.favorited {
  color: #f59e0b;
  border-color: #f59e0b;
}

@media (prefers-color-scheme: dark) {
  .action-btn {
    border-color: #555;
    color: #aaa;
  }
  .action-btn:hover {
    background: #4a4a4a;
    border-color: #888;
    color: #ddd;
  }
  .action-btn.favorited {
    color: #f59e0b;
    border-color: #f59e0b;
  }
}
</style>

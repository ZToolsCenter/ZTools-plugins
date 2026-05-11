<script setup>
import { getFileIconType } from '@/utils/fileIcon'

defineProps({
  item: { type: Object, required: true },
  isExpanded: { type: Boolean, default: false }
})

const emit = defineEmits(['toggle-expand'])
</script>

<template>
  <div class="item-content">
    <div class="file-list" :class="{ collapsed: !isExpanded }">
      <div
        v-for="(file, idx) in item.files"
        :key="idx"
        class="file-item"
        :class="{
          hidden: !isExpanded && idx >= 5,
          'file-not-exists': !file.exists
        }"
      >
        <span class="file-icon" :class="'icon-' + getFileIconType(file)">
          <!-- 文件夹 -->
          <svg v-if="getFileIconType(file) === 'folder'" viewBox="0 0 24 24" fill="none">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
              stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <!-- PDF -->
          <svg v-else-if="getFileIconType(file) === 'pdf'" viewBox="0 0 24 24" fill="none">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
              stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M14 2v6h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <text x="7" y="17" font-size="6" font-weight="700" fill="currentColor" font-family="sans-serif">PDF</text>
          </svg>
          <!-- 文档 -->
          <svg v-else-if="getFileIconType(file) === 'doc'" viewBox="0 0 24 24" fill="none">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
              stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"
              stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <!-- 表格 -->
          <svg v-else-if="getFileIconType(file) === 'sheet'" viewBox="0 0 24 24" fill="none">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
              stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M14 2v6h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <rect x="7" y="12" width="10" height="7" rx="1" stroke="currentColor" stroke-width="1.5"/>
            <line x1="7" y1="15.5" x2="17" y2="15.5" stroke="currentColor" stroke-width="1"/>
            <line x1="12" y1="12" x2="12" y2="19" stroke="currentColor" stroke-width="1"/>
          </svg>
          <!-- 压缩包 -->
          <svg v-else-if="getFileIconType(file) === 'archive'" viewBox="0 0 24 24" fill="none">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
              stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M14 2v6h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M10 10h1M13 10h1M10 12.5h1M13 12.5h1M10 15h1M13 15h1"
              stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <rect x="10" y="17" width="4" height="2.5" rx="0.5" stroke="currentColor" stroke-width="1"/>
          </svg>
          <!-- 图片 -->
          <svg v-else-if="getFileIconType(file) === 'image'" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="18" height="18" rx="2"
              stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" stroke-width="1.5"/>
            <path d="M21 15l-5-5L5 21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <!-- 视频 -->
          <svg v-else-if="getFileIconType(file) === 'video'" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="4" width="15" height="16" rx="2"
              stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M17 8l5-3v14l-5-3V8z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <!-- 音频 -->
          <svg v-else-if="getFileIconType(file) === 'audio'" viewBox="0 0 24 24" fill="none">
            <path d="M9 18V5l12-2v13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="1.5"/>
            <circle cx="18" cy="16" r="3" stroke="currentColor" stroke-width="1.5"/>
          </svg>
          <!-- 默认文件 -->
          <svg v-else viewBox="0 0 24 24" fill="none">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
              stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M14 2v6h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        <span class="file-name">{{ file.name }}</span>
        <span v-if="!file.exists" class="file-status">已删除</span>
      </div>
    </div>

    <div class="item-meta">
      <span class="meta-time">{{ item.time }}</span>
      <span v-if="item.appName" class="meta-app">{{ item.appName }}</span>
      <button
        v-if="item.files && item.files.length > 5"
        class="expand-btn"
        @click.stop="emit('toggle-expand')"
      >
        <span class="expand-icon">{{ isExpanded ? '▲' : '▼' }}</span>
        <span>{{ isExpanded ? '收起' : '展开' }}</span>
      </button>
      <span class="meta-count">{{ item.preview || `${item.fileCount} 个项目` }}</span>
    </div>
  </div>
</template>

<style scoped>
.item-content {
  padding: 5px 10px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  color: var(--text-primary);
  font-size: 14px;
}

.file-item.hidden {
  display: none;
}

.file-item.file-not-exists {
  opacity: 0.5;
}

.file-item.file-not-exists .file-name {
  text-decoration: line-through;
  color: var(--text-tertiary);
}

.file-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
}

.file-icon svg {
  width: 100%;
  height: 100%;
}

.file-icon.icon-folder { color: #f0a030; }
.file-icon.icon-pdf { color: #e74c3c; }
.file-icon.icon-doc { color: #3498db; }
.file-icon.icon-sheet { color: #27ae60; }
.file-icon.icon-archive { color: #8e44ad; }
.file-icon.icon-image { color: #e67e22; }
.file-icon.icon-video { color: #e74c3c; }
.file-icon.icon-audio { color: #1abc9c; }

.file-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-status {
  font-size: 11px;
  color: var(--text-danger);
  background: var(--bg-danger-light);
  padding: 2px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}

.item-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text-tertiary);
  font-size: 12px;
  position: relative;
}

.meta-time {
  flex: 1;
}

.meta-app {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  background: var(--bg-accent-light);
  color: var(--primary-color);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}

.expand-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--primary-color);
  cursor: pointer;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background 0.2s;
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
}

.expand-btn:hover {
  background: var(--bg-accent-light);
}

.expand-icon {
  font-size: 10px;
}

.meta-count {
  color: var(--text-secondary);
}
</style>

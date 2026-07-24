<script setup>
defineProps({
  item: { type: Object, required: true },
  isExpanded: { type: Boolean, default: false },
  needsExpand: { type: Boolean, default: false },
  isFavoriteTab: { type: Boolean, default: false }
})

const emit = defineEmits(['toggle-expand', 'delete-favorite'])
</script>

<template>
  <div class="item-content">
    <div
      class="content-text"
      :data-text-id="item.id"
      :class="{
        'text-collapsed': !isExpanded,
        'text-expanded': isExpanded
      }"
    >
      {{ item.content }}
    </div>
    <div class="item-meta">
      <span class="meta-time">{{ item.time }}</span>
      <span v-if="item.remark" class="meta-remark" :title="item.remark">{{ item.remark }}</span>
      <span v-if="item.appName" class="meta-app">{{ item.appName }}</span>
      <button
        v-if="needsExpand"
        class="expand-btn"
        @click.stop="emit('toggle-expand')"
      >
        <span class="expand-icon">{{ isExpanded ? '▲' : '▼' }}</span>
        <span>{{ isExpanded ? '收起' : '展开' }}</span>
      </button>
      <button
        v-if="isFavoriteTab"
        class="delete-btn"
        @click.stop="emit('delete-favorite')"
        title="删除收藏"
      >
        ✕
      </button>
      <span class="meta-count">{{ item.charCount }} 字符</span>
    </div>
  </div>
</template>

<style scoped>
.item-content {
  padding: 5px 10px;
}

.content-text {
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.4;
  word-break: break-all;
  white-space: pre-wrap;
}

.text-collapsed {
  max-height: 120px;
  overflow: hidden;
  position: relative;
}

.text-expanded {
  max-height: none;
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

.meta-remark {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  max-width: 240px;
  padding: 2px 8px;
  background: var(--bg-warning-light);
  color: var(--text-warning);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s;
  font-size: 16px;
  margin-left: auto;
}

.delete-btn:hover {
  color: var(--text-danger);
  background: var(--bg-danger-light);
}

.meta-count {
  color: var(--text-secondary);
}
</style>

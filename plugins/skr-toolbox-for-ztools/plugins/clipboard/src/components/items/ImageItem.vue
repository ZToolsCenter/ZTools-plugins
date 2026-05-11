<script setup>
defineProps({
  item: { type: Object, required: true },
  isFavoriteTab: { type: Boolean, default: false }
})

const emit = defineEmits(['delete-favorite'])
</script>

<template>
  <div class="item-content">
    <div class="image-preview">
      <img :src="item.content" :alt="`图片 ${item.id}`" />
    </div>
    <div class="item-meta">
      <span class="meta-time">{{ item.time }}</span>
      <span v-if="item.remark" class="meta-remark" :title="item.remark">{{ item.remark }}</span>
      <span v-if="item.appName" class="meta-app">{{ item.appName }}</span>
      <button
        v-if="isFavoriteTab"
        class="delete-btn"
        @click.stop="emit('delete-favorite')"
        title="删除收藏"
      >
        ✕
      </button>
      <span class="meta-count">{{ item.size }}</span>
    </div>
  </div>
</template>

<style scoped>
.item-content {
  padding: 5px 10px;
}

.image-preview {
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-app);
}

.image-preview img {
  width: 100%;
  max-height: 160px;
  object-fit: contain;
  display: block;
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

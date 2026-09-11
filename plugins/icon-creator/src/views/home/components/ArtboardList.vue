<template>
  <div class="artboard-list">
    <div class="artboard-list-header">
      <span class="artboard-list-title">画板</span>
      <button class="btn-icon btn-add-artboard" @click="$emit('add-artboard')" title="新建画板">
        <Icon icon="mdi:plus" />
      </button>
    </div>
    <div class="artboard-items">
      <div
        v-for="artboard in artboards"
        :key="artboard.id"
        class="artboard-item"
        :class="{ active: artboard.id === activeArtboardId }"
        @click="$emit('switch-artboard', artboard.id)"
      >
        <div class="artboard-thumbnail">
          <img v-if="artboard.thumbnail" :src="artboard.thumbnail" alt="" />
          <div v-else class="artboard-thumbnail-empty">
            <Icon icon="mdi:image-outline" />
          </div>
        </div>
        <div class="artboard-info">
          <div class="artboard-name">{{ artboard.name }}</div>
          <div class="artboard-size">{{ artboard.canvas.width }} × {{ artboard.canvas.height }}</div>
        </div>
        <div class="artboard-actions">
          <button class="btn-icon-small" @click.stop="$emit('duplicate-artboard', artboard.id)" title="复制">
            <Icon icon="mdi:content-copy" />
          </button>
          <button class="btn-icon-small" @click.stop="$emit('rename-artboard', artboard.id)" title="重命名">
            <Icon icon="mdi:pencil" />
          </button>
          <button
            v-if="artboards.length > 1"
            class="btn-icon-small btn-delete"
            @click.stop="$emit('delete-artboard', artboard.id)"
            title="删除"
          >
            <Icon icon="mdi:trash-can-outline" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { IconCreatorProjectArtboard } from '../types'

defineProps<{
  artboards: IconCreatorProjectArtboard[]
  activeArtboardId: string
}>()

defineEmits<{
  'add-artboard': []
  'switch-artboard': [id: string]
  'duplicate-artboard': [id: string]
  'rename-artboard': [id: string]
  'delete-artboard': [id: string]
}>()
</script>

<style scoped>
.artboard-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-1);
  border-right: 1px solid var(--color-border);
}

.artboard-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-bottom: 1px solid var(--color-border);
}

.artboard-list-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-1);
}

.btn-add-artboard {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--color-text-2);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.15s;

  :deep(svg) {
    width: 16px;
    height: 16px;
  }
}

.btn-add-artboard:hover {
  background: var(--color-fill-2);
  color: var(--color-text-1);
}

.artboard-items {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.artboard-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
  margin-bottom: 4px;
}

.artboard-item:hover {
  background: var(--color-fill-2);
}

.artboard-item.active {
  background: var(--color-primary-light-1);
}

.artboard-thumbnail {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  border-radius: 4px;
  overflow: hidden;
  background: var(--color-fill-2);
  border: 1px solid var(--color-border);
}

.artboard-thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.artboard-thumbnail-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-3);

  :deep(svg) {
    width: 20px;
    height: 20px;
  }
}

.artboard-info {
  flex: 1;
  min-width: 0;
}

.artboard-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.artboard-size {
  font-size: 11px;
  color: var(--color-text-3);
  margin-top: 2px;
}

.artboard-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;
}

.artboard-item:hover .artboard-actions {
  opacity: 1;
}

.btn-icon-small {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--color-text-3);
  cursor: pointer;
  border-radius: 3px;
  transition: all 0.15s;

  :deep(svg) {
    width: 14px;
    height: 14px;
  }
}

.btn-icon-small:hover {
  background: var(--color-fill-3);
  color: var(--color-text-1);
}

.btn-icon-small.btn-delete:hover {
  background: var(--color-danger-light-1);
  color: var(--color-danger);
}
</style>

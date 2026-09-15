<template>
  <div
    class="job-item"
    :class="{ 'is-keyboard-selected': props.isSelected }"
    :data-job-path="job.fullName || job.name"
  >
    <div class="job-info" @click="handleClick">
      <span
        v-if="isFolder"
        class="folder-arrow"
        :class="{ expanded: isExpanded }"
        @click.stop="handleToggleExpand"
      ></span>
      <span class="job-name" :title="displayName">{{ displayName }}</span>
    </div>

    <div v-if="!isFolder" class="job-actions">
      <button
        class="action-btn favorite-btn"
        :class="{ active: favorited }"
        @click.stop="emit('toggle-favorite', job)"
        :title="favorited ? '取消收藏' : '添加收藏'"
      >
        <span class="star-icon"></span>
      </button>
      <button
        class="action-btn build-btn"
        @click.stop="emit('build', job)"
        title="触发构建"
      >
        <span class="play-icon"></span>
      </button>
    </div>

    <!-- 子 Jobs（Folder 展开） -->
    <div v-if="isFolder && job.jobs && job.jobs.length > 0 && isExpanded" class="job-children">
      <JobItem
        v-for="child in job.jobs"
        :key="child.url"
        :job="child"
        :favorited="false"
        :show-full-name="showFullName"
        :expanded="props.expandedMap?.has(child.fullName || child.name) ?? false"
        :expanded-map="props.expandedMap"
        :selected-path="props.selectedPath"
        @toggle-favorite="emit('toggle-favorite', $event)"
        @build="emit('build', $event)"
        @click="emit('click', $event)"
        @toggle-expand="emit('toggle-expand', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { JobInfo } from '../types'

const props = defineProps<{
  job: JobInfo
  favorited: boolean
  showFullName?: boolean
  expanded?: boolean
  expandedMap?: Set<string>
  selectedPath?: string | null
  isSelected?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-favorite', job: JobInfo): void
  (e: 'build', job: JobInfo): void
  (e: 'click', job: JobInfo): void
  (e: 'toggle-expand', job: JobInfo): void
}>()

const displayName = computed(() => {
  return props.showFullName ? (props.job.fullName || props.job.name) : props.job.name
})

/**
 * 是否为 Folder
 */
const isFolder = computed(() => {
  return Array.isArray(props.job.jobs) || /(?:Folder|MultiBranchProject)$/.test(props.job._class || '')
})

const isExpanded = computed(() => {
  if (props.expandedMap) {
    return props.expandedMap.has(props.job.fullName || props.job.name)
  }
  return !!props.expanded
})

const handleClick = () => {
  if (isFolder.value) {
    emit('toggle-expand', props.job)
    return
  }
  emit('click', props.job)
}

const handleToggleExpand = () => {
  emit('toggle-expand', props.job)
}
</script>

<style scoped>
.job-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  padding: 5px 12px;
  margin-bottom: 2px;
  background: var(--bg-color, #fff);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s, box-shadow 0.15s;
}

.job-item:hover {
  background: var(--bg-hover, #f5f5f5);
}

.job-item.is-keyboard-selected {
  background: var(--primary-bg, rgba(0, 120, 212, 0.15));
  box-shadow: inset 2px 0 0 var(--primary-color, #0078d4);
}

.job-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}

.folder-arrow {
  width: 0;
  height: 0;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 5px solid var(--text-secondary, #888);
  transition: transform 0.15s;
  flex-shrink: 0;
  cursor: pointer;
}

.folder-arrow.expanded {
  transform: rotate(90deg);
}

.job-name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.job-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.job-item:hover .job-actions,
.job-item.is-keyboard-selected .job-actions {
  opacity: 1;
}

.action-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  transition: background 0.2s;
}

.action-btn:hover {
  background: var(--bg-secondary, #f0f0f0);
}

.favorite-btn.active {
  color: #faad14;
}

.build-btn {
  color: var(--primary-color, #0078d4);
}

.star-icon {
  display: inline-block;
  width: 12px;
  height: 12px;
  background: var(--text-secondary, #888);
  clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
}

.favorite-btn.active .star-icon {
  background: #faad14;
}

.play-icon {
  display: inline-block;
  width: 0;
  height: 0;
  border-left: 8px solid var(--primary-color, #0078d4);
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  margin-left: 2px;
}

.job-children {
  flex-basis: 100%;
  width: 100%;
  margin-left: 10px;
  margin-top: 2px;
}
</style>
<script setup lang="ts">
import type { GroupId } from '../todo/types'

defineProps<{
  active: GroupId
  counts: Record<GroupId, number>
}>()

const emit = defineEmits<{
  select: [group: GroupId]
  openSettings: []
}>()

const groups: { id: GroupId; label: string }[] = [
  { id: 'pending', label: '待处理' },
  { id: 'done', label: '已完成' },
]
</script>

<template>
  <aside class="sidebar">
    <nav class="group-list" aria-label="待办分组">
      <button
        v-for="group in groups"
        :key="group.id"
        type="button"
        class="group-item"
        :class="{ active: active === group.id }"
        :aria-current="active === group.id ? 'page' : undefined"
        :title="group.label"
        @click="emit('select', group.id)"
      >
        <svg
          v-if="group.id === 'pending'"
          class="group-icon"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <circle cx="4.6" cy="5.6" r="1.1" fill="currentColor" stroke="none" />
          <circle cx="4.6" cy="10" r="1.1" fill="currentColor" stroke="none" />
          <circle cx="4.6" cy="14.4" r="1.1" fill="currentColor" stroke="none" />
          <path d="M8.4 5.6h7.2M8.4 10h7.2M8.4 14.4h7.2" />
        </svg>
        <svg
          v-else
          class="group-icon"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M3.1 5.4 4.5 6.8 7.2 4.1" />
          <path d="M3.1 13.4l1.4 1.4 2.7-2.7" />
          <path d="M10.4 5.6h6.4M10.4 13.6h6.4" />
        </svg>
        <span class="group-label">{{ group.label }}</span>
        <span class="group-count" :data-count="group.id">{{ counts[group.id] }}</span>
      </button>
    </nav>

    <div class="sidebar-footer">
      <button
        type="button"
        class="settings-button"
        title="设置 (?)"
        aria-label="打开设置"
        @click="emit('openSettings')"
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <circle cx="10" cy="10" r="2.6" />
          <path
            d="M10 2.6l1.1 1.9 2.2-.3 .6 2.1 2 1-1 1.9 1 1.9-2 1-.6 2.1-2.2-.3L10 17.4l-1.1-1.9-2.2.3-.6-2.1-2-1 1-1.9-1-1.9 2-1 .6-2.1 2.2.3z"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 8px;
  min-height: 0;
  padding: 12px 10px;
  background: var(--plugin-sidebar, #f6f7f9);
}

.group-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.group-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--plugin-text, #1f2329);
  transition: background 0.15s ease, color 0.15s ease;
}

.group-item:hover {
  background: color-mix(in srgb, var(--plugin-accent, #2f6bff) 10%, transparent);
}

.group-item.active {
  background: var(--plugin-accent-soft, rgba(47, 107, 255, 0.14));
  color: var(--plugin-accent, #2f6bff);
  font-weight: 600;
}

.group-icon {
  flex: none;
  width: 17px;
  height: 17px;
}

.group-label {
  flex: 1;
  min-width: 0;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.group-count {
  flex: none;
  min-width: 18px;
  text-align: right;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--plugin-text-muted, #8a919f);
}

.group-item.active .group-count {
  color: var(--plugin-accent, #2f6bff);
}

.sidebar-footer {
  display: flex;
  justify-content: flex-end;
}

.settings-button {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  color: var(--plugin-text-muted, #8a919f);
  transition: background 0.15s ease, color 0.15s ease;
}

.settings-button:hover {
  background: color-mix(in srgb, var(--plugin-accent, #2f6bff) 12%, transparent);
  color: var(--plugin-accent, #2f6bff);
}

.settings-button svg {
  width: 17px;
  height: 17px;
}

@media (max-width: 720px) {
  .sidebar {
    align-items: center;
    padding: 10px 6px;
  }

  .group-item {
    flex-direction: column;
    gap: 2px;
    padding: 8px 4px;
  }

  .group-label {
    display: none;
  }

  .group-count {
    min-width: 0;
    text-align: center;
    font-size: 11px;
  }
}
</style>

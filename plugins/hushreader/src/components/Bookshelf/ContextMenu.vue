<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'

const props = defineProps<{ pos: { x: number; y: number }; isFinished?: boolean }>()
const emit = defineEmits<{
  'book-info': []
  'chapter-list': []
  'bookmark-list': []
  'search-jump': []
  'change-path': []
  'open-file-location': []
  'edit-metadata': []
  'reload-metadata': []
  'set-category': []
  'set-cover': []
  'restore-cover': []
  'mark-unfinished': []
  'delete': []
  'close': []
}>()

const menuRef = ref<HTMLElement | null>(null)
const style = ref({ top: `${props.pos.y}px`, left: `${props.pos.x}px` })

watch(
  () => props.pos,
  (newPos) => {
    style.value = { top: `${newPos.y}px`, left: `${newPos.x}px` }
    nextTick(() => {
      const el = menuRef.value
      if (!el) return
      const rect = el.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      let x = newPos.x
      let y = newPos.y
      if (x + rect.width > vw) x = vw - rect.width - 8
      if (y + rect.height > vh) y = vh - rect.height - 8
      style.value = { top: `${y}px`, left: `${x}px` }
    })
  },
  { immediate: true }
)
</script>

<template>
  <div class="ctx-backdrop" @click.self="emit('close')" @contextmenu.prevent>
    <ul ref="menuRef" class="ctx-menu" :style="style" @click.stop>
      <li class="ctx-item" @click="emit('book-info')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        书籍信息
      </li>
      <li class="ctx-item" @click="emit('chapter-list')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        章节列表
      </li>
      <li class="ctx-item" @click="emit('bookmark-list')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        书签列表
      </li>
      <li class="ctx-item" @click="emit('search-jump')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        搜索跳转
      </li>
      <li class="ctx-item" @click="emit('change-path')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        修改本地路径
      </li>
      <li class="ctx-item" @click="emit('open-file-location')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        打开文件位置
      </li>
      <li class="ctx-item" @click="emit('edit-metadata')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
        编辑元数据
      </li>
      <li class="ctx-item" @click="emit('reload-metadata')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        重载元数据
      </li>
      <li class="ctx-divider"></li>
      <li class="ctx-item" @click="emit('set-category')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
        设置分类
      </li>
      <li class="ctx-item" @click="emit('set-cover')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        设置封面
      </li>
      <li class="ctx-item" @click="emit('restore-cover')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
        恢复封面
      </li>
      <li class="ctx-divider"></li>
      <li v-if="isFinished" class="ctx-item" @click="emit('mark-unfinished')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
        标记为未读完
      </li>
      <li v-if="isFinished" class="ctx-divider"></li>
      <li class="ctx-item ctx-danger" @click="emit('delete')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        删除书籍
      </li>
    </ul>
  </div>
</template>

<style scoped>
.ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9000;
}

.ctx-menu {
  position: fixed;
  z-index: 9001;
  min-width: 170px;
  margin: 0;
  padding: 6px;
  background: var(--c-surface-overlay);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  list-style: none;
  animation: slide-up 0.12s var(--ease-out);
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--c-ink);
  border-radius: var(--radius-sm);
  user-select: none;
  transition: background 0.1s var(--ease-out);
}

.ctx-item:hover { background: var(--c-surface-sunken); }

.ctx-item svg {
  color: var(--c-ink-tertiary);
  flex-shrink: 0;
}

.ctx-item:hover svg {
  color: var(--c-ink-secondary);
}

.ctx-danger { color: var(--c-danger); }
.ctx-danger svg { color: var(--c-danger); }
.ctx-danger:hover { background: var(--c-danger-soft); }

.ctx-divider {
  height: 1px;
  background: var(--c-border);
  margin: 4px 6px;
}
</style>

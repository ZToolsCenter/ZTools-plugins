<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { PromptItem } from '../types'
import { usePromptStore } from '../stores/prompt'

defineProps<{
  items: PromptItem[]
  activeIndex: number
  selectedId?: string
  emptyTitle?: string
  emptyDesc?: string
}>()

const emit = defineEmits<{
  (e: 'select', index: number): void
  (e: 'activate'): void
  (e: 'enterWizard'): void
  (e: 'toggleFavorite', id: string): void
  (e: 'delete', id: string): void
  (e: 'edit', id: string): void
}>()

const prompt = usePromptStore()

// 右键菜单状态
const ctxMenu = ref<{ visible: boolean; x: number; y: number; item: PromptItem | null }>({
  visible: false, x: 0, y: 0, item: null,
})

function onContextMenu(e: MouseEvent, item: PromptItem) {
  e.preventDefault()
  ctxMenu.value = { visible: true, x: e.clientX, y: e.clientY, item }
}

function closeCtxMenu() {
  ctxMenu.value.visible = false
}

onMounted(() => {
  window.addEventListener('click', closeCtxMenu)
})

onUnmounted(() => {
  window.removeEventListener('click', closeCtxMenu)
})

function timeAgo(dateVal?: string | number): string {
  if (!dateVal) return ''
  const diff = Date.now() - new Date(dateVal).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  return `${days}天前`
}

function formatDate(ts?: number): string {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('zh-CN')
}

function toggleSort(field: 'createdAt' | 'updatedAt' | 'title' | 'usageCount') {
  if (prompt.sortBy.value === field) {
    prompt.sortDir.value = prompt.sortDir.value === 'desc' ? 'asc' : 'desc'
  } else {
    prompt.sortBy.value = field
    prompt.sortDir.value = field === 'title' ? 'asc' : 'desc'
  }
}

const sortLabel = computed(() => {
  const map: Record<string, string> = { createdAt: '创建时间', updatedAt: '更新时间', title: '名称', usageCount: '使用次数' }
  return map[prompt.sortBy.value] || '创建时间'
})
const sortIcon = computed(() => prompt.sortDir.value === 'desc' ? '↓' : '↑')
</script>

<template>
  <div class="list-wrap">
    <div v-if="items.length > 0" class="sort-bar">
      <span class="sort-label">排序</span>
      <button
        v-for="opt in [{v:'createdAt',l:'创建'},{v:'updatedAt',l:'更新'},{v:'title',l:'名称'},{v:'usageCount',l:'使用'}] as const"
        :key="opt.v"
        :class="['sort-btn', { active: prompt.sortBy.value === opt.v }]"
        @click="toggleSort(opt.v)"
      >{{ opt.l }}{{ prompt.sortBy.value === opt.v ? ' ' + sortIcon : '' }}</button>
    </div>
    <template v-if="items.length > 0">
      <div
        v-for="(item, index) in items"
        :key="item.id"
        :class="['card', { active: index === activeIndex }]"
        @click="emit('select', index); emit('activate')"
        @contextmenu="onContextMenu($event, item)"
      >
        <div class="card-left">
          <button :class="['dot', { fav: item.favorite }]" @click.stop="emit('toggleFavorite', item.id)">
            {{ item.favorite ? '★' : '☆' }}
          </button>
        </div>
        <div class="card-body">
          <div class="card-title">{{ item.title }}</div>
          <div class="card-meta">
            <span class="create-time">📅 {{ formatDate(item.createdAt) }}</span>
            <span v-for="tag in item.tags.slice(0, 3)" :key="tag" class="tag">#{{ tag }}</span>
            <span v-if="item.variables?.length" class="tag accent">{{ item.variables.length }} 变量</span>
            <span v-if="item.usageCount" class="usage">{{ item.usageCount }}次</span>
            <span v-if="item.lastUsedAt" class="time">{{ timeAgo(item.lastUsedAt) }}</span>
          </div>
        </div>
        <div class="card-right">
          <span class="ver">v{{ item.version || 1 }}</span>
        </div>
      </div>
    </template>

    <div v-else class="empty">
      <div class="empty-icon">
        <svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </div>
      <p class="empty-title">{{ emptyTitle || '没有找到提示词' }}</p>
      <p class="empty-desc">{{ emptyDesc || (prompt.query.value.trim() ? '试试其他关键词' : '点击右上角 + 创建第一个') }}</p>
      <button v-if="!prompt.query.value.trim() && !emptyDesc" class="btn primary" @click="emit('enterWizard')">
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        创建提示词
      </button>
    </div>

    <!-- 右键菜单 -->
    <teleport to="body">
      <div v-if="ctxMenu.visible" class="prompt-ctx-menu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }" @click.stop>
        <div class="prompt-ctx-item" @click="emit('edit', ctxMenu.item!.id); closeCtxMenu()">
          <span>✏️</span><span>编辑</span>
        </div>
        <div class="prompt-ctx-divider"></div>
        <div class="prompt-ctx-item danger" @click="emit('delete', ctxMenu.item!.id); closeCtxMenu()">
          <span>🗑</span><span>删除</span>
        </div>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
.list-wrap {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 12px 16px;
  display: flex; flex-direction: column; gap: 8px;
}
.sort-bar { display: flex; align-items: center; gap: 4px; padding-bottom: 4px; }
.sort-label { font-size: 11px; color: var(--pf-text-faint); font-weight: 600; margin-right: 4px; }
.sort-btn { border: 1px solid var(--pf-border); border-radius: var(--pf-radius-xs); background: var(--pf-surface); font-size: 11px; color: var(--pf-text-muted); padding: 3px 8px; cursor: pointer; transition: all 0.12s; }
.sort-btn:hover { border-color: var(--pf-accent); color: var(--pf-accent); }
.sort-btn.active { background: var(--pf-accent-soft); color: var(--pf-accent); border-color: var(--pf-accent); font-weight: 600; }
.create-time { font-size: 11px; color: var(--pf-text-faint); font-family: var(--pf-font-mono); }
.card {
  display: flex; align-items: center;
  gap: 14px; padding: 14px 16px;
  border-radius: var(--pf-radius-md);
  border: 1px solid var(--pf-border);
  background: var(--pf-surface);
  cursor: pointer;
  transition: all 0.15s ease;
}
.card:hover {
  border-color: var(--pf-border-hover);
  background: var(--pf-surface-hover);
  transform: translateY(-1px);
  box-shadow: var(--pf-shadow-sm);
}
.card.active {
  border-color: var(--pf-accent);
  background: var(--pf-accent-soft);
  box-shadow: 0 0 0 1px var(--pf-accent-soft);
}
.card-left { flex-shrink: 0; }
.dot {
  width: 20px; height: 20px; border-radius: 50%;
  background: none; border: none; cursor: pointer;
  font-size: 14px; color: var(--pf-text-faint);
  display: flex; align-items: center; justify-content: center;
  transition: color 0.15s;
}
.dot:hover { color: var(--pf-warning); }
.dot.fav { color: var(--pf-warning); }
.card-body { flex: 1; min-width: 0; }
.card-title {
  font-size: 14px; font-weight: 600;
  color: var(--pf-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  margin-bottom: 4px;
}
.card.active .card-title { color: var(--pf-accent); }
.card-meta {
  display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
}
.tag {
  font-size: 11px; font-weight: 500;
  padding: 2px 8px; border-radius: var(--pf-radius-pill);
  background: var(--pf-surface-raised);
  color: var(--pf-text-muted);
}
.tag.accent {
  background: var(--pf-accent-soft);
  color: var(--pf-accent);
  font-weight: 600;
}
.usage {
  font-size: 11px; font-weight: 600;
  color: var(--pf-accent);
  font-family: var(--pf-font-mono);
}
.time {
  font-size: 11px;
  color: var(--pf-text-faint);
  margin-left: auto;
}
.card-right { flex-shrink: 0; }
.ver {
  font-size: 11px; font-weight: 600;
  color: var(--pf-text-faint);
  font-family: var(--pf-font-mono);
  padding: 2px 8px;
  background: var(--pf-surface-raised);
  border-radius: var(--pf-radius-xs);
}

.empty {
  flex: 1; display: flex;
  flex-direction: column; align-items: center;
  justify-content: center; gap: 8px;
  padding: 40px 20px;
}
.empty-icon { color: var(--pf-text-faint); opacity: 0.5; }
.empty-title { font-size: 15px; font-weight: 600; color: var(--pf-text); margin: 0; }
.empty-desc { font-size: 13px; color: var(--pf-text-muted); margin: 0; }
.empty .btn { margin-top: 8px; }

/* 右键菜单 */
.prompt-ctx-menu {
  position: fixed; z-index: 9999;
  min-width: 140px; padding: 4px 0;
  background: var(--pf-surface-raised, #fff);
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-radius-md);
  box-shadow: var(--pf-shadow-lg, 0 8px 24px rgba(0,0,0,0.15));
  animation: ctxFadeIn 0.12s ease;
}
@keyframes ctxFadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
.prompt-ctx-item {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 14px; font-size: 13px; color: var(--pf-text);
  cursor: pointer; transition: background 0.1s;
}
.prompt-ctx-item:hover { background: var(--pf-surface-hover); }
.prompt-ctx-item.danger { color: var(--pf-danger, #ef4444); }
.prompt-ctx-item.danger:hover { background: rgba(239, 68, 68, 0.08); }
.prompt-ctx-divider { height: 1px; background: var(--pf-border); margin: 4px 0; }
</style>

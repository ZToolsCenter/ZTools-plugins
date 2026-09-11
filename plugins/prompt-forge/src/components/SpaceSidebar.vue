<script setup lang="ts">
import { computed } from 'vue'
import { List, Clock, Star, History, Folder, Package, BarChart3, Trash2 } from 'lucide-vue-next'
import { usePromptStore } from '../stores/prompt'

const prompt = usePromptStore()

const sideNav = computed(() => [
  { key: 'all' as const, label: '全部', icon: List },
  { key: 'recent' as const, label: '最近', icon: Clock },
  { key: 'favorite' as const, label: '收藏', icon: Star },
  { key: 'history' as const, label: '历史', icon: History },
  { key: 'project' as const, label: '项目', icon: Folder },
  { key: 'asset' as const, label: '资产', icon: Package },
  { key: 'stats' as const, label: '统计', icon: BarChart3 },
  { key: 'trash' as const, label: '回收站', icon: Trash2 },
])

function switchTab(key: typeof prompt.spaceTab.value) {
  prompt.spaceTab.value = key
  prompt.filterTag.value = ''
  prompt.filterProjectId.value = ''
  prompt.query.value = ''
  prompt.keyboardIndex.value = 0
  prompt.phase.value = 'search'
  prompt.selectedPrompt.value = null
}
</script>

<template>
  <aside class="space-sidebar">
    <div v-for="nav in sideNav" :key="nav.key"
      :class="['side-btn', { active: prompt.spaceTab.value === nav.key }]"
      @click="switchTab(nav.key)"
    >
      <span class="side-icon"><component :is="nav.icon" :size="16" /></span>
      <span class="side-label">{{ nav.label }}</span>
      <span v-if="nav.key === 'all'" class="side-count">{{ prompt.liveItems.value.length }}</span>
      <span v-if="nav.key === 'history'" class="side-count">{{ prompt.historyItems.value.length }}</span>
      <span v-if="nav.key === 'trash'" class="side-count">{{ prompt.trashItems.value.length }}</span>
    </div>
    <div v-if="prompt.spaceTab.value !== 'trash' && prompt.spaceTab.value !== 'history' && prompt.allTags.value.length" class="side-tags">
      <div class="side-tags-title">标签</div>
      <div
        v-for="tag in prompt.allTags.value.slice(0, 20)"
        :key="tag"
        :class="['side-tag', { active: prompt.filterTag.value === tag }]"
        @click="prompt.filterTag.value = prompt.filterTag.value === tag ? '' : tag"
      >
        <span class="side-tag-dot">#</span>
        <span class="side-tag-name">{{ tag }}</span>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.space-sidebar {
  width: 150px; flex-shrink: 0;
  background: var(--pf-bg-elevated);
  border-right: 1px solid var(--pf-border);
  display: flex; flex-direction: column;
  padding: 8px 0; overflow-y: auto;
}
.side-btn {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px; margin: 0 8px; border-radius: var(--pf-radius-sm);
  font-size: 13px; color: var(--pf-text-muted);
  cursor: pointer; transition: all 0.12s;
}
.side-btn:hover { background: var(--pf-surface-hover); color: var(--pf-text); }
.side-btn.active { background: var(--pf-accent-soft); color: var(--pf-accent); font-weight: 600; }
.side-icon { font-size: 15px; width: 20px; text-align: center; }
.side-label { flex: 1; }
.side-count { font-size: 11px; font-weight: 600; color: var(--pf-text-faint); font-family: var(--pf-font-mono); }
.side-tags { margin-top: 4px; padding: 0 8px; border-top: 1px solid var(--pf-border); }
.side-tags-title { font-size: 10px; font-weight: 700; color: var(--pf-text-faint); text-transform: uppercase; letter-spacing: 0.06em; padding: 10px 8px 4px; }
.side-tag { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: var(--pf-radius-sm); font-size: 12px; color: var(--pf-text-muted); cursor: pointer; transition: all 0.12s; }
.side-tag:hover { background: var(--pf-surface-hover); color: var(--pf-text); }
.side-tag.active { background: var(--pf-accent-soft); color: var(--pf-accent); font-weight: 600; }
.side-tag-dot { font-size: 11px; opacity: 0.5; }
.side-tag-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>

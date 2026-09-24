<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useOnlineStore } from '../../../stores/online'
import SourceManager from './SourceManager.vue'
import SyncPanel from './SyncPanel.vue'

const onlineStore = useOnlineStore()

const activePanel = ref<'sources' | 'sync'>('sources')

onMounted(() => {
  onlineStore.load()
})
</script>

<template>
  <div class="online-tab">
    <div class="sub-nav">
      <button class="sub-nav-item" :class="{ active: activePanel === 'sources' }" @click="activePanel = 'sources'">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        书源管理
      </button>
      <button class="sub-nav-item" :class="{ active: activePanel === 'sync' }" @click="activePanel = 'sync'">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <polyline points="21 3 21 9 15 9" />
        </svg>
        开源阅读同步
      </button>
    </div>

    <div v-show="activePanel === 'sources'" class="panel">
      <SourceManager />
    </div>
    <div v-show="activePanel === 'sync'" class="panel">
      <SyncPanel />
    </div>
  </div>
</template>

<style scoped>
.online-tab {
  display: flex;
  flex-direction: column;
}

.sub-nav {
  display: flex;
  gap: 4px;
  padding: 2px 0 10px;
  border-bottom: 1px solid var(--c-border);
  margin-bottom: 10px;
}

.sub-nav-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 600;
  color: var(--c-ink-secondary);
  background: transparent;
  transition: all 0.15s var(--ease-out);
}

.sub-nav-item:hover {
  background: var(--c-surface-sunken);
  color: var(--c-ink);
}

.sub-nav-item.active {
  background: var(--c-accent-soft);
  color: var(--c-accent);
}

.panel {
  display: flex;
  flex-direction: column;
  animation: panel-in 0.2s var(--ease-out);
}

@keyframes panel-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>

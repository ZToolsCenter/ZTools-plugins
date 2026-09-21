<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { ConnectionProfile } from './types'
import ClusterTab from './components/ClusterTab.vue'
import ConnTab from './components/ConnTab.vue'
import IndicesTab from './components/IndicesTab.vue'
import RestTab from './components/RestTab.vue'
import SearchTab from './components/SearchTab.vue'
import SearchableSelect from './components/SearchableSelect.vue'

type TabKey = 'conn' | 'cluster' | 'indices' | 'search' | 'rest'
type ThemeMode = 'dark' | 'light'

const THEME_KEY = 'esclient.theme'
const tabs: { key: TabKey; label: string }[] = [
  { key: 'conn', label: '连接' },
  { key: 'cluster', label: '集群' },
  { key: 'indices', label: '索引' },
  { key: 'search', label: '搜索' },
  { key: 'rest', label: 'REST' },
]

const activeTab = ref<TabKey>('conn')
const active = ref<ConnectionProfile | null>(null)
const connections = ref<ConnectionProfile[]>([])
const selectedId = ref('')
const ready = ref(false)
const bootError = ref('')
const theme = ref<ThemeMode>('dark')
const switching = ref(false)

const connOptions = computed(() =>
  connections.value.map((c) => ({
    value: c._id,
    label: `${c.name} · ${c.baseUrl}`,
  })),
)

function applyTheme(mode: ThemeMode) {
  theme.value = mode
  document.documentElement.setAttribute('data-theme', mode)
  document.documentElement.setAttribute('data-bs-theme', mode)
  try {
    localStorage.setItem(THEME_KEY, mode)
  } catch {
    // ignore
  }
}

function setTheme(mode: ThemeMode) {
  applyTheme(mode)
}

async function refreshConnections() {
  if (!window.services) return
  connections.value = await window.services.listConnections()
  active.value = await window.services.getActiveConnection()
  selectedId.value = active.value?._id ?? ''
}

async function switchConnection(id: string) {
  if (!id || id === active.value?._id) {
    selectedId.value = active.value?._id ?? ''
    return
  }
  switching.value = true
  try {
    await window.services.setActiveConnection(id)
    await refreshConnections()
  } catch (err) {
    bootError.value = err instanceof Error ? err.message : String(err)
    selectedId.value = active.value?._id ?? ''
  } finally {
    switching.value = false
  }
}

onMounted(async () => {
  let initial: ThemeMode = 'dark'
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') initial = saved
  } catch {
    // ignore
  }
  applyTheme(initial)
  try {
    window.ztools?.setExpendHeight?.(680)
  } catch {
    // host optional
  }
  try {
    window.ztools?.onPluginEnter?.(() => {
      activeTab.value = 'conn'
      void refreshConnections()
    })
  } catch {
    // optional
  }
  if (!window.services) {
    bootError.value =
      '未检测到 preload API（window.services）。请在 ZTools 中安装 src-ztools/ 目录后打开。'
    ready.value = true
    return
  }
  try {
    await refreshConnections()
  } catch (e) {
    bootError.value = e instanceof Error ? e.message : String(e)
  } finally {
    ready.value = true
  }
})
</script>

<template>
  <div class="shell">
    <header class="top">
      <div class="top-row">
        <div class="conn-switch">
          <label class="muted">当前连接</label>
          <SearchableSelect
            v-model="selectedId"
            :options="connOptions"
            :disabled="switching || !connections.length"
            width="100%"
            placeholder="搜索连接…"
            @update:model-value="switchConnection"
          />
        </div>
        <div class="btn-group btn-group-sm" role="group" aria-label="主题">
          <button
            type="button"
            class="btn"
            :class="theme === 'dark' ? 'btn-primary' : 'btn-secondary'"
            @click="setTheme('dark')"
          >
            深色
          </button>
          <button
            type="button"
            class="btn"
            :class="theme === 'light' ? 'btn-primary' : 'btn-secondary'"
            @click="setTheme('light')"
          >
            浅色
          </button>
        </div>
      </div>
      <nav class="tabs">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="tab"
          :class="{ active: activeTab === t.key }"
          type="button"
          @click="activeTab = t.key"
        >
          {{ t.label }}
        </button>
      </nav>
    </header>

    <main v-if="ready" class="main">
      <div v-if="bootError" class="err">{{ bootError }}</div>
      <template v-else>
        <ConnTab v-if="activeTab === 'conn'" @changed="refreshConnections" />
        <ClusterTab v-if="activeTab === 'cluster'" />
        <IndicesTab v-if="activeTab === 'indices'" />
        <KeepAlive>
          <SearchTab v-if="activeTab === 'search'" />
        </KeepAlive>
        <KeepAlive>
          <RestTab v-if="activeTab === 'rest'" />
        </KeepAlive>
      </template>
    </main>
  </div>
</template>

<style scoped>
.shell {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.top {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 14px 0;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.conn-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.conn-switch :deep(.combo) {
  flex: 1;
  max-width: 480px;
  min-width: 180px;
  width: 100% !important;
}
.btn-group {
  flex-shrink: 0;
}
.tabs {
  display: flex;
  gap: 2px;
  overflow-x: auto;
}
.tab {
  border: none;
  background: transparent;
  padding: 9px 12px;
  color: var(--muted);
  border-bottom: 2px solid transparent;
}
.tab:hover {
  color: var(--text);
}
.tab.active {
  color: var(--text);
  border-bottom-color: var(--accent);
  font-weight: 600;
}
.main {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 14px;
}
</style>

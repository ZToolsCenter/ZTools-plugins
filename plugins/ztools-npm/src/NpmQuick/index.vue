<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useTheme } from '../lib/useTheme'
import { parseSearch } from '../lib/search-parser'
import { buildInstallCommand } from '../lib/command-builder'
import type { NpmPackage } from '../lib/types'

const props = defineProps<{ enterAction: any }>()

useTheme()

const keyword = ref('')
const results = ref<NpmPackage[]>([])
const selectedIdx = ref(0)
const loading = ref(false)
const error = ref<any>(null)
const helpOpen = ref(false)

async function doSearch() {
  const q = keyword.value.trim()
  if (!q) return
  error.value = null
  loading.value = true
  try {
    const parsed = parseSearch(q)
    const r = await window.services.npmSearch(parsed)
    results.value = r.data
    selectedIdx.value = 0
  } catch (e: any) {
    error.value = e
    results.value = []
  } finally {
    loading.value = false
  }
}

async function copyCommand(manager: 'npm' | 'pnpm' | 'yarn') {
  const p = results.value[selectedIdx.value]
  if (!p) return
  const content = buildInstallCommand({ name: p.name, version: p.version }, manager)
  try {
    await window.ztools?.clipboard?.writeContent({ type: 'text', content, shouldPaste: true })
    window.ztools?.showNotification?.(`已复制：${content}`)
    window.ztools?.hideMainWindow?.()
  } catch {
    window.ztools?.showNotification?.('复制失败')
  }
}

function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    helpOpen.value = !helpOpen.value; e.preventDefault(); return
  }
  if (e.key === 'ArrowDown') { selectedIdx.value = Math.min(selectedIdx.value + 1, Math.max(results.value.length - 1, 0)); e.preventDefault() }
  else if (e.key === 'ArrowUp') { selectedIdx.value = Math.max(selectedIdx.value - 1, 0); e.preventDefault() }
  else if (e.key === 'Enter' || e.key === 'n') { copyCommand('npm'); e.preventDefault() }
  else if (e.key === 'p') { copyCommand('pnpm'); e.preventDefault() }
  else if (e.key === 'y') { copyCommand('yarn'); e.preventDefault() }
  else if (e.key === 'Escape') { window.ztools?.hideMainWindow?.() }
}

onMounted(() => {
  keyword.value = String(props.enterAction?.payload ?? '')
  window.addEventListener('keydown', onKey)
  if (keyword.value) doSearch()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="npm-quick">
    <div v-if="helpOpen" class="help-overlay" @click.self="helpOpen = false">
      <div class="help-box">
        <h3>快捷键</h3>
        <ul>
          <li><kbd>↑</kbd>/<kbd>↓</kbd> 列表内移动</li>
          <li><kbd>Enter</kbd>/<kbd>n</kbd> 复制 npm</li>
          <li><kbd>p</kbd> 复制 pnpm</li>
          <li><kbd>y</kbd> 复制 yarn</li>
          <li><kbd>Esc</kbd> 退出</li>
          <li><kbd>Cmd/Ctrl+K</kbd> 帮助</li>
        </ul>
      </div>
    </div>

    <div v-if="error" class="error-box">
      <pre>{{ error?.message || String(error) }}</pre>
    </div>

    <div class="quick-header">
      <span class="search-tip">↑↓ 选择 · Enter/n/p/y 复制</span>
    </div>

    <div v-if="!keyword" class="empty">请先输入要搜索的关键字</div>
    <div v-else-if="loading">检索中…</div>
    <ul v-else-if="results.length">
      <li
        v-for="(p, i) in results"
        :key="p.name"
        :class="{ active: i === selectedIdx }"
        @click="selectedIdx = i"
      >
        <span class="name">{{ p.name }}</span>
        <span class="version">{{ p.version }}</span>
      </li>
    </ul>
    <p v-else class="empty">未找到包。可尝试其他关键字，或换官方源。</p>
  </div>
</template>

<style scoped>
.npm-quick { padding: 20px 24px; background: var(--bg-primary); color: var(--text-primary); font-size: 16px; min-height: 100%; }
ul { list-style: none; padding: 0; margin: 0; }
li { padding: 10px 14px; cursor: pointer; border-radius: var(--radius); margin-bottom: 4px; border: 1px solid transparent; display: flex; gap: 12px; }
li.active { background: var(--bg-hover); border-color: var(--accent); }
.name { font-family: var(--font-mono); font-weight: 500; }
.version { margin-left: auto; color: var(--text-secondary); font-size: 0.9em; font-family: var(--font-mono); }
.empty { color: var(--text-muted); padding: 12px; text-align: center; }
.error-box { padding: 8px; background: var(--error-bg); border: 1px solid var(--error-border); border-radius: var(--radius); margin-bottom: 8px; }
.error-box pre { font-size: 0.8em; max-height: 200px; overflow: auto; white-space: pre-wrap; }
.quick-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
.search-tip { color: var(--text-muted); font-size: 0.85em; font-family: var(--font-mono); }
.help-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; }
.help-box { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; min-width: 240px; }
.help-box h3 { margin-top: 0; }
.help-box ul { padding-left: 0; }
.help-box li { padding: 3px 0; cursor: default; border: none; }
kbd { background: var(--bg-hover); padding: 1px 6px; border-radius: 3px; font-family: var(--font-mono); font-size: 0.85em; }
</style>

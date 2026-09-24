<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useTheme } from '../lib/useTheme'
import { useMavenCache } from '../lib/useMavenCache'
import { parseSearch } from '../lib/search-parser'
import { tagVersion, dedupeVersions, formatTimestamp, pickLatest } from '../lib/version-tag'
import { buildDependency } from '../lib/pom-builder'
import type { MavenArtifact, MavenVersion } from '../lib/types'
import MavenSettings from '../MavenSettings/index.vue'

const props = defineProps<{ enterAction: any }>()

const settingsOpen = ref(false)

useTheme()
const cache = useMavenCache()

const keyword = ref('')
const results = ref<MavenArtifact[]>([])
const selectedIdx = ref(0)
const selectedArtifact = ref<MavenArtifact | null>(null)
const versions = ref<MavenVersion[]>([])
const versionIdx = ref(0)
const loading = ref(false)
const error = ref<any>(null)
const helpOpen = ref(false)

function cacheKey(parsed: any): string {
  if (parsed.kind === 'scoped') return `${parsed.g ?? ''}:${parsed.a ?? ''}`
  if (parsed.kind === 'rawQuery') return parsed.rawQuery
  return parsed.freeText
}

async function doSearch() {
  if (!keyword.value.trim()) return
  error.value = null
  loading.value = true
  try {
    const parsed = parseSearch(keyword.value)
    const r = await (window as any).services.mavenSearch(parsed)
    cache.setSearch(cacheKey(parsed), r)
    results.value = r.data
    selectedIdx.value = 0
  } catch (e: any) {
    error.value = e
    results.value = []
  } finally {
    loading.value = false
  }
}

async function pickArtifact(a: MavenArtifact) {
  // Aliyun results have no real groupId; resolve true g:a via Solr first.
  let target = a
  if (a.source === 'aliyun' && !a.g) {
    try {
      const r = await (window as any).services.mavenSearch({ kind: 'scoped', a: a.a })
      const hit = (r?.data ?? []).find((x: any) => x.g && x.a === a.a) ?? r?.data?.[0]
      if (hit?.g && hit?.a) {
        target = {
          id: `${hit.g}:${hit.a}`,
          g: hit.g,
          a: hit.a,
          latestVersion: a.latestVersion,
          timestamp: a.timestamp,
          source: 'solr',
        }
      }
    } catch { /* fall through */ }
  }
  selectedArtifact.value = target
  const key = `${target.source === 'coderead' ? 'cr:' : ''}${target.g}:${target.a}`
  const cached = cache.getVersions(key)
  if (cached) {
    versions.value = tagAndDedupe(cached.data)
    return
  }
  loading.value = true
  try {
    const r = target.source === 'coderead'
      ? await (window as any).services.codeReadVersions(target.g, target.a)
      : await (window as any).services.mavenVersions(target.g, target.a)
    cache.setVersions(key, r)
    versions.value = tagAndDedupe(r.data)
    versionIdx.value = versions.value.findIndex(v => v === pickLatest(versions.value))
  } catch (e: any) {
    error.value = e
  } finally {
    loading.value = false
  }
}

function tagAndDedupe(raw: any[]): MavenVersion[] {
  const tagged = raw.map(v => ({
    v: v.v, timestamp: v.timestamp,
    status: tagVersion(v.v), isLatest: false,
  }))
  const deduped = dedupeVersions(tagged)
  const latest = deduped.findIndex(v => v === pickLatest(deduped))
  if (latest >= 0) deduped[latest] = { ...deduped[latest], isLatest: true }
  return deduped.sort((a, b) => b.timestamp - a.timestamp)
}

async function pickVersion(v: MavenVersion) {
  if (!selectedArtifact.value) return
  const xml = buildDependency(
    { g: selectedArtifact.value.g, a: selectedArtifact.value.a, v: v.v },
    { scope: 'compile' }
  )
  await (window as any).ztools.clipboard.writeContent({
    type: 'text', content: xml, shouldPaste: true,
  })
  ;(window as any).ztools.showNotification(`已复制：${selectedArtifact.value.id}:${v.v}`)
  ;(window as any).ztools.hideMainWindow()
}

// Mode B: Enter/c trigger default-copy.
async function defaultCopy() {
  if (selectedArtifact.value && versions.value[versionIdx.value]) {
    await pickVersion(versions.value[versionIdx.value])
  } else if (!selectedArtifact.value && results.value[selectedIdx.value]) {
    await pickArtifact(results.value[selectedIdx.value])
  }
}

function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    helpOpen.value = !helpOpen.value; e.preventDefault(); return
  }
  if (e.key === 'ArrowDown' && !selectedArtifact.value) {
    selectedIdx.value = Math.min(selectedIdx.value + 1, results.value.length - 1); e.preventDefault()
  } else if (e.key === 'ArrowUp' && !selectedArtifact.value) {
    selectedIdx.value = Math.max(selectedIdx.value - 1, 0); e.preventDefault()
  } else if (e.key === 'ArrowDown' && selectedArtifact.value) {
    versionIdx.value = Math.min(versionIdx.value + 1, versions.value.length - 1); e.preventDefault()
  } else if (e.key === 'ArrowUp' && selectedArtifact.value) {
    versionIdx.value = Math.max(versionIdx.value - 1, 0); e.preventDefault()
  } else if (e.key === 'Enter' || e.key === 'c') {
    // Mode B: Enter/c trigger default-copy path.
    defaultCopy(); e.preventDefault()
  } else if (e.key === 'Escape') {
    if (selectedArtifact.value) selectedArtifact.value = null
    else (window as any).ztools.hideMainWindow()
  }
}

async function copyErrorDetails() {
  if (!error.value) return
  const d = error.value
  const text = [
    `Message: ${d.message ?? '(none)'}`,
    `URL: ${d.url ?? '(none)'}`,
    `Status: ${d.status ?? '(none)'}`,
  ].join('\n')
  await (window as any).ztools.clipboard.writeContent({ type: 'text', content: text, shouldPaste: false })
  ;(window as any).ztools.showNotification('已复制错误信息')
}

function switchToUiMode() {
  // Best-effort: open the maven-ui panel by triggering its command.
  // ZTools API doesn't have a direct cross-feature jump without payload;
  // we hide this window and instruct the user via notification.
  (window as any).ztools.showNotification('请输入 "maven" 进入主面板')
  ;(window as any).ztools.hideMainWindow()
}

onMounted(() => {
  keyword.value = String(props.enterAction?.payload ?? '')
  window.addEventListener('keydown', onKey)
  if (keyword.value) doSearch()
})
</script>

<template>
  <div class="maven-quick">
    <!-- Help overlay. -->
    <div v-if="helpOpen" class="help-overlay" @click.self="helpOpen = false">
      <div class="help-box">
        <h3>快捷键</h3>
        <ul>
          <li><kbd>↑</kbd>/<kbd>↓</kbd> 列表内移动</li>
          <li><kbd>Enter</kbd>/<kbd>c</kbd>/<kbd>g</kbd>/<kbd>u</kbd> 默认复制</li>
          <li><kbd>Esc</kbd> 返回 / 退出</li>
          <li><kbd>Cmd/Ctrl+K</kbd> 显示/隐藏此帮助</li>
        </ul>
      </div>
    </div>

    <div v-if="error" class="error-box">
      <details>
        <summary class="err-toggle">查看错误详情</summary>
        <pre>{{ error.message }}
URL: {{ error.url }}
Status: {{ error.status }}</pre>
        <button @click="copyErrorDetails">复制错误信息</button>
      </details>
    </div>

    <div class="quick-header">
      <span class="search-tip">↑↓ 选择 · Enter/c 复制 · ← 退出</span>
      <button class="settings-btn" @click="settingsOpen = true" title="代理等设置">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
        设置
      </button>
    </div>

    <div v-if="!keyword" class="empty">
      请先输入要搜索的关键字
      <button class="link" @click="switchToUiMode">切换到主面板 (maven)</button>
    </div>
    <div v-else-if="loading">检索中…</div>
    <div v-else-if="!selectedArtifact">
      <ul v-if="results.length">
        <li
          v-for="(a, i) in results"
          :key="a.id"
          :class="{ active: i === selectedIdx }"
          @click="pickArtifact(a)"
        >{{ a.id }} <span class="latest">{{ a.latestVersion }}</span></li>
      </ul>
      <p v-else class="empty">未找到包。如搜索一直无结果，请打开代理后重试</p>
      <p class="hint">↑↓ 选择 · Enter 进入</p>
    </div>
    <div v-else>
      <header>{{ selectedArtifact.id }}</header>
      <ul v-if="versions.length">
        <li
          v-for="(v, i) in versions"
          :key="v.v"
          :class="{ active: i === versionIdx }"
          @click="pickVersion(v)"
        >
          <span>{{ v.v }}</span>
          <span class="time">{{ formatTimestamp(v.timestamp) }}</span>
          <span :class="['status', v.status]">{{ v.status }}</span>
        </li>
      </ul>
      <p v-else class="empty">未找到版本。如搜索一直无结果，请打开代理后重试</p>
      <p class="hint">↑↓ 选择 · Enter/c 复制 · Esc 返回</p>
    </div>

    <!-- Settings dialog -->
    <MavenSettings :open="settingsOpen" @close="settingsOpen = false" />
  </div>
</template>

<style scoped>
.maven-quick { padding: 20px 24px; background: var(--bg-primary); color: var(--text-primary); position: relative; font-size: 16px; min-height: 100%; }
ul { list-style: none; padding: 0; margin: 0; }
li { padding: 10px 14px; cursor: pointer; border-radius: var(--radius); margin-bottom: 4px; border: 1px solid transparent; }
li.active { background: var(--bg-hover); border-color: var(--accent); }
.latest { color: var(--text-secondary); font-size: 0.9em; margin-left: 8px; }
.time { color: var(--text-muted); font-size: 0.85em; margin-left: 8px; }
.status { margin-left: 8px; font-size: 0.75em; padding: 1px 6px; border-radius: 3px; }
.status.stable { background: var(--status-stable); color: white; }
.status.alpha { background: var(--status-alpha); color: white; }
.status.beta { background: var(--status-beta); color: white; }
.status.snapshot { background: var(--status-snapshot); color: white; }
.error-box { padding: 8px; background: var(--error-bg); border: 1px solid var(--error-border); border-radius: var(--radius); margin-bottom: 8px; }
.error-box pre { font-size: 0.8em; max-height: 200px; overflow: auto; white-space: pre-wrap; }
.empty { color: var(--text-muted); padding: 12px; text-align: center; }
.empty .link { display: block; margin: 8px auto 0; }
header { font-family: var(--font-mono); font-weight: bold; margin-bottom: 8px; }
.hint { color: var(--text-muted); font-size: 0.8em; margin-top: 8px; }
button { background: transparent; color: var(--accent); border: 1px solid var(--border); padding: 4px 8px; border-radius: var(--radius); }
button:hover { background: var(--bg-hover); }

/* Quick panel header row */
.quick-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}
.search-tip {
  color: var(--text-muted);
  font-size: 0.85em;
  font-family: var(--font-mono);
}
.settings-btn {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  white-space: nowrap;
}
.settings-btn:hover { border-color: var(--accent); color: var(--accent); }

/* Details toggle arrow (CSS triangle) */
.err-toggle {
  cursor: pointer;
  list-style: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.err-toggle::-webkit-details-marker { display: none; }
.err-toggle::after {
  content: '';
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 6px solid currentColor;
  transition: transform 0.15s;
}
details[open] .err-toggle::after { transform: rotate(180deg); }

.help-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; }
.help-box { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; min-width: 240px; }
.help-box h3 { margin-top: 0; }
.help-box ul { padding-left: 0; }
.help-box li { padding: 3px 0; cursor: default; }
kbd { background: var(--bg-hover); padding: 1px 6px; border-radius: 3px; font-family: var(--font-mono); font-size: 0.85em; }
</style>
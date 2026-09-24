<script setup lang="ts">
import { onMounted, ref, computed, nextTick, watch } from 'vue'
import { useTheme } from '../lib/useTheme'
import { useMavenCache } from '../lib/useMavenCache'
import { parseSearch } from '../lib/search-parser'
import { tagVersion, dedupeVersions, formatTimestamp, pickLatest } from '../lib/version-tag'
import { buildDependency, buildGradleCoord } from '../lib/pom-builder'
import type { MavenArtifact, MavenVersion } from '../lib/types'
import MavenSettings from '../MavenSettings/index.vue'
import { version } from '../../package.json'

const props = defineProps<{ enterAction: any }>()

useTheme()
const cache = useMavenCache()

const searchInput = ref('')
const debouncedInput = ref('')
let debounceTimer: any = null
const searchResult = ref<{ data: MavenArtifact[]; sources: { solr: MavenArtifact[]; aliyun: MavenArtifact[]; coderead: MavenArtifact[] } } | null>(null)
const selectedIdx = ref(0)
const selectedArtifact = ref<MavenArtifact | null>(null)
const versions = ref<MavenVersion[]>([])
const versionIdx = ref(0)
const versionsTotal = ref(0)          // total count from Solr
const versionsStart = ref(0)         // pagination offset
const versionsHasMore = ref(false)
const loading = ref(false)
const error = ref<{ msg: string; details?: any } | null>(null)

// Settings dialog (replaces route-based settings page).
const settingsOpen = ref(false)

// Link to this plugin's own source repo (single "open source" entry point).
const REPO_URL = 'https://github.com/kshq1996/ztools-maven'

// Source tabs — user preference is remembered in dbStorage.
const STORAGE_TAB_KEY = 'maven-search-tab'
const TABS = [
  { key: 'all', label: '全部' },
  { key: 'central', label: 'Central' },
  { key: 'aliyun', label: '阿里云' },
  { key: 'coderead', label: 'CodeRead' },
]
const activeTab = ref('all')
let tabIdx = 0

// Category filter — lets users see only Android-ecosystem artifacts, or only
// everything else. Selection is remembered in dbStorage.
type Category = 'all' | 'android' | 'java'
const CATEGORY_STORAGE_KEY = 'maven-category'
const categoryFilter = ref<Category>('all')
// Any artifact whose groupId OR artifactId contains "android" (anywhere,
// case-insensitive) counts as Android — covers androidx.*, com.android.*,
// com.google.android.*, android.arch.*, and artifactId like fastjson2-android.
function isAndroidArtifact(a: MavenArtifact): boolean {
  return /android/i.test(a.g || '') || /android/i.test(a.a || '')
}

function baseTabResults(): MavenArtifact[] {
  const s = searchResult.value
  if (!s) return []
  switch (activeTab.value) {
    case 'central': return s.sources?.solr ?? []
    case 'aliyun': return s.sources?.aliyun ?? []
    case 'coderead': return s.sources?.coderead ?? []
    default: return s.data ?? []
  }
}

function tabResults(): MavenArtifact[] {
  const base = baseTabResults()
  if (categoryFilter.value === 'android') return base.filter(isAndroidArtifact)
  if (categoryFilter.value === 'java') return base.filter(a => !isAndroidArtifact(a))
  return base
}

function categoryCount(cat: Category): number {
  const base = baseTabResults()
  if (cat === 'android') return base.filter(isAndroidArtifact).length
  if (cat === 'java') return base.filter(a => !isAndroidArtifact(a)).length
  return base.length
}

function setCategory(cat: Category) {
  categoryFilter.value = cat
  selectedIdx.value = 0
  try { window.ztools?.dbStorage?.setItem?.(CATEGORY_STORAGE_KEY, cat) } catch {}
}

function tabCount(key: string): number {
  const s = searchResult.value
  if (!s) return 0
  if (key === 'central') return s.sources?.solr?.length ?? 0
  if (key === 'aliyun') return s.sources?.aliyun?.length ?? 0
  if (key === 'coderead') return s.sources?.coderead?.length ?? 0
  return s.data?.length ?? 0
}

const SOURCE_LABELS: Record<string, string> = {
  solr: 'Central',
  aliyun: '阿里云',
  coderead: 'CodeRead',
}
function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] || source
}

// Any row with an artifactId can be copied on demand (missing g/v are
// resolved via Solr), so all rows show the quick-copy shortcut hint.
function rowCopyable(a: MavenArtifact): boolean {
  return !!a.a
}

function persistTab(key: string) {
  try { window.ztools?.dbStorage?.setItem?.(STORAGE_TAB_KEY, key) } catch {}
}

function switchTab(key: string) {
  activeTab.value = key
  tabIdx = TABS.findIndex(t => t.key === key)
  selectedIdx.value = 0
  persistTab(key)
}

function tabStep(dir: 1 | -1) {
  tabIdx = (tabIdx + dir + TABS.length) % TABS.length
  switchTab(TABS[tabIdx].key)
}

// Version-level category filter (inside the version panel): splits versions
// by whether the version string contains "android" (e.g. 2.0.60.android8).
const versionCat = ref<Category>('all')
function versionIsAndroid(v: MavenVersion): boolean {
  return /android/i.test(v.v)
}
const filteredVersions = computed<MavenVersion[]>(() => {
  if (versionCat.value === 'android') return versions.value.filter(versionIsAndroid)
  if (versionCat.value === 'java') return versions.value.filter(v => !versionIsAndroid(v))
  return versions.value
})
function versionCatCount(cat: Category): number {
  if (cat === 'android') return versions.value.filter(versionIsAndroid).length
  if (cat === 'java') return versions.value.filter(v => !versionIsAndroid(v)).length
  return versions.value.length
}
function setVersionCat(cat: Category) {
  versionCat.value = cat
  versionIdx.value = 0
}

// Shift+←/→ cycles 全部 → Android → 非安卓 → 全部 in both the results and
// version panels. Same Category order used by both filters.
const CATEGORY_CYCLE: Category[] = ['all', 'android', 'java']
function cycleCategory(dir: 1 | -1) {
  const target = selectedArtifact.value ? versionCat : categoryFilter
  const i = CATEGORY_CYCLE.indexOf(target.value)
  target.value = CATEGORY_CYCLE[(i + dir + CATEGORY_CYCLE.length) % CATEGORY_CYCLE.length]
  // In the version panel, also reset the row cursor so it stays valid.
  if (selectedArtifact.value) versionIdx.value = 0
}

// Action menu — POM and Android are SEPARATE format choices.
const menuOpen = ref(false)
const menuFocusIdx = ref(0)
const MENU_ITEMS = [
  { label: '复制 POM (XML)', group: 'POM', shortcut: 'm', build: (c: any, v: string) => buildDependency(c, { scope: 'compile' }) },
  { label: '复制 Android (Gradle)', group: 'Android', shortcut: 'g', build: (c: any, v: string) => `implementation '${buildGradleCoord(c)}'` },
]

// Refs to focus the list when results render so arrow keys work immediately.
const resultsListRef = ref<HTMLUListElement | null>(null)
const versionsListRef = ref<HTMLDivElement | null>(null)

// Keep keyboard nav on the lists, but never scroll/steal focus so the
// search hint row and source tabs stay visible at the top.
watch([() => activeTab.value, () => tabResults().length], async () => {
  if (tabResults().length > 0 && !selectedArtifact.value) {
    await nextTick()
    resultsListRef.value?.focus({ preventScroll: true })
  }
})

// Focus the versions list when versions render.
watch(versions, async (newVersions) => {
  if (newVersions.length > 0 && selectedArtifact.value) {
    await nextTick()
    // Reset selection to the latest version when versions change.
    versionIdx.value = newVersions.findIndex(v => v.isLatest)
    versionsListRef.value?.focus({ preventScroll: true })
  }
})

// Smart-scroll: keep the highlighted row visible when the cursor moves.
// block:'nearest' is a no-op when the row is already in the viewport, so
// it never jumps or steals scroll from the search hint row / source tabs.
function scrollSelectedIntoView(listEl: HTMLElement | null, idx: number) {
  const item = listEl?.children[idx] as HTMLElement | undefined
  item?.scrollIntoView({ block: 'nearest' })
}

watch(selectedIdx, async () => {
  await nextTick()
  scrollSelectedIntoView(resultsListRef.value, selectedIdx.value)
})
watch(versionIdx, async () => {
  await nextTick()
  scrollSelectedIntoView(versionsListRef.value, versionIdx.value)
})

// Help overlay (Cmd/Ctrl+K).
const helpOpen = ref(false)

const queryKey = computed(() => debouncedInput.value.trim().toLowerCase())

function cacheKey(query: any): string {
  if (query.kind === 'scoped') return `${query.g ?? ''}:${query.a ?? ''}`
  if (query.kind === 'rawQuery') return query.rawQuery
  return query.freeText
}

async function doSearch() {
  const input = debouncedInput.value.trim()
  if (!input) { searchResult.value = null; return }
  const parsed = parseSearch(input)
  const key = cacheKey(parsed)
  const cached = cache.getSearch(key)
  if (cached) {
    searchResult.value = cached as any
    return
  }
  loading.value = true
  error.value = null
  try {
    const r = await (window as any).services.mavenSearch(parsed)
    cache.setSearch(key, r)
    searchResult.value = r
    selectedIdx.value = 0
  } catch (e: any) {
    error.value = { msg: '搜索失败', details: e }
    searchResult.value = null
  } finally {
    loading.value = false
  }
}

async function resolveAliyunArtifact(artifact: MavenArtifact): Promise<MavenArtifact | null> {
  // Aliyun search results have no real groupId (API returns '#'). Look up the
  // true g:a via Solr by artifactId so we can load versions and copy POM.
  try {
    const r = await (window as any).services.mavenSearch({ kind: 'scoped', a: artifact.a })
    const hit = (r?.data ?? []).find((x: any) => x.g && x.a === artifact.a) ?? r?.data?.[0]
    if (hit?.g && hit?.a) {
      return {
        id: `${hit.g}:${hit.a}`,
        g: hit.g,
        a: hit.a,
        latestVersion: artifact.latestVersion,
        timestamp: artifact.timestamp,
        source: 'solr',
      }
    }
  } catch { /* fall through — version panel will show the empty state */ }
  return null
}

async function selectArtifact(a: MavenArtifact) {
  let target = a
  if (a.source === 'aliyun' && !a.g) {
    const resolved = await resolveAliyunArtifact(a)
    if (resolved) target = resolved
  }
  selectedArtifact.value = target
  versionsStart.value = 0
  await loadVersions(target, 0, false)
}

async function loadVersions(a: MavenArtifact, start: number, append: boolean) {
  const key = `${a.source === 'coderead' ? 'cr:' : ''}${a.g}:${a.a}`
  let r
  const fetcher = () => a.source === 'coderead'
    ? (window as any).services.codeReadVersions(a.g, a.a)
    : (window as any).services.mavenVersions(a.g, a.a, start)
  if (start === 0) {
    const cached = cache.getVersions(key)
    if (cached) {
      r = cached
    } else {
      loading.value = true
      try {
        r = await fetcher()
        cache.setVersions(key, r)
      } catch (e: any) {
        error.value = { msg: '获取版本失败', details: e }
        versions.value = []
        loading.value = false
        return
      } finally {
        loading.value = false
      }
    }
  } else {
    // Pagination (Solr only): not cached — always fetch.
    loading.value = true
    try {
      r = await (window as any).services.mavenVersions(a.g, a.a, start)
    } catch (e: any) {
      error.value = { msg: '加载更多失败', details: e }
      loading.value = false
      return
    } finally {
      loading.value = false
    }
  }
  const tagged = (r.data as any[]).map(v => ({
    v: v.v, timestamp: v.timestamp, status: tagVersion(v.v), isLatest: false,
  }))
  const deduped = dedupeVersions(tagged)
  const latest = deduped.findIndex(v => v === pickLatest(deduped))
  if (latest >= 0) deduped[latest] = { ...deduped[latest], isLatest: true }
  const sorted = deduped.sort((a, b) => b.timestamp - a.timestamp)
  versions.value = append ? [...versions.value, ...sorted] : sorted
  versionIdx.value = versions.value.findIndex(v => v.isLatest)
  versionsStart.value = start + sorted.length
  versionsHasMore.value = sorted.length === 200 // assume more if full page
}

async function copyContent(content: string) {
  await (window as any).ztools.clipboard.writeContent({
    type: 'text', content, shouldPaste: true,
  })
  ;(window as any).ztools.showNotification('已复制 Maven 依赖')
  ;(window as any).ztools.hideMainWindow()
}

function openMenu() {
  if (!selectedArtifact.value || !filteredVersions.value[versionIdx.value]) return
  menuOpen.value = true
  menuFocusIdx.value = 0
}

function closeMenu() {
  menuOpen.value = false
}

function confirmMenu() {
  const a = selectedArtifact.value
  const v = filteredVersions.value[versionIdx.value]
  if (!a || !v) return
  const item = MENU_ITEMS[menuFocusIdx.value]
  const coord = { g: a.g, a: a.a, v: v.v }
  copyContent(item.build(coord, v.v))
  closeMenu()
}

function copyPom() {
  const a = selectedArtifact.value, v = filteredVersions.value[versionIdx.value]
  if (!a || !v) return
  copyContent(buildDependency({ g: a.g, a: a.a, v: v.v }, { scope: 'compile' }))
}

function copyGradle() {
  const a = selectedArtifact.value, v = filteredVersions.value[versionIdx.value]
  if (!a || !v) return
  copyContent(`implementation '${buildGradleCoord({ g: a.g, a: a.a, v: v.v })}'`)
}

// Copy shortcuts on a *result* row (no version picked yet). Prefer the row's
// own g/a/latestVersion; when the source lacks one (Aliyun has no groupId,
// CodeRead has no version), resolve it on demand via Solr so the user can
// copy directly without entering the version list.
async function resolveRowCoord(entry: MavenArtifact): Promise<{ g: string; a: string; v: string } | null> {
  if (entry.g && entry.a && entry.latestVersion) {
    return { g: entry.g, a: entry.a, v: entry.latestVersion }
  }
  try {
    const query = entry.g
      ? { kind: 'scoped', g: entry.g, a: entry.a }
      : { kind: 'scoped', a: entry.a }
    const r = await (window as any).services.mavenSearch(query)
    const list: any[] = r?.data ?? []
    const hit = list.find((x) => x.source === 'solr' && x.g && x.a === entry.a && x.latestVersion)
      ?? list.find((x) => x.g && x.a === entry.a && x.latestVersion)
    const v = hit?.latestVersion ?? entry.latestVersion
    if (hit?.g && hit?.a && v) return { g: hit.g, a: hit.a, v }
  } catch { /* fall through */ }
  return null
}

function copyFromRow(entry: MavenArtifact | undefined, build: (c: any) => string) {
  if (!entry) return
  // Central (solr) and CodeRead rows need the second-level version panel to
  // pick a specific version — only Aliyun rows carry a full g:a:v that can be
  // copied straight from the first-level list.
  if (entry.source !== 'aliyun') {
    selectArtifact(entry)
    return
  }
  resolveRowCoord(entry).then((coord) => {
    if (!coord) {
      ;(window as any).ztools.showNotification?.('无法解析该包坐标，请按 Enter 进入版本列表选择')
      return
    }
    copyContent(build(coord))
  })
}
function copyPomFromRow(entry?: MavenArtifact) { copyFromRow(entry, c => buildDependency(c, { scope: 'compile' })) }
function copyGradleFromRow(entry?: MavenArtifact) { copyFromRow(entry, c => `implementation '${buildGradleCoord(c)}'`) }

function onSearchChange(input: unknown) {
  // ZTools actually passes { text: string } object despite the doc saying
  // the callback is `(text: string) => void`. Be defensive.
  const text = typeof input === 'string' ? input : (input as any)?.text ?? ''
  searchInput.value = text
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debouncedInput.value = text
    doSearch()
  // Debounce: only search once the user has stopped typing for 700ms.
  }, 700)
}

function onResultKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { selectedIdx.value = Math.min(selectedIdx.value + 1, tabResults().length - 1); e.preventDefault() }
  else if (e.key === 'ArrowUp') { selectedIdx.value = Math.max(selectedIdx.value - 1, 0); e.preventDefault() }
  // ←/→ (tab switching) + Enter are handled globally (see onGlobalKey), so
  // they keep working even when the current tab has no results.
}

function onVersionKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { versionIdx.value = Math.min(versionIdx.value + 1, filteredVersions.value.length - 1); e.preventDefault() }
  else if (e.key === 'ArrowUp') { versionIdx.value = Math.max(versionIdx.value - 1, 0); e.preventDefault() }
  // Plain ← returns to results; Shift+←/→ must NOT be intercepted here so the
  // global cycleCategory handler can see them (otherwise the local handler
  // runs first, sets selectedArtifact=null, and the global handler then
  // cycles the wrong panel's filter).
  else if (!e.shiftKey && e.key === 'ArrowLeft') { selectedArtifact.value = null; e.preventDefault() }
  // Enter / c / p / a / g / u are handled globally (see onGlobalKey).
}

function onMenuKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { closeMenu(); e.preventDefault() }
  else if (e.key === 'Tab') {
    e.preventDefault()
    if (e.shiftKey) {
      menuFocusIdx.value = (menuFocusIdx.value - 1 + MENU_ITEMS.length) % MENU_ITEMS.length
    } else {
      menuFocusIdx.value = (menuFocusIdx.value + 1) % MENU_ITEMS.length
    }
  } else if (e.key === 'Enter') { confirmMenu(); e.preventDefault() }
}

function onGlobalKey(e: KeyboardEvent) {
  if (menuOpen.value || settingsOpen.value) return // overlays capture first

  const inVersionPanel = !!selectedArtifact.value
  const hasSelection = inVersionPanel || (!selectedArtifact.value && tabResults().length > 0)
  const key = e.key.toLowerCase()

  // Esc: close overlays are handled elsewhere; here it steps back.
  if (e.key === 'Escape') {
    if (selectedArtifact.value) selectedArtifact.value = null
    else (window as any).ztools.hideMainWindow()
    e.preventDefault()
    return
  }
  if ((e.metaKey || e.ctrlKey) && key === 'k') { helpOpen.value = !helpOpen.value; e.preventDefault(); return }
  if (e.key === '/') {
    const el = document.getElementById('maven-search-input') as HTMLInputElement
    el?.focus(); e.preventDefault()
    return
  }

  // Shift+←/→ cycles the 全部/Android/非安卓 category filter (works in
  // both the results and version panels). Must come before the plain ←/→
  // handlers below so the shift modifier wins.
  if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    cycleCategory(e.key === 'ArrowRight' ? 1 : -1)
    e.preventDefault()
    return
  }

  // ←/→ switch source tabs while in the results view — even when the current
  // tab shows "没找到相关包" (empty list has no <ul> to capture keydown).
  if (!selectedArtifact.value && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    tabStep(e.key === 'ArrowRight' ? 1 : -1)
    e.preventDefault()
    return
  }
  // ← in the version panel steps back to the results list (focus-independent).
  if (selectedArtifact.value && e.key === 'ArrowLeft') {
    selectedArtifact.value = null
    e.preventDefault()
    return
  }

  // Copy shortcuts fire whenever a row is selected — this keeps m/g/c/Enter
  // from leaking into the ZTools search box after arrow-key selection.
  if (hasSelection && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.key === 'Enter' || key === 'c' || key === 'p') {
      if (inVersionPanel) openMenu()
      else {
        const entry = tabResults()[selectedIdx.value]
        if (entry) {
          // Aliyun rows already carry a full g:a:v — copy directly, no
          // second-level version page needed.
          if (entry.source === 'aliyun') copyPomFromRow(entry)
          else selectArtifact(entry)
        }
      }
      e.preventDefault()
    } else if (key === 'm') {
      if (inVersionPanel) copyPom()
      else copyPomFromRow(tabResults()[selectedIdx.value])
      e.preventDefault()
    } else if (key === 'g') {
      if (inVersionPanel) copyGradle()
      else copyGradleFromRow(tabResults()[selectedIdx.value])
      e.preventDefault()
    }
  }
}

async function copyErrorDetails() {
  if (!error.value?.details) return
  const d = error.value.details
  const text = [
    `Message: ${d.message ?? '(none)'}`,
    `URL: ${d.url ?? '(none)'}`,
    `Status: ${d.status ?? '(none)'}`,
    `Duration: ${d.durationMs ?? '(none)'}ms`,
    `Body: ${d.body ?? '(none)'}`,
  ].join('\n')
  await (window as any).ztools.clipboard.writeContent({ type: 'text', content: text, shouldPaste: false })
  ;(window as any).ztools.showNotification('已复制错误信息')
}

onMounted(() => {
  // Register sub-input + global keys synchronously so the UI works immediately.
  ;(window as any).ztools.setSubInput(onSearchChange, '搜索 Maven 包…', true)
  window.addEventListener('keydown', onGlobalKey)

  // Restore the user's preferred tab + category from dbStorage (async).
  Promise.resolve()
    .then(() => window.ztools?.dbStorage?.getItem?.(STORAGE_TAB_KEY))
    .then((saved) => {
      if (saved && TABS.some(t => t.key === saved)) switchTab(saved)
      else tabIdx = TABS.findIndex(t => t.key === activeTab.value)
      return window.ztools?.dbStorage?.getItem?.(CATEGORY_STORAGE_KEY)
    })
    .then((savedCat) => {
      if (savedCat === 'android' || savedCat === 'java') categoryFilter.value = savedCat
    })
    .catch(() => { tabIdx = 0 })
})
</script>

<template>
  <div class="maven-panel">
    <!-- Help overlay (Cmd/Ctrl+K). -->
    <div v-if="helpOpen" class="help-overlay" @click.self="helpOpen = false">
      <div class="help-box">
        <h3>快捷键</h3>
        <ul>
          <li><kbd>/</kbd> 聚焦搜索</li>
          <li><kbd>↑</kbd>/<kbd>↓</kbd> 列表内移动</li>
          <li><kbd>←</kbd>/<kbd>→</kbd> 切换数据源</li>
          <li><kbd>Shift</kbd>+<kbd>←</kbd>/<kbd>→</kbd> 切换分类</li>
          <li><kbd>Enter</kbd> 进入版本列表</li>
          <li><kbd>m</kbd> 复制 Maven / <kbd>g</kbd> 复制 Gradle</li>
          <li><kbd>c</kbd>/<kbd>p</kbd> 打开操作菜单（选版本后）</li>
          <li><kbd>Esc</kbd> 返回 / 退出</li>
          <li><kbd>Cmd/Ctrl+K</kbd> 显示/隐藏此帮助</li>
        </ul>
      </div>
    </div>

    <!-- Action menu (Mode A). -->
    <div v-if="menuOpen" class="menu-overlay" @click.self="closeMenu" @keydown="onMenuKey" tabindex="0">
      <div class="menu-box">
        <button
          v-for="(item, i) in MENU_ITEMS"
          :key="item.label"
          :class="{ focused: i === menuFocusIdx }"
          @click="confirmMenu"
        >
          <span>
            <span class="group-tag">{{ item.group }}</span>
            {{ item.label.replace('复制 ' + item.group + ' (', '').replace(')', '') || item.label }}
          </span>
          <span class="hint">({{ item.shortcut }})</span>
        </button>
      </div>
    </div>

    <!-- Error box (spec §10). -->
    <div v-if="error" class="error-box">
      <div class="error-msg">{{ error.msg }}</div>
      <details>
        <summary class="err-toggle">查看错误详情</summary>
        <pre>{{ error.details?.message }}
URL: {{ error.details?.url }}
Status: {{ error.details?.status }}
Duration: {{ error.details?.durationMs }}ms
Body: {{ error.details?.body }}</pre>
        <button @click="copyErrorDetails">复制错误信息</button>
      </details>
    </div>

    <!-- Result list (Mode A step 5). -->
    <div v-if="!selectedArtifact" class="results">
      <header class="result-header">
        <span class="search-tip">↑↓ 选包 · ←→ 切源 · Shift+←→ 切分类 · m Maven · g Gradle · Enter 进入</span>
        <button class="settings-btn" @click="settingsOpen = true" title="代理等设置">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
          设置
        </button>
      </header>

      <!-- Always-visible source tip -->
      <div class="source-tip">
        <span class="dot"></span>
        <span>推荐使用 <b>CodeRead</b>；Central 可能需要配置代理才能访问（可在设置中配置）</span>
      </div>

      <!-- Source tabs -->
      <div v-if="searchResult" class="tabs">
        <button
          v-for="t in TABS"
          :key="t.key"
          class="tab"
          :class="{ active: activeTab === t.key }"
          @click="switchTab(t.key)"
        >
          {{ t.label }}
          <span v-if="t.key !== 'all'" class="tab-count">{{ tabCount(t.key) }}</span>
          <span v-else class="tab-count">{{ searchResult.data?.length ?? 0 }}</span>
        </button>
      </div>

      <!-- Category filter -->
      <div v-if="searchResult" class="cats">
        <span class="cats-label">分类</span>
        <button class="cat" :class="{ active: categoryFilter === 'all' }" @click="setCategory('all')">全部 {{ categoryCount('all') }}</button>
        <button class="cat" :class="{ active: categoryFilter === 'android' }" @click="setCategory('android')">Android {{ categoryCount('android') }}</button>
        <button class="cat" :class="{ active: categoryFilter === 'java' }" @click="setCategory('java')">非安卓 {{ categoryCount('java') }}</button>
      </div>

      <!-- Only show "no results" AFTER a search actually completed; while the
           user is still typing (debounce) or fetching, don't mislead them. -->
      <div v-if="loading" class="loading">检索中…</div>
      <div v-else-if="searchResult && tabResults().length === 0" class="empty">
        <template v-if="searchResult.data.length === 0">
          没找到相关包。
          <div class="hint-proxy">如搜索一直无结果，请打开代理后重试</div>
          <a :href="`https://www.baidu.com/s?wd=maven%20${encodeURIComponent(searchInput)}`" target="_blank">用百度搜 “maven {{ searchInput }}”</a>
        </template>
        <template v-else>
          当前数据源暂无结果，按 ← → 切换数据源查看
        </template>
      </div>
      <ul v-else-if="searchResult && tabResults().length > 0" ref="resultsListRef" tabindex="0" @keydown="onResultKey">
        <li
          v-for="(a, i) in tabResults()"
          :key="a.id + '-' + a.source"
          :class="{ active: i === selectedIdx }"
          @click="selectArtifact(a)"
        >
          <span class="id">{{ a.id }}</span>
          <span class="version">{{ a.latestVersion }}</span>
          <span v-if="activeTab === 'all' && a.source" class="src-tag" :class="'src-' + a.source">{{ sourceLabel(a.source) }}</span>
          <span v-if="rowCopyable(a)" class="copy-hint">
            <template v-if="a.source === 'aliyun'">
              <kbd>m</kbd> Maven · <kbd>g</kbd> Gradle
            </template>
            <template v-else>
              <kbd>Enter</kbd> 进入
            </template>
          </span>
        </li>
      </ul>
      <footer class="panel-footer">
        <a class="footer-link" :href="REPO_URL" target="_blank" rel="noopener" title="查看开源仓库">
          <span class="github-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.16c-3.2.69-3.87-1.36-3.87-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.47.11-3.06 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.77.11 3.06.73.81 1.18 1.84 1.18 3.1 0 4.43-2.7 5.41-5.27 5.69.41.36.78 1.05.78 2.12v3.14c0 .31.21.67.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/></svg>
          </span>
          <span>开源 v{{ version }}</span>
        </a>
      </footer>
    </div>

    <!-- Version list (Mode A step 6). -->
    <div v-else class="versions" @keydown="onVersionKey" tabindex="0">
      <header>
        <button class="back-btn" @click="selectedArtifact = null">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
          返回
        </button>
        <span class="id">{{ selectedArtifact.id }}</span>
        <span class="hint-mini">↑↓ 选版本 · Shift+←→ 切分类 · Enter/c/p 菜单 · m Maven · g Gradle · ← 返回</span>
        <button class="settings-btn" @click="settingsOpen = true" title="代理等设置">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
        </button>
      </header>

      <!-- Version category filter -->
      <div v-if="filteredVersions.length || versions.length" class="cats">
        <span class="cats-label">版本</span>
        <button class="cat" :class="{ active: versionCat === 'all' }" @click="setVersionCat('all')">全部 {{ versionCatCount('all') }}</button>
        <button class="cat" :class="{ active: versionCat === 'android' }" @click="setVersionCat('android')">Android {{ versionCatCount('android') }}</button>
        <button class="cat" :class="{ active: versionCat === 'java' }" @click="setVersionCat('java')">非安卓 {{ versionCatCount('java') }}</button>
      </div>

      <ul ref="versionsListRef">
        <li
          v-for="(v, i) in filteredVersions"
          :key="v.v"
          :class="{ active: i === versionIdx, latest: v.isLatest }"
          @click="versionIdx = i"
          tabindex="0"
          @focus="versionIdx = i"
        >
          <span class="ver">{{ v.v }}</span>
          <span class="time">{{ formatTimestamp(v.timestamp) }}</span>
          <span :class="['status', v.status]">{{ v.status }}</span>
          <span v-if="v.isLatest" class="latest-badge">LATEST</span>
          <span class="copy-hint" title="m 复制 Maven · g 复制 Gradle"><kbd>m</kbd> Maven · <kbd>g</kbd> Gradle</span>
        </li>
      </ul>
      <button v-if="versionsHasMore" class="more" @click="selectedArtifact && loadVersions(selectedArtifact, versionsStart, true)">
        加载更多
      </button>
      <footer>
        <span>Tab 切换 · Enter 确认 · Esc 取消 · Cmd+K 帮助</span>
      </footer>
    </div>

    <!-- Settings dialog -->
    <MavenSettings :open="settingsOpen" @close="settingsOpen = false" />
  </div>
</template>

<style scoped>
.maven-panel {
  padding: 12px 20px;
  background: var(--bg-primary);
  color: var(--text-primary);
  position: relative;
  font-size: 16px;
  line-height: 1.5;
  height: 100%;
  display: flex;
  flex-direction: column;
}

ul { list-style: none; padding: 0; margin: 0; }

/* Result / version containers fill the remaining viewport height; the inner
   <ul> scrolls internally so the search tip, source tabs, filter chips,
   and footer stay anchored while arrow-key navigation can run past the
   visible window. */
.results, .versions {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
.results > ul,
.versions > ul {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

/* Result list items — bigger, more breathing room */
.results li {
  padding: 14px 16px;
  cursor: pointer;
  border-radius: var(--radius);
  margin-bottom: 4px;
  border: 1px solid transparent;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: background 0.1s, border-color 0.1s;
}
.results li:hover { background: var(--bg-hover); }
.results li.active {
  background: var(--bg-hover);
  border-color: var(--accent);
}
.id { font-family: var(--font-mono); color: var(--text-primary); font-size: 1em; font-weight: 500; }
.version {
  margin-left: auto;
  color: var(--text-secondary);
  font-size: 0.9em;
  font-family: var(--font-mono);
}

/* Version list items */
.versions ul li {
  padding: 12px 14px;
  cursor: pointer;
  border-radius: var(--radius);
  margin-bottom: 4px;
  border: 1px solid transparent;
  display: grid;
  grid-template-columns: 1fr auto auto auto auto;
  align-items: center;
  gap: 12px;
  transition: background 0.1s, border-color 0.1s;
}
.versions ul li:hover { background: var(--bg-hover); }
.versions ul li.active {
  background: var(--bg-hover);
  border-color: var(--accent);
}
.versions ul li.latest {
  border-left: 3px solid var(--accent);
}
.ver { font-family: var(--font-mono); font-size: 1em; }
.time { color: var(--text-muted); font-size: 0.85em; font-family: var(--font-mono); }
.status {
  font-size: 0.75em;
  padding: 3px 10px;
  border-radius: 12px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.status.stable { background: var(--status-stable); color: white; }
.status.alpha { background: var(--status-alpha); color: white; }
.status.beta { background: var(--status-beta); color: white; }
.status.snapshot { background: var(--status-snapshot); color: white; }
.latest-badge {
  background: var(--accent);
  color: white;
  font-size: 0.7em;
  padding: 3px 8px;
  border-radius: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

/* Error box */
.error-box {
  padding: 12px 14px;
  background: var(--error-bg);
  border: 1px solid var(--error-border);
  border-radius: var(--radius);
  margin-bottom: 12px;
}
.error-box pre {
  font-size: 0.85em;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  font-family: var(--font-mono);
  background: var(--bg-primary);
  padding: 8px;
  border-radius: var(--radius);
  margin: 8px 0;
}

/* Headers / footers */
header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
  flex-wrap: wrap;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
}
.hint-mini {
  color: var(--text-muted);
  font-size: 0.78em;
  margin-left: auto;
  font-family: var(--font-mono);
}
footer {
  margin-top: 6px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 0.85em;
  font-family: var(--font-mono);
}

/* Empty state */
.empty {
  color: var(--text-muted);
  padding: 32px 16px;
  text-align: center;
  font-size: 1.05em;
}
.empty .hint-proxy {
  margin-top: 12px;
  padding: 8px 12px;
  background: var(--bg-hover);
  border-radius: var(--radius);
  font-size: 0.9em;
  color: var(--text-secondary);
}
.empty a {
  color: var(--accent);
  display: block;
  margin-top: 12px;
  text-decoration: none;
  font-size: 0.95em;
}
.empty a:hover { text-decoration: underline; }

/* Buttons */
button {
  background: transparent;
  color: var(--accent);
  border: 1px solid var(--border);
  padding: 6px 12px;
  border-radius: var(--radius);
  font-size: 0.95em;
  transition: background 0.1s;
}
button:hover { background: var(--bg-hover); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.more { margin-top: 12px; display: block; width: 100%; padding: 10px; }

/* Always-visible source tip */
.source-tip {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 0.75em;
  color: var(--text-muted);
  background: var(--bg-secondary);
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  padding: 3px 8px;
  margin-bottom: 6px;
}
.source-tip .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--status-beta);
  flex-shrink: 0;
}
.source-tip b { color: var(--text-secondary); }

/* Category filter */
.cats {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.cats-label {
  font-size: 0.78em;
  color: var(--text-muted);
  margin-right: 2px;
}
.cat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.82em;
  cursor: pointer;
  transition: all 0.1s;
}
.cat:hover { border-color: var(--accent); color: var(--accent); }
.cat.active {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}
.cat .cat-count {
  font-size: 0.75em;
  font-family: var(--font-mono);
  padding: 0 5px;
  border-radius: 999px;
  background: rgba(128,128,128,0.2);
}
.cat.active .cat-count { background: rgba(255,255,255,0.25); }

/* Source tabs */
.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.85em;
  cursor: pointer;
  transition: all 0.1s;
}
.tab:hover { border-color: var(--accent); color: var(--accent); }
.tab.active {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}
.tab-count {
  font-size: 0.75em;
  font-family: var(--font-mono);
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(128,128,128,0.2);
}
.tab.active .tab-count { background: rgba(255,255,255,0.25); }

/* Source tag in "all" tab */
.src-tag {
  font-size: 0.7em;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 500;
}
.src-solr { background: var(--status-stable); color: white; }
.src-aliyun { background: var(--status-snapshot); color: white; }
.src-coderead { background: var(--status-beta); color: white; }

/* Right-side "quick copy" shortcut hint on result rows */
.copy-hint {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--text-muted);
  font-size: 0.72em;
  white-space: nowrap;
}
.copy-hint kbd {
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 0 5px;
  font-size: 0.9em;
}
.copy-hint.muted kbd { border-style: dashed; color: var(--accent); }
.results li.active .copy-hint { color: var(--text-secondary); }

/* Settings button — always visible, top-right */
.settings-btn {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: 1px solid var(--border);
  padding: 6px 12px;
  border-radius: var(--radius);
  font-size: 0.95em;
  white-space: nowrap;
}
.settings-btn:hover { background: var(--bg-hover); border-color: var(--accent); color: var(--accent); }

/* Panel footer (results view) — open-source link lives here. */
.panel-footer {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 8px 0 4px;
  margin-top: 4px;
  border-top: 1px solid var(--border);
}
.footer-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  text-decoration: none;
  font-size: 0.8em;
  transition: color 0.1s;
}
.footer-link:hover { color: var(--accent); }
.github-icon { display: inline-flex; align-items: center; }

/* Back button (CSS arrow) */
.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.back-btn svg { transition: transform 0.1s; }
.back-btn:hover svg { transform: translateX(-2px); }

/* Details toggle arrow (CSS triangle, rotates when open) */
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

.result-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
}
.search-tip {
  color: var(--text-muted);
  font-size: 0.78em;
  font-family: var(--font-mono);
}

/* Loading state */
.loading {
  padding: 32px;
  text-align: center;
  color: var(--text-muted);
  font-size: 1.05em;
}

/* Menu overlay */
.menu-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  backdrop-filter: blur(2px);
}
.menu-box {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  min-width: 320px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.3);
}
.menu-box button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  text-align: left;
  margin-bottom: 6px;
  padding: 12px 14px;
  font-size: 1em;
  border-radius: 6px;
}
.menu-box button:last-child { margin-bottom: 0; }
.menu-box button.focused {
  background: var(--bg-hover);
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.menu-box .hint {
  color: var(--text-muted);
  font-size: 0.8em;
  font-family: var(--font-mono);
  padding: 2px 8px;
  background: var(--bg-hover);
  border-radius: 4px;
}
.menu-box .group-tag {
  color: var(--text-muted);
  font-size: 0.75em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  margin-right: 8px;
}

/* Help overlay */
.help-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  backdrop-filter: blur(2px);
}
.help-box {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 24px;
  min-width: 360px;
  max-width: 480px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.4);
}
.help-box h3 { margin-top: 0; margin-bottom: 12px; }
.help-box ul { padding-left: 0; list-style: none; }
.help-box li { padding: 6px 0; font-size: 0.95em; }
kbd {
  background: var(--bg-hover);
  padding: 2px 8px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 0.85em;
  border: 1px solid var(--border);
  margin: 0 2px;
}
</style>

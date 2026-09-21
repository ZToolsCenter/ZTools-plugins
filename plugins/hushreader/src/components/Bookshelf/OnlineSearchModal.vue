<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import Modal from './Modal.vue'
import { useBookStore } from '../../stores/books'
import { useOnlineStore } from '../../stores/online'
import { searchOnlineBooks, fetchBookInfo, downloadCoverToDataUrl, type OnlineSearchHit } from '../../utils/onlineBook'

const emit = defineEmits<{ close: [] }>()

const bookStore = useBookStore()
const onlineStore = useOnlineStore()

/** Cookie Jar 上下文：搜索/详情页请求自动携带/保存书源域名 Cookie */
function buildCookieCtx() {
  return {
    getCookie: (url: string) => onlineStore.jarCookie(url),
    saveCookies: (url: string, cookies: string[]) => onlineStore.saveJarCookies(url, cookies)
  }
}

const keyword = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)
// 搜索结果封面加载失败集合（失败显示占位符，避免空白）
const failedCovers = ref<Set<string>>(new Set())
function onCoverLoad(url: string, e: Event) {
  failedCovers.value = new Set([...failedCovers.value].filter(u => u !== url))
  ;(e.target as HTMLElement).style.display = ''
}
function onCoverError(url: string, e: Event) {
  failedCovers.value = new Set([...failedCovers.value, url])
  ;(e.target as HTMLElement).style.display = 'none'
}
// 每个分组默认选中，便于一开始全选
const selectedGroupIds = ref<string[]>(onlineStore.groups.map(g => g.id))

onMounted(() => {
  searchInputRef.value?.focus()
})

// 分组列表（含书源数量）
const groups = computed(() =>
  onlineStore.groups.map(g => ({
    id: g.id,
    name: g.name,
    count: g.sources.length
  }))
)

// 新增/初始化分组时默认全选
watch(() => onlineStore.groups.map(g => g.id).join(','), (idsKey) => {
  const current = new Set(selectedGroupIds.value)
  for (const id of idsKey.split(',').filter(Boolean)) {
    if (!current.has(id)) current.add(id)
  }
  selectedGroupIds.value = Array.from(current)
})

function toggleGroup(groupId: string) {
  const setVal = new Set(selectedGroupIds.value)
  if (setVal.has(groupId)) setVal.delete(groupId)
  else setVal.add(groupId)
  selectedGroupIds.value = Array.from(setVal)
}

function selectAllGroups() {
  selectedGroupIds.value = onlineStore.groups.map(g => g.id)
}

function clearGroups() {
  selectedGroupIds.value = []
}

/** 当前参与搜索的书源（携带分组标识） */
const searchEntries = computed(() => {
  const selected = new Set(selectedGroupIds.value)
  return onlineStore.groups
    .filter(g => selected.has(g.id))
    .flatMap(g => g.sources.map(source => ({ source, groupName: g.name })))
})
const searching = ref(false)
const results = ref<OnlineSearchHit[]>([])
const doneSources = ref<string[]>([])
const errorMsg = ref('')
const addingIds = ref<Set<string>>(new Set())

const sourceCount = computed(() => onlineStore.groups.reduce((n, g) => n + g.sources.length, 0))

const addedUrls = computed(() => new Set(
  bookStore.books
    .filter(b => b.format === 'online' && b.onlineKind === 'source')
    .map(b => b.bookUrl)
))

async function doSearch() {
  const kw = keyword.value.trim()
  if (!kw) return
  if (onlineStore.groups.length === 0) {
    errorMsg.value = '尚未添加任何书源，请先在「设置 → 在线」中添加书源'
    return
  }
  if (searchEntries.value.length === 0) {
    errorMsg.value = '请至少选择一个书源分组后再搜索'
    return
  }
  searching.value = true
  errorMsg.value = ''
  results.value = []
  doneSources.value = []
  try {
    results.value = await searchOnlineBooks(kw, searchEntries.value, (name) => {
      doneSources.value.push(name)
    }, buildCookieCtx())
    if (results.value.length === 0) {
      errorMsg.value = '未找到匹配的书籍，可尝试更换关键词或增加书源'
    }
  } catch (e: any) {
    errorMsg.value = `搜索失败：${e?.message || e}`
  } finally {
    searching.value = false
  }
}

async function addToShelf(hit: OnlineSearchHit) {
  if (addingIds.value.has(hit.url)) return
  if (addedUrls.value.has(hit.url)) return
  addingIds.value = new Set(addingIds.value).add(hit.url)
  try {
    let title = hit.title
    let author = hit.author
    let description = hit.intro || hit.remark
    let tocUrl = hit.tocUrl
    let latestChapterTitle = hit.newest
    let wordCount = hit.wordCount
    let kind = hit.kind
    let cover: string | undefined

    // 详情页入库：按 ruleBookInfo 拉取完整书籍信息（书源无详情规则或详情页失败时回退搜索信息）
    try {
      const info = await fetchBookInfo({
        id: hit.url,
        bookUrl: hit.url,
        onlineKind: 'source',
        source: hit.source
      }, { cookie: buildCookieCtx() })
      title = info.title || title
      author = info.author || author
      description = info.intro || description
      tocUrl = info.tocUrl || tocUrl
      latestChapterTitle = info.latestChapterTitle || latestChapterTitle
      wordCount = info.wordCount || wordCount
      kind = info.kind || kind
      if (info.coverUrl) cover = (await downloadCoverToDataUrl(info.coverUrl, normHeaders(hit.source))) || undefined
    } catch {
      /* 回退搜索结果信息 */
    }
    if (!cover && hit.cover) {
      // data URL 下载失败时用直链兜底（书架直接加载直链，图床可达即显示）
      cover = (await downloadCoverToDataUrl(hit.cover, normHeaders(hit.source))) || hit.cover
    }

    bookStore.addOnlineBook({
      title,
      author,
      description,
      onlineKind: 'source',
      bookUrl: hit.url,
      bookId: hit.bookId,
      source: hit.source,
      sourceName: hit.sourceName,
      cover,
      tocUrl,
      latestChapterTitle,
      wordCount,
      kind
    })
  } finally {
    const next = new Set(addingIds.value)
    next.delete(hit.url)
    addingIds.value = next
  }
}

/** 取书源 header（封面下载携带 Referer/UA，防图床防盗链） */
function normHeaders(source: any): Record<string, string> | undefined {
  if (!source) return undefined
  try {
    const raw = typeof source.header === 'string' ? source.header : JSON.stringify(source.header ?? {})
    const h = JSON.parse(raw || '{}')
    return Object.keys(h).length ? h : undefined
  } catch {
    return undefined
  }
}
</script>

<template>
  <Modal title="在线搜书" @close="emit('close')">
    <div class="online-search">
      <div class="search-bar">
        <div class="search-field">
          <svg class="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" />
          </svg>
          <input ref="searchInputRef" v-model="keyword" class="search-input" placeholder="输入书名或作者关键词…"
            spellcheck="false" @keydown.enter="doSearch" />
        </div>
        <button class="btn-primary" :disabled="!keyword.trim() || searching || sourceCount === 0" @click="doSearch">
          <span v-if="searching" class="spinner" style="width:14px;height:14px;border-width:1.5px;margin-right:4px"></span>
          搜索
        </button>
      </div>
      <p v-if="sourceCount === 0" class="hint-block">
        尚未添加书源，请先在
        <b>设置 → 在线</b> 中导入书源后再搜索。
      </p>
      <template v-else>
        <div class="group-filter">
          <div class="group-filter-head">
            <span class="source-info">书源分组：{{ searchEntries.length }} 个书源</span>
            <div class="group-filter-actions">
              <button class="group-filter-link" @click="selectAllGroups">全选</button>
              <button class="group-filter-link" @click="clearGroups">清空</button>
            </div>
          </div>
          <div class="group-chips">
            <button v-for="g in groups" :key="g.id" class="group-chip"
              :class="{ active: selectedGroupIds.includes(g.id), disabled: g.count === 0 }"
              :disabled="g.count === 0" @click="toggleGroup(g.id)">
              <svg v-if="selectedGroupIds.includes(g.id)" class="group-chip-check" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>{{ g.name }}</span>
              <span class="group-chip-count">{{ g.count }}</span>
            </button>
          </div>
        </div>
        <template v-if="searching">
          <p class="source-info">正在搜索 {{ doneSources.length }}/{{ searchEntries.length }} 个书源…</p>
        </template>
      </template>

      <div v-if="errorMsg && !searching" class="search-error">{{ errorMsg }}</div>

      <div class="result-list" v-if="results.length > 0">
        <div v-for="hit in results" :key="hit.url" class="result-item">
          <div class="result-cover">
            <span v-if="!hit.cover || failedCovers.has(hit.url)" class="cover-placeholder">书</span>
            <img v-if="hit.cover" :src="hit.cover" alt="" loading="lazy" referrerpolicy="no-referrer"
                 @load="onCoverLoad(hit.url, $event)" @error="onCoverError(hit.url, $event)" />
          </div>
          <div class="result-info">
            <div class="result-line">
              <span class="result-title">{{ hit.title }}</span>
              <span class="result-group" v-if="hit.sourceGroup">{{ hit.sourceGroup }}</span>
              <span class="result-source" v-if="!hit.sourceCount">{{ hit.sourceName }}</span>
              <span class="result-multi" v-else>{{ hit.sourceCount }} 个书源</span>
            </div>
            <div class="result-sub">{{ hit.author || '未知作者' }}{{ hit.kind ? ` · ${hit.kind}` : '' }}{{ hit.wordCount ? ` · ${hit.wordCount}` : '' }}</div>
            <div v-if="hit.newest || hit.intro" class="result-sub result-meta">
              {{ hit.newest ? `最新：${hit.newest}` : '' }}{{ hit.newest && hit.intro ? ' · ' : '' }}{{ hit.intro }}
            </div>
          </div>
          <button class="btn-primary add-btn" :disabled="addedUrls.has(hit.url) || addingIds.has(hit.url)"
            @click="addToShelf(hit)">
            <span v-if="addingIds.has(hit.url)" class="spinner" style="width:13px;height:13px;border-width:1.5px"></span>
            <template v-else>{{ addedUrls.has(hit.url) ? '已加入' : '加入' }}</template>
          </button>
        </div>
      </div>

      <div v-if="searching" class="list-loading">
        <div class="spinner"></div>
        <span>正在搜索，请稍候…</span>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.online-search {
  min-width: 420px;
}

.search-bar {
  display: flex;
  gap: 8px;
  align-items: center;
}

.search-field {
  position: relative;
  flex: 1;
  min-width: 0;
}

.search-field:focus-within .search-icon {
  color: var(--c-accent);
}

.search-icon {
  position: absolute;
  left: 11px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--c-ink-tertiary);
  pointer-events: none;
  transition: color 0.15s var(--ease-out);
}

.search-input {
  width: 100%;
  height: 36px;
  padding: 0 34px 0 34px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-md);
  background: var(--c-surface-sunken);
  color: var(--c-ink);
  font-size: 13px;
  transition: border-color 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out), background 0.15s var(--ease-out);
}

.search-input::placeholder {
  color: var(--c-ink-tertiary);
}

.search-input:hover {
  background: var(--c-surface);
  border-color: var(--c-border-strong);
}

.search-input:focus {
  background: var(--c-surface);
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-soft);
}

.btn-primary {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  padding: 0 18px;
  border-radius: var(--radius-md);
  background: var(--c-accent);
  color: var(--c-ink-inverse);
  font-size: 13px;
  font-weight: 500;
  transition: background 0.15s var(--ease-out), transform 0.1s var(--ease-out), box-shadow 0.15s var(--ease-out), opacity 0.15s var(--ease-out);
}

.btn-primary:hover:not(:disabled) {
  background: var(--c-accent-hover);
  box-shadow: 0 2px 8px var(--c-accent-soft);
}

.btn-primary:active:not(:disabled) {
  transform: translateY(1px);
}

.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid var(--c-border-strong);
  border-top-color: var(--c-accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  flex-shrink: 0;
}

.hint-block {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--c-accent-soft);
  color: var(--c-accent);
  font-size: 12px;
  line-height: 1.6;
}

.source-info {
  margin-top: 10px;
  font-size: 12px;
  color: var(--c-ink-tertiary);
}

.group-filter {
  margin-top: 8px;
}

.group-filter-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.group-filter-head .source-info {
  margin-top: 0;
}

.group-filter-actions {
  display: flex;
  gap: 10px;
}

.group-filter-link {
  font-size: 12px;
  color: var(--c-accent);
  cursor: pointer;
}

.group-filter-link:hover {
  color: var(--c-accent-hover);
  text-decoration: underline;
}

.group-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.group-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-full);
  background: var(--c-surface-sunken);
  font-size: 12px;
  color: var(--c-ink-secondary);
  transition: all 0.12s var(--ease-out);
}

.group-chip:hover:not(:disabled) {
  border-color: var(--c-border-strong);
  background: var(--c-surface);
}

.group-chip.active {
  background: var(--c-accent);
  border-color: var(--c-accent);
  color: var(--c-ink-inverse);
  font-weight: 500;
}

.group-chip.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.group-chip-check {
  display: inline-flex;
}

.group-chip-count {
  font-size: 10px;
  opacity: 0.75;
}

.search-error {
  margin-top: 10px;
  font-size: 13px;
  color: var(--c-ink-tertiary);
}

.result-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  max-height: 380px;
  overflow-y: auto;
}

.result-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-md);
  background: var(--c-surface);
  transition: border-color 0.15s var(--ease-out);
}

.result-item:hover {
  border-color: var(--c-accent-muted);
}

.result-cover {
  width: 42px;
  height: 58px;
  flex-shrink: 0;
  border-radius: var(--radius-xs);
  overflow: hidden;
  background: var(--c-surface-sunken);
  display: flex;
  align-items: center;
  justify-content: center;
}

.result-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-placeholder {
  font-size: 18px;
  color: var(--c-ink-tertiary);
}

.result-info {
  flex: 1;
  min-width: 0;
}

.result-line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.result-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-source {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--c-accent);
  background: var(--c-accent-soft);
  padding: 1px 6px;
  border-radius: var(--radius-full);
}

.result-group {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--c-ink-tertiary);
  background: var(--c-surface-sunken);
  border: 1px solid var(--c-border);
  padding: 1px 6px;
  border-radius: var(--radius-full);
}

.result-multi {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  color: var(--c-success);
  background: var(--c-success-soft);
  padding: 1px 6px;
  border-radius: var(--radius-full);
}

.result-sub {
  margin-top: 2px;
  font-size: 11px;
  color: var(--c-ink-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-meta {
  opacity: 0.85;
}

.add-btn {
  flex-shrink: 0;
  height: 30px;
  padding: 0 14px;
  font-size: 12px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  gap: 4px;
}

.list-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 28px;
  color: var(--c-ink-tertiary);
  font-size: 13px;
}
</style>

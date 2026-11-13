<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import ChannelBrowser from './components/ChannelBrowser.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import DisclaimerDialog from './components/DisclaimerDialog.vue'
import HistoryList from './components/HistoryList.vue'
import PlaybackDetails from './components/PlaybackDetails.vue'
import ResultList from './components/ResultList.vue'
import { clearHistory, readHistory, removeHistory, type HistoryEntry } from './history'
import { openPlaybackWindow } from './playbackWindow'
import { acceptDisclaimer, readDisclaimerAccepted } from './prefs'
import { readInput, service } from './service'
import type { PlaybackRequest, Result } from './types'

const input = ref('')
const navigation = [
  { key: 'movie', label: '电影' },
  { key: 'tv', label: '电视剧' },
  { key: 'anime', label: '动漫' },
] as const
type NavigationKey = (typeof navigation)[number]['key']
// 打开插件直接进入电影频道。
const channel = ref<NavigationKey>('movie')
const channelLabel = computed(() => navigation.find(item => item.key === channel.value)?.label ?? '')
const searchInput = ref<HTMLInputElement | null>(null)
const results = ref<Result[]>([])
const searched = ref(false)
// 有搜索词时用搜索结果覆盖频道列表。
const showingResults = computed(() => searched.value && (results.value.length > 0 || Boolean(busy.value) || Boolean(error.value)))
// browse 是搜索/频道页，history 是播放记录页。
const view = ref<'browse' | 'history'>('browse')
const previewPlayback = ref<PlaybackRequest>()
const windowError = ref('')
const history = ref<HistoryEntry[]>(readHistory())
// 只在第一次使用时弹出免责声明，确认后不再打扰。
const showDisclaimer = ref(!readDisclaimerAccepted())
const busy = ref('')
const error = ref('')
let session = 0
let mounted = true
let browseScroll = 0

function invalidate() {
  session++
  service.cancel()
  return session
}

function showBrowse() {
  invalidate()
  previewPlayback.value = undefined
  busy.value = ''
  error.value = ''
  windowError.value = ''
  void nextTick(() => window.scrollTo(0, browseScroll))
}

/**
 * 切换频道，同时清掉搜索结果，回到频道列表。
 * @param key 目标频道。
 */
function switchChannel(key: NavigationKey) {
  const sameChannel = channel.value === key && !previewPlayback.value && view.value === 'browse'
  if (sameChannel && !searched.value) return
  if (channel.value !== key) browseScroll = 0
  channel.value = key
  view.value = 'browse'
  // 切频道视为放弃当前搜索，回到该频道的列表。
  searched.value = false
  results.value = []
  input.value = ''
  showBrowse()
}

/**
 * 切换播放记录页。
 * @param target 目标视图，默认在浏览页和记录页之间切换。
 */
function showHistory(target: 'browse' | 'history' = 'history') {
  view.value = target
  refreshHistory()
  if (target === 'history') window.scrollTo(0, 0)
}

function explain(cause: unknown) {
  return cause instanceof Error ? cause.message : '请求失败，请稍后重试。'
}

function play(request: PlaybackRequest) {
  windowError.value = ''
  try {
    if (typeof ztools !== 'undefined') {
      openPlaybackWindow(request)
    } else if (import.meta.env.DEV) {
      browseScroll = window.scrollY
      previewPlayback.value = request
      void nextTick(() => window.scrollTo(0, 0))
    } else throw new Error('请在 ZTools 中打开插件。')
  } catch (cause) {
    windowError.value = '打开播放窗口失败：' + explain(cause)
  }
}

function openResult(v: string, title = '', cover: string | null = null) {
  play({ kind: 'catalog', v, title, cover })
}

/**
 * 从播放记录继续观看。
 * @param entry 播放记录。
 */
function openHistory(entry: HistoryEntry) {
  if (entry.kind === 'direct' && entry.source) {
    play({ kind: 'direct', source: entry.source, title: entry.title })
  } else if (entry.v) {
    play({ kind: 'catalog', v: entry.v, title: entry.title, cover: entry.cover })
  }
}

/**
 * 主窗口重新获得焦点时刷新记录，让播放窗口写入的进度及时出现。
 * 播放窗口是独立进程，必须绕开本进程的缓存重新读。
 */
function refreshHistory() {
  history.value = readHistory(true)
}

// 删除是破坏性操作，先弹窗确认再执行。
const pendingDelete = ref<{ key: string; title: string } | null>(null)
const pendingClear = ref(false)

function forget(key: string) {
  const entry = history.value.find(item => item.key === key)
  pendingDelete.value = { key, title: entry?.title || '这条记录' }
}

function forgetAll() {
  pendingClear.value = true
}

function confirmDelete() {
  if (!pendingDelete.value) return
  removeHistory(pendingDelete.value.key)
  pendingDelete.value = null
  refreshHistory()
}

function confirmClear() {
  clearHistory()
  pendingClear.value = false
  refreshHistory()
}

/**
 * 用户确认免责声明后，记下这一状态并关闭弹窗。
 */
function confirmDisclaimer() {
  acceptDisclaimer()
  showDisclaimer.value = false
  // 弹窗期间输入框拿不到焦点，关闭后补上。
  void nextTick(() => searchInput.value?.focus({ preventScroll: true }))
}

async function submit() {
  const query = input.value.trim()
  view.value = 'browse'
  browseScroll = 0
  // 清空输入并提交后回到频道列表。
  if (!query) {
    searched.value = false
    results.value = []
    showBrowse()
    return
  }
  const task = invalidate()
  windowError.value = ''
  error.value = ''
  busy.value = ''
  previewPlayback.value = undefined
  try {
    if (query.length > 8192) throw new Error('输入过长。')
    const parsed = readInput(query)
    if (parsed && 'v' in parsed) return openResult(parsed.v)
    if (parsed && 'source' in parsed) return play({ kind: 'direct', ...parsed })
    busy.value = '正在搜索…'
    searched.value = true
    results.value = []
    const matches = await service.search(query)
    if (session === task) results.value = matches
  } catch (cause) {
    if (session === task) error.value = explain(cause)
  } finally {
    if (session === task) busy.value = ''
  }
}

/**
 * 清空搜索，回到当前频道的列表。
 */
function clearSearch() {
  input.value = ''
  searched.value = false
  results.value = []
  showBrowse()
  void nextTick(() => searchInput.value?.focus({ preventScroll: true }))
}

// 播放窗口在独立进程里写入记录，靠 preload 的中继消息通知主窗口。
const stopHistory = window.videoHistory?.onChange(refreshHistory)

onMounted(() => {
  window.addEventListener('focus', refreshHistory)
  if (typeof ztools === 'undefined') return
  ztools.onPluginEnter(({ code, payload, type }) => {
    if (!mounted || code !== 'video-search') return
    refreshHistory()
    if (type === 'regex' && typeof payload === 'string') {
      input.value = payload.slice(0, 300)
      void submit()
    } else {
      void nextTick(() => searchInput.value?.focus())
    }
  })
  ztools.onPluginOut(() => {
    if (!mounted) return
    invalidate()
    busy.value = ''
    error.value = ''
    windowError.value = ''
  })
})

onBeforeUnmount(() => {
  mounted = false
  window.removeEventListener('focus', refreshHistory)
  stopHistory?.()
  invalidate()
})
</script>

<template>
  <main class="shell">
    <header class="topbar">
      <div class="topbar-row">
        <nav class="channel-nav" aria-label="影视频道">
          <button v-for="item in navigation" :key="item.key" type="button"
            :aria-current="channel === item.key && view === 'browse' && !showingResults ? 'page' : undefined"
            @click="switchChannel(item.key)">{{ item.label }}</button>
        </nav>
        <form v-if="view === 'browse'" class="search-form topbar-search" role="search" @submit.prevent="submit">
          <label class="searchbox">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5" stroke="currentColor" stroke-width="1.7"/><path d="m15 15 4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
            <input ref="searchInput" v-model="input" type="search" aria-label="片名或播放链接" autocomplete="off" spellcheck="false"
              placeholder="搜索片名或粘贴链接，回车确认" maxlength="8192" @keydown.enter.prevent="submit">
          </label>
        </form>
        <button type="button" class="icon-button history-toggle" :class="{ active: view === 'history' }"
          :aria-label="view === 'history' ? '返回浏览' : '播放记录'" :aria-pressed="view === 'history'"
          :title="view === 'history' ? '返回浏览' : '播放记录'" @click="showHistory(view === 'history' ? 'browse' : 'history')">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="8.2" stroke="currentColor" stroke-width="1.6"/>
            <path d="M12 7.6V12l3 1.9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span v-if="history.length" class="history-count">{{ history.length > 99 ? '99+' : history.length }}</span>
        </button>
      </div>
    </header>

    <div v-if="windowError" class="state-panel failure playback-window-error" role="alert">{{ windowError }}</div>

    <!-- 搜索结果覆盖频道列表；清空或切频道后回到频道。 -->
    <section v-if="!previewPlayback && view === 'browse' && showingResults" class="content" aria-label="搜索结果">
      <div v-if="busy || error" class="state-panel" :class="{ failure: error }" role="status">
        <span v-if="busy" class="spinner" aria-hidden="true"></span><span>{{ error || busy }}</span>
        <button v-if="error && input" class="secondary" type="button" @click="submit">重试</button>
      </div>
      <template v-else>
        <div class="section-heading results-heading">
          <h2>搜索结果<span>{{ results.length }} 部</span></h2>
          <button type="button" class="link-button" @click="clearSearch">返回{{ channelLabel }}</button>
        </div>
        <ResultList v-if="results.length" :results="results" @open="result => openResult(result.v, result.title, result.cover)" />
        <div v-else class="empty">
          <h2>没有找到相关影片</h2><p>试试更短的片名或别名。</p>
        </div>
      </template>
    </section>

    <section v-if="!previewPlayback && view === 'history'" class="content history-page" aria-label="播放记录">
      <div class="section-heading page-heading">
        <h2>播放记录<span v-if="history.length">{{ history.length }} 部</span></h2>
        <button v-if="history.length" type="button" class="link-button" @click="forgetAll">清空记录</button>
      </div>
      <HistoryList v-if="history.length" :entries="history" @open="openHistory" @remove="forget" />
      <div v-else class="empty">
        <div class="empty-icon" aria-hidden="true"><svg viewBox="0 0 28 28" fill="none"><circle cx="14" cy="14" r="9.5" stroke="currentColor" stroke-width="1.5"/><path d="M14 8.6V14l3.6 2.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <h2>还没有播放记录</h2>
        <p>看过的剧集和进度会保存在这里。</p>
        <div class="examples"><button class="secondary" type="button" @click="showHistory('browse')">去搜索</button></div>
      </div>
    </section>

    <ChannelBrowser v-show="!previewPlayback && view === 'browse' && !showingResults"
      :channel="channel" :label="channelLabel" @open="result => openResult(result.v, result.title, result.cover)" />

    <PlaybackDetails v-if="previewPlayback" :request="previewPlayback" inline @back="showBrowse" />

    <ConfirmDialog v-if="pendingDelete" title="删除播放记录"
      :message="`确定删除「${pendingDelete.title}」的播放记录吗？删除后无法恢复。`"
      @confirm="confirmDelete" @cancel="pendingDelete = null" />
    <ConfirmDialog v-if="pendingClear" title="清空播放记录"
      :message="`确定清空全部 ${history.length} 条播放记录吗？删除后无法恢复。`"
      confirm-text="清空" @confirm="confirmClear" @cancel="pendingClear = false" />

    <DisclaimerDialog v-if="showDisclaimer" @accept="confirmDisclaimer" />
  </main>
</template>

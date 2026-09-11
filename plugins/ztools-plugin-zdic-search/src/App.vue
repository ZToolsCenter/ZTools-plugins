<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

const ZDIC_BASE_URL = 'https://zdic.net'
const ZDIC_HANS_PREFIX = 'https://zdic.net/hans/'
const ZDIC_SEARCH_PREFIX = 'https://zdic.net/search/?q='

const initialUrl = ref('')
const webviewRef = ref<any>(null)
const loadError = ref(false)
const currentQuery = ref('')
const isNavigating = ref(false)
// webview 内容可见性：主文档导航期间遮住内容，待滚动条样式注入完成后再淡入，
// 消除“原生滚动条 → 自定义滚动条”的视觉闪烁
const contentRevealed = ref(true)

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let revealTimeout: ReturnType<typeof setTimeout> | null = null
const hansMissCache = new Set<string>()

const DEBUG = false
function log(...args: any[]) {
  if (DEBUG) console.log('[zdic]', ...args)
}

const SCROLLBAR_CSS = `
  ::-webkit-scrollbar {
    width: 6px !important;
    height: 6px !important;
  }
  ::-webkit-scrollbar-track {
    background: transparent !important;
  }
  ::-webkit-scrollbar-thumb {
    background: rgba(128, 128, 128, 0.25) !important;
    border-radius: 3px !important;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: rgba(128, 128, 128, 0.45) !important;
  }
  ::-webkit-scrollbar-corner {
    background: transparent !important;
  }
`

/**
 * 注入自定义滚动条样式。insertCSS 不跨导航持久，需在每次文档就绪后重新注入。
 * @returns 注入完成的 Promise
 */
function injectCustomScrollbar(): Promise<unknown> {
  if (!webviewRef.value) return Promise.resolve()
  return webviewRef.value.insertCSS(SCROLLBAR_CSS).catch(() => {})
}

/**
 * 显示 webview 内容（清除遮罩兜底定时器）
 */
function revealContent() {
  if (revealTimeout) {
    clearTimeout(revealTimeout)
    revealTimeout = null
  }
  contentRevealed.value = true
}

/**
 * 主文档导航开始：遮住内容 + 设定兜底超时（防止注入链路异常导致永久白屏）
 */
function maskContent() {
  contentRevealed.value = false
  if (revealTimeout) clearTimeout(revealTimeout)
  revealTimeout = setTimeout(revealContent, 2000)
}

function onWebviewNavigationStart(_event: unknown, _url: string, isInPlace: boolean, isMainFrame: boolean) {
  if (isMainFrame && !isInPlace) {
    maskContent()
  }
}

/**
 * DOM 就绪：立即注入滚动条样式（比 onload 早得多），注入完成后短暂缓冲再淡入，
 * 确保首帧可见时滚动条已是自定义样式
 */
function onWebviewDomReady() {
  const url = webviewRef.value?.getURL?.() || ''
  if (!url || url === 'about:blank') return
  injectCustomScrollbar().then(() => {
    setTimeout(revealContent, 80)
  })
}

function navigateTo(url: string) {
  isNavigating.value = true
  loadError.value = false
  if (webviewRef.value) {
    log('navigate in-webview:', url)
    webviewRef.value.executeJavaScript(`location.href = '${url}'`).catch(() => {})
  }
}

function searchQuery(query: string) {
  if (!query || !query.trim()) return
  const q = query.trim()
  currentQuery.value = q
  if (hansMissCache.has(q)) {
    navigateTo(ZDIC_SEARCH_PREFIX + encodeURIComponent(q))
  } else {
    navigateTo(ZDIC_HANS_PREFIX + encodeURIComponent(q))
  }
}

function debouncedSearch(query: string, delay = 800) {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    searchQuery(query)
  }, delay)
}

function checkAndRedirect() {
  if (!webviewRef.value) return
  const url = webviewRef.value.getURL?.() || ''
  log('checkAndRedirect, url:', url)
  if (!url.includes('/hans/')) {
    isNavigating.value = false
    return
  }
  webviewRef.value.executeJavaScript(`
    (function() {
      var text = document.body ? document.body.innerText || '' : '';
      if (text.includes('route snapshot') && !document.querySelector('.content') && !document.querySelector('.entry')) {
        var match = location.pathname.match(/\\/hans\\/(.+)/);
        if (match && match[1]) {
          document.documentElement.style.display = 'none';
          return decodeURIComponent(match[1]);
        }
      }
      return null;
    })()
  `).then((missQuery: string | null) => {
    log('checkAndRedirect result:', missQuery)
    if (missQuery) {
      hansMissCache.add(missQuery)
      const searchUrl = ZDIC_SEARCH_PREFIX + encodeURIComponent(missQuery)
      webviewRef.value.executeJavaScript(`location.href = '${searchUrl}'`).catch(() => {})
    } else {
      isNavigating.value = false
    }
  }).catch(() => {
    isNavigating.value = false
  })
}

onMounted(() => {
  window.ztools.onPluginEnter((action) => {
    log('onPluginEnter', action.code, action.payload)
    isNavigating.value = true
    loadError.value = false

    if (action.code === 'zdic-home') {
      initialUrl.value = ZDIC_BASE_URL
    } else if (action.code === 'zdic-search' && action.payload) {
      const query = String(action.payload)
      currentQuery.value = query
      initialUrl.value = ZDIC_HANS_PREFIX + encodeURIComponent(query)
    }

    window.ztools.setSubInput(
      ({ text }: { text: string }) => {
        if (isNavigating.value) return
        if (!text.trim()) return
        if (text.trim() === currentQuery.value) return
        debouncedSearch(text)
      },
      '输入汉字或词语查询...',
      true
    )

    if (action.code === 'zdic-search' && action.payload) {
      window.ztools.setSubInputValue(String(action.payload))
    }
  })

  window.ztools.onPluginOut(() => {
    log('onPluginOut')
    initialUrl.value = ''
    currentQuery.value = ''
    loadError.value = false
    isNavigating.value = false
    if (debounceTimer) clearTimeout(debounceTimer)
  })
})

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (revealTimeout) clearTimeout(revealTimeout)
})

function onWebviewLoad() {
  const url = webviewRef.value?.getURL?.() || ''
  log('did-finish-load:', url)
  revealContent()
  if (!url || url === 'about:blank') return
  loadError.value = false
  injectCustomScrollbar()
  checkAndRedirect()
}

function onWebviewError(event: any) {
  const errorCode = event?.errorCode ?? event?.error?.code ?? -1
  log('did-fail-load:', errorCode)
  if (errorCode === -3) return
  const url = event?.validatedURL || event?.url || webviewRef.value?.getURL?.() || ''
  if (!url || url === 'about:blank') return
  loadError.value = true
  isNavigating.value = false
  revealContent()
}

function onWebviewGone(event: any) {
  log('render-process-gone:', event?.reason || event?.errorType || 'unknown')
  loadError.value = true
  isNavigating.value = false
  revealContent()
}

function retrySearch() {
  if (currentQuery.value) {
    searchQuery(currentQuery.value)
  }
}
</script>

<template>
  <div class="zdic-container">
    <webview
      v-show="!loadError"
      ref="webviewRef"
      :src="initialUrl"
      :class="['zdic-webview', { 'content-masked': !contentRevealed }]"
      allowpopups
      @did-start-navigation="onWebviewNavigationStart"
      @dom-ready="onWebviewDomReady"
      @did-finish-load="onWebviewLoad"
      @did-fail-load="onWebviewError"
      @crashed="onWebviewGone"
      @render-process-gone="onWebviewGone"
    ></webview>
    <div v-if="loadError" class="error-panel">
      <div class="error-icon">📖</div>
      <div class="error-title">页面加载失败</div>
      <div class="error-desc">未能连接到汉典，请检查网络后重试</div>
      <div v-if="currentQuery" class="error-query">查询词：{{ currentQuery }}</div>
      <button class="retry-btn" @click="retrySearch">重新加载</button>
    </div>
    <div v-if="isNavigating && !loadError" class="loading-bar">
      <div class="loading-progress"></div>
    </div>
  </div>
</template>

<style scoped>
.zdic-container {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.zdic-webview {
  flex: 1;
  width: 100%;
  border: none;
  opacity: 1;
  transition: opacity 0.18s ease;
}

.zdic-webview.content-masked {
  opacity: 0;
  transition: none;
}

.loading-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  z-index: 10;
}

.loading-progress {
  height: 100%;
  width: 40%;
  background: var(--blue, #58a4f6);
  border-radius: 1px;
  animation: loading-slide 1.2s ease-in-out infinite;
}

@keyframes loading-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}

.error-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px;
  user-select: none;
}

.error-icon {
  font-size: 48px;
  line-height: 1;
  margin-bottom: 4px;
  opacity: 0.6;
}

.error-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--error-title, #333);
}

.error-desc {
  font-size: 13px;
  color: var(--error-desc, #888);
}

.error-query {
  font-size: 13px;
  color: var(--error-desc, #888);
  margin-top: 2px;
}

.retry-btn {
  margin-top: 12px;
  padding: 6px 20px;
  border: 1px solid var(--retry-border, #d0d0d0);
  border-radius: 6px;
  background: transparent;
  color: var(--retry-text, #555);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}

.retry-btn:hover {
  background: var(--retry-hover-bg, #f0f0f0);
  border-color: var(--retry-hover-border, #bbb);
}

.retry-btn:active {
  transform: scale(0.97);
}

@media (prefers-color-scheme: dark) {
  .error-title {
    color: #e0e0e0;
  }
  .error-desc {
    color: #999;
  }
  .retry-btn {
    border-color: #555;
    color: #ccc;
  }
  .retry-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: #777;
  }
}
</style>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { store, init, ensureAuthed, refreshCurrent, markAllReadInCurrent, resetError } from './store'
import FeedTree from './FeedTree.vue'
import ArticleList from './ArticleList.vue'
import ArticleView from './ArticleView.vue'
import Settings from './Settings.vue'

const showSettings = ref(false)
const treeCollapsed = ref(false)

const selectedTitle = computed(() => {
  const find = (nodes: readonly any[]): any => {
    for (const n of nodes) {
      if (n.id === store.selectedNodeId) return n
      if (n.children) {
        const r = find(n.children)
        if (r) return r
      }
    }
    return null
  }
  const node = find(store.tree)
  return node ? node.title : ''
})

onMounted(() => {
  void init().then(() => {
    if (!store.config || !store.authed) showSettings.value = true
  })
})

function handleRetry() {
  resetError()
  void ensureAuthed()
}
function handleSettings() {
  showSettings.value = true
}
function handleMarkAllRead() {
  void markAllReadInCurrent()
}
function handleRefresh() {
  void refreshCurrent()
}
function toggleTree() {
  treeCollapsed.value = !treeCollapsed.value
}

const leftWidth = ref(280)
const dragging = ref(false)
function startVSplit(e: MouseEvent) {
  e.preventDefault()
  dragging.value = true
  const startX = e.clientX
  const startW = leftWidth.value
  const maxW = Math.max(320, Math.floor(window.innerWidth * 0.72))
  const onMove = (ev: MouseEvent) => {
    leftWidth.value = Math.min(maxW, Math.max(280, startW + ev.clientX - startX))
  }
  const onUp = () => {
    dragging.value = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
</script>

<template>
  <div class="reader">
    <div class="topbar">
      <div class="topbar-left">
        <button class="tb-btn" @click="toggleTree" title="折叠/展开订阅源">
          {{ treeCollapsed ? '▤' : '⊟' }}
        </button>
        <span class="crumb">{{ selectedTitle || 'RSS' }}</span>
      </div>
      <div class="topbar-right">
        <button class="tb-btn" @click="handleRefresh" :disabled="store.loading" title="刷新当前订阅源">
          {{ store.loading ? '⋯' : '⟳' }}
        </button>
        <button class="tb-btn" @click="handleMarkAllRead" title="当前源全部标为已读">全部已读</button>
        <button class="tb-btn" @click="handleSettings" title="账号配置">⚙</button>
      </div>
    </div>

    <div class="body">
      <!-- 左栏：订阅源树 + 文章列表 -->
      <div class="col-left" :style="{ width: leftWidth + 'px' }">
        <div v-show="!treeCollapsed" class="tree-pane">
          <FeedTree />
        </div>
        <div class="list-pane">
          <ArticleList />
        </div>
      </div>

      <div
        class="vsplitter"
        :class="{ active: dragging }"
        title="拖动调整宽度"
        @mousedown="startVSplit"
      ></div>

      <!-- 右栏：文章正文 -->
      <div class="col-right">
        <ArticleView />
      </div>
    </div>

    <!-- 未登录 / 错误态 -->
    <div v-if="store.error && !store.authed" class="overlay-msg">
      <div class="msg-box">
        <div class="msg-title">无法连接</div>
        <div class="msg-detail">{{ store.error }}</div>
        <div class="msg-actions">
          <button class="btn primary" @click="handleSettings">配置账号</button>
          <button class="btn ghost" @click="handleRetry">重试</button>
        </div>
      </div>
    </div>
    <div v-if="store.loading && !store.articles.length" class="overlay-msg">
      <div class="msg-box"><div class="msg-detail">加载中…</div></div>
    </div>

    <Settings :visible="showSettings" @close="showSettings = false" />
  </div>
</template>

<style scoped>
.reader {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--rss-bg);
  color: var(--rss-text);
}
.topbar {
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  border-bottom: 1px solid var(--rss-border);
  background: var(--rss-bar);
}
.topbar-left,
.topbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.crumb {
  font-size: 13px;
  font-weight: 600;
  color: var(--rss-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
}
.tb-btn {
  background: none;
  border: 1px solid transparent;
  color: var(--rss-text-soft);
  border-radius: 5px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  line-height: 1.4;
}
.tb-btn:hover {
  background: var(--rss-hover);
  border-color: var(--rss-border);
}
.body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.col-left {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--rss-border);
}
.vsplitter {
  flex-shrink: 0;
  width: 5px;
  cursor: col-resize;
  background: var(--rss-border);
  transition: background 0.15s;
}
.vsplitter:hover,
.vsplitter.active {
  background: var(--rss-accent);
}
.tree-pane {
  flex: 0 0 42%;
  overflow-y: auto;
  padding: 8px 6px;
  border-bottom: 1px solid var(--rss-border);
  min-height: 90px;
}
.list-pane {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.col-right {
  flex: 1;
  min-width: 0;
}
.overlay-msg {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  z-index: 50;
}
.msg-box {
  background: var(--rss-panel);
  border-radius: 10px;
  padding: 24px 28px;
  text-align: center;
  min-width: 280px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
}
.msg-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 8px;
}
.msg-detail {
  font-size: 13px;
  color: var(--rss-text-soft);
  margin-bottom: 16px;
  word-break: break-word;
}
.msg-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}
.btn {
  border-radius: 6px;
  padding: 7px 16px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--rss-border);
  background: var(--rss-hover);
  color: var(--rss-text);
}
.btn.primary {
  background: var(--rss-accent);
  border-color: var(--rss-accent);
  color: #fff;
}
.btn.ghost {
  background: transparent;
}
</style>

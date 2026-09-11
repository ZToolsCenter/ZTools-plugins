<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import Home from './Note/Home.vue'
import StickyNote from './Note/StickyNote.vue'
import EdgeTab from './Note/EdgeTab.vue'
import { openStickyWindow, isStandaloneSupported, isStickyNoteOpen, initHostBridge } from './Note/host'
import { useNotes } from './Note/composables/useNotes'

const winType = ref<'main' | 'detach' | 'browser'>(window.ztools.getWindowType())
const view = ref<'home' | 'editor'>('home')

const { reloadNotes, loadDraft } = useNotes()

let unloadTimer: ReturnType<typeof setInterval> | null = null

const params = new URLSearchParams(location.search)
/** 最小化后的边缘标签窗口（?view=tab） */
const isEdgeTab = winType.value === 'browser' && params.get('view') === 'tab'

// 独立便利贴窗口：同步加载草稿，确保 MilkdownEditor 初始值正确
if (winType.value === 'browser' && !isEdgeTab) {
  loadDraft(params.get('note'))
}

// 标签窗口铺满整个窗口，不能带外层背景色，否则窗口边缘会露出底色
if (isEdgeTab) document.body.classList.add('win-edge-tab')

onMounted(() => {
  if (winType.value === 'browser') return

  // 窗口管家：接便利贴 / 标签窗口发来的指令（最小化、还原、关闭）
  initHostBridge()

  reloadNotes()
  window.ztools.setExpendHeight?.(560)

  window.ztools.onPluginEnter((action) => {
    if (action.code === 'note') {
      reloadNotes()
      view.value = 'home'
      window.ztools.setExpendHeight?.(560)
      return
    }
    if (action.code === 'new-note') {
      openSticky(null)
      return
    }
  })

  // 拦截主窗口关闭：如果便利贴正在打开，阻止关闭并隐藏主窗口
  window.addEventListener('beforeunload', onBeforeUnload)
})

onUnmounted(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  if (unloadTimer) {
    clearInterval(unloadTimer)
    unloadTimer = null
  }
})

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (isStickyNoteOpen()) {
    e.preventDefault()
    e.returnValue = ''
    // 阻止窗口关闭，改为隐藏
    try {
      window.ztools.hideMainWindow()
    } catch {
      /* ignore */
    }

    // 轮询检测便利贴窗口是否已关闭，关闭后结束插件进程
    if (unloadTimer) clearInterval(unloadTimer)
    unloadTimer = setInterval(() => {
      if (!isStickyNoteOpen()) {
        if (unloadTimer) {
          clearInterval(unloadTimer)
          unloadTimer = null
        }
        window.ztools.outPlugin(true)
      }
    }, 500)
  }
}

function openSticky(noteId: string | null) {
  loadDraft(noteId)
  if (isStandaloneSupported()) {
    // 独立窗口模式：创建便利贴窗口，如果失败则回退到嵌入模式
    const ok = openStickyWindow(noteId)
    if (!ok) {
      // createBrowserWindow 失败（如 WPS 环境），回退到主窗口内嵌编辑
      view.value = 'editor'
      return
    }
    try {
      window.ztools.hideMainWindow()
    } catch {
      /* ignore */
    }
  } else {
    // dev 模式：主窗口内切换到编辑视图
    view.value = 'editor'
  }
}

/** 在列表直接打开：进入普通内容页面（主窗口内嵌，可查看、可编辑） */
function openContent(noteId: string) {
  loadDraft(noteId)
  view.value = 'editor'
}

function onBack() {
  reloadNotes()
  view.value = 'home'
}

function onSaved() {
  reloadNotes()
}
</script>

<template>
  <EdgeTab v-if="isEdgeTab" />
  <StickyNote v-else-if="winType === 'browser'" />
  <StickyNote
    v-else-if="view === 'editor'"
    embedded
    @back="onBack"
    @saved="onSaved"
  />
  <Home
    v-else
    @new="openSticky(null)"
    @open="openContent($event)"
    @open-sticky="openSticky($event)"
  />
</template>
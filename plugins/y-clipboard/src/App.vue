<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { api } from './api'
import { useStore } from './composables/useStore'
import { CAT_ICONS_LG } from './utils/icons'
import type { ClipboardRecord } from './types'
import Sidebar from './components/Sidebar.vue'
import Toolbar from './components/Toolbar.vue'
import VirtualList from './components/VirtualList.vue'
import ImagePreview from './components/ImagePreview.vue'
import CodePreview from './components/CodePreview.vue'

const store = useStore()

const selectedRecord = computed(() =>
  store.filtered.value[store.selectedIndex.value] ?? null
)

/* ---------- 全屏预览：图片看大图，代码看全文 ---------- */

const previewOpen = ref(false)
const previewIndex = ref(0)

/**
 * 当前过滤结果里所有"值得全屏看"的记录（←→ 在这批之间切换）。
 * 图片在卡片里看不清细节，代码在卡片里放不下 —— 两者都需要更大的空间。
 */
const previewableRecords = computed(() =>
  store.filtered.value.filter((r) => r.kind === 'image' || r.kind === 'code')
)

const previewRecord = computed(() => previewableRecords.value[previewIndex.value] ?? null)

function openPreview(r: ClipboardRecord): void {
  const i = previewableRecords.value.findIndex((x) => x.id === r.id)
  if (i < 0) return
  previewIndex.value = i
  previewOpen.value = true
}

function movePreview(delta: number): void {
  const len = previewableRecords.value.length
  if (len === 0) return
  previewIndex.value = (previewIndex.value + delta + len) % len
}

function closePreview(): void {
  previewOpen.value = false
}

function copyPreview(r: ClipboardRecord): void {
  closePreview()
  void store.copyRecord(r)
}

/**
 * 已收藏的内容 key 集合。
 * 直接对任意记录（含远端搜索结果，它们不在 records 里）算 key 再查表即可，
 * 不需要"先遍历当前列表"—— 查表本身就是 O(1)，且不会因为某条记录不在
 * filtered 里而漏判。
 */
const favKeys = computed(() => new Set(store.favorites.value.map((f) => f.id)))

/**
 * 列表里的星标是否点亮。
 * 必须用 `favKey(r)`（内容哈希）去查，不能用 `r.id`（宿主历史 id）：
 * 两者不是同一套值，用 id 查会永远查不中 —— 也就是"点了星却不亮"。
 */
const isStarred = (r: ClipboardRecord): boolean => favKeys.value.has(store.favKey(r))

/* ---------- 主题 ---------- */

function applyTheme(): void {
  const t = api.theme()
  document.documentElement.classList.toggle('dark', t.dark)
  if (t.accent) document.documentElement.style.setProperty('--accent', t.accent)
}

/* ---------- 键盘流 ---------- */

function onKeyDown(e: KeyboardEvent): void {
  const inInput = e.target instanceof HTMLInputElement

  // 预览层打开时接管键盘：Esc 关闭 / ←→ 切换 / Enter 复制
  if (previewOpen.value) {
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        closePreview()
        return
      case 'ArrowLeft':
        e.preventDefault()
        movePreview(-1)
        return
      case 'ArrowRight':
        e.preventDefault()
        movePreview(1)
        return
      case 'Enter':
        e.preventDefault()
        if (previewRecord.value) copyPreview(previewRecord.value)
        return
    }
    return
  }

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      store.moveSelection(1)
      break
    case 'ArrowUp':
      e.preventDefault()
      store.moveSelection(-1)
      break
    case 'Home':
      if (inInput) return
      e.preventDefault()
      store.setCat('all')
      break
    case ' ': {
      // Space：选中项是图片（看大图）或代码（看全文）时打开全屏预览
      if (inInput) return
      const rec = selectedRecord.value
      if (rec && (rec.kind === 'image' || rec.kind === 'code')) {
        e.preventDefault()
        openPreview(rec)
      }
      break
    }
    case 'Enter': {
      e.preventDefault()
      const rec = selectedRecord.value
      if (rec) void store.copyRecord(rec)
      break
    }
    case 'Delete':
      if (inInput) return
      e.preventDefault()
      if (selectedRecord.value) void store.deleteRecord(selectedRecord.value)
      break
    case 'Escape':
      e.preventDefault()
      api.outPlugin()
      break
  }
}

/* ---------- 生命周期 ---------- */

onMounted(() => {
  applyTheme()
  api.onThemeChange(applyTheme)
  window.addEventListener('keydown', onKeyDown)
  store.init()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div class="app">
    <Toolbar />
    <div class="app-body">
      <Sidebar />
      <main class="main">
        <VirtualList
          v-if="store.filtered.value.length > 0"
          :items="store.filtered.value"
          :selected-id="selectedRecord?.id ?? null"
          :is-starred="isStarred"
          :img-scale="store.imgScale.value"
          :reset-key="store.listKey.value"
          @copy="(r) => store.copyRecord(r)"
          @star="(r) => store.toggleStar(r)"
          @remove="(r) => store.deleteRecord(r)"
          @preview="openPreview"
          @reveal="(p) => store.revealFile(p)"
          @open="(r) => store.openLink(r)"
          @load-more="store.loadMore()"
        />

        <div v-else class="empty">
          <!--
            空态是唯一的大图标位（48px），所以用 128px 原图那档（CAT_ICONS_LG）：
            DPR 2 的屏幕上需要 144 物理像素，64px 那档不够用。
            字面大小看着比卡片版小，是因为 v2 素材是统一画布、字形居中留白的，
            视觉重心反而更稳。
          -->
          <img class="empty-icon" :src="CAT_ICONS_LG.all" alt="" draggable="false" />
          <p class="empty-title">
            {{ store.loading.value
              ? '正在查找…'
              : store.query.value ? '没有匹配的记录' : '暂无剪贴板历史' }}
          </p>
          <p class="empty-sub">
            {{ store.loading.value
              ? '正在从更久的历史里找这一类记录'
              : store.query.value
                ? '换个关键词，或等待远端搜索结果'
                : '复制任何内容后，会自动出现在这里' }}
          </p>
        </div>
      </main>
    </div>

    <!-- 全屏预览层：按类型走不同的查看器 -->
    <ImagePreview
      v-if="previewOpen && previewRecord?.kind === 'image'"
      :record="previewRecord"
      :index="previewIndex"
      :total="previewableRecords.length"
      @close="closePreview"
      @prev="movePreview(-1)"
      @next="movePreview(1)"
      @copy="copyPreview"
    />
    <CodePreview
      v-else-if="previewOpen && previewRecord?.kind === 'code'"
      :record="previewRecord"
      :index="previewIndex"
      :total="previewableRecords.length"
      @close="closePreview"
      @prev="movePreview(-1)"
      @next="movePreview(1)"
      @copy="copyPreview"
    />
  </div>
</template>

<style scoped>
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-3);
}

/*
 * 空态 48px：v2 素材字形只占画布的 63%~81%，48px 下字形看着约 30~39px，
 * 撑得起"引导图"的分量又不会喧宾夺主（72 / 60px 都试过，用户反馈偏大）。
 * 不降不透明度（降了彩色字形会发灰显脏）。
 */
.empty-icon {
  width: 48px;
  height: 48px;
  display: block;
  object-fit: contain;
}
.empty-title { font-size: 13.5px; color: var(--text-2); }
.empty-sub { font-size: 12px; }
</style>

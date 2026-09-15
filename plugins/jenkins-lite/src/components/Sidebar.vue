<template>
  <aside class="sidebar" @click="focusPanel">
    <div class="sidebar-header">
      <h1 class="logo">Jenkins Lite</h1>
    </div>

    <!-- 实例选择器 -->
    <div class="service-selector" v-if="hasInstances">
      <div class="service-current" @click="toggleServiceMenu">
        <span class="service-name" :title="currentInstance?.name">{{ currentInstance?.name || '选择实例' }}</span>
        <span class="service-arrow" :class="{ open: showServiceMenu }"></span>
      </div>
      <div class="service-menu" v-if="showServiceMenu">
        <div
          v-for="inst in instances"
          :key="inst._id"
          class="service-option"
          :class="{ active: inst._id === currentInstance?._id }"
          @click="selectService(inst._id)"
        >
          <span class="service-dot"></span>
          <span class="service-option-name" :title="inst.name">{{ inst.name }}</span>
        </div>
        <div class="service-divider"></div>
        <div class="service-option add-service" @click="openAddInstance">
          <span class="add-icon">+</span>
          <span>新增实例</span>
        </div>
      </div>
    </div>

    <nav class="sidebar-nav" ref="navRef">
      <!-- Jenkins 视图列表 + 收藏 -->
      <div class="nav-section" v-if="hasInstances && currentInstance">
        <div class="nav-section-title">视图</div>

        <!-- 收藏 - 作为特殊视图 -->
        <div
          class="nav-item favorite-view-item"
          :class="{
            active: props.currentView === '__favorites__',
            'is-keyboard-selected': nav.focusedPanel.value === 'sidebar' && nav.sidebarIndex.value === 0
          }"
          @click="selectView('__favorites__')"
          title="收藏的 Jobs"
          data-nav-index="0"
        >
          <span class="nav-icon star-icon"></span>
          <span class="nav-label">收藏</span>
          <span class="favorite-count" v-if="currentInstanceFavorites.length > 0">
            {{ currentInstanceFavorites.length }}
          </span>
        </div>

        <!-- Jenkins 视图列表 -->
        <div
          v-for="(view, idx) in views"
          :key="view.name"
          class="nav-item"
          :class="{
            active: props.currentView === view.name,
            'is-keyboard-selected': nav.focusedPanel.value === 'sidebar' && nav.sidebarIndex.value === idx + 1
          }"
          @click="selectView(view.name)"
          :data-nav-index="idx + 1"
        >
          <span class="nav-icon view-icon"></span>
          <span class="nav-label" :title="view.name">{{ view.name }}</span>
        </div>
        <div v-if="views.length === 0" class="nav-empty">
          加载中...
        </div>
      </div>
    </nav>

    <div class="sidebar-footer">
      <div class="keyboard-hint">
        <kbd>←</kbd><kbd>→</kbd> 切面板
        <span class="hint-sep">·</span>
        <kbd>↑</kbd><kbd>↓</kbd> 切换视图
      </div>
      <a class="footer-link" href="https://github.com/kshq1996/ztools-jenkins" target="_blank" title="查看开源仓库">
        <span class="github-icon"></span>
        <span>开源 v{{ version }}</span>
      </a>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useInstances } from '../composables/useInstances'
import { useFavorites } from '../composables/useFavorites'
import { useKeyboardNav } from '../composables/useKeyboardNav'
import type { Favorite, JenkinsView } from '../types'

const props = defineProps<{
  currentView: string
  selectedJob?: string
}>()

const emit = defineEmits<{
  (e: 'favorite-click', fav: Favorite): void
  (e: 'view-change', viewName: string): void
  (e: 'open-settings'): void
  (e: 'add-instance'): void
  (e: 'focus-sidebar'): void
}>()

const { instances, currentInstance, currentClient, hasInstances, switchInstance } = useInstances()
const { favorites } = useFavorites()
const nav = useKeyboardNav()

const views = ref<JenkinsView[]>([])
const showServiceMenu = ref(false)
const version = '1.4.0'
const navRef = ref<HTMLElement | null>(null)

/** 当前实例的收藏（按添加时间倒序） */
const currentInstanceFavorites = computed(() => {
  if (!currentInstance.value) return []
  return favorites.value
    .filter(f => f.instanceId === currentInstance.value?._id)
    .sort((a, b) => b.addedAt - a.addedAt)
})

/**
 * 导航项总数（收藏 + 视图）
 */
const navItemsCount = computed(() => {
  return 1 + views.value.length // 1 = 收藏
})

/**
 * sidebarIndex 越界裁剪
 */
const clampSidebarIndex = () => {
  const n = navItemsCount.value
  if (n === 0) {
    nav.sidebarIndex.value = 0
  } else if (nav.sidebarIndex.value >= n) {
    nav.sidebarIndex.value = n - 1
  } else if (nav.sidebarIndex.value < 0) {
    nav.sidebarIndex.value = 0
  }
}

watch(navItemsCount, () => clampSidebarIndex())

const toggleServiceMenu = () => {
  showServiceMenu.value = !showServiceMenu.value
}

const selectService = (instanceId: string) => {
  switchInstance(instanceId)
  showServiceMenu.value = false
  emit('view-change', '')
}

const openAddInstance = () => {
  showServiceMenu.value = false
  emit('add-instance')
}

const loadViews = async () => {
  if (!currentClient.value) {
    views.value = []
    return
  }
  const result = await currentClient.value.getViews()
  if (result.data) {
    views.value = result.data.filter(v => v.name !== 'All')
  }
}

const selectView = (viewName: string) => {
  emit('view-change', viewName)
}

/**
 * 根据 sidebarIndex 选中目标视图 / 收藏
 */
const activateNavItem = (index: number) => {
  if (index === 0) {
    selectView('__favorites__')
  } else {
    const view = views.value[index - 1]
    if (view) selectView(view.name)
  }
}

/**
 * 同级内移动（↑↓）
 * 选中即切换视图 —— 不再需要回车确认，直接查询/加载
 */
const moveInSiblings = (delta: number) => {
  const n = navItemsCount.value
  if (n === 0) return
  nav.sidebarIndex.value = Math.max(0, Math.min(n - 1, nav.sidebarIndex.value + delta))
  scrollSelectedIntoView()
  // 移动即选中（与 JobsList 的"键盘移动联动右侧"一致）
  activateNavItem(nav.sidebarIndex.value)
}

/**
 * 主操作（Enter）：保留点击 / Enter 切换的兜底（鼠标点击不触发 moveInSiblings）
 */
const primaryAction = () => {
  activateNavItem(nav.sidebarIndex.value)
}

/**
 * 滚动选中项入视
 */
const scrollSelectedIntoView = () => {
  nextTick(() => {
    const root = navRef.value
    if (!root) return
    const el = root.querySelector(`[data-nav-index="${nav.sidebarIndex.value}"]`) as HTMLElement | null
    if (el) el.scrollIntoView({ block: 'nearest' })
  })
}

/**
 * 点击本面板 → 焦点切到 sidebar
 */
const focusPanel = () => {
  if (nav.focusedPanel.value !== 'sidebar') {
    nav.setFocusedPanel('sidebar')
  }
  emit('focus-sidebar')
}

defineExpose({
  focusPanel,
  moveInSiblings,
  primaryAction
})

watch(currentInstance, () => loadViews())
watch(currentClient, () => {
  if (currentClient.value) loadViews()
})

onMounted(() => {
  if (currentClient.value) loadViews()
})
</script>

<style scoped>
.sidebar {
  width: 200px;
  height: 100%;
  background: var(--bg-secondary, #f5f5f5);
  border-right: 1px solid var(--border-color, #e0e0e0);
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.logo {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

/* 实例选择器 */
.service-selector {
  position: relative;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.service-current {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--bg-color, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.2s;
}

.service-current:hover {
  border-color: var(--primary-color, #0078d4);
}

.service-name {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.service-arrow {
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid var(--text-secondary, #888);
  margin-left: 8px;
  transition: transform 0.2s;
}

.service-arrow.open {
  transform: rotate(180deg);
}

.service-menu {
  position: absolute;
  top: 100%;
  left: 16px;
  right: 16px;
  margin-top: 4px;
  background: var(--bg-color, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 100;
  overflow: hidden;
}

.service-option {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  cursor: pointer;
  transition: background 0.15s;
}

.service-option:hover {
  background: var(--bg-hover, #f5f5f5);
}

.service-option.active {
  background: var(--primary-bg, rgba(0,120,212,0.1));
}

.service-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-secondary, #888);
  margin-right: 8px;
  flex-shrink: 0;
}

.service-option.active .service-dot {
  background: var(--primary-color, #0078d4);
}

.service-option-name {
  font-size: 13px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.service-divider {
  height: 1px;
  background: var(--border-color, #e0e0e0);
  margin: 4px 0;
}

.add-service {
  color: var(--primary-color, #0078d4);
}

.add-icon {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 600;
  margin-right: 8px;
  flex-shrink: 0;
}

.sidebar-nav {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.nav-section {
  margin-bottom: 12px;
}

.nav-section-title {
  padding: 8px 16px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary, #666);
  text-transform: uppercase;
}

.favorites-title {
  color: #faad14;
  background: var(--bg-color, #fff);
  margin: 0 -8px 4px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.nav-item {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  cursor: pointer;
  transition: background 0.15s;
  min-height: 32px;
}

.nav-item:hover {
  background: var(--bg-hover, rgba(0,0,0,0.05));
}

.nav-item.active {
  background: var(--primary-bg, rgba(0,120,212,0.1));
  color: var(--primary-color, #0078d4);
}

.nav-item.is-keyboard-selected {
  box-shadow: inset 2px 0 0 var(--primary-color, #0078d4);
}

.nav-icon {
  width: 14px;
  height: 14px;
  margin-right: 8px;
  background: var(--text-secondary, #888);
  flex-shrink: 0;
}

.view-icon {
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Crect x='3' y='3' width='7' height='7'/%3E%3Crect x='14' y='3' width='7' height='7'/%3E%3Crect x='3' y='14' width='7' height='7'/%3E%3Crect x='14' y='14' width='7' height='7'/%3E%3C/svg%3E") center/contain no-repeat;
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Crect x='3' y='3' width='7' height='7'/%3E%3Crect x='14' y='3' width='7' height='7'/%3E%3Crect x='3' y='14' width='7' height='7'/%3E%3Crect x='14' y='14' width='7' height='7'/%3E%3C/svg%3E") center/contain no-repeat;
}

.star-icon {
  clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
}

.nav-item.active .nav-icon {
  background: var(--primary-color, #0078d4);
}

.favorite-view-item {
  border-left: 3px solid transparent;
}

.favorite-view-item.active {
  border-left-color: var(--primary-color, #0078d4);
}

.favorite-count {
  background: var(--bg-secondary, #e0e0e0);
  color: var(--text-secondary, #666);
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 600;
  margin-left: 4px;
}

.favorite-view-item.active .favorite-count {
  background: var(--primary-color, #0078d4);
  color: #fff;
}

.nav-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.nav-empty {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--text-secondary, #999);
}

.sidebar-footer {
  padding: 10px 12px;
  border-top: 1px solid var(--border-color, #e0e0e0);
}

.keyboard-hint {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 10px;
  color: var(--text-secondary, #999);
  padding: 4px 8px;
  margin-bottom: 6px;
  line-height: 1.6;
}

.keyboard-hint .hint-sep {
  margin: 0 2px;
  color: var(--text-secondary, #aaa);
}

.keyboard-hint kbd {
  display: inline-block;
  padding: 0 4px;
  min-width: 14px;
  text-align: center;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  color: var(--text-color, #333);
  background: var(--bg-color, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-bottom-width: 2px;
  border-radius: 3px;
  line-height: 14px;
}

.footer-link {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-secondary, #888);
  text-decoration: none;
  padding: 6px 8px;
  border-radius: 4px;
  transition: background 0.15s;
}

.footer-link:hover {
  background: var(--bg-hover, rgba(0,0,0,0.05));
  color: var(--primary-color, #0078d4);
}

.github-icon {
  width: 14px;
  height: 14px;
  background: currentColor;
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='currentColor' d='M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5c.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34c-.46-1.16-1.11-1.47-1.11-1.47c-.91-.62.07-.6.07-.6c1 .07 1.53 1.03 1.53 1.03c.87 1.52 2.34 1.07 2.91.83c.09-.65.35-1.09.63-1.34c-2.22-.25-4.55-1.11-4.55-4.94c0-1.11.38-2 1.03-2.71c-.1-.25-.45-1.29.1-2.64c0 0 .84-.27 2.75 1.02c.79-.22 1.65-.33 2.5-.33s1.71.11 2.5.33c1.91-1.29 2.75-1.02 2.75-1.02c.55 1.35.2 2.39.1 2.64c.65.71 1.03 1.6 1.03 2.71c0 3.84-2.34 4.68-4.57 4.93c.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z'/%3E%3C/svg%3E") center/contain no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='currentColor' d='M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5c.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34c-.46-1.16-1.11-1.47-1.11-1.47c-.91-.62.07-.6.07-.6c1 .07 1.53 1.03 1.53 1.03c.87 1.52 2.34 1.07 2.91.83c.09-.65.35-1.09.63-1.34c-2.22-.25-4.55-1.11-4.55-4.94c0-1.11.38-2 1.03-2.71c-.1-.25-.45-1.29.1-2.64c0 0 .84-.27 2.75 1.02c.79-.22 1.65-.33 2.5-.33s1.71.11 2.5.33c1.91-1.29 2.75-1.02 2.75-1.02c.55 1.35.2 2.39.1 2.64c.65.71 1.03 1.6 1.03 2.71c0 3.84-2.34 4.68-4.57 4.93c.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z'/%3E%3C/svg%3E") center/contain no-repeat;
  flex-shrink: 0;
}
</style>

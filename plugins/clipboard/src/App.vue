<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { TAB_DEFINITIONS } from '@/constants'
import { useFavorites } from '@/composables/useFavorites'
import { useClipboardData } from '@/composables/useClipboardData'
import { useSelection } from '@/composables/useSelection'
import { useContextMenu } from '@/composables/useContextMenu'
import { useFavoriteDialog } from '@/composables/useFavoriteDialog'
import { supportsMultiSelectClipboard } from '@/utils/appVersion'
import { buildClipboardPayload } from '@/utils/clipboardPayload'
import TabBar from '@/components/TabBar.vue'
import ClipboardList from '@/components/ClipboardList.vue'
import SideBar from '@/components/SideBar.vue'
import ContextMenu from '@/components/ContextMenu.vue'
import FavoriteDialog from '@/components/FavoriteDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

// ---- 状态 ----
const activeTab = ref('all')
const searchText = ref('')
const TEXT_MASK_STORAGE_KEY = 'clipboard.isTextMasked'

const getInitialTextMaskState = () => {
  try {
    return window.localStorage.getItem(TEXT_MASK_STORAGE_KEY) === 'true'
  } catch (error) {
    console.warn('读取掩码显示设置失败:', error)
    return false
  }
}

const isTextMasked = ref(getInitialTextMaskState())

const toggleTextMask = () => {
  isTextMasked.value = !isTextMasked.value
}

const getCurrentAppVersion = () => {
  try {
    return window.ztools.getAppVersion()
  } catch (error) {
    console.error('获取 ZTools 版本失败:', error)
    return ''
  }
}

const appVersion = ref(getCurrentAppVersion())
const supportsMultiSelect = computed(() => supportsMultiSelectClipboard(appVersion.value))
let lastUpgradeNoticeTime = 0

const showMultiSelectUpgradeNotice = () => {
  const now = Date.now()
  if (now - lastUpgradeNoticeTime < 2000) return
  lastUpgradeNoticeTime = now

  const currentVersion = appVersion.value ? `（当前版本 ${appVersion.value}）` : ''
  const message = `多选复制需要 ZTools 3.0.2 或 3.0.2-beta.x 及更高版本${currentVersion}，请升级后使用。`

  if (typeof window.ztools.showToast === 'function') {
    window.ztools.showToast(message, { type: 'warning', duration: 4500 })
  } else if (typeof window.ztools.showNotification === 'function') {
    window.ztools.showNotification(message)
  } else {
    console.warn(message)
  }
}

// ---- Composables ----
const {
  favorites, loadFavorites, addFavorite, deleteFavorite, deleteFavorites, moveFavorite
} = useFavorites()

const {
  clipboardData, loading, loadingMore, hasMore, needsExpand, expandedItems,
  filteredData, toggleExpand, isExpanded,
  fetchClipboardHistory, loadMore, reload, checkTextOverflow
} = useClipboardData(activeTab, searchText, favorites)

// tabs 计算属性（带收藏数量）
const tabs = computed(() =>
  TAB_DEFINITIONS.map(tab =>
    tab.key === 'favorite' ? { ...tab, count: favorites.value.length } : tab
  )
)

const isSuccessfulWrite = (result) => result === true || result?.success === true

// 将当前选择写入剪贴板
const writeClipboardItems = async (items, shouldPaste = true) => {
  if (!items.length) return
  if (items.length > 1 && !supportsMultiSelect.value) {
    showMultiSelectUpgradeNotice()
    return
  }

  try {
    let result
    if (items.length === 1 && activeTab.value !== 'favorite') {
      result = await window.ztools.clipboard.write(items[0].id, shouldPaste)
    } else {
      const payload = buildClipboardPayload(items)
      if (!payload) {
        console.error('无法合并选中的剪贴板内容')
        return
      }
      result = await window.ztools.clipboard.writeContent(payload, shouldPaste)
    }

    if (!isSuccessfulWrite(result)) {
      console.error('写入剪贴板失败:', result)
    }
  } catch (error) {
    console.error('复制失败:', error)
  }
}

const showDeleteConfirm = ref(false)
const deleteTargetItems = ref([])
const deleteFromFavorites = ref(false)

const handleDeleteSelected = (items) => {
  deleteTargetItems.value = items.slice()
  deleteFromFavorites.value = activeTab.value === 'favorite'
  showDeleteConfirm.value = true
}

const {
  activeIndex, selectedItemSet, selectedCount, clipboardListRef, resetSelection,
  handleItemClick, handleContextSelection, handleDoubleClick,
  handleKeydown, handleToggleClick, copySelected, pasteSelected
} = useSelection(filteredData, tabs, activeTab, writeClipboardItems, handleDeleteSelected)

watch(selectedCount, (count, previousCount = 0) => {
  if (count > 1 && previousCount <= 1 && !supportsMultiSelect.value) {
    showMultiSelectUpgradeNotice()
  }
})

const { contextMenu, showContextMenu, hideContextMenu } = useContextMenu()
const { favoriteDialog, openFavoriteDialog, confirmFavorite, cancelFavoriteDialog } = useFavoriteDialog()

// ---- 事件处理 ----
const handleContextMenu = (event, item, index) => {
  handleContextSelection(index)
  showContextMenu(event, item, activeTab.value)
}

const handleFavoriteConfirm = async (remark) => {
  await confirmFavorite(addFavorite, remark)
}

const handleDeleteItem = () => {
  deleteTargetItems.value = [contextMenu.value.item]
  deleteFromFavorites.value = false
  hideContextMenu()
  showDeleteConfirm.value = true
}

const handleDeleteConfirm = async () => {
  showDeleteConfirm.value = false
  if (deleteTargetItems.value.length === 0) return

  try {
    if (deleteFromFavorites.value) {
      await deleteFavorites(deleteTargetItems.value)
    } else {
      await Promise.all(
        deleteTargetItems.value.map(item => window.ztools.clipboard.delete(item.id))
      )
    }
    doReload()
  } catch (error) {
    console.error('删除失败:', error)
  }
  deleteTargetItems.value = []
  deleteFromFavorites.value = false
}

const handleDeleteCancel = () => {
  showDeleteConfirm.value = false
  deleteTargetItems.value = []
  deleteFromFavorites.value = false
}

const handleOpenFavoriteDialog = () => {
  openFavoriteDialog(contextMenu.value.item)
  hideContextMenu()
}

const handleDeleteFavorite = async (index) => {
  await deleteFavorite(index)
  if (activeTab.value === 'favorite') {
    fetchClipboardHistory()
  }
}

const handleReorderFavorite = async ({ fromIndex, toIndex }) => {
  await moveFavorite(fromIndex, toIndex)
  checkTextOverflow()
}

const deleteConfirmTitle = computed(() =>
  deleteFromFavorites.value ? '删除收藏' : '删除记录'
)

const deleteConfirmMessage = computed(() => {
  const count = deleteTargetItems.value.length
  if (deleteFromFavorites.value) {
    return count > 1
      ? `确定要删除选中的 ${count} 条收藏吗？`
      : '确定要删除这条收藏吗？'
  }
  return count > 1
    ? `确定要删除选中的 ${count} 条剪贴板记录吗？`
    : '确定要删除这条剪贴板记录吗？'
})

const handleScroll = (event) => {
  const container = event.target
  if (container.scrollTop + container.clientHeight >= container.scrollHeight - 100) {
    loadMore()
  }
}

const showClearConfirm = ref(false)

const clearClipboard = async () => {
  try {
    await window.ztools.clipboard.clear()
    doReload()
  } catch (error) {
    console.error('清空失败:', error)
  }
}

const handleClearClick = () => {
  showClearConfirm.value = true
}

const handleClearConfirm = async () => {
  showClearConfirm.value = false
  await clearClipboard()
}

const handleClearCancel = () => {
  showClearConfirm.value = false
}

const doReload = () => {
  resetSelection()
  reload(clipboardListRef)
}

const focusSearchInput = () => {
  nextTick(() => {
    try {
      window.ztools.subInputFocus()
    } catch (error) {
      console.error('聚焦搜索框失败:', error)
    }
  })
}

const resetSearchAndFocus = async () => {
  searchText.value = ''
  try {
    await window.ztools.setSubInputValue('')
  } catch (error) {
    console.error('清空搜索框失败:', error)
  }
  doReload()
  focusSearchInput()
}

// ---- 监听 & 生命周期 ----
watch(activeTab, doReload)
watch(isTextMasked, (masked) => {
  try {
    window.localStorage.setItem(TEXT_MASK_STORAGE_KEY, String(masked))
  } catch (error) {
    console.warn('保存掩码显示设置失败:', error)
  }
  checkTextOverflow()
})

// 当对话框打开时，阻止全局键盘快捷键（如 Enter 粘贴）
const isAnyModalOpen = computed(() =>
  showDeleteConfirm.value || showClearConfirm.value || favoriteDialog.value.show
)

const handleGlobalKeydown = (event) => {
  if (isAnyModalOpen.value) return

  if (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'f'
  ) {
    event.preventDefault()
    focusSearchInput()
    return
  }

  handleKeydown(event)
}

onMounted(async () => {
  window.addEventListener('keydown', handleGlobalKeydown)
  window.addEventListener('click', hideContextMenu)

  await loadFavorites()
  fetchClipboardHistory()

  await window.ztools.setSubInput((text) => {
    searchText.value = text.text
    doReload()
  }, '搜索剪贴板内容...', true)

  window.ztools.clipboard.onChange(() => doReload())
  window.ztools.onPluginEnter(() => {
    resetSearchAndFocus()
  })
  focusSearchInput()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('click', hideContextMenu)
})
</script>

<template>
  <div class="clipboard-app">
    <div class="main-content">
      <TabBar
        :active-tab="activeTab"
        :favorite-count="favorites.length"
        @update:active-tab="activeTab = $event"
      />
      <ClipboardList
        ref="clipboardListRef"
        :items="filteredData"
        :loading="loading"
        :loading-more="loadingMore"
        :has-more="hasMore"
        :active-index="activeIndex"
        :selected-items="selectedItemSet"
        :active-tab="activeTab"
        :expanded-items="expandedItems"
        :needs-expand="needsExpand"
        :is-text-masked="isTextMasked"
        @select="handleItemClick"
        @toggle-selection="handleToggleClick"
        @dblclick="handleDoubleClick"
        @contextmenu="handleContextMenu"
        @toggle-expand="toggleExpand"
        @delete-favorite="handleDeleteFavorite"
        @reorder-favorite="handleReorderFavorite"
        @scroll="handleScroll"
      />
    </div>

    <SideBar
      :selected-count="selectedCount"
      :is-text-masked="isTextMasked"
      @copy="copySelected"
      @paste="pasteSelected"
      @toggle-text-mask="toggleTextMask"
      @clear="handleClearClick"
    />

    <ContextMenu
      :show="contextMenu.show"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :can-favorite="['text', 'image', 'file'].includes(contextMenu.item?.type)"
      @favorite="handleOpenFavoriteDialog"
      @delete="handleDeleteItem"
    />

    <FavoriteDialog
      :show="favoriteDialog.show"
      :item="favoriteDialog.item"
      @confirm="handleFavoriteConfirm"
      @cancel="cancelFavoriteDialog"
    />

    <ConfirmDialog
      :show="showClearConfirm"
      title="清空剪贴板"
      message="确定要清空所有剪贴板记录吗？此操作不可撤销。"
      @confirm="handleClearConfirm"
      @cancel="handleClearCancel"
    />

    <ConfirmDialog
      :show="showDeleteConfirm"
      :title="deleteConfirmTitle"
      :message="deleteConfirmMessage"
      @confirm="handleDeleteConfirm"
      @cancel="handleDeleteCancel"
    />
  </div>
</template>

<style scoped>
.clipboard-app {
  display: flex;
  width: 100%;
  min-height: 100vh;
  background: var(--bg-app);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  color: var(--text-primary);
}

.main-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}
</style>

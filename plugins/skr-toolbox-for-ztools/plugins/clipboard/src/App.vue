<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { TAB_DEFINITIONS } from '@/constants'
import { useFavorites } from '@/composables/useFavorites'
import { useClipboardData } from '@/composables/useClipboardData'
import { useSelection } from '@/composables/useSelection'
import { useContextMenu } from '@/composables/useContextMenu'
import { useFavoriteDialog } from '@/composables/useFavoriteDialog'
import TabBar from '@/components/TabBar.vue'
import ClipboardList from '@/components/ClipboardList.vue'
import SideBar from '@/components/SideBar.vue'
import ContextMenu from '@/components/ContextMenu.vue'
import FavoriteDialog from '@/components/FavoriteDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

// ---- 状态 ----
const activeTab = ref('all')
const searchText = ref('')

// ---- Composables ----
const { favorites, loadFavorites, addFavorite, deleteFavorite } = useFavorites()

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

// 复制到剪贴板
const copyToClipboard = async (id, shouldPaste = true) => {
  try {
    if (activeTab.value === 'favorite') {
      const item = favorites.value.find(i => i.id === id)
      if (!item) return
      let content = item.content
      if (item.type === 'image') {
        content = item.imagePath || item.content.replace('file://', '')
      }
      await window.ztools.clipboard.writeContent({ type: item.type, content }, shouldPaste)
      return
    }
    await window.ztools.clipboard.write(id, shouldPaste)
  } catch (error) {
    console.error('复制失败:', error)
  }
}

const {
  selectedIndex, clipboardListRef, resetSelection,
  handleKeydown, copySelected, pasteSelected
} = useSelection(filteredData, tabs, activeTab, copyToClipboard)

const { contextMenu, showContextMenu, hideContextMenu } = useContextMenu()
const { favoriteDialog, openFavoriteDialog, confirmFavorite, cancelFavoriteDialog } = useFavoriteDialog()

// ---- 事件处理 ----
const handleContextMenu = (event, item) => {
  showContextMenu(event, item, activeTab.value)
}

const handleFavoriteConfirm = async (remark) => {
  await confirmFavorite(addFavorite, remark)
}

const showDeleteConfirm = ref(false)
const deleteTargetItem = ref(null)

const handleDeleteItem = () => {
  deleteTargetItem.value = contextMenu.value.item
  hideContextMenu()
  showDeleteConfirm.value = true
}

const handleDeleteConfirm = async () => {
  showDeleteConfirm.value = false
  if (!deleteTargetItem.value) return
  try {
    await window.ztools.clipboard.delete(deleteTargetItem.value.id)
    doReload()
  } catch (error) {
    console.error('删除失败:', error)
  }
  deleteTargetItem.value = null
}

const handleDeleteCancel = () => {
  showDeleteConfirm.value = false
  deleteTargetItem.value = null
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

onMounted(async () => {
  window.addEventListener('keydown', handleKeydown)
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
  window.removeEventListener('keydown', handleKeydown)
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
        :selected-index="selectedIndex"
        :active-tab="activeTab"
        :expanded-items="expandedItems"
        :needs-expand="needsExpand"
        @select="selectedIndex = $event"
        @dblclick="copyToClipboard($event)"
        @contextmenu="handleContextMenu"
        @toggle-expand="toggleExpand"
        @delete-favorite="handleDeleteFavorite"
        @scroll="handleScroll"
      />
    </div>

    <SideBar
      @copy="copySelected"
      @paste="pasteSelected"
      @clear="handleClearClick"
    />

    <ContextMenu
      :show="contextMenu.show"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :can-favorite="contextMenu.item?.type === 'text' || contextMenu.item?.type === 'image'"
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
      title="删除记录"
      message="确定要删除这条剪贴板记录吗？"
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

import { ref, computed, nextTick } from 'vue'
import { formatTime } from '@/utils/format'
import { PAGE_SIZE } from '@/constants'

/**
 * 转换API数据为显示格式
 */
const transformClipboardItem = (item) => {
  const baseItem = {
    id: item.id,
    type: item.type,
    time: formatTime(item.timestamp),
    timestamp: item.timestamp,
    appName: item.appName || null
  }

  if (item.type === 'text') {
    return {
      ...baseItem,
      content: item.content || item.preview || '',
      charCount: (item.content || item.preview || '').length
    }
  }

  if (item.type === 'image') {
    return {
      ...baseItem,
      content: 'file://' + item.imagePath || '',
      imagePath: item.imagePath,
      preview: item.preview,
      size: item.resolution
    }
  }

  if (item.type === 'file') {
    if (item.files && Array.isArray(item.files)) {
      return {
        ...baseItem,
        content: item.preview || '',
        files: item.files.map(file => ({
          name: file.name,
          path: file.path,
          isDirectory: file.isDirectory,
          exists: file.exists
        })),
        fileCount: item.files.length,
        preview: item.preview
      }
    }
    if (item.fileName) {
      return {
        ...baseItem,
        content: item.preview || '',
        files: [{
          name: item.fileName,
          path: item.filePath,
          exists: item.fileExists
        }],
        fileCount: 1,
        filePath: item.filePath
      }
    }
    return baseItem
  }

  return baseItem
}

/**
 * @param {import('vue').Ref<string>} activeTab
 * @param {import('vue').Ref<string>} searchText
 * @param {import('vue').Ref<Array>} favorites
 */
export function useClipboardData(activeTab, searchText, favorites) {
  const clipboardData = ref([])
  const loading = ref(false)
  const loadingMore = ref(false)
  const total = ref(0)
  const currentPage = ref(1)
  const hasMore = ref(true)
  const needsExpand = ref({})
  const expandedItems = ref(new Set())

  // 根据当前tab筛选数据
  const filteredData = computed(() => {
    if (activeTab.value === 'all' || activeTab.value === 'favorite') {
      return clipboardData.value
    }
    return clipboardData.value.filter(item => item.type === activeTab.value)
  })

  // 检查文本是否溢出需要展开按钮
  const checkTextOverflow = () => {
    nextTick(() => {
      filteredData.value.forEach(item => {
        if (item.type === 'text') {
          const element = document.querySelector(`[data-text-id="${item.id}"]`)
          if (element) {
            needsExpand.value[item.id] = element.scrollHeight > element.clientHeight
          }
        }
      })
    })
  }

  // 切换展开/收起
  const toggleExpand = (id) => {
    if (expandedItems.value.has(id)) {
      expandedItems.value.delete(id)
    } else {
      expandedItems.value.add(id)
    }
  }

  const isExpanded = (id) => {
    return expandedItems.value.has(id)
  }

  // 获取剪贴板历史
  const fetchClipboardHistory = async (append = false) => {
    if (append) {
      if (loadingMore.value || !hasMore.value) return
      loadingMore.value = true
    } else {
      loading.value = true
    }

    try {
      if (activeTab.value === 'favorite') {
        clipboardData.value = favorites.value
        total.value = favorites.value.length
        hasMore.value = false
        checkTextOverflow()
        return
      }

      const result = await window.ztools.clipboard.getHistory(
        currentPage.value,
        PAGE_SIZE,
        searchText.value || undefined
      )

      const newItems = result.items.map(transformClipboardItem)

      if (append) {
        clipboardData.value = [...clipboardData.value, ...newItems]
      } else {
        clipboardData.value = newItems
      }

      total.value = result.total
      hasMore.value = clipboardData.value.length < result.total
      checkTextOverflow()
    } catch (error) {
      console.error('获取剪贴板历史失败:', error)
      if (!append) {
        clipboardData.value = []
      }
      hasMore.value = false
    } finally {
      loading.value = false
      loadingMore.value = false
    }
  }

  const loadMore = () => {
    if (!hasMore.value || loadingMore.value) return
    currentPage.value++
    fetchClipboardHistory(true)
  }

  const reload = (clipboardListRef) => {
    if (clipboardListRef?.value) {
      // 支持组件实例（通过 $el）和原生 DOM 元素
      const el = clipboardListRef.value.$el || clipboardListRef.value
      el.scrollTop = 0
    }
    currentPage.value = 1
    hasMore.value = true
    fetchClipboardHistory()
  }

  return {
    clipboardData,
    loading,
    loadingMore,
    total,
    hasMore,
    needsExpand,
    expandedItems,
    filteredData,
    toggleExpand,
    isExpanded,
    fetchClipboardHistory,
    loadMore,
    reload,
    checkTextOverflow
  }
}

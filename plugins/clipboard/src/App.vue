<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'

const activeTab = ref('all')
const expandedItems = ref(new Set())
const selectedIndex = ref(0) // 当前选中的剪贴项索引
const clipboardData = ref([]) // 剪贴板数据
const loading = ref(false) // 初始加载状态
const loadingMore = ref(false) // 加载更多状态
const total = ref(0) // 总记录数
const currentPage = ref(1) // 当前页码
const pageSize = ref(20) // 每页数量
const hasMore = ref(true) // 是否还有更多数据
const needsExpand = ref({}) // 存储需要展开按钮的项目ID
const favorites = ref([]) // 收藏的内容列表
const searchText = ref('') // 搜索/过滤文本
const clipboardListRef = ref(null) // 剪贴板列表容器引用

// 右键菜单相关
const contextMenu = ref({
  show: false,
  x: 0,
  y: 0,
  item: null
})

// 收藏弹窗相关
const favoriteDialog = ref({
  show: false,
  remark: '',
  item: null
})

// 收藏数据持久化key
const FAVORITE_STORAGE_KEY = 'clipboard_favorites'

// tabs使用计算属性,动态显示收藏数量
const tabs = computed(() => [
  { key: 'all', label: '全部' },
  { key: 'text', label: '文本' },
  { key: 'image', label: '图像' },
  { key: 'file', label: '文件' },
  { key: 'favorite', label: '收藏', count: favorites.value.length }
])

// 获取文件/文件夹图标
const getFileIcon = (file) => {
  if (file.isDirectory) {
    return '📁'
  }
  // 根据文件扩展名返回不同图标
  const ext = file.name.split('.').pop()?.toLowerCase()
  const iconMap = {
    'pdf': '📄',
    'doc': '📝',
    'docx': '📝',
    'xls': '📊',
    'xlsx': '📊',
    'ppt': '📊',
    'pptx': '📊',
    'zip': '🗜️',
    'gz': '🗜️',
    'rar': '🗜️',
    'jpg': '🖼️',
    'jpeg': '🖼️',
    'png': '🖼️',
    'gif': '🖼️',
    'mp4': '🎬',
    'mov': '🎬',
    'mp3': '🎵',
    'wav': '🎵'
  }
  return iconMap[ext] || '📄'
}

// 格式化时间
const formatTime = (timestamp) => {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (hours < 24) return `${hours} 小时前`
  if (days < 7) return `${days} 天前`
  return new Date(timestamp).toLocaleDateString()
}

// 转换API数据为显示格式
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
      size: item.resolution // API没有返回文件大小
    }
  }

  if (item.type === 'file') {
    // 新的文件数据结构：包含files数组
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
    // 兼容旧的数据结构
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

// 获取剪贴板历史
const fetchClipboardHistory = async (append = false) => {
  // 如果是追加模式，使用loadingMore状态
  if (append) {
    if (loadingMore.value || !hasMore.value) return
    loadingMore.value = true
  } else {
    loading.value = true
  }

  try {
    // 如果是收藏Tab,直接显示收藏的数据
    if (activeTab.value === 'favorite') {
      clipboardData.value = favorites.value
      total.value = favorites.value.length
      hasMore.value = false
      checkTextOverflow()
      return
    }

    // 调用API - filter参数是字符串，用于文本搜索
    const result = await window.ztools.clipboard.getHistory(
      currentPage.value,
      pageSize.value,
      searchText.value || undefined
    )
    console.log('API返回数据:', result)

    // 转换数据
    const newItems = result.items.map(transformClipboardItem)

    // 追加或替换数据
    if (append) {
      clipboardData.value = [...clipboardData.value, ...newItems]
    } else {
      clipboardData.value = newItems
    }

    total.value = result.total

    // 判断是否还有更多数据
    hasMore.value = clipboardData.value.length < result.total

    // 检查文本溢出
    checkTextOverflow()
  } catch (error) {
    console.error('获取剪贴板历史失败:', error)
    // 如果API不可用，可以使用模拟数据
    if (!append) {
      clipboardData.value = []
    }
    hasMore.value = false
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

// 加载更多数据
const loadMore = () => {
  if (!hasMore.value || loadingMore.value) return
  currentPage.value++
  fetchClipboardHistory(true)
}

// 滚动事件处理
const handleScroll = (event) => {
  const container = event.target
  // 计算是否滚动到底部（距离底部100px时开始加载）
  const scrollTop = container.scrollTop
  const scrollHeight = container.scrollHeight
  const clientHeight = container.clientHeight

  if (scrollTop + clientHeight >= scrollHeight - 100) {
    loadMore()
  }
}

// 根据当前tab筛选数据
const filteredData = computed(() => {
  // 如果是 'all' 或 'favorite'，不做类型过滤
  if (activeTab.value === 'all' || activeTab.value === 'favorite') {
    return clipboardData.value
  }
  // 按类型过滤
  return clipboardData.value.filter(item => item.type === activeTab.value)
})

// 切换展开/收起
const toggleExpand = (id) => {
  if (expandedItems.value.has(id)) {
    expandedItems.value.delete(id)
  } else {
    expandedItems.value.add(id)
  }
}

// 检查文本是否溢出需要展开按钮
const checkTextOverflow = () => {
  nextTick(() => {
    filteredData.value.forEach(item => {
      if (item.type === 'text') {
        const element = document.querySelector(`[data-text-id="${item.id}"]`)
        if (element) {
          // 检查内容高度是否超过容器高度
          needsExpand.value[item.id] = element.scrollHeight > element.clientHeight
        }
      }
    })
  })
}

// 判断是否展开
const isExpanded = (id) => {
  return expandedItems.value.has(id)
}

// 键盘事件处理
const handleKeydown = (event) => {
  // 左右键切换Tab
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    const currentIndex = tabs.value.findIndex(tab => tab.key === activeTab.value)
    let nextIndex

    if (event.key === 'ArrowLeft') {
      nextIndex = currentIndex > 0 ? currentIndex - 1 : tabs.value.length - 1
    } else {
      nextIndex = currentIndex < tabs.value.length - 1 ? currentIndex + 1 : 0
    }

    activeTab.value = tabs.value[nextIndex].key
    selectedIndex.value = 0 // 切换tab时重置选中项为第一项
  }

  // 上下键切换选中项
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault()
    const maxIndex = filteredData.value.length - 1
    const direction = event.key === 'ArrowDown' ? 'down' : 'up'

    if (event.key === 'ArrowUp') {
      // 向上键：不循环，到第一项就停止
      if (selectedIndex.value > 0) {
        selectedIndex.value = selectedIndex.value - 1
      }
    } else {
      // 向下键：不循环，到最后一项就停止
      if (selectedIndex.value < maxIndex) {
        selectedIndex.value = selectedIndex.value + 1
      }
    }

    // 滚动到选中项
    scrollToSelectedItem(direction)
  }

  // 回车键复制选中项
  if (event.key === 'Enter') {
    event.preventDefault()
    const selectedItem = filteredData.value[selectedIndex.value]
    if (selectedItem) {
      copyToClipboard(selectedItem.id)
    }
  }
}

// 复制到剪贴板
const copyToClipboard = async (id, shouldPaste = false) => {
  try {
    // 收藏Tab使用 writeContent
    if (activeTab.value === 'favorite') {
      const item = favorites.value.find(i => i.id === id)
      if (!item) return

      let content = item.content
      if (item.type === 'image') {
        // 直接使用图片路径
        content = item.imagePath || item.content.replace('file://', '')
      }

      await window.ztools.clipboard.writeContent({
        type: item.type,
        content: content
      }, shouldPaste)
      console.log('已复制收藏内容到剪贴板')
      return
    }

    // 其他列表使用 write
    await window.ztools.clipboard.write(id, shouldPaste)
    console.log('已复制到剪贴板:', id, '是否粘贴:', shouldPaste)
  } catch (error) {
    console.error('复制失败:', error)
  }
}

// 复制选中项（不粘贴）
const copySelected = async () => {
  const selectedItem = filteredData.value[selectedIndex.value]
  if (selectedItem) {
    await copyToClipboard(selectedItem.id, false)
  }
}

// 粘贴选中项（复制并粘贴）
const pasteSelected = async () => {
  const selectedItem = filteredData.value[selectedIndex.value]
  if (selectedItem) {
    await copyToClipboard(selectedItem.id, true)
  }
}

// 清空剪贴板
const clearClipboard = async () => {
  try {
    await window.ztools.clipboard.clear()
    console.log('已清空剪贴板')
    // 清空后刷新数据
    reload()
  } catch (error) {
    console.error('清空失败:', error)
  }
}

// 滚动到选中项
const scrollToSelectedItem = (direction = 'down') => {
  // 使用 nextTick 确保 DOM 已更新
  setTimeout(() => {
    const selectedElement = document.querySelector('.clipboard-item.selected')
    const container = clipboardListRef.value
    if (selectedElement && container) {
      const containerRect = container.getBoundingClientRect()
      const elementRect = selectedElement.getBoundingClientRect()

      if (direction === 'down') {
        // 向下滚动：检查元素底部是否在视口内
        const isBelowViewport = elementRect.bottom > containerRect.bottom

        if (isBelowViewport) {
          // 元素底部超出容器视口，滚动到让元素底部紧贴容器底部
          const scrollOffset = elementRect.bottom - containerRect.bottom + 10 // 10px间距
          container.scrollTop += scrollOffset
        }
      } else {
        // 向上滚动：检查元素顶部是否被遮挡
        const isAboveViewport = elementRect.top < containerRect.top

        if (isAboveViewport) {
          // 元素被遮挡，滚动到让元素顶部在容器顶部
          const scrollOffset = elementRect.top - containerRect.top - 10 // 10px间距
          container.scrollTop += scrollOffset
        }
      }
    }
  }, 0)
}

const reload = () => {
  // 滚动到顶部
  if (clipboardListRef.value) {
    clipboardListRef.value.scrollTop = 0
  }
  // 重置分页状态
  currentPage.value = 1
  hasMore.value = true
  selectedIndex.value = 0 // 重置选中项
  fetchClipboardHistory()
}

// 加载收藏列表
const loadFavorites = async () => {
  try {
    const data = await window.ztools.db.promises.get(FAVORITE_STORAGE_KEY)
    if (data && Array.isArray(data.favorites)) {
      favorites.value = data.favorites
    }
  } catch (error) {
    console.error('加载收藏列表失败:', error)
  }
}

// 保存收藏列表
const saveFavorites = async () => {
  try {
    // 查询旧数据
    const record = await window.ztools.db.promises.get(FAVORITE_STORAGE_KEY)

    await window.ztools.db.promises.put({
      _id: FAVORITE_STORAGE_KEY,
      _rev: record?._rev,
      favorites: JSON.parse(JSON.stringify(favorites.value))
    })
  } catch (error) {
    console.error('保存收藏列表失败:', error)
  }
}

// 显示右键菜单
const showContextMenu = (event, item) => {
  // 收藏Tab不支持右键菜单
  if (activeTab.value === 'favorite') {
    return
  }

  // 只允许文本和图像类型收藏
  if (item.type !== 'text' && item.type !== 'image') {
    return
  }

  event.preventDefault()
  contextMenu.value = {
    show: true,
    x: event.clientX,
    y: event.clientY,
    item: item
  }
}

// 隐藏右键菜单
const hideContextMenu = () => {
  contextMenu.value.show = false
}

// 打开收藏弹窗
const openFavoriteDialog = () => {
  favoriteDialog.value = {
    show: true,
    remark: '',
    item: contextMenu.value.item
  }
  hideContextMenu()
}

// 确认收藏
const confirmFavorite = async () => {
  if (!favoriteDialog.value.item) return

  const favoriteItem = {
    ...favoriteDialog.value.item,
    remark: favoriteDialog.value.remark,
    favoriteTime: Date.now()
  }

  favorites.value.unshift(favoriteItem) // 添加到开头
  await saveFavorites()

  // 关闭弹窗
  favoriteDialog.value.show = false
  favoriteDialog.value.remark = ''
  favoriteDialog.value.item = null
}

// 取消收藏弹窗
const cancelFavoriteDialog = () => {
  favoriteDialog.value.show = false
  favoriteDialog.value.remark = ''
  favoriteDialog.value.item = null
}

// 删除收藏
const deleteFavorite = async (index) => {
  favorites.value.splice(index, 1)
  await saveFavorites()
  // 刷新显示
  if (activeTab.value === 'favorite') {
    fetchClipboardHistory()
  }
}

// 监听Tab切换，滚动到顶部并重新加载数据
watch(activeTab, reload)

// 监听键盘事件
onMounted(async () => {
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('click', hideContextMenu)

  // 等待 DOM 挂载后再绑定滚动事件
  nextTick(() => {
    if (clipboardListRef.value) {
      clipboardListRef.value.addEventListener('scroll', handleScroll)
    }
  })

  // 初始加载收藏列表
  await loadFavorites()
  // 初始加载数据
  fetchClipboardHistory()
  window.ztools.clipboard.onChange(() => {
    // 剪贴板内容变化时，刷新数据
    reload()
  })
  window.ztools.onPluginEnter((param) => {
    searchText.value = ''
    // 刷新数据
    reload()
  })

  // 设置搜索框
  window.ztools.setSubInput((text) => {
    // 搜索框输入时更新搜索文本并重新加载数据
    searchText.value = text.text
    reload()
  }, '搜索剪贴板内容...', true)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('click', hideContextMenu)
  if (clipboardListRef.value) {
    clipboardListRef.value.removeEventListener('scroll', handleScroll)
  }
})
</script>

<template>
  <div class="clipboard-app">
    <!-- 主内容区域 -->
    <div class="main-content">
    <!-- Tab 导航 -->
    <div class="tab-bar">
      <div
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-item"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        <span class="tab-icon">
          <!-- 全部图标 -->
          <svg v-if="tab.key === 'all'" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"/>
          </svg>
          <!-- 文本图标 -->
          <svg v-else-if="tab.key === 'text'" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"/>
            <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"/>
          </svg>
          <!-- 图像图标 -->
          <svg v-else-if="tab.key === 'image'" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"/>
            <circle cx="8.5" cy="8.5" r="1.5"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"/>
            <path d="M21 15l-5-5L5 21"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"/>
          </svg>
          <!-- 文件图标 -->
          <svg v-else-if="tab.key === 'file'" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"/>
          </svg>
          <!-- 收藏图标 -->
          <svg v-else-if="tab.key === 'favorite'" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"/>
          </svg>
        </span>
        <span class="tab-label">{{ tab.label }}</span>
        <span v-if="tab.count" class="tab-count">({{ tab.count }})</span>
      </div>
    </div>

    <!-- 剪贴板列表 -->
    <div class="clipboard-list" ref="clipboardListRef">
      <!-- 空状态 -->
      <div v-if="!loading && filteredData.length === 0" class="empty-state">
        <div class="empty-icon">📋</div>
        <div class="empty-text">暂无剪贴板记录</div>
      </div>

      <!-- 列表项 -->
      <div
        v-for="(item, index) in filteredData"
        :key="item.id || index"
        class="clipboard-item"
        :class="{ selected: selectedIndex === index }"
        @click="selectedIndex = index"
        @dblclick="copyToClipboard(item.id)"
        @contextmenu="showContextMenu($event, item)"
      >
        <!-- 文本类型 -->
        <div v-if="item.type === 'text'" class="item-content">
          <div
            class="content-text"
            :data-text-id="item.id"
            :class="{
              'text-collapsed': !isExpanded(item.id),
              'text-expanded': isExpanded(item.id)
            }"
          >
            {{ item.content }}
          </div>
          <div class="item-meta">
            <span class="meta-time">{{ item.time }}</span>
            <span v-if="item.remark" class="meta-remark">{{ item.remark }}</span>
            <span v-if="item.appName" class="meta-app">{{ item.appName }}</span>
            <button
              v-if="needsExpand[item.id]"
              class="expand-btn"
              @click.stop="toggleExpand(item.id)"
            >
              <span class="expand-icon">{{ isExpanded(item.id) ? '▲' : '▼' }}</span>
              <span>{{ isExpanded(item.id) ? '收起' : '展开' }}</span>
            </button>
            <button
              v-if="activeTab === 'favorite'"
              class="delete-btn"
              @click.stop="deleteFavorite(index)"
              title="删除收藏"
            >
              ✕
            </button>
            <span class="meta-count">{{ item.charCount }} 字符</span>
            <span class="meta-index">{{ index + 1 }}</span>
          </div>
        </div>

        <!-- 图像类型 -->
        <div v-else-if="item.type === 'image'" class="item-content">
          <div class="image-preview">
            <img :src="item.content" :alt="`图片 ${item.id}`" />
          </div>
          <div class="item-meta">
            <span class="meta-time">{{ item.time }}</span>
            <span v-if="item.remark" class="meta-remark">{{ item.remark }}</span>
            <span v-if="item.appName" class="meta-app">{{ item.appName }}</span>
            <button
              v-if="activeTab === 'favorite'"
              class="delete-btn"
              @click.stop="deleteFavorite(index)"
              title="删除收藏"
            >
              ✕
            </button>
            <span class="meta-count">{{ item.size }}</span>
            <span class="meta-index">{{ index + 1 }}</span>
          </div>
        </div>

        <!-- 文件类型 -->
        <div v-else-if="item.type === 'file'" class="item-content">
          <div class="file-list" :class="{ collapsed: !isExpanded(item.id) }">
            <div
              v-for="(file, idx) in item.files"
              :key="idx"
              class="file-item"
              :class="{
                hidden: !isExpanded(item.id) && idx >= 5,
                'file-not-exists': !file.exists
              }"
            >
              <span class="file-icon">{{ getFileIcon(file) }}</span>
              <span class="file-name">{{ file.name }}</span>
              <span v-if="!file.exists" class="file-status">已删除</span>
            </div>
          </div>

          <div class="item-meta">
            <span class="meta-time">{{ item.time }}</span>
            <span v-if="item.appName" class="meta-app">{{ item.appName }}</span>
            <button
              v-if="item.files && item.files.length > 5"
              class="expand-btn"
              @click.stop="toggleExpand(item.id)"
            >
              <span class="expand-icon">{{ isExpanded(item.id) ? '▲' : '▼' }}</span>
              <span>{{ isExpanded(item.id) ? '收起' : '展开' }}</span>
            </button>
            <span class="meta-count">{{ item.preview || `${item.fileCount} 个项目` }}</span>
            <span class="meta-index">{{ index + 1 }}</span>
          </div>
        </div>
      </div>

      <!-- 加载更多状态 -->
      <div v-if="loadingMore" class="loading-more">
        <div class="loading-more-spinner"></div>
        <span class="loading-more-text">加载更多...</span>
      </div>

      <!-- 没有更多数据提示 -->
      <div v-else-if="!loading && clipboardData.length > 0 && !hasMore" class="no-more">
        <span class="no-more-text">没有更多了</span>
      </div>
    </div>
    </div>

    <!-- 右侧侧边栏 -->
    <div class="sidebar">
      <div class="sidebar-actions">
        <!-- 复制按钮 -->
        <button class="sidebar-btn copy-btn" @click="copySelected" title="复制选中项">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"/>
          </svg>
        </button>

        <!-- 粘贴按钮 -->
        <button class="sidebar-btn paste-btn" @click="pasteSelected" title="执行粘贴">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"/>
          </svg>
        </button>
      </div>

      <div class="sidebar-bottom">
        <!-- 清空按钮 -->
        <button class="sidebar-btn clear-btn" @click="clearClipboard" title="清空剪贴板">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 6h18M8 6V4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2v2m3 0v14c0 1.1-.9 2-2 2H7c-1.1 0-2-.9-2-2V6h14z"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"/>
            <path d="M10 11v6M14 11v6"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- 右键菜单 -->
    <div
      v-if="contextMenu.show"
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      @click.stop
    >
      <div class="context-menu-item" @click="openFavoriteDialog">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"/>
        </svg>
        <span>收藏</span>
      </div>
    </div>

    <!-- 收藏弹窗 -->
    <div v-if="favoriteDialog.show" class="dialog-overlay" @click="cancelFavoriteDialog">
      <div class="dialog-content" @click.stop>
        <div class="dialog-header">
          <h3>添加收藏</h3>
          <button class="dialog-close" @click="cancelFavoriteDialog">✕</button>
        </div>
        <div class="dialog-body">
          <div class="dialog-preview">
            <div v-if="favoriteDialog.item?.type === 'text'" class="preview-text">
              {{ favoriteDialog.item.content.substring(0, 100) }}{{ favoriteDialog.item.content.length > 100 ? '...' : '' }}
            </div>
            <div v-else-if="favoriteDialog.item?.type === 'image'" class="preview-image">
              <img :src="favoriteDialog.item.content" alt="预览图" />
            </div>
          </div>
          <div class="dialog-field">
            <label>备注</label>
            <input
              v-model="favoriteDialog.remark"
              type="text"
              placeholder="请输入备注(可选)"
              @keyup.enter="confirmFavorite"
            />
          </div>
        </div>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="cancelFavoriteDialog">取消</button>
          <button class="btn-confirm" @click="confirmFavorite">确定</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
:root {
  --bg-app: #f5f5f5;
  --bg-surface: white;
  --bg-hover: #fafafa;
  --bg-hover-light: #f8f8f8;
  --bg-accent-light: #e8f0fe;
  --bg-warning-light: #fff3e0;
  --bg-danger-light: #ffebee;
  --bg-cancel-hover: #e8e8e8;
  --primary-color: #1a73e8;
  --primary-hover: #1557b0;
  --text-primary: #333333;
  --text-secondary: #666666;
  --text-tertiary: #999999;
  --text-warning: #f57c00;
  --text-danger: #f44336;
  --text-white: white;
  --border-color: #e5e5e5;
  --spinner-bg: #f3f3f3;
  --overlay-color: rgba(0, 0, 0, 0.5);
  --icon-warning: #ffa726;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-app: #1e1e1e;
    --bg-surface: #2d2d2d;
    --bg-hover: #383838;
    --bg-hover-light: #333333;
    --bg-accent-light: #1a3a5c;
    --bg-warning-light: #4a3b2a;
    --bg-danger-light: #4a2a2a;
    --bg-cancel-hover: #404040;
    --primary-color: #4dabf7;
    --primary-hover: #4299e1;
    --text-primary: #e0e0e0;
    --text-secondary: #a0a0a0;
    --text-tertiary: #757575;
    --text-warning: #ffb74d;
    --text-danger: #ef5350;
    --text-white: white;
    --border-color: #404040;
    --spinner-bg: #404040;
    --overlay-color: rgba(0, 0, 0, 0.7);
    --icon-warning: #ffb74d;
  }
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg-app);
  color: var(--text-primary);
}
</style>

<style scoped>

.clipboard-app {
  display: flex;
  width: 100%;
  min-height: 100vh;
  background: var(--bg-app);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  color: var(--text-primary);
}

/* 主内容区域 */
.main-content {
  flex: 1;
  min-width: 0; /* 防止 flex 项目溢出 */
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

/* Tab 导航样式 */
.tab-bar {
  flex-shrink: 0;
  display: flex;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-color);
  padding: 0 20px;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 16px;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 14px;
  border-bottom: 2px solid transparent;
  transition: all 0.3s;
}

.tab-item:hover {
  color: var(--text-primary);
  background: var(--bg-hover-light);
}

.tab-item.active {
  color: var(--primary-color);
  border-bottom-color: var(--primary-color);
}

.tab-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}

.tab-icon svg {
  width: 16px;
  height: 16px;
}

.tab-count {
  color: var(--text-tertiary);
  font-size: 12px;
}

/* 剪贴板列表 */
.clipboard-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 3px;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  background: var(--bg-surface);
}

.empty-icon {
  font-size: 48px;
  opacity: 0.3;
  margin-bottom: 16px;
}

.empty-text {
  color: var(--text-tertiary);
  font-size: 14px;
}

.clipboard-item {
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-color);
  /* transition: all 0.2s; */
  cursor: pointer;
}

.clipboard-item:hover {
  background: var(--bg-hover);
}

.clipboard-item.selected {
  border: 2px solid var(--primary-color);
  border-radius: 5px;
}

.item-content {
  padding: 5px 10px;
}

.content-text {
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.4;
  word-break: break-all;
  white-space: pre-wrap; /* 保留换行符和空格 */
}

.text-collapsed {
  max-height: 120px;
  overflow: hidden;
  position: relative;
}

.text-expanded {
  max-height: none;
}

/* 图片预览 */
.image-preview {
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-app);
}

.image-preview img {
  width: 100%;
  max-height: 160px;
  object-fit: contain;
  display: block;
}

/* 文件列表 */

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  color: var(--text-primary);
  font-size: 14px;
}

.file-item.hidden {
  display: none;
}

.file-item.file-not-exists {
  opacity: 0.5;
}

.file-item.file-not-exists .file-name {
  text-decoration: line-through;
  color: var(--text-tertiary);
}

.file-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.file-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-status {
  font-size: 11px;
  color: var(--text-danger);
  background: var(--bg-danger-light);
  padding: 2px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}

/* Meta 信息 */
.item-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text-tertiary);
  font-size: 12px;
  position: relative; /* 为绝对定位的按钮提供定位上下文 */
}

.meta-time {
  flex: 1; /* 时间占据左侧剩余空间 */
}

.meta-app {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  background: var(--bg-accent-light);
  color: var(--primary-color);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}

.expand-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--primary-color);
  cursor: pointer;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background 0.2s;
  position: absolute; /* 绝对定位 */
  left: 50%; /* 从左边50%开始 */
  transform: translateX(-50%); /* 向左偏移自身宽度的50%，实现居中 */
}

.expand-btn:hover {
  background: var(--bg-accent-light);
}

.expand-icon {
  font-size: 10px;
}

.delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s;
  font-size: 16px;
  margin-left: auto;
}

.delete-btn:hover {
  color: var(--text-danger);
  background: var(--bg-danger-light);
}

.meta-remark {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  background: var(--bg-warning-light);
  color: var(--text-warning);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}

.meta-count {
  color: var(--text-secondary);
}

.meta-index {
  min-width: 20px;
  text-align: right;
  font-weight: 500;
}

/* 加载更多 */
.loading-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 20px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-color);
}

.loading-more-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--spinner-bg);
  border-top: 2px solid var(--primary-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.loading-more-text {
  color: var(--text-secondary);
  font-size: 14px;
}

/* 没有更多 */
.no-more {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--bg-surface);
}

.no-more-text {
  color: var(--text-tertiary);
  font-size: 13px;
}

/* 右侧侧边栏 */
.sidebar {
  width: 60px;
  min-height: 100vh;
  background: var(--bg-surface);
  border-left: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 0;
  position: sticky;
  top: 0;
  height: 100vh;
}

.sidebar-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
}

.sidebar-bottom {
  margin-top: auto;
}

.sidebar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.3s;
  color: var(--text-secondary);
}

.sidebar-btn:hover {
  background: var(--bg-hover);
  border-color: var(--primary-color);
  color: var(--primary-color);
  transform: translateX(-2px);
}

.sidebar-btn svg {
  width: 20px;
  height: 20px;
}

.sidebar-btn.copy-btn:hover {
  color: var(--primary-color);
}

.sidebar-btn.paste-btn:hover {
  color: #4caf50;
  border-color: #4caf50;
}

.sidebar-btn.clear-btn {
  color: var(--text-danger);
}

.sidebar-btn.clear-btn:hover {
  background: var(--bg-danger-light);
  border-color: var(--text-danger);
  color: var(--text-danger);
}

/* 右键菜单 */
.context-menu {
  position: fixed;
  background: var(--bg-surface);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 4px;
  min-width: 120px;
  z-index: 2000;
  border: 1px solid var(--border-color);
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.2s;
  color: var(--text-primary);
  font-size: 14px;
}

.context-menu-item:hover {
  background: var(--bg-app);
}

.context-menu-item svg {
  width: 16px;
  height: 16px;
  color: var(--icon-warning);
}

/* 弹窗 */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--overlay-color);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3000;
}

.dialog-content {
  background: var(--bg-surface);
  border-radius: 12px;
  width: 90%;
  max-width: 500px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}

.dialog-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.dialog-close {
  background: none;
  border: none;
  font-size: 20px;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background 0.2s;
}

.dialog-close:hover {
  background: var(--bg-app);
  color: var(--text-primary);
}

.dialog-body {
  padding: 20px;
}

.dialog-preview {
  margin-bottom: 16px;
  padding: 12px;
  background: var(--bg-hover-light);
  border-radius: 8px;
  max-height: 200px;
  overflow: auto;
}

.preview-text {
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}

.preview-image {
  display: flex;
  justify-content: center;
}

.preview-image img {
  max-width: 100%;
  max-height: 180px;
  border-radius: 4px;
}

.dialog-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dialog-field label {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.dialog-field input {
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
  background: var(--bg-surface);
  color: var(--text-primary);
}

.dialog-field input:focus {
  border-color: var(--primary-color);
}

.dialog-footer {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color);
}

.dialog-footer button {
  padding: 8px 20px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.btn-cancel {
  background: var(--bg-app);
  color: var(--text-secondary);
}

.btn-cancel:hover {
  background: var(--bg-cancel-hover);
}

.btn-confirm {
  background: var(--primary-color);
  color: var(--text-white);
}

.btn-confirm:hover {
  background: var(--primary-hover);
}
</style>

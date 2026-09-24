<template>
  <div class="app-container" :class="{ 'performance-optimized': isFullscreen, 'no-transition': isFullscreen }">
    <el-container class="main-layout">
      <!-- 侧边栏 -->
      <AppSidebar
        :current-view="currentView"
        :is-dark-mode="isDarkMode"
        :app-language="appLanguage"
        :collapsed="isSidebarCollapsed"
        @view-change="handleViewChange"
        @dark-mode-toggle="toggleDarkMode"
        @sidebar-toggle="isSidebarCollapsed = !isSidebarCollapsed"
      />

      <!-- 主内容区 -->
      <el-container class="content-layout">
        <!-- 顶部搜索栏 - 在联网检索、关于作者、表情工坊和emoji页面时隐藏 -->
        <AppHeader
          v-if="currentView !== 'online' && currentView !== 'about' &&
               currentView !== 'workshop' && currentView !== 'emoji' && currentView !== 'kaomoji'
               && currentView !== 'videotogif' && currentView !== 'ai' && currentView !== 'girlvideo'
               && currentView !== 'wallpaper' && currentView !== 'favorite' && currentView !== 'beauty'
               && currentView !== 'handsome'"
          :total="displayEmoticons?.length || 0"
          :emoticons="displayEmoticons || []"
          :is-select-mode="isSelectMode"
          :active-source="activeSource"
          :source-count="store.sourceCount"
          @search="handleSearch"
          @upload="handleFileUpload"
          @filter="handleFilter"
          @tags-updated="handleTagsUpdated"
          @selectMode="handleSelectMode"
          @source-filter="handleSourceFilter"
          @import-clicked="showImportDialog = true"
        >
          
        </AppHeader>
        
        <!-- 主内容区域 -->
        <el-main class="main-content">
          <!-- 关于作者页面 -->
          <AboutAuthor v-if="currentView === 'about'" />
          
          <!-- 联网检索视图 -->
          <OnlineSearch v-else-if="currentView === 'online'" :initial-query="contextSearchQuery" />
          
          <!-- 表情工坊视图 -->
          <EmoticonWorkshop v-else-if="currentView === 'workshop'" />
          
          <!-- 视频转GIF视图 -->
          <VideoToGif v-else-if="currentView === 'videotogif'" />
          
          <!-- AI生成表情视图 -->
          <AiEmoticonGenerator v-else-if="currentView === 'ai'" />
          
          <!-- Emoji表情视图 -->
          <EmojiPicker v-else-if="currentView === 'emoji'" />
          
          <!-- 颜文字表情视图 -->
          <KaomojiPicker v-else-if="currentView === 'kaomoji'" />
          
          <!-- 美女视频视图 -->
          <VideoPlayer v-else-if="currentView === 'girlvideo'" />
          
          <!-- 壁纸视图 -->
          <router-view v-else-if="currentView === 'wallpaper'" />
          
          <!-- 美女图片视图 -->
          <BeautyImages v-else-if="currentView === 'beauty'" />
          
          <!-- 帅哥图片视图 -->
          <HandsomeImages v-else-if="currentView === 'handsome'" />
          
          <!-- 本地表情包和收藏表情包视图 -->
          <EmoticonGrid
            v-else
            :emoticons="displayEmoticons || []"
            :active-tag-id="activeTagId"
            :is-gif-only="isGifOnly"
            :tags="tags"
            :show-empty-state-upload="currentView === 'all' && !activeTagId && !isGifOnly"
            :is-fullscreen="isFullscreen"
            :current-view="currentView"
            :is-select-mode="isSelectMode"
            @update="handleEmoticonUpdate"
            @upload="handleFileUpload"
            @select-mode-change="handleSelectModeChange"
            @batch-delete="handleBatchDelete"
            @batch-set-tags="handleBatchSetTags"
            @batch-download="handleBatchDownload"
            @batch-favorite="handleBatchFavorite"
            @edit-emoticon="handleEditEmoticon"
          />
        </el-main>
      </el-container>
    </el-container>

    <!-- 导入对话框 -->
    <ImportDialog
      v-model="showImportDialog"
      @imported="handleImported"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useEmoticonStore } from '@/store/emoticon'
import type { Emoticon } from './types'
import { nanoid } from 'nanoid'
import { Document } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import {
  getStorageItem,
  getStorageItemSync,
  setStorageItemSync,
  STORAGE_KEYS,
  type ThemeColorKey,
  type ThemeMode,
  type AppLanguage
} from '@/utils/storage'
import { applyTheme } from '@/utils/theme'

// 导入组件
import AppSidebar from './components/layout/AppSidebar.vue'
import AppHeader from './components/layout/AppHeader.vue'
import EmoticonGrid from './components/emoticon/EmoticonGrid.vue'
import EmptyState from './components/emoticon/EmptyState.vue'
import Pagination from './components/emoticon/Pagination.vue'
import OnlineSearch from './components/online/OnlineSearch.vue'
import AboutAuthor from './components/AboutAuthor.vue'
import EmoticonWorkshop from './components/workshop/EmoticonWorkshop.vue'
import VideoToGif from './components/video/VideoToGif.vue'
import EmojiPicker from './components/emoji/EmojiPicker.vue'
import KaomojiPicker from './components/emoji/KaomojiPicker.vue'
import AiEmoticonGenerator from '@/components/ai/AiEmoticonGenerator.vue'
import VideoPlayer from './components/VideoPlayer.vue'
import BeautyImages from './components/beauty/BeautyImages.vue'
import HandsomeImages from './components/handsome/HandsomeImages.vue'
import ImportDialog from './components/import/ImportDialog.vue'

const store = useEmoticonStore()
const displayEmoticons = ref<Emoticon[]>([])
// 默认显示联网检索视图
const currentView = ref('online')
const contextSearchQuery = ref('')
const colorSchemeMedia = window.matchMedia('(prefers-color-scheme: dark)')
const isDarkMode = ref(colorSchemeMedia.matches)
const themeMode = ref<ThemeMode>('system')
const appLanguage = ref<AppLanguage>(getStorageItemSync(STORAGE_KEYS.APP_LANGUAGE, 'zh-CN'))
const router = useRouter()
const activeTagId = ref<number | null>(null)
const isGifOnly = ref(false)
const tags = ref<{ id: number; name: string }[]>([])
// 主题颜色（尝试从存储加载，否则默认蓝色）
const themeColor = ref<ThemeColorKey>(getStorageItemSync(STORAGE_KEYS.THEME_COLOR, 'blue'))

// 全屏状态检测
const isFullscreen = ref(false)

// 侧边栏折叠状态
const isSidebarCollapsed = ref(false)

// 选择模式状态
const isSelectMode = ref(false)

// 导入对话框
const showImportDialog = ref(false)

// 来源筛选
const activeSource = ref('all')

// 移除编辑图片URL状态，改用剪贴板方式

// 处理插件进入（支持已运行时的再次进入）
const handlePluginEnter = (action: { code: string; type: string; payload?: string }) => {
  if (action.code === 'bqb_search_with_text' && action.payload) {
    contextSearchQuery.value = action.payload
    currentView.value = 'online'
  }
}

// 初始化
onMounted(async () => {
  try {
    // 注册插件进入监听（ZTools 会把首次进入的动作重放给这里）
    window.ztools?.onPluginEnter(handlePluginEnter)

    // 首先初始化存储
    await store.initializeStore()

    // 加载持久化设置（确保在其他初始化之前完成）
    await loadSettings()

    // 只在显示本地表情包相关视图时才需要加载 displayEmoticons
    if (currentView.value === 'all' || currentView.value === 'favorite') {
      displayEmoticons.value = store.allEmoticons
    }

    // 加载标签
    const savedTags = localStorage.getItem('emoticon-tags')
    if (savedTags) {
      tags.value = JSON.parse(savedTags)
    }

    setupDarkMode()
    setupFullscreenDetection()
    document.addEventListener('paste', handlePaste)
  } catch (error) {
    console.error('App initialization failed:', error)
  }
})

// 加载保存的设置
const loadSettings = async () => {
  try {
    // 优先读取新的主题模式设置，其次兼容旧版仅保存布尔值的逻辑
    const savedThemeMode = await getStorageItem<ThemeMode | null>(STORAGE_KEYS.THEME_MODE, null)
    const savedDarkMode = await getStorageItem<boolean | null>(STORAGE_KEYS.DARK_MODE, null)

    if (savedThemeMode) {
      themeMode.value = savedThemeMode
      setDarkModeState(savedThemeMode === 'system' ? colorSchemeMedia.matches : savedThemeMode === 'dark', false)
    } else if (savedDarkMode !== null) {
      themeMode.value = savedDarkMode ? 'dark' : 'light'
      setDarkModeState(savedDarkMode, false)
    } else {
      themeMode.value = 'system'
      setDarkModeState(colorSchemeMedia.matches, false)
    }

    const savedLanguage = await getStorageItem<AppLanguage>(STORAGE_KEYS.APP_LANGUAGE, appLanguage.value)
    appLanguage.value = savedLanguage
    applyLanguage(savedLanguage, false)

    // 加载并应用主题颜色（如果异步加载的值与同步加载的不同，则更新）
    const savedThemeColor = await getStorageItem(STORAGE_KEYS.THEME_COLOR, themeColor.value)

    // 确保主题色是有效的
    if (savedThemeColor && typeof savedThemeColor === 'string') {
      // 只有当主题色发生变化时才更新
      if (themeColor.value !== savedThemeColor) {
        themeColor.value = savedThemeColor as ThemeColorKey
      }
      // 无论如何都要应用主题，确保CSS变量正确设置
      applyTheme(themeColor.value)
    } else {
      console.warn('Invalid theme color loaded, using current value:', themeColor.value)
      applyTheme(themeColor.value)
    }
  } catch (error) {
    console.error('Error loading settings:', error)
    // 发生错误时应用当前主题色
    applyTheme(themeColor.value)
  }
}

// 保存设置
const saveSettings = () => {
  try {
    setStorageItemSync(STORAGE_KEYS.DARK_MODE, isDarkMode.value)
    setStorageItemSync(STORAGE_KEYS.THEME_MODE, themeMode.value)
    setStorageItemSync(STORAGE_KEYS.APP_LANGUAGE, appLanguage.value)
    setStorageItemSync(STORAGE_KEYS.THEME_COLOR, themeColor.value)
  } catch (error) {
    console.error('Error saving settings:', error)
  }
}

// 设置暗黑模式
const handleSystemThemeChange = (event: MediaQueryListEvent) => {
  if (themeMode.value !== 'system') return
  setDarkModeState(event.matches, false)
}

const setupDarkMode = () => {
  setDarkModeState(isDarkMode.value, false)
  colorSchemeMedia.addEventListener('change', handleSystemThemeChange)
}

// 设置全屏检测
const setupFullscreenDetection = () => {
  const handleFullscreenChange = () => {
    isFullscreen.value = !!(document.fullscreenElement || 
      (document as any).webkitFullscreenElement || 
      (document as any).mozFullScreenElement || 
      (document as any).msFullscreenElement)
    
    // 在全屏时禁用所有过渡效果
    if (isFullscreen.value) {
      document.body.classList.add('no-transition', 'performance-optimized')
    } else {
      // 延迟移除类名，确保全屏切换完成
      setTimeout(() => {
        document.body.classList.remove('no-transition', 'performance-optimized')
      }, 100)
    }
  }
  
  // 添加全屏事件监听器
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
  document.addEventListener('mozfullscreenchange', handleFullscreenChange)
  document.addEventListener('MSFullscreenChange', handleFullscreenChange)
  
  // 初始检测
  handleFullscreenChange()
}

// 切换暗黑模式
const setDarkModeState = (dark: boolean, persist = true) => {
  isDarkMode.value = dark
  if (dark) {
    document.documentElement.classList.add('dark')
    document.documentElement.setAttribute('data-theme', 'dark')
  } else {
    document.documentElement.classList.remove('dark')
    document.documentElement.setAttribute('data-theme', 'light')
  }

  if (persist) {
    saveSettings()
  }
}

const toggleDarkMode = (dark = !isDarkMode.value) => {
  themeMode.value = dark ? 'dark' : 'light'
  setDarkModeState(dark)
}

const applyLanguage = (language: AppLanguage, persist = true) => {
  appLanguage.value = language
  document.documentElement.lang = language
  document.documentElement.setAttribute('data-language', language)

  if (persist) {
    saveSettings()
  }
}

const toggleLanguage = () => {
  applyLanguage(appLanguage.value === 'zh-CN' ? 'en-US' : 'zh-CN')
}

const getCurrentFilteredEmoticons = () => {
  let filtered = activeSource.value === 'all'
    ? (currentView.value === 'favorite'
        ? [...store.favoriteEmoticons]
        : [...store.allEmoticons])
    : store.filterBySource(activeSource.value).filter(e =>
        currentView.value === 'favorite' ? e.favorite : true
      )

  if (isGifOnly.value) {
    filtered = filtered.filter(emoticon =>
      emoticon.type === 'image/gif' ||
      emoticon.url.toLowerCase().endsWith('.gif') ||
      emoticon.url.toLowerCase().includes('.gif?')
    )
  }

  if (activeTagId.value !== null && tags.value) {
    const activeTag = tags.value.find(tag => tag.id === activeTagId.value)
    if (activeTag) {
      filtered = filtered.filter(emoticon =>
        emoticon.tags && emoticon.tags.includes(activeTag.name)
      )
    }
  }

  return filtered
}

const syncDisplayEmoticons = () => {
  if (currentView.value === 'all' || currentView.value === 'favorite') {
    displayEmoticons.value = getCurrentFilteredEmoticons()
  }
}


// 处理视图切换
const handleViewChange = async (view: string) => {
  try {
    currentView.value = view
    
    // 当切换到收藏页面时，自动关闭选择模式
    if (view === 'favorite' && isSelectMode.value) {
      isSelectMode.value = false
      console.log('切换到收藏页面，自动关闭选择模式')
    }
    
    // 根据视图类型切换显示内容
    switch (view) {
      case 'emoji':
        router.push('/emoji')
        break
      case 'kaomoji':
        router.push('/kaomoji')
        break
      case 'about':
        router.push('/about')
        break
      case 'online':
        router.push('/online')
        break
      case 'workshop':
        router.push('/workshop')
        break
      case 'videotogif':
        router.push('/videotogif')
        break
      case 'ai':
        router.push('/ai')
        break
      case 'girlvideo':
        router.push('/girlvideo')
        break
      case 'wallpaper':
        router.push('/wallpaper')
        break
      case 'beauty':
        router.push('/beauty')
        break
      case 'handsome':
        router.push('/handsome')
        break
      case 'import':
        showImportDialog.value = true
        break
      default:
        // 先清空当前显示的表情包
        displayEmoticons.value = []
        
        // 确保store已初始化
        if (!store.initialized) {
          await store.initializeStore()
        } else {
          await store.refreshEmoticons()
        }
        
        // 根据视图类型设置显示的表情包
        if (view === 'all') {
          router.push('/')
        } else if (view === 'favorite') {
          router.push('/favorite')
        }
        
        // 重置筛选状态
        activeTagId.value = null
        isGifOnly.value = false
        activeSource.value = 'all'
        syncDisplayEmoticons()
    }
  } catch (error) {
    console.error('Failed to change view:', error)
    ElMessage.error('切换视图失败，请重试')
  }
}

// 切换主题颜色
const handleThemeColorChange = (color: ThemeColorKey) => {
  themeColor.value = color
  applyTheme(color)
  saveSettings()
}

// 处理搜索
const handleSearch = (query: string) => {
  displayEmoticons.value = store.searchEmoticons(query)
}

// 处理选择模式切换
const handleSelectMode = () => {
  console.log('AppHeader 触发选择模式切换，当前状态:', isSelectMode.value)
  isSelectMode.value = !isSelectMode.value
  console.log('切换后状态:', isSelectMode.value)
  
  // 如果退出选择模式，通知 EmoticonGrid 清除选中状态
  if (!isSelectMode.value) {
    console.log('退出选择模式，需要清除选中状态')
    // 通过事件总线或其他方式通知 EmoticonGrid 清除选择
    // 这里我们依赖 EmoticonGrid 监听 isSelectMode 的变化来自动清除
  }
}

// 处理选择模式状态变化
const handleSelectModeChange = (selectMode: boolean) => {
  console.log('EmoticonGrid 触发选择模式变化:', selectMode)
  isSelectMode.value = selectMode
  console.log('设置后状态:', isSelectMode.value)
}

// 处理编辑表情包
const handleEditEmoticon = async (emoticonId: string) => {
  try {
    // 查找选中的表情包
    const emoticon = displayEmoticons.value.find(e => e.id === emoticonId)
    if (!emoticon) {
      ElMessage.error('未找到要编辑的表情包')
      return
    }
    
    console.log('编辑表情包:', emoticon.url) // 调试信息
    
    // 显示加载提示
    const loadingMessage = ElMessage({
      type: 'info',
      message: '正在复制图片到剪贴板...',
      duration: 0
    })
    
    try {
      // 将图片复制到剪贴板
      const response = await fetch(emoticon.url)
      const blob = await response.blob()
      
      console.log('获取到图片blob:', blob.type, blob.size) // 调试信息
      
      // 创建 ClipboardItem 对象
      const item = new ClipboardItem({
        [blob.type]: blob
      })
      
      // 写入剪贴板
      await navigator.clipboard.write([item])
      console.log('图片已成功复制到剪贴板') // 调试信息
      
      loadingMessage.close()
      
      // 清除选择状态，强制使用剪贴板方式
      
      // 切换到表情工坊视图
      await handleViewChange('workshop')
      
      ElMessage.success('图片已复制到剪贴板，正在表情工坊中自动粘贴...')
      
    } catch (clipboardError) {
      console.error('复制到剪贴板失败:', clipboardError)
      loadingMessage.close()
      ElMessage.error('复制图片到剪贴板失败，请手动复制图片后到表情工坊粘贴')
    }
    
  } catch (error) {
    console.error('Failed to edit emoticon:', error)
    ElMessage.error('编辑操作失败')
  }
}

// 批量删除
const handleBatchDelete = async (emoticonIds: string[]) => {
  try {
    const loadingMessage = ElMessage({
      type: 'info',
      message: `正在删除 ${emoticonIds.length} 个表情包...`,
      duration: 0
    })
    
    await store.deleteEmoticons(emoticonIds)
    syncDisplayEmoticons()
    
    loadingMessage.close()
    ElMessage({
      message: `批量删除成功，共删除 ${emoticonIds.length} 个表情包`,
      type: 'success',
      showClose: true,
      duration: 3000
    })
  } catch (error) {
    console.error('Batch delete failed:', error)
    ElMessage.error('批量删除失败，请重试')
  }
}

// 批量设置标签
const handleBatchSetTags = async (emoticonIds: string[], tags: string[]) => {
  try {
    const loadingMessage = ElMessage({
      type: 'info',
      message: `正在为 ${emoticonIds.length} 个表情包设置标签...`,
      duration: 0
    })
    
    const idSet = new Set(emoticonIds)
    const updatedEmoticons = store.allEmoticons
      .filter(emoticon => idSet.has(emoticon.id))
      .map(emoticon => ({
        ...emoticon,
        tags,
        updateTime: Date.now()
      }))

    await store.updateEmoticons(updatedEmoticons)
    syncDisplayEmoticons()
    
    loadingMessage.close()
    ElMessage.success(`批量设置成功，共更新 ${updatedEmoticons.length} 个表情包`)
  } catch (error) {
    console.error('Batch set tags failed:', error)
    ElMessage.error('批量设置标签失败，请重试')
  }
}

// 批量下载
const handleBatchDownload = async (emoticonIds: string[]) => {
  try {
    let loadingMessage = ElMessage({
      type: 'info',
      message: '正在打包下载...',
      duration: 0
    })
    
    // 动态导入 JSZip
    const JSZipModule = await import('jszip') as any
    const JSZip = JSZipModule.default || JSZipModule
    const zip = new JSZip()
    const folder = zip.folder('表情包')
    if (!folder) throw new Error('Failed to create folder')
    
    let processedCount = 0
    
    for (const id of emoticonIds) {
      try {
        const emoticon = displayEmoticons.value.find(e => e.id === id)
        if (emoticon) {
          const response = await fetch(emoticon.url)
          const blob = await response.blob()
          
          let ext = 'png'
          if (blob.type === 'image/gif') ext = 'gif'
          else if (blob.type === 'image/jpeg') ext = 'jpg'
          
          folder.file(`${emoticon.name || 'emoticon'}.${ext}`, blob)
          processedCount++
          
          // 重新创建加载消息
          loadingMessage.close()
          loadingMessage = ElMessage({
            type: 'info',
            message: `正在打包下载... (${processedCount}/${emoticonIds.length})`,
            duration: 0
          })
        }
      } catch (err) {
        console.error(`Failed to add emoticon ${id} to zip:`, err)
      }
    }
    
    loadingMessage.close()
    loadingMessage = ElMessage({
      type: 'info',
      message: '正在生成压缩包...',
      duration: 0
    })
    const content = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 }
    })
    
    const link = document.createElement('a')
    link.href = URL.createObjectURL(content)
    const now = new Date()
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
    link.download = `选中表情包_${timestamp}.zip`
    
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(link.href)
    
    loadingMessage.close()
    ElMessage.success(`批量下载成功！共 ${processedCount} 个表情包`)
  } catch (error) {
    console.error('Batch download failed:', error)
    ElMessage.error('批量下载失败，请重试')
  }
}

// 批量收藏
const handleBatchFavorite = async (emoticonIds: string[]) => {
  try {
    const loadingMessage = ElMessage({
      type: 'info',
      message: `正在收藏 ${emoticonIds.length} 个表情包...`,
      duration: 0
    })
    
    const idSet = new Set(emoticonIds)
    const updatedEmoticons = store.allEmoticons
      .filter(emoticon => idSet.has(emoticon.id))
      .map(emoticon => ({
        ...emoticon,
        favorite: true,
        updateTime: Date.now()
      }))

    await store.updateEmoticons(updatedEmoticons)
    syncDisplayEmoticons()
    
    loadingMessage.close()
    ElMessage.success(`批量收藏成功，共收藏 ${updatedEmoticons.length} 个表情包`)
  } catch (error) {
    console.error('Batch favorite failed:', error)
    ElMessage.error('批量收藏失败，请重试')
  }
}

// 处理文件上传
const handleFileUpload = async (file: File | null) => {
  if (!file) return;
  
  try {
    // 获取当前选中的标签名称
    let currentTags: string[] = []
    if (activeTagId.value && tags.value) {
      const activeTag = tags.value.find(tag => tag.id === activeTagId.value)
      if (activeTag) {
        currentTags = [activeTag.name]
      }
    }

    const emoticon = {
      id: nanoid(),
      name: file.name,
      url: '', // 将由 store 处理
      type: file.type,
      favorite: false,
      source: 'local' as const,
      createdAt: Date.now(),
      createTime: Date.now(),
      updateTime: Date.now(),
      tags: currentTags // 使用当前选中的标签
    };

    await store.addEmoticon(emoticon, file);
    syncDisplayEmoticons()
    
    ElMessage.success('上传成功');
  } catch (error) {
    console.error('Failed to add emoticon:', error);
    ElMessage.error('上传失败');
  }
};

// 处理导入完成
const handleImported = async () => {
  try {
    syncDisplayEmoticons()
  } catch (error) {
    console.error('Failed to refresh after import:', error)
  }
}

// 处理表情包更新
const handleEmoticonUpdate = async (emoticons: Emoticon[]) => {
  try {
    if (currentView.value === 'all' || currentView.value === 'favorite') {
      syncDisplayEmoticons()
    } else {
      // 如果是搜索结果，保留搜索结果中未被删除的表情包
      displayEmoticons.value = emoticons;
    }
  } catch (error) {
    console.error('Failed to update emoticons:', error);
    ElMessage.error('更新失败，请重试');
  }
}

// 添加粘贴事件处理函数
const handlePaste = async (e: ClipboardEvent) => {
  // 检查目标元素是否是搜索框
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    return; // 如果是输入框，不拦截粘贴事件
  }
  
  // 阻止默认粘贴行为
  e.preventDefault();
  
  try {
    const items = e.clipboardData?.items;
    if (!items) return;

    let hasImage = false;
    
    for (const item of items) {
      // 检查是否是图片类型
      if (item.type.startsWith('image/')) {
        hasImage = true;
        const file = item.getAsFile();
        if (!file) continue;

        // 使用已有的文件上传处理函数
        await handleFileUpload(file);
        
        // 只处理第一个图片
        break;
      }
    }

    if (!hasImage) {
      ElMessage.info('剪贴板中未发现图片');
    }
  } catch (error) {
    console.error('Failed to handle paste:', error);
    ElMessage.error('添加失败，请重试');
  }
};

// 处理来源筛选
const handleSourceFilter = async (source: string) => {
  try {
    activeSource.value = source
    syncDisplayEmoticons()
  } catch (error) {
    console.error('Failed to filter by source:', error)
  }
}

// 处理过滤
const handleFilter = async (tagId: number | null, isGif = false) => {
  try {
    // 更新状态
    activeTagId.value = tagId
    isGifOnly.value = isGif

    // 每次筛选前重新加载标签数据
    const savedTags = localStorage.getItem('emoticon-tags')
    if (savedTags) {
      tags.value = JSON.parse(savedTags)
    }

    // 更新显示的表情包
    displayEmoticons.value = getCurrentFilteredEmoticons()
  } catch (error) {
    console.error('Failed to filter emoticons:', error)
    ElMessage.error('筛选失败，请重试')
  }
}

// 处理标签更新和删除
const handleTagsUpdated = async (updatedTags: { id: number; name: string }[], deletedTags: string[]) => {
  try {
    // 更新本地标签列表
    tags.value = updatedTags
    
    // 如果有标签被删除，更新所有表情包的标签
    if (deletedTags.length > 0) {
      const deletedTagSet = new Set(deletedTags)
      const updatedEmoticons = store.allEmoticons
        .filter(emoticon => emoticon.tags && emoticon.tags.some(tag => deletedTagSet.has(tag)))
        .map(emoticon => ({
          ...emoticon,
          tags: emoticon.tags.filter(tag => !deletedTagSet.has(tag)),
          updateTime: Date.now()
        }))

      await store.updateEmoticons(updatedEmoticons)
      syncDisplayEmoticons()
      
      ElMessage.success('已更新表情包分类')
    }
  } catch (error) {
    console.error('Failed to update emoticons tags:', error)
    ElMessage.error('更新表情包分类失败')
  }
}

// 清理临时URL
onBeforeUnmount(() => {
  document.removeEventListener('paste', handlePaste)
  colorSchemeMedia.removeEventListener('change', handleSystemThemeChange)
  
  // 清理全屏事件监听器
  document.removeEventListener('fullscreenchange', () => {})
  document.removeEventListener('webkitfullscreenchange', () => {})
  document.removeEventListener('mozfullscreenchange', () => {})
  document.removeEventListener('MSFullscreenChange', () => {})
  
  store.clearURLs()
})
</script>

<style scoped lang="scss">
@import '@/styles/performance.scss';
.app-container {
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background:
    radial-gradient(circle at top right, rgba(91, 155, 213, 0.14), transparent 28%),
    linear-gradient(180deg, var(--app-bg-elevated) 0%, var(--app-bg) 100%);
  /* 强化硬件加速和性能优化 */
  will-change: auto;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  /* 强制复合层和新建射堆上下文 */
  contain: layout style paint;
  isolation: isolate;
  /* 避免重排的布局模式 */
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;

  .main-layout {
    height: 100%;
    width: 100%;
    /* 强化性能优化 */
    contain: layout style;
    transform: translate3d(0, 0, 0);
    position: relative;
    
    .content-layout {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-left: 12px solid var(--app-bg);
      background: transparent;
      /* 强化性能优化，完全防止全屏时闪烁 */
      will-change: auto;
      contain: layout style paint;
      transform: translate3d(0, 0, 0);
      position: relative;
      height: 100%;
      
      .main-content {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 0;
        position: relative;
        /* 使用固定高度避免视口单位重计算 */
        height: 100%;
        background-color: var(--el-bg-color-page);
        /* 强化性能优化，完全防止滚动时闪烁 */
        will-change: scroll-position;
        transform: translate3d(0, 0, 0);
        contain: layout style paint;
        /* 避免重绘 */
        backface-visibility: hidden;
        
        &::-webkit-scrollbar {
          display: none;
        }
        
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
    }
  }
}

:global(html.dark) .app-container .content-layout {
  background: transparent;
}

// 确保 el-container 正确显示
:deep(.el-container) {
  height: 100%;
  
  &.is-vertical {
    flex: 1;
  }
}

// 调整 el-main 样式
:deep(.el-main) {
  --el-main-padding: 0;
  background-color: var(--el-bg-color-page);
}

// 调整 el-header 样式
:deep(.el-header) {
  --el-header-padding: 0 16px;
  background-color: transparent;
  border-bottom: 1px solid var(--app-border);
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;

  .paste-tip {
    .el-tag {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;

      .el-icon {
        font-size: 14px;
      }
    }
  }
}
</style>

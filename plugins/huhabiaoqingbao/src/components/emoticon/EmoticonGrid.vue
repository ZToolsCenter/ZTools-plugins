<template>
  <div class="emoticon-grid-container" 
       :class="{ 'flicker-resistant': isFullscreen, 'drag-over': isDragging }"
       @dragover="handleDragOver"
       @drop="handleDrop"
       @dragenter="handleDragEnter"
       @dragleave="handleDragLeave">
    <!-- 新的趣味加载动画 -->
    <EmoticonLoader v-if="loading" />

    <!-- 添加空状态提示 -->
    <div v-else-if="sortedEmoticons.length === 0" class="empty-state">
      <el-empty :image-size="120">
        <template #description>
          <p v-if="showEmptyStateUpload">还没有表情包哦</p>
          <p v-else>当前分类下没有表情包</p>
        </template>
        <el-tooltip content="添加表情包" placement="top">
          <el-button v-if="showEmptyStateUpload" type="primary" circle @click="$emit('upload', null)" style="background-color: #2e6fef; border-color: #2e6fef; width: 40px; height: 40px; padding: 0;">
            <el-icon><Plus /></el-icon>
          </el-button>
        </el-tooltip>
      </el-empty>
    </div>
    
    <div v-else class="emoticon-grid">
      <EmoticonItem
        v-for="emoticon in sortedEmoticons" 
        :key="emoticon.id"
        :emoticon="emoticon"
        :current-view="currentView"
        :is-select-mode="props.isSelectMode"
        :is-selected="selectedEmoticons.has(emoticon.id)"
        @update="handleEmoticonUpdate"
        @delete="handleEmoticonDelete"
        @preview="handlePreview"
        @select="handleEmoticonSelect"
      />
    </div>

    <!-- 仿苹果风格批量操作菜单 -->
    <Teleport to="body">
      <div v-if="props.isSelectMode" class="batch-actions-panel">
          <!-- 上部信息栏 -->
          <div class="batch-header">
            <div class="selection-info">
              <div class="count-badge">{{ selectedEmoticons.size }}</div>
              <span class="selection-text">个项目已选中</span>
            </div>
            <div class="header-actions">
              <button class="select-all-btn" @click="handleSelectAll" :class="{ 'all-selected': isAllSelected }">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                  <path v-if="isAllSelected" d="M12 4.5L5.5 11L2 7.5L3.5 6L5.5 8L10.5 3L12 4.5Z"/>
                  <rect v-else x="2" y="2" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
                </svg>
                <span>全选</span>
              </button>
              <button class="close-btn" @click="handleExitSelectMode">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                  <path d="M14 1.41L12.59 0L7 5.59L1.41 0L0 1.41L5.59 7L0 12.59L1.41 14L7 8.41L12.59 14L14 12.59L8.41 7L14 1.41Z"/>
                </svg>
              </button>
            </div>
          </div>
          
          <!-- 分割线 -->
          <div class="divider"></div>
          
          <!-- 操作按钮组 -->
          <div class="action-buttons">
            <button
              class="action-btn rename-btn"
              :disabled="selectedEmoticons.size !== 1"
              @click="handleBatchRename">
              <div class="btn-icon">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M11.854 1.146a.5.5 0 0 1 .707 0l2.293 2.293a.5.5 0 0 1 0 .707l-8.5 8.5L4 13l.354-2.354 8.5-8.5z"/>
                  <path d="M1 15h14v1H0v-2.5l3.293-3.293 1.414 1.414L2 14h-.5A.5.5 0 0 0 1 14.5V15z"/>
                </svg>
              </div>
              <span class="btn-text">改名</span>
            </button>

            <button class="action-btn download-btn" @click="handleBatchDownload">
              <div class="btn-icon">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8.5 1.5V11.793l3.146-3.147a.5.5 0 0 1 .707.708l-4 4a.5.5 0 0 1-.708 0l-4-4a.5.5 0 0 1 .708-.708L7.5 11.793V1.5a.5.5 0 0 1 1 0z"/>
                  <path d="M3 15h10a1 1 0 0 0 1-1v-3a.5.5 0 0 0-1 0v3H3v-3a.5.5 0 0 0-1 0v3a1 1 0 0 0 1 1z"/>
                </svg>
              </div>
              <span class="btn-text">下载</span>
            </button>
            
            <button class="action-btn favorite-btn" @click="handleBatchFavorite">
              <div class="btn-icon">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 12.5l-4.5 2.5 1-5L0 6.5l5-.5L8 1l2.5 5 5 .5-4.5 3.5 1 5L8 12.5z"/>
                </svg>
              </div>
              <span class="btn-text">收藏</span>
            </button>
            
            <button class="action-btn tag-btn" @click="showTagDialog = true">
              <div class="btn-icon">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M2 2a1 1 0 0 1 1-1h4.586a1 1 0 0 1 .707.293l7 7a1 1 0 0 1 0 1.414l-4.586 4.586a1 1 0 0 1-1.414 0l-7-7A1 1 0 0 1 2 6.586V2z"/>
                  <path d="M5.5 5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0z"/>
                </svg>
              </div>
              <span class="btn-text">标签</span>
            </button>
            
            <button class="action-btn delete-btn" @click="handleBatchDelete">
              <div class="btn-icon">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5ZM11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H2.506a.58.58 0 0 0-.01 0H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84L14.962 3.5H15.5a.5.5 0 0 0 0-1h-4.5Z"/>
                </svg>
              </div>
              <span class="btn-text">删除</span>
            </button>
          </div>
        </div>
    </Teleport>

    <!-- 仿苹果风格批量设置标签对话框 -->
    <el-dialog
      v-model="showTagDialog"
      title="为选中项目设置标签"
      width="400px"
      :close-on-click-modal="false"
      :append-to-body="true"
      destroy-on-close
      class="apple-style-dialog"
    >
      <div class="apple-tag-selector">
        <template v-if="availableTags.length > 0">
          <div class="tags-grid">
            <div 
              v-for="tag in availableTags"
              :key="tag.id"
              class="tag-item"
              :class="{ 'selected': batchTags.includes(tag.name) }"
              @click="toggleTag(tag.name)"
            >
              <div class="tag-checkbox">
                <svg v-if="batchTags.includes(tag.name)" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M10.97 4.97a.75.75 0 0 0-1.07-1.05L6 7.88 3.66 5.54a.75.75 0 0 0-1.06 1.06l2.82 2.83c.3.3.77.3 1.06 0l4.49-4.5Z"/>
                </svg>
              </div>
              <span class="tag-name">{{ tag.name }}</span>
            </div>
          </div>
        </template>
        <div v-else class="empty-state">
          <div class="empty-icon">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="currentColor">
              <path d="M4 4a2 2 0 0 1 2-2h9.172a2 2 0 0 1 1.414.586l14 14a2 2 0 0 1 0 2.828l-9.172 9.172a2 2 0 0 1-2.828 0l-14-14A2 2 0 0 1 4 13.172V4z"/>
              <circle cx="11" cy="11" r="2" fill="white"/>
            </svg>
          </div>
          <p class="empty-text">暂无标签</p>
          <p class="empty-hint">可在分类管理中添加新标签</p>
        </div>
      </div>
      <template #footer>
        <div class="apple-dialog-footer">
          <button class="apple-btn secondary" @click="showTagDialog = false">取消</button>
          <button class="apple-btn primary" @click="handleBatchSetTags" :disabled="availableTags.length === 0">应用</button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showRenameDialog"
      title="修改文件名"
      width="360px"
      :close-on-click-modal="false"
      :append-to-body="true"
      destroy-on-close
      class="apple-style-dialog"
    >
      <div class="rename-form">
        <el-input
          v-model="renameValue"
          placeholder="输入新的文件名"
          maxlength="100"
          clearable
          @keyup.enter="handleRenameConfirm"
        />
        <p class="rename-hint">一次只能修改一个表情包的文件名。</p>
      </div>
      <template #footer>
        <div class="apple-dialog-footer">
          <button class="apple-btn secondary" @click="showRenameDialog = false">取消</button>
          <button class="apple-btn primary" @click="handleRenameConfirm">保存</button>
        </div>
      </template>
    </el-dialog>

    <!-- 修改预览组件，添加 teleport -->
    <Teleport to="body">
      <el-image-viewer
        v-if="showViewer"
        :url-list="[previewUrl]"
        :initial-index="0"
        :zoom-rate="1.2"
        :hide-on-click-modal="true"
        @close="showViewer = false"
      />
    </Teleport>
    
    <!-- 批量删除确认模态框 -->
    <DeleteConfirmModal
      v-model:visible="showBatchDeleteModal"
      title="批量删除"
      :message="`即将删除选中的表情包，此操作不可撤销。`"
      :item-count="selectedEmoticons.size"
      @confirm="confirmBatchDelete"
      @cancel="showBatchDeleteModal = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, nextTick, watch } from 'vue'
import { useEmoticonStore } from '@/store/emoticon'
import EmoticonItem from './EmoticonItem.vue'
import EmoticonLoader from './EmoticonLoader.vue'
import type { Emoticon } from '@/types'
import { ElMessage, ElImageViewer, ElMessageBox } from 'element-plus'
import { Plus, Loading, Delete, Collection, Download } from '@element-plus/icons-vue'
import DeleteConfirmModal from '@/components/DeleteConfirmModal.vue'

const props = defineProps<{
  emoticons: Emoticon[]
  activeTagId?: number | null
  isGifOnly?: boolean
  tags?: { id: number; name: string }[]
  showEmptyStateUpload?: boolean
  isFullscreen?: boolean // 新增全屏状态属性
  currentView?: string // 新增当前视图属性
  isSelectMode?: boolean // 新增选择模式属性
}>()

const emit = defineEmits<{
  (e: 'update', emoticons: Emoticon[]): void
  (e: 'upload', file: File | null): void
  (e: 'selectModeChange', isSelectMode: boolean): void
  (e: 'batchDelete', emoticonIds: string[]): void
  (e: 'batchSetTags', emoticonIds: string[], tags: string[]): void
  (e: 'batchDownload', emoticonIds: string[]): void
  (e: 'batchFavorite', emoticonIds: string[]): void
}>()

const store = useEmoticonStore()

// 图片预览相关状态
const showViewer = ref(false)
const previewUrl = ref('')
// 加载状态
const loading = ref(true) // 修改：初始加载状态设为true

// 选择模式相关状态
const selectedEmoticons = ref<Set<string>>(new Set())
const showBatchActions = ref(false)
const showTagDialog = ref(false)
const batchTags = ref<string[]>([])
const availableTags = ref<{ id: number; name: string }[]>([])
const showBatchDeleteModal = ref(false)
const showRenameDialog = ref(false)
const renameValue = ref('')

// 添加计算属性对表情包进行排序和筛选
const sortedEmoticons = computed(() => {
  // 确保 emoticons 是数组
  const emoticonArray = Array.isArray(props.emoticons) ? props.emoticons : []
  
  // 直接使用表情包列表，因为已经在父组件中完成了筛选
  let filtered = [...emoticonArray]

  // 最后按时间排序
  return filtered.sort((a, b) => {
    return (b.createdAt || b.createTime || 0) - (a.createdAt || a.createTime || 0)
  })
})

// 全选状态计算属性
const isAllSelected = computed(() => {
  return sortedEmoticons.value.length > 0 && selectedEmoticons.value.size === sortedEmoticons.value.length
})

const selectedSingleEmoticon = computed(() => {
  if (selectedEmoticons.value.size !== 1) return null
  const [selectedId] = Array.from(selectedEmoticons.value)
  return props.emoticons.find(emoticon => emoticon.id === selectedId) || null
})

// 在组件挂载时添加加载动画
onMounted(() => {
  // 加载标签数据
  loadTags()
  
  // 修改：即使有数据也显示短暂的加载动画
  if (props.emoticons === undefined || props.emoticons === null || props.emoticons.length === 0) {
    loading.value = true
    // 模拟加载过程
    setTimeout(() => {
      loading.value = false
    }, 1200)
  } else {
    // 短暂显示加载动画以确保用户注意到内容加载
    setTimeout(() => {
      loading.value = false
    }, 800)
  }
})

// 处理图片预览
const handlePreview = (emoticon: Emoticon) => {
  previewUrl.value = emoticon.url
  showViewer.value = true
}

// 处理表情包更新
const handleEmoticonUpdate = (emoticon: Emoticon) => {
  const index = props.emoticons.findIndex(e => e.id === emoticon.id)
  if (index !== -1) {
    props.emoticons.splice(index, 1, emoticon)
    emit('update', props.emoticons)
  }
}

// 处理表情包删除
const handleEmoticonDelete = async (emoticon: Emoticon) => {
  try {
    await store.deleteEmoticon(emoticon.id)
    
    // 创建一个新的数组，而不是修改原数组
    const updatedEmoticons = props.emoticons.filter(e => e.id !== emoticon.id)
    
    // 发出更新事件
    emit('update', updatedEmoticons)
    
    ElMessage({
      message: '删除成功',
      type: 'success',
      showClose: true,
      duration: 3000
    })
  } catch (err) {
    console.error('Failed to delete emoticon:', err)
    ElMessage({
      message: '删除失败',
      type: 'error',
      showClose: true,
      duration: 3000
    })
  }
}

// 加载标签数据
const loadTags = () => {
  const savedTags = localStorage.getItem('emoticon-tags')
  if (savedTags) {
    availableTags.value = JSON.parse(savedTags)
  }
}

// 处理表情包选择
const handleEmoticonSelect = (emoticonId: string, selected: boolean) => {
  if (selected) {
    selectedEmoticons.value.add(emoticonId)
  } else {
    selectedEmoticons.value.delete(emoticonId)
  }
}

// 处理全选
const handleSelectAll = () => {
  if (isAllSelected.value) {
    // 如果已经全选，则取消全选
    selectedEmoticons.value.clear()
  } else {
    // 否则选中所有表情包
    sortedEmoticons.value.forEach(emoticon => {
      selectedEmoticons.value.add(emoticon.id)
    })
  }
}

// 退出选择模式
const handleExitSelectMode = () => {
  console.log('退出选择模式，清除选中状态')
  selectedEmoticons.value.clear()
  console.log('已清除选中的表情包，当前选中数量:', selectedEmoticons.value.size)
  emit('selectModeChange', false)
  
  // 强制更新DOM，确保样式立即生效
  nextTick(() => {
    console.log('DOM更新完成，选择模式已退出')
  })
}

// 监听选择模式变化，当退出选择模式时自动清除选中状态
watch(() => props.isSelectMode, (newVal, oldVal) => {
  console.log('EmoticonGrid - 选择模式状态变化:', oldVal, '->', newVal)
  if (oldVal === true && newVal === false) {
    console.log('检测到退出选择模式，自动清除选中状态')
    selectedEmoticons.value.clear()
    nextTick(() => {
      console.log('选中状态已清除，DOM已更新')
    })
  }
})

// 批量删除
const handleBatchDelete = () => {
  if (selectedEmoticons.value.size === 0) return
  showBatchDeleteModal.value = true
}

// 确认批量删除
const confirmBatchDelete = () => {
  const emoticonIds = Array.from(selectedEmoticons.value)
  emit('batchDelete', emoticonIds)
  selectedEmoticons.value.clear()
  showBatchDeleteModal.value = false
}

// 批量设置标签
const handleBatchSetTags = () => {
  if (selectedEmoticons.value.size === 0) return
  
  const emoticonIds = Array.from(selectedEmoticons.value)
  emit('batchSetTags', emoticonIds, batchTags.value)
  showTagDialog.value = false
  selectedEmoticons.value.clear()
  batchTags.value = []
}

// 批量下载
const handleBatchDownload = () => {
  if (selectedEmoticons.value.size === 0) return
  
  const emoticonIds = Array.from(selectedEmoticons.value)
  emit('batchDownload', emoticonIds)
  selectedEmoticons.value.clear()
}

// 批量收藏
const handleBatchFavorite = () => {
  if (selectedEmoticons.value.size === 0) return
  
  const emoticonIds = Array.from(selectedEmoticons.value)
  emit('batchFavorite', emoticonIds)
  selectedEmoticons.value.clear()
}

const handleBatchRename = () => {
  if (selectedEmoticons.value.size === 0) return

  if (selectedEmoticons.value.size !== 1 || !selectedSingleEmoticon.value) {
    ElMessage.warning('修改文件名时请只选择一个表情包')
    return
  }

  renameValue.value = selectedSingleEmoticon.value.name || ''
  showRenameDialog.value = true
}

const handleRenameConfirm = async () => {
  const selectedEmoticon = selectedSingleEmoticon.value
  const nextName = renameValue.value.trim()

  if (!selectedEmoticon) {
    ElMessage.warning('请选择一个表情包后再修改文件名')
    return
  }

  if (!nextName) {
    ElMessage.warning('文件名不能为空')
    return
  }

  if (nextName === selectedEmoticon.name) {
    showRenameDialog.value = false
    return
  }

  try {
    const updatedEmoticon = {
      ...selectedEmoticon,
      name: nextName,
      updateTime: Date.now()
    }

    await store.updateEmoticon(updatedEmoticon)

    const updatedEmoticons = props.emoticons.map(emoticon =>
      emoticon.id === updatedEmoticon.id ? updatedEmoticon : emoticon
    )

    emit('update', updatedEmoticons)
    showRenameDialog.value = false
    selectedEmoticons.value.clear()
    ElMessage.success('文件名修改成功')
  } catch (error) {
    console.error('Failed to rename emoticon:', error)
    ElMessage.error('文件名修改失败')
  }
}



// 切换标签选择
const toggleTag = (tagName: string) => {
  const index = batchTags.value.indexOf(tagName)
  if (index > -1) {
    batchTags.value.splice(index, 1)
  } else {
    batchTags.value.push(tagName)
  }
}

// 添加拖拽相关的响应式数据
const isDragging = ref(false)
const dragCounter = ref(0)

// 拖拽事件处理函数
const handleDragOver = (event: DragEvent) => {
  event.preventDefault()
  event.stopPropagation()
}

const handleDragEnter = (event: DragEvent) => {
  event.preventDefault()
  event.stopPropagation()
  dragCounter.value++
  
  // 只在本地表情包页面(all)启用拖拽功能，收藏页面(favorite)不启用
  if (props.currentView === 'all') {
    isDragging.value = true
  }
}

const handleDragLeave = (event: DragEvent) => {
  event.preventDefault()
  event.stopPropagation()
  dragCounter.value--
  
  if (dragCounter.value === 0) {
    isDragging.value = false
  }
}

const handleDrop = async (event: DragEvent) => {
  event.preventDefault()
  event.stopPropagation()
  
  isDragging.value = false
  dragCounter.value = 0
  
  // 只在本地表情包页面(all)处理拖拽文件，收藏页面(favorite)不处理
  if (props.currentView !== 'all') {
    return
  }
  
  const files = event.dataTransfer?.files
  if (files && files.length > 0) {
    // 过滤出图片文件
    const imageFiles = Array.from(files).filter(file => 
      file.type.startsWith('image/')
    )
    
    if (imageFiles.length > 0) {
      try {
        // 逐个处理图片文件
        for (const file of imageFiles) {
          await handleFileUpload(file)
        }
        
        ElMessage.success(`成功导入 ${imageFiles.length} 个表情包`)
      } catch (error) {
        console.error('导入表情包失败:', error)
        ElMessage.error('导入表情包失败')
      }
    } else {
      ElMessage.warning('请拖拽图片文件')
    }
  }
}

// 处理文件上传的函数（与 App.vue 保持一致）
const handleFileUpload = async (file: File) => {
  try {
    // 获取当前选中的标签名称
    let currentTags: string[] = []
    // 注意：在 EmoticonGrid 组件中，我们通过 props 获取 activeTagId 和 tags
    if (props.activeTagId && props.tags) {
      const activeTag = props.tags.find(tag => tag.id === props.activeTagId)
      if (activeTag) {
        currentTags = [activeTag.name]
      }
    }

    const emoticon = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      name: file.name,
      url: '', // 将由 store 处理
      type: file.type,
      favorite: false,
      createdAt: Date.now(),
      createTime: Date.now(),
      updateTime: Date.now(),
      tags: currentTags // 使用当前选中的标签
    };

    await store.addEmoticon(emoticon, file);
    
    // 更新显示的表情包列表
    emit('update', [...props.emoticons, emoticon]);
    
    ElMessage.success('上传成功');
    return emoticon;
  } catch (error) {
    console.error('Failed to add emoticon:', error);
    ElMessage.error('上传失败');
    throw error;
  }
}

</script>

<style scoped lang="scss">
.emoticon-grid-container {
  /* 移除固定高度 */
  height: auto;
  min-height: 100vh; /* 占满整个视口高度 */
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px;
  border-radius: 24px 24px 0 0;
  background: var(--el-bg-color-page);
  position: relative; /* 添加相对定位，使批量操作面板相对于此容器定位 */
  /* 强制硬件加速和性能优化 */
  will-change: scroll-position;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  /* 避免重绘和重排 */
  contain: strict;
  /* 启用复合层 */
  isolation: isolate;
  /* 启用容器查询 */
  container-type: inline-size;
  
  /* 优化滚动条样式 */
  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  
  &::-webkit-scrollbar-thumb {
    background: var(--el-border-color-darker);
    border-radius: 3px;
    
    &:hover {
      background: var(--el-border-color-dark);
    }
  }
  
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  
  // 拖拽时的样式
  &.drag-over {
    position: relative;

    &::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(46, 111, 239, 0.1);
      border: 2px dashed #2e6fef;
      border-radius: 20px;
      z-index: 1000;
      pointer-events: none;

      :global([data-theme="dark"]) &,
        :global(html.dark) & {
        background: rgba(59, 130, 246, 0.15);
        border-color: #3b82f6;
      }
    }

    &::after {
      content: '释放鼠标以导入表情包';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(255, 255, 255, 0.9);
      color: #2e6fef;
      padding: 16px 24px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 1001;
      pointer-events: none;

      :global([data-theme="dark"]) &,
        :global(html.dark) & {
        background: rgba(30, 41, 59, 0.95);
        color: #60a5fa;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      }
    }
  }
}

// 加载状态样式
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 40px;
  background: var(--el-bg-color-page);
  
  .loading-cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 12px;
    width: 100%;
    margin-bottom: 24px;
  }
  
  .skeleton-content {
    border-radius: 8px;
    overflow: hidden;
    background: var(--el-bg-color);
    
    :deep(.el-skeleton-item--image) {
      height: 120px !important;
    }
  }
  
  .loading-text {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--el-text-color-secondary);
    font-size: 15px;
    
    .rotating {
      animation: rotate 2s linear infinite;
    }
  }
}

.emoticon-grid {
  display: grid;
  /* 使用更稳定的grid定义，避免媒体查询触发重排 */
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
  width: 100%;
  padding: 0 0 180px;
  box-sizing: border-box;
  justify-items: center;
  align-items: start;
  justify-content: center;
  margin: 0 auto;
  /* 强制性能优化，完全避免布局抖动 */
  will-change: auto;
  contain: layout style;
  /* 避免子元素影响外部布局 */
  overflow: hidden;
  /* 添加防闪烁样式 */
  @extend .flicker-resistant !optional;
  
  /* 彻底禁用所有过渡和动画 */
  * {
    transition: none !important;
    animation: none !important;
  }
  
  /* 响应式布局优化 - 减少断点，使用容器查询 */
  @container (max-width: 1200px) {
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  }
  
  @container (max-width: 800px) {
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 10px;
    padding: 0 0 160px;
  }
  
  @container (max-width: 600px) {
    grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
    gap: 8px;
    padding: 0 0 140px;
  }
}

// 优化空状态样式
.empty-state {
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 40px;
  background: var(--el-bg-color-page);
  border-radius: 8px;
  
  :deep(.el-empty__description) {
    margin-top: 24px;
    font-size: 15px;
    
    p {
      margin: 0;
      line-height: 1.6;
      color: var(--el-text-color-secondary);
    }
  }
  
  :deep(.el-empty__bottom) {
    margin-top: 24px;
  }
  
  .el-button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    font-size: 14px;
    border-radius: 6px;
    transition: all 0.3s ease;
    
    .el-icon {
      font-size: 16px;
    }
    
    &:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
  }
}

// 加载动画关键帧
@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

// 优化图片预览样式
:deep(.el-image-viewer__wrapper) {
  position: fixed !important;
  inset: 0 !important;
  z-index: 9999 !important;
  background-color: rgba(0, 0, 0, 0.9);
  backdrop-filter: blur(10px);
  
  .el-image-viewer__btn {
    color: #fff;
    opacity: 0.8;
    transition: all 0.3s ease;
    
    &:hover {
      color: var(--el-color-primary);
      opacity: 1;
      transform: scale(1.1);
    }
  }
  
  .el-image-viewer__actions {
    opacity: 0.95;
    backdrop-filter: blur(8px);
    
    &__inner {
      padding: 10px 20px;
      border-radius: 20px;
    }
  }

  .el-image-viewer__canvas {
    position: absolute !important;
    inset: 0 !important;
    display: flex !important;
    justify-content: center !important;
    align-items: center !important;
  }

  .el-image-viewer__img {
    max-width: 90vw !important;
    max-height: 90vh !important;
    object-fit: contain !important;
    border-radius: 4px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
}

// 苹果扁平风格批量操作面板样式 - 优化清晰度
.batch-actions-panel {
  position: fixed !important;
  bottom: 20px !important;
  left: calc(200px + (100vw - 200px) / 2) !important;
  transform: translateX(-50%) !important;
  background: linear-gradient(135deg,
    rgba(239, 246, 255, 0.98) 0%,
    rgba(219, 234, 254, 0.98) 50%,
    rgba(248, 250, 252, 0.98) 100%);
  backdrop-filter: blur(30px) saturate(120%);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 14px;
  padding: 0;
  box-shadow:
    0 12px 28px rgba(0, 0, 0, 0.1),
    0 4px 12px rgba(0, 0, 0, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  z-index: 999999 !important;
  min-width: 360px;
  max-width: 420px;
  overflow: visible;
  will-change: transform;
  pointer-events: auto;
  isolation: isolate;
  margin: 0 auto;
  animation: none;
  
  // 添加悬浮动画效果
  &:hover {
    transform: translateX(-50%) !important;
  }

  // 确保在所有屏幕尺寸下都始终固定在窗口底部
  @media (max-height: 600px) {
    bottom: 16px !important;
    min-width: 340px;
    max-width: 400px;
  }

  @media (max-height: 500px) {
    bottom: 12px !important;
    min-width: 320px;
    max-width: 380px;
  }

  @media (max-height: 400px) {
    bottom: 8px !important;
    min-width: 300px;
    max-width: 360px;
  }
  
  @media (max-width: 768px) {
    left: 50% !important;
    right: auto !important;
    width: calc(100vw - 24px);
    max-width: calc(100vw - 24px);
    min-width: calc(100vw - 24px);
  }
  
  @media (max-width: 1024px) {
    left: calc(180px + (100vw - 180px) / 2) !important;
  }
  
  // 暗色模式适配 - 优化清晰度
  :global([data-theme="dark"]) &,
        :global(html.dark) & {
    background: linear-gradient(135deg,
      rgba(30, 41, 59, 0.98) 0%,
      rgba(51, 65, 85, 0.98) 50%,
      rgba(71, 85, 105, 0.98) 100%);
    border: 1.5px solid rgba(148, 163, 184, 0.4);
    box-shadow:
      0 20px 40px rgba(0, 0, 0, 0.4),
      0 8px 24px rgba(0, 0, 0, 0.3),
      0 2px 8px rgba(0, 0, 0, 0.2),
      inset 0 1px 0 rgba(255, 255, 255, 0.15),
      inset 0 0 0 1px rgba(255, 255, 255, 0.1);

    &:hover {
      box-shadow:
        0 25px 50px rgba(0, 0, 0, 0.5),
        0 12px 30px rgba(0, 0, 0, 0.4),
        0 4px 16px rgba(0, 0, 0, 0.3),
        inset 0 1px 0 rgba(255, 255, 255, 0.2),
        inset 0 0 0 1px rgba(255, 255, 255, 0.15);
    }
  }
  
  .batch-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px 8px;
    background: rgba(255, 255, 255, 0.6);
    border-bottom: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 14px 14px 0 0;
    backdrop-filter: blur(10px);

    :global([data-theme="dark"]) &,
        :global(html.dark) & {
      background: rgba(51, 65, 85, 0.8);
      border-bottom: 1px solid rgba(148, 163, 184, 0.3);
    }
    
    .selection-info {
      display: flex;
      align-items: center;
      gap: 8px;

      .count-badge {
        background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
        color: white;
        font-size: 12px;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 10px;
        min-width: 22px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: none;

        :global([data-theme="dark"]) &,
        :global(html.dark) & {
          background: linear-gradient(135deg, #3b82f6 0%, #1e40af 100%);
          box-shadow:
            0 2px 8px rgba(59, 130, 246, 0.4),
            inset 0 1px 0 rgba(255, 255, 255, 0.25);
        }
      }

      .selection-text {
        font-size: 13px;
        font-weight: 600;
        color: #374151;
        letter-spacing: -0.1px;

        :global([data-theme="dark"]) &,
        :global(html.dark) & {
          color: #f9fafb;
        }
      }
    }
    
    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .select-all-btn {
      background: rgba(0, 122, 255, 0.1);
      border: none;
      border-radius: 8px;
      padding: 4px 10px;
      display: flex;
      align-items: center;
      gap: 4px;
      color: #007AFF;
      cursor: pointer;
      transition: all 0.2s ease;
      font-size: 12px;
      font-weight: 500;
      min-height: 26px;

      &:hover {
        background: rgba(0, 122, 255, 0.15);
      }

      &.all-selected {
        background: #007AFF;
        color: white;

        &:hover {
          background: #0056CC;
        }
      }

      &:active {
        transform: scale(0.96);
        transition: transform 0.1s ease;
      }

      svg {
        flex-shrink: 0;
      }

      :global([data-theme="dark"]) &,
        :global(html.dark) & {
        background: rgba(142, 142, 147, 0.15);
        border: 1px solid rgba(10, 132, 255, 0.4);
        color: #0A84FF;

        &:hover {
          background: rgba(10, 132, 255, 0.12);
          border-color: rgba(10, 132, 255, 0.7);
          color: #5E5CE6;
          box-shadow: 0 2px 8px rgba(10, 132, 255, 0.3);
        }

        &.all-selected {
          background: linear-gradient(135deg, #0A84FF 0%, #5E5CE6 100%);

          &:hover {
            background: linear-gradient(135deg, #5E5CE6 0%, #AF52DE 100%);
          }
        }
      }
    }
    
    .close-btn {
      background: rgba(142, 142, 147, 0.12);
      border: none;
      border-radius: 8px;
      width: 26px;
      height: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #8E8E93;
      cursor: pointer;
      transition: all 0.2s ease;

      &:hover {
        background: rgba(142, 142, 147, 0.2);
        color: #48484A;

        :global([data-theme="dark"]) &,
        :global(html.dark) & {
          color: #aeaeb2;
          background: rgba(142, 142, 147, 0.3);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }
      }

      &:active {
        transform: scale(0.92);
      }

      :global([data-theme="dark"]) &,
        :global(html.dark) & {
        background: rgba(142, 142, 147, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: #aeaeb2;

        &:hover {
          background: rgba(142, 142, 147, 0.3);
        }
      }
    }
  }
  
  .divider {
    height: 0.5px;
    background: rgba(0, 0, 0, 0.06);
    margin: 0 14px;

    :global([data-theme="dark"]) &,
        :global(html.dark) & {
      background: linear-gradient(90deg,
        transparent 0%,
        rgba(255, 255, 255, 0.12) 20%,
        rgba(255, 255, 255, 0.12) 80%,
        transparent 100%);

      &::after {
        background: linear-gradient(90deg,
          transparent 0%,
          rgba(255, 255, 255, 0.05) 20%,
          rgba(255, 255, 255, 0.05) 80%,
          transparent 100%);
      }
    }
  }
  
  .action-buttons {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    padding: 6px 10px 10px;
    gap: 6px;

    @media (max-width: 720px) {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    
    .action-btn {
      background: rgba(248, 250, 252, 0.8);
      border: 1px solid rgba(226, 232, 240, 0.6);
      border-radius: 10px;
      padding: 8px 6px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      transition: all 0.25s ease;
      min-height: 48px;
      backdrop-filter: blur(8px);

      .btn-icon {
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;

        svg {
          width: 14px;
          height: 14px;
        }
      }

      .btn-text {
        font-size: 11px;
        font-weight: 600;
        line-height: 1;
        letter-spacing: -0.05px;
      }
      
      &:hover {
        background: rgba(241, 245, 249, 0.9);
        border-color: rgba(203, 213, 225, 0.8);
        transform: translateY(-1px) scale(1.02);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
      }
      
      &:active {
        transform: translateY(0) scale(0.98);
        transition: all 0.1s ease;
      }

      &:disabled {
        cursor: not-allowed;
        opacity: 0.45;
        transform: none;
        box-shadow: none;
      }
      
      &.rename-btn {
        .btn-icon {
          background: linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%);
          color: white;
        }

        .btn-text {
          color: #6366F1;
          font-weight: 600;
        }

        &:hover:not(:disabled) {
          background: rgba(99, 102, 241, 0.14);

          .btn-icon {
            background: linear-gradient(135deg, #7C3AED 0%, #A855F7 100%);
            transform: scale(1.1);
          }

          .btn-text {
            color: #7C3AED;
          }
        }

        :global([data-theme="dark"]) &,
        :global(html.dark) & {
          .btn-text {
            color: #818CF8;
          }
        }
      }

      // 下载按钮 - 增强视觉效果
      &.download-btn {
        .btn-icon {
          background: linear-gradient(135deg, #34C759 0%, #30D158 100%);
          color: white;
          box-shadow: 
            none;
        }
        
        .btn-text {
          color: #34C759;
          font-weight: 600;
        }
        
        &:hover {
          background: rgba(52, 199, 89, 0.15);

          .btn-icon {
            background: linear-gradient(135deg, #30D158 0%, #32D74B 100%);
            box-shadow:
              none;
            transform: scale(1.1);
          }

          .btn-text {
            color: #30D158;
          }
        }

        :global([data-theme="dark"]) &,
        :global(html.dark) & {
          .btn-text {
            color: #30D158;
          }
        }
      }

      // 收藏按钮 - 增强视觉效果
      &.favorite-btn {
        .btn-icon {
          background: linear-gradient(135deg, #FF9500 0%, #FF8C00 100%);
          color: white;
          box-shadow: 
            none;
        }
        
        .btn-text {
          color: #FF9500;
          font-weight: 600;
        }
        
        &:hover {
          background: rgba(255, 149, 0, 0.15);

          .btn-icon {
            background: linear-gradient(135deg, #FF8C00 0%, #FF7F00 100%);
            box-shadow:
              none;
            transform: scale(1.1);
          }

          .btn-text {
            color: #FF8C00;
          }
        }

        :global([data-theme="dark"]) &,
        :global(html.dark) & {
          .btn-text {
            color: #FF9F0A;
          }

          &:hover .btn-text {
            color: #FFAD33;
          }
        }
      }
      

      // 标签按钮 - 增强视觉效果
      &.tag-btn {
        .btn-icon {
          background: linear-gradient(135deg, #007AFF 0%, #5856D6 100%);
          color: white;
          box-shadow:
            none;
        }

        .btn-text {
          color: #007AFF;
          font-weight: 600;
        }

        &:hover {
          background: rgba(0, 122, 255, 0.15);

          .btn-icon {
            background: linear-gradient(135deg, #5856D6 0%, #AF52DE 100%);
            box-shadow:
              none;
            transform: scale(1.1);
          }

          .btn-text {
            color: #5856D6;
          }
        }

        :global([data-theme="dark"]) &,
        :global(html.dark) & {
          .btn-icon {
            background: linear-gradient(135deg, #0A84FF 0%, #5E5CE6 100%);
          }

          .btn-text {
            color: #0A84FF;
          }

          &:hover {
            .btn-icon {
              background: linear-gradient(135deg, #5E5CE6 0%, #AF52DE 100%);
            }

            .btn-text {
              color: #5E5CE6;
            }
          }
        }
      }
      
      // 删除按钮 - 增强视觉效果
      &.delete-btn {
        .btn-icon {
          background: linear-gradient(135deg, #FF3B30 0%, #FF453A 100%);
          color: white;
          box-shadow:
            none;
        }

        .btn-text {
          color: #FF3B30;
          font-weight: 600;
        }

        &:hover {
          background: rgba(255, 59, 48, 0.15);

          .btn-icon {
            background: linear-gradient(135deg, #FF453A 0%, #FF6961 100%);
            box-shadow:
              none;
            transform: scale(1.1);
          }

          .btn-text {
            color: #FF453A;
          }
        }

        :global([data-theme="dark"]) &,
        :global(html.dark) & {
          .btn-text {
            color: #FF453A;
          }
        }
      }
      
      :global([data-theme="dark"]) &,
        :global(html.dark) & {
        background: rgba(71, 85, 105, 0.6);
        border-color: rgba(100, 116, 139, 0.4);

        &:hover {
          background: rgba(71, 85, 105, 0.8);
          border-color: rgba(100, 116, 139, 0.6);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }
      }
    }
  }
}

.rename-form {
  padding: 8px 4px 4px;

  .rename-hint {
    margin: 10px 2px 0;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    line-height: 1.4;
  }

  :deep(.el-input__wrapper) {
    border-radius: 12px;
    min-height: 40px;
  }
}

// 移除批量操作面板动画样式

// 仿苹果风格对话框样式 - 更精致的设计
:deep(.apple-style-dialog) {
  .el-dialog {
    border-radius: 20px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.92);
    backdrop-filter: blur(40px) saturate(200%);
    border: 1px solid rgba(255, 255, 255, 0.3);
    box-shadow: 
      0 32px 80px rgba(0, 0, 0, 0.15),
      0 12px 40px rgba(0, 0, 0, 0.1),
      0 4px 16px rgba(0, 0, 0, 0.05),
      inset 0 1px 0 rgba(255, 255, 255, 0.9),
      inset 0 0 0 1px rgba(255, 255, 255, 0.4);
    
    :global([data-theme="dark"]) &,
        :global(html.dark) & {
      background: rgba(28, 28, 30, 0.94);
      border: 1px solid rgba(84, 84, 88, 0.6);
      box-shadow:
        0 32px 80px rgba(0, 0, 0, 0.6),
        0 12px 40px rgba(0, 0, 0, 0.4),
        0 4px 16px rgba(0, 0, 0, 0.2),
        inset 0 1px 0 rgba(255, 255, 255, 0.15),
        inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    }
  }
  
  .el-dialog__header {
    padding: 24px 24px 16px;
    margin: 0;
    border: none;
    background: linear-gradient(180deg, 
      rgba(255, 255, 255, 0.1) 0%, 
      rgba(255, 255, 255, 0) 100%);
    
    :global([data-theme="dark"]) &,
        :global(html.dark) & {
      background: linear-gradient(180deg,
        rgba(255, 255, 255, 0.05) 0%,
        rgba(255, 255, 255, 0) 100%);
    }

    .el-dialog__title {
      font-size: 18px;
      font-weight: 700;
      color: #1d1d1f;
      letter-spacing: -0.3px;

      :global([data-theme="dark"]) &,
        :global(html.dark) & {
        color: #f5f5f7;
      }
    }
    
    .el-dialog__headerbtn {
      top: 20px;
      right: 20px;
      width: 32px;
      height: 32px;
      background: rgba(142, 142, 147, 0.14);
      border-radius: 16px;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.3);
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      
      &:hover {
        background: rgba(142, 142, 147, 0.22);
        transform: scale(1.05);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      }
      
      .el-dialog__close {
        color: #8e8e93;
        font-size: 16px;
        transition: color 0.2s ease;
        
        &:hover {
          color: #48484a;
        }
      }
      
      :global([data-theme="dark"]) &,
        :global(html.dark) & {
        background: rgba(142, 142, 147, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.1);

        &:hover {
          background: rgba(142, 142, 147, 0.3);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .el-dialog__close {
          color: #aeaeb2;

          &:hover {
            color: #aeaeb2;
          }
        }
      }
    }
  }

  .el-dialog__body {
    padding: 8px 24px 20px;
  }

  .el-dialog__footer {
    padding: 16px 24px 24px;
    border: none;
    background: linear-gradient(180deg,
      rgba(0, 0, 0, 0) 0%,
      rgba(0, 0, 0, 0.02) 100%);

    :global([data-theme="dark"]) &,
        :global(html.dark) & {
      background: linear-gradient(180deg,
        rgba(255, 255, 255, 0) 0%,
        rgba(255, 255, 255, 0.02) 100%);
    }
  }
}

.apple-tag-selector {
  .tags-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 14px;
    max-height: 320px;
    overflow-y: auto;
    padding: 8px 4px;
    
    &::-webkit-scrollbar {
      width: 6px;
    }
    
    &::-webkit-scrollbar-thumb {
      background: rgba(0, 0, 0, 0.15);
      border-radius: 3px;

      &:hover {
        background: rgba(0, 0, 0, 0.25);
      }

      :global([data-theme="dark"]) &,
        :global(html.dark) & {
        background: rgba(255, 255, 255, 0.2);

        &:hover {
          background: rgba(255, 255, 255, 0.3);
        }
      }
    }
    
    &::-webkit-scrollbar-track {
      background: transparent;
    }
    
    .tag-item {
      background: rgba(142, 142, 147, 0.08);
      border: 1.5px solid rgba(142, 142, 147, 0.25);
      border-radius: 14px;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      overflow: hidden;
      backdrop-filter: blur(10px);
      
      // 添加光泽效果
      &::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(135deg, 
          rgba(255, 255, 255, 0.1) 0%, 
          rgba(255, 255, 255, 0) 50%);
        opacity: 0;
        transition: opacity 0.25s ease;
      }
      
      .tag-checkbox {
        width: 22px;
        height: 22px;
        border: 1.5px solid rgba(142, 142, 147, 0.4);
        border-radius: 7px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        background: rgba(255, 255, 255, 0.8);
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        backdrop-filter: blur(10px);

        :global([data-theme="dark"]) &,
        :global(html.dark) & {
          background: rgba(28, 28, 30, 0.8);
          border-color: rgba(142, 142, 147, 0.6);
        }

        svg {
          width: 14px;
          height: 14px;
        }
      }

      .tag-name {
        font-size: 15px;
        font-weight: 600;
        color: #1d1d1f;
        flex: 1;
        transition: color 0.25s ease;
        letter-spacing: -0.1px;

        :global([data-theme="dark"]) &,
        :global(html.dark) & {
          color: #f5f5f7;
        }
      }
      
      &:hover {
        border-color: rgba(0, 122, 255, 0.6);
        background: rgba(0, 122, 255, 0.08);
        transform: translateY(-2px) scale(1.02);
        box-shadow: 
          0 8px 20px rgba(0, 122, 255, 0.2),
          0 2px 8px rgba(0, 0, 0, 0.05);
        
        &::before {
          opacity: 1;
        }
        
        .tag-checkbox {
          border-color: rgba(0, 122, 255, 0.8);
          background: rgba(0, 122, 255, 0.1);
        }
      }
      
      &.selected {
        border-color: #007AFF;
        background: linear-gradient(135deg, 
          rgba(0, 122, 255, 0.12) 0%, 
          rgba(88, 86, 214, 0.08) 100%);
        color: #007AFF;
        transform: translateY(-1px);
        box-shadow: 
          0 8px 25px rgba(0, 122, 255, 0.25),
          0 2px 10px rgba(0, 0, 0, 0.08),
          inset 0 1px 0 rgba(255, 255, 255, 0.6);
        
        &::before {
          opacity: 1;
        }
        
        .tag-checkbox {
          background: linear-gradient(135deg, #007AFF 0%, #5856D6 100%);
          color: white;
          border-color: transparent;
          box-shadow: 
            0 3px 12px rgba(0, 122, 255, 0.4),
            inset 0 1px 0 rgba(255, 255, 255, 0.4);
        }
        
        .tag-name {
          color: #007AFF;
          font-weight: 700;
        }
        
        :global([data-theme="dark"]) &,
        :global(html.dark) & {
          border-color: #0A84FF;
          color: #0A84FF;
          background: linear-gradient(135deg,
            rgba(10, 132, 255, 0.15) 0%,
            rgba(94, 92, 230, 0.1) 100%);

          .tag-checkbox {
            background: linear-gradient(135deg, #0A84FF 0%, #5E5CE6 100%);
          }

          .tag-name {
            color: #0A84FF;
          }
        }
      }
      
      :global([data-theme="dark"]) &,
        :global(html.dark) & {
        background: rgba(142, 142, 147, 0.12);
        border-color: rgba(142, 142, 147, 0.3);

        &:hover {
          border-color: rgba(10, 132, 255, 0.7);
          background: rgba(10, 132, 255, 0.12);

          .tag-checkbox {
            border-color: rgba(10, 132, 255, 0.8);
            background: rgba(10, 132, 255, 0.15);
          }
        }
      }
    }
  }
  
  .empty-state {
    text-align: center;
    padding: 40px 20px;

    .empty-icon {
      color: #8e8e93;
      margin-bottom: 12px;

      :global([data-theme="dark"]) &,
        :global(html.dark) & {
        color: #aeaeb2;
      }
    }

    .empty-text {
      font-size: 16px;
      font-weight: 600;
      color: #1d1d1f;
      margin: 0 0 4px;

      :global([data-theme="dark"]) &,
        :global(html.dark) & {
        color: #f5f5f7;
      }
    }

    .empty-hint {
      font-size: 13px;
      color: #8e8e93;
      margin: 0;

      :global([data-theme="dark"]) &,
        :global(html.dark) & {
        color: #aeaeb2;
      }
    }
  }
}

.apple-dialog-footer {
  display: flex;
  gap: 14px;
  justify-content: flex-end;
  
  .apple-btn {
    border: none;
    border-radius: 10px;
    padding: 12px 24px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    min-width: 88px;
    letter-spacing: -0.2px;
    position: relative;
    overflow: hidden;
    
    // 添加光泽效果
    &::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: linear-gradient(135deg, 
        rgba(255, 255, 255, 0.15) 0%, 
        rgba(255, 255, 255, 0) 50%);
      opacity: 0;
      transition: opacity 0.25s ease;
    }
    
    &.secondary {
      background: rgba(142, 142, 147, 0.14);
      color: #1d1d1f;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.3);
      
      &:hover {
        background: rgba(142, 142, 147, 0.22);
        transform: translateY(-1px) scale(1.02);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        
        &::before {
          opacity: 1;
        }
      }
      
      :global([data-theme="dark"]) &,
        :global(html.dark) & {
        background: rgba(142, 142, 147, 0.2);
        color: #f5f5f7;
        border: 1px solid rgba(255, 255, 255, 0.1);

        &:hover {
          background: rgba(142, 142, 147, 0.3);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }
      }
    }

    &.primary {
      background: linear-gradient(135deg, #007AFF 0%, #5856D6 100%);
      color: white;
      box-shadow:
        0 4px 16px rgba(0, 122, 255, 0.4),
        inset 0 1px 0 rgba(255, 255, 255, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.2);

      &:hover {
        background: linear-gradient(135deg, #5856D6 0%, #AF52DE 100%);
        transform: translateY(-1px) scale(1.02);
        box-shadow:
          0 6px 20px rgba(0, 122, 255, 0.5),
          inset 0 1px 0 rgba(255, 255, 255, 0.5);

        &::before {
          opacity: 1;
        }
      }

      &:disabled {
        background: rgba(142, 142, 147, 0.3);
        color: rgba(255, 255, 255, 0.6);
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
        border: 1px solid rgba(142, 142, 147, 0.2);

        &::before {
          opacity: 0;
        }
      }

      :global([data-theme="dark"]) &,
        :global(html.dark) & {
        background: linear-gradient(135deg, #0A84FF 0%, #5E5CE6 100%);

        &:hover {
          background: linear-gradient(135deg, #5E5CE6 0%, #AF52DE 100%);
        }
      }
    }
    
    &:active {
      transform: scale(0.96);
      transition: transform 0.1s ease;
    }
  }
}

// 标签选择器样式
.tag-selector {
  max-height: 360px;
  overflow-y: auto;
  padding: 16px 0;
  
  :deep(.el-checkbox-group) {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 12px;
    padding: 0 4px;
    
    .el-checkbox {
      margin: 0;
      height: auto;
      
      &.is-bordered {
        padding: 8px 12px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        
        .el-checkbox__label {
          padding-left: 6px;
          line-height: 1.4;
          font-size: 13px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      }
      
      &.is-checked {
        border-color: var(--el-color-primary);
        background-color: var(--el-color-primary-light-9);
      }
    }
  }
  
  :deep(.el-empty) {
    padding: 24px 0;
    
    .el-empty__description {
      margin-top: 12px;
      
      p {
        color: var(--el-text-color-secondary);
      }
    }
  }
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 16px;
}

</style>

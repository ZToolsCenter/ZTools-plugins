<template>
  <div class="emoticon-item" 
       :class="{ 'gpu-accelerated': true, 'flicker-resistant': true, 'select-mode': props.isSelectMode, 'selected': props.isSelected }"
       draggable="false"
       @dragstart.prevent.stop>
    <!-- 选择模式下的勾选框 -->
    <div v-if="props.isSelectMode" 
         class="select-checkbox" 
         :class="{ 'selected': props.isSelected }"
         @click.stop="handleSelect">
    </div>
    
    <!-- 表情包图片 -->
    <el-image 
      :src="emoticon.url" 
      fit="contain"
      loading="lazy"
      draggable="false"
      @click="handleImageClick"
      @dragstart.prevent.stop>
      <template #error>
        <div class="image-error">
          <el-icon><Picture /></el-icon>
          <span>加载失败</span>
        </div>
      </template>
    </el-image>
    
    <!-- 所有按钮统一在固定显示区域 -->
    <div v-if="!props.isSelectMode" class="fixed-actions">
      <!-- 收藏页面的简化按钮布局 -->
      <template v-if="props.currentView === 'favorite'">
        <div class="favorite-actions">
          <!-- 复制按钮 -->
          <el-tooltip content="复制到剪贴板" placement="top" :show-after="500">
            <el-button
              class="action-button copy-button"
              circle
              size="small"
              draggable="false"
              @click.stop="handleCopy"
              @dragstart.prevent.stop>
              <el-icon><CopyDocument /></el-icon>
            </el-button>
          </el-tooltip>

          <!-- 取消收藏按钮 -->
          <el-tooltip content="取消收藏" placement="top" :show-after="500">
            <el-button
              class="action-button favorite-button"
              circle
              size="small"
              draggable="false"
              @click.stop="handleFavorite"
              @dragstart.prevent.stop>
              <el-icon><Star /></el-icon>
            </el-button>
          </el-tooltip>
          
          <!-- 发送按钮 -->
          <el-tooltip content="发送到聊天窗口" placement="top" :show-after="500">
            <el-button
              class="action-button send-button"
              circle
              size="small"
              draggable="false"
              @click.stop="handleSend"
              @dragstart.prevent.stop>
              <el-icon><Position /></el-icon>
            </el-button>
          </el-tooltip>
        </div>
      </template>
      
      <!-- 其他页面的完整按钮布局 -->
      <template v-else>
        <div class="main-actions">
          <!-- 复制按钮 -->
          <el-tooltip content="复制到剪贴板" placement="top" :show-after="500">
            <el-button
              class="action-button copy-button"
              circle
              size="small"
              draggable="false"
              @click.stop="handleCopy"
              @dragstart.prevent.stop>
              <el-icon><CopyDocument /></el-icon>
            </el-button>
          </el-tooltip>

          <!-- 收藏按钮 -->
          <el-tooltip :content="emoticon.favorite ? '取消收藏' : '添加收藏'" placement="top" :show-after="500">
            <el-button
              class="action-button favorite-button"
              :class="{ 'is-favorite': emoticon.favorite }"
              circle
              size="small"
              draggable="false"
              @click.stop="handleFavorite"
              @dragstart.prevent.stop>
              <el-icon><Star /></el-icon>
            </el-button>
          </el-tooltip>
          
          <!-- 发送按钮 -->
          <el-tooltip content="发送到聊天窗口" placement="top" :show-after="500">
            <el-button
              class="action-button send-button"
              circle
              size="small"
              draggable="false"
              @click.stop="handleSend"
              @dragstart.prevent.stop>
              <el-icon><Position /></el-icon>
            </el-button>
          </el-tooltip>
        </div>
      </template>
    </div>

    <!-- 标签选择弹窗 -->
    <el-dialog
      v-model="showTagSelector"
      title="设置分类标签"
      width="360px"
      :close-on-click-modal="false"
      :append-to-body="true"
      destroy-on-close
      @closed="handleTagDialogClose"
      @open="handleTagDialogOpen"
    >
      <div class="tag-selector">
        <template v-if="availableTags.length > 0">
          <el-checkbox-group v-model="selectedTags">
            <el-checkbox
              v-for="tag in availableTags"
              :key="tag.id"
              :label="tag.name"
              border
            >
              {{ tag.name }}
            </el-checkbox>
          </el-checkbox-group>
        </template>
        <el-empty v-else description="暂无分类标签" :image-size="80">
          <el-button type="primary" size="small" @click="goToTagManager">
            去添加
          </el-button>
        </el-empty>
      </div>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="showTagSelector = false">取消</el-button>
          <el-button type="primary" @click="handleTagsSave">
            确定
          </el-button>
        </span>
      </template>
    </el-dialog>
    
    <!-- 自定义删除确认模态框 -->
    <DeleteConfirmModal
      v-model:visible="showDeleteModal"
      :message="deleteMessage"
      @confirm="confirmDelete"
      @cancel="showDeleteModal = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { CopyDocument, Star, ZoomIn, Delete, Picture, Position, Collection, Download } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Emoticon } from '@/types'
import { useEmoticonStore } from '@/store/emoticon'
import DeleteConfirmModal from '@/components/DeleteConfirmModal.vue'

const props = defineProps<{
  emoticon: Emoticon
  currentView?: string
  isSelectMode?: boolean
  isSelected?: boolean
}>()

const emit = defineEmits<{
  (e: 'update', emoticon: Emoticon): void
  (e: 'delete', emoticon: Emoticon): void
  (e: 'preview', emoticon: Emoticon): void
  (e: 'select', emoticonId: string, selected: boolean): void
}>()

const store = useEmoticonStore()
const showTagSelector = ref(false)
const selectedTags = ref<string[]>([])
const availableTags = ref<{ id: number; name: string }[]>([])
const showDeleteModal = ref(false)

// 计算属性，确保勾选状态同步
const isChecked = computed({
  get: () => !!props.isSelected,
  set: (value: boolean) => {
    console.log('isChecked setter called with:', value)
    emit('select', props.emoticon.id, value)
  }
})

// 删除消息文本
const deleteMessage = computed(() => {
  const name = props.emoticon.name || '未命名'
  return `确定要删除表情包 "${name}" 吗？`
})

// 初始化标签数据
onMounted(() => {
  loadTags()
})

// 加载标签数据
const loadTags = () => {
  const savedTags = localStorage.getItem('emoticon-tags')
  if (savedTags) {
    availableTags.value = JSON.parse(savedTags)
  }
  // 设置已选中的标签
  selectedTags.value = props.emoticon.tags || []
}

// 处理标签对话框打开
const handleTagDialogOpen = () => {
  // 每次打开对话框时重新加载标签数据
  loadTags()
}

// 处理标签对话框关闭
const handleTagDialogClose = () => {
  // 重置选中的标签为当前表情包的标签
  selectedTags.value = props.emoticon.tags || []
}

// 处理标签保存
const handleTagsSave = async () => {
  try {
    const loadingMessage = ElMessage({
      type: 'info',
      message: '正在保存...',
      duration: 0
    })

    // 创建更新后的表情包对象
    const updatedEmoticon = {
      ...props.emoticon,
      tags: selectedTags.value,
      updateTime: Date.now()
    }

    // 使用 store 的 updateEmoticon 方法更新
    await store.updateEmoticon(updatedEmoticon)
    
    // 触发更新事件
    emit('update', updatedEmoticon)

    loadingMessage.close()
    ElMessage({
      message: '标签设置成功',
      type: 'success',
      showClose: true,
      duration: 3000
    })
    showTagSelector.value = false
  } catch (error) {
    console.error('Failed to save tags:', error)
    ElMessage.error('标签设置失败，请重试')
  }
}

// 处理复制
const handleCopy = async () => {
  const loadingMessage = ElMessage({
    type: 'info',
    message: '正在复制...',
    duration: 0
  })

  try {
    // 获取图片的类型和数据
    const response = await fetch(props.emoticon.url)
    const blob = await response.blob()
    
    // 更可靠的文件类型检测
    const isGif = await isGifImage(blob)
    
    if (isGif) {
      // 1. 创建临时文件
      const tempFileName = `temp_${Date.now()}.gif`
      const tempPath = window.preload.utils.getTempPath(tempFileName)
      
      // 2. 将blob转换为buffer并写入临时文件
      const arrayBuffer = await blob.arrayBuffer()
      const buffer = new Uint8Array(arrayBuffer)
      await window.preload.fs.writeFile(tempPath, buffer)

      // 3. 使用 ztools.copyFile 复制 GIF 文件到剪贴板
      window.ztools.copyFile(tempPath)
      
      loadingMessage.close()
      ElMessage({
        message: 'GIF已复制到剪贴板，可直接粘贴使用',
        type: 'success',
        duration: 3000,
        showClose: true
      })
      
      // 4. 30秒后删除临时文件
      setTimeout(async () => {
        try {
          await window.preload.fs.unlink(tempPath)
        } catch (err) {
          console.error('Failed to delete temp file:', err)
        }
      }, 30000)
    } else {
      // 非GIF图片使用Canvas方法
      await copyUsingCanvas(props.emoticon.url)
      loadingMessage.close()
      ElMessage.success('复制成功')
    }
  } catch (err) {
    console.error('Copy failed:', err)
    loadingMessage.close()
    ElMessage.error('复制失败，请稍后重试')
  }
}

// 更可靠的GIF检测方法
const isGifImage = async (blob: Blob): Promise<boolean> => {
  // 方法1: 检查MIME类型
  if (blob.type === 'image/gif') {
    return true
  }
  
  // 方法2: 检查文件头部标识
  try {
    const buffer = await blob.arrayBuffer()
    const uint8Arr = new Uint8Array(buffer)
    
    // GIF文件头部标识为 "GIF87a" 或 "GIF89a"
    const header = String.fromCharCode(...uint8Arr.slice(0, 6))
    return header === 'GIF87a' || header === 'GIF89a'
  } catch {
    // 如果无法读取文件头，回退到使用MIME类型判断
    return blob.type === 'image/gif'
  }
}

// 使用 Canvas 方法复制
const copyUsingCanvas = async (url: string) => {
  const img = document.createElement('img')
  img.crossOrigin = 'anonymous'
  img.src = url
  
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = reject
  })
  
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get canvas context')
  ctx.drawImage(img, 0, 0)
  
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b)
      else reject(new Error('Failed to create blob'))
    }, 'image/png')
  })
  
  await navigator.clipboard.write([
    new ClipboardItem({
      'image/png': blob
    })
  ])
}

// 处理收藏
const handleFavorite = async () => {
  try {
    // 创建一个加载提示
    const loadingMessage = ElMessage({
      type: 'info',
      message: '正在处理...',
      duration: 0
    });
    
    // 保存当前的收藏状态
    const willBeFavorite = !props.emoticon.favorite;
    
    // 获取更新后的表情包对象
    const updatedEmoticon = await store.toggleFavorite(props.emoticon);
    
    // 关闭加载提示
    loadingMessage.close();
    
    // 使用新的状态显示消息
    ElMessage.success(willBeFavorite ? '已收藏' : '已取消收藏');
    
    // 触发更新事件，传递更新后的对象
    emit('update', updatedEmoticon);
  } catch (error) {
    console.error('Failed to toggle favorite:', error);
    ElMessage.error('操作失败，请重试');
  }
}

// 处理下载
const handleDownload = async () => {
  try {
    // 获取图片的类型和数据
    const response = await fetch(props.emoticon.url)
    const blob = await response.blob()
    
    // 使用更可靠的文件类型检测
    const isGif = await isGifImage(blob)
    const extension = isGif ? 'gif' : getImageExtension(blob.type)
    
    // 创建下载链接
    const imageUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = imageUrl
    
    // 设置文件名，保留原始格式
    const fileName = props.emoticon.name ? 
      `${props.emoticon.name}.${extension}` : 
      `emoticon_${props.emoticon.id}.${extension}`
    
    link.download = fileName
    
    // 触发下载
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    
    // 释放URL
    URL.revokeObjectURL(imageUrl)
    
    ElMessage.success('下载成功')
  } catch (err) {
    console.error('Failed to download emoticon:', err)
    ElMessage.error('下载失败')
  }
}

// 从MIME类型获取图片扩展名
const getImageExtension = (mimeType: string): string => {
  const extensions: { [key: string]: string } = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/gif': 'gif'
  }
  return extensions[mimeType] || 'png'
}

// 处理删除
const handleDelete = () => {
  showDeleteModal.value = true
}

// 确认删除
const confirmDelete = () => {
  emit('delete', props.emoticon)
  showDeleteModal.value = false
}

// 处理图片加载
// const handleImageLoad = async () => {
//   此方法已禁用，因为getEmoticonDataUrl方法不存在
// }

// 处理发送
const handleSend = async () => {
  const loadingMessage = ElMessage({
    type: 'info',
    message: '正在准备发送...',
    duration: 0
  })

  try {
    // 获取图片的类型和数据
    const response = await fetch(props.emoticon.url)
    const blob = await response.blob()
    
    // 检测是否为GIF
    const isGif = await isGifImage(blob)
    
    if (isGif) {
      // 1. 创建临时文件
      const tempFileName = `temp_${Date.now()}.gif`
      const tempPath = window.preload.utils.getTempPath(tempFileName)
      
      // 2. 将blob转换为buffer并写入临时文件
      const arrayBuffer = await blob.arrayBuffer()
      const buffer = new Uint8Array(arrayBuffer)
      await window.preload.fs.writeFile(tempPath, buffer)

      // 3. 使用 ztools.copyFile 复制 GIF 文件到剪贴板
      window.ztools.copyFile(tempPath)
      
      // 4. 隐藏 ZTools 主窗口
      window.ztools.hideMainWindow()
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // 5. 模拟按键序列：Alt+Tab, Ctrl+V
      window.ztools.simulateKeyboardTap('tab', 'alt')
      await new Promise(resolve => setTimeout(resolve, 300))
      window.ztools.simulateKeyboardTap('v', 'ctrl')
      
      // 6. 30秒后删除临时文件
      setTimeout(async () => {
        try {
          await window.preload.fs.unlink(tempPath)
        } catch (err) {
          console.error('Failed to delete temp file:', err)
        }
      }, 30000)
    } else {
      // 非GIF图片使用Canvas方法
      await copyUsingCanvas(props.emoticon.url)
      
      // 隐藏 ZTools 主窗口
      window.ztools.hideMainWindow()
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // 模拟按键序列：Alt+Tab, Ctrl+V
      window.ztools.simulateKeyboardTap('tab', 'alt')
      await new Promise(resolve => setTimeout(resolve, 300))
      window.ztools.simulateKeyboardTap('v', 'ctrl')
    }

    loadingMessage.close()
    ElMessage({
      type: 'success',
      message: '表情包已粘贴到输入框',
      duration: 2000
    })
  } catch (error) {
    console.error('Send failed:', error)
    loadingMessage.close()
    ElMessage.error('发送失败，请重试')
    window.ztools.showMainWindow()
  }
}

// 添加跳转到标签管理的方法
const goToTagManager = () => {
  showTagSelector.value = false
  // 这里可以添加跳转到标签管理的逻辑
  ElMessage.info('请先在右上角的"分类管理"中添加标签')
}

// 处理checkbox变化
const handleCheckboxChange = (value: boolean) => {
  emit('select', props.emoticon.id, value)
}

// 处理选择状态变化
const handleSelect = () => {
  const newSelected = !props.isSelected
  emit('select', props.emoticon.id, newSelected)
}

// 处理图片点击
const handleImageClick = () => {
  if (props.isSelectMode) {
    // 选择模式下点击图片切换选择状态
    handleSelect()
  } else {
    // 非选择模式下点击图片预览
    emit('preview', props.emoticon)
  }
}
</script>

<style scoped lang="scss">
.emoticon-item {
  position: relative;
  border-radius: 20px;
  overflow: hidden;
  cursor: pointer;
  aspect-ratio: 1;
  width: 100%;
  /* 优化性能，防止全屏时闪烁 */
  will-change: opacity;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  /* 提升动画流畅度，使用更快的过渡 */
  transition: transform 0.15s ease, opacity 0.15s ease;
  
  // 选择模式样式
  &.select-mode {
    .el-image {
      cursor: pointer;
    }
  }
  
  // 被选中状态 - 优化为半透明遮罩效果
  &.selected {
    &::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 122, 255, 0.15);
      backdrop-filter: blur(1px);
      z-index: 1;
      border-radius: 20px;
      pointer-events: none;
    }
  }
  
  &:hover {
    transform: translateY(-1px);
    
    .fixed-actions {
      opacity: 1;
    }
  }
  
  // 表情包图片
  .el-image {
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    
    :deep(.el-image__inner) {
      object-fit: contain;
      width: 100%;
      height: 100%;
      border-radius: 16px;
    }
  }
  
  // 固定显示的按钮
  .fixed-actions {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 6px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 5px;
    z-index: 1;
    opacity: 0;
    /* 提升动画流畅度 */
    transition: opacity 0.15s ease;
    padding: 0 6px;
    background: transparent;
    
    // 收藏页面的简化按钮布局
    .favorite-actions {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 5px;
      padding: 0;
        
        .action-button {
          width: 22px;
          height: 22px;
          min-width: 22px;
          min-height: 22px;
          padding: 0 !important;
          margin: 0;
          background-color: #2e6fef !important;
          border-color: #2e6fef !important;
          color: white !important;
          transition: all 0.15s ease;
          border-radius: 50% !important;
          display: flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
          transform: none;

          .el-icon {
            font-size: 12px;
            color: white !important;
            line-height: 1;
          }

          &:hover {
            background-color: #4c7df0 !important;
            border-color: #4c7df0 !important;
            box-shadow: 0 4px 8px rgba(46, 111, 239, 0.3);
          }

          &:active {
            background-color: #1e5bd8 !important;
            border-color: #1e5bd8 !important;
          }

          // 重写Element Plus默认样式
          :deep(.el-button__content) {
            padding: 0;
            margin: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
          }
          
          // 取消收藏按钮特殊样式
          &.favorite-button {
            background-color: #ef4444 !important;
            border-color: #ef4444 !important;
            
            &:hover {
              background-color: #f87171 !important;
              border-color: #f87171 !important;
            }
          }
        }
      }
    
    // 本地表情页面的主要按钮布局
    .main-actions {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 5px;
      padding: 0;
      
      .action-button {
        width: 22px;
        height: 22px;
        min-width: 22px;
        min-height: 22px;
        padding: 0 !important;
        margin: 0;
        background-color: #2e6fef !important;
        border-color: #2e6fef !important;
        color: white !important;
        transition: all 0.15s ease;
        border-radius: 50% !important;
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;

        .el-icon {
          font-size: 12px;
          color: white !important;
          line-height: 1;
        }

        &:hover {
          background-color: #4c7df0 !important;
          border-color: #4c7df0 !important;
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(46, 111, 239, 0.3);
        }

        &:active {
          background-color: #1e5bd8 !important;
          border-color: #1e5bd8 !important;
        }

        // 重写Element Plus默认样式
        :deep(.el-button__content) {
          padding: 0;
          margin: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
        }
        
        // 收藏按钮特殊样式
        &.favorite-button {
          &.is-favorite {
            background-color: #ef4444 !important;
            border-color: #ef4444 !important;
            
            &:hover {
              background-color: #f87171 !important;
              border-color: #f87171 !important;
            }
          }
        }
      }
    }
    
    .el-button {
      width: 22px;
      height: 22px;
      padding: 1px;
      transition: all 0.15s ease;
      background-color: rgba(255, 255, 255, 0.9);
      backdrop-filter: blur(4px);
      border: none;
      flex-shrink: 0;
      
      .el-icon {
        font-size: 12px;
      }
      
      &:hover {
        transform: scale(1.1);
      }
    }
  }
  
  // 扁平设计圆形勾选按钮
  .select-checkbox {
    position: absolute;
    top: 8px;
    left: 6px;
    z-index: 10;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s ease;
    background: rgba(255, 255, 255, 0.9);
    border: 1.5px solid rgba(0, 0, 0, 0.1);

    // 勾选图标
    &::before {
      content: '';
      width: 4px;
      height: 8px;
      border: solid transparent;
      border-width: 0 1.5px 1.5px 0;
      border-right-color: #666;
      border-bottom-color: #666;
      transform: rotate(45deg);
      opacity: 0;
      transition: all 0.2s ease;
      margin-top: -2px;
      margin-left: 1px;
    }

    // 选中状态
    &.selected {
      background: #007AFF;
      border-color: #007AFF;

      &::before {
        opacity: 1;
        border-right-color: white;
        border-bottom-color: white;
      }
    }

    // 未选中状态悬停
    &:not(.selected):hover {
      background: rgba(0, 122, 255, 0.1);
      border-color: rgba(0, 122, 255, 0.3);
      transform: scale(1.05);
    }

    // 选中状态悬停
    &.selected:hover {
      background: #0056CC;
      border-color: #0056CC;
      transform: scale(1.05);
    }

    &:active {
      transform: scale(0.95);
      transition: transform 0.1s ease;
    }

    // 隐藏原有的 checkbox
    :deep(.el-checkbox) {
      display: none;
    }
  }
}

@keyframes buttonFadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

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
        border-radius: 10px;
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

:deep(.el-dialog) {
  border-radius: 16px;
  overflow: hidden;

  .el-dialog__header {
    margin: 0;
    padding: 16px 20px;
    border-bottom: 1px solid var(--el-border-color-lighter);

    .el-dialog__title {
      font-size: 16px;
      font-weight: 600;
    }
  }

  .el-dialog__body {
    padding: 0 20px;
  }

  .el-dialog__footer {
    padding: 16px 20px;
    border-top: 1px solid var(--el-border-color-lighter);
  }
}
</style>

<!-- 暗黑模式适配 -->
<style lang="scss">
html.dark {
  .emoticon-item {
    &.selected::before {
      background: rgba(10, 132, 255, 0.2);
    }

    .select-checkbox {
      background: rgba(40, 40, 40, 0.9);
      border: 1.5px solid rgba(255, 255, 255, 0.1);

      &.selected {
        background: #0A84FF;
        border-color: #0A84FF;
      }

      &:not(.selected):hover {
        background: rgba(10, 132, 255, 0.2);
        border-color: rgba(10, 132, 255, 0.4);
      }

      &.selected:hover {
        background: #0066FF;
        border-color: #0066FF;
      }
    }
  }
}
</style>

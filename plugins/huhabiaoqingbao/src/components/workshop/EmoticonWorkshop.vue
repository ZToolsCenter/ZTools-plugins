<template>
  <div class="emoticon-workshop">
    <!-- 左侧预设图片区域 -->
    <div class="preset-images">
      <div class="header-controls">
        <div class="category-tabs">
          <div
            v-for="category in categories"
            :key="category.value"
            class="category-tab"
            :class="{ active: currentCategory === category.value }"
            @click="currentCategory = category.value"
          >
            {{ category.label }}
          </div>
        </div>


      </div>

      <div class="image-grid">
        <el-empty v-if="isLoading" description="加载中...">
          <template #image>
            <el-icon class="is-loading"><Loading /></el-icon>
          </template>
        </el-empty>
        <template v-else>
          <div
            v-for="(image, index) in filteredPresetImages"
            :key="index"
            class="preset-image-item"
            @click="selectPresetImage(image)"
          >
            <img 
              :src="image.url" 
              :alt="image.name"
              @error="(e) => handleImageError(e, image)"
            >
          </div>
        </template>
      </div>
    </div>

    <!-- 右侧编辑区域 -->
    <div class="edit-area">
      <div
        class="preview-window"
        ref="previewWindow"
        @paste="handlePaste"
        @mousemove="handleDragging"
        @mouseup="stopDragging"
        @mouseleave="stopDragging"
        tabindex="0"
      >
        <template v-if="selectedImage">
          <img
            :src="selectedImage"
            class="base-image"
            :style="{ filter: currentFilter }"
          >
          <div class="remove-image-btn" @click="clearImage">
            <el-icon><Close /></el-icon>
          </div>
          <div
            class="text-overlay"
            v-if="formattedPreviewText"
            :style="{
              color: smartPreviewTextColor,
              fontSize: `${textSize}px`,
              left: `${textPosition.x}%`,
              top: `${textPosition.y}%`,
              transform: 'translate(-50%, -50%)',
              cursor: isDragging ? 'grabbing' : 'grab',
              whiteSpace: 'pre-line',
              textAlign: 'center',
              maxWidth: textMode === 'vertical' ? 'none' : '90%',
              lineHeight: '1.3',
              writingMode: textMode === 'vertical' ? 'vertical-rl' : 'horizontal-tb',
              textOrientation: textMode === 'vertical' ? 'upright' : 'mixed',
              textShadow: smartPreviewTextColor === '#ffffff' ? '2px 2px 4px rgba(0, 0, 0, 0.8), -1px -1px 2px rgba(0, 0, 0, 0.3)' : '2px 2px 4px rgba(255, 255, 255, 0.8), -1px -1px 2px rgba(255, 255, 255, 0.3)'
            }"
            @mousedown="startDragging"
          >
            {{ formattedPreviewText }}
          </div>
        </template>
        <div v-else class="empty-preview">
          <el-icon class="paste-icon"><Picture /></el-icon>
          <p>选择预设图片或直接粘贴图片 (Ctrl+V)</p>
        </div>
      </div>

      <div class="controls">
        <!-- 文字输入 -->
        <el-input
          v-model="text"
          type="textarea"
          :rows="2"
          maxlength="20"
          show-word-limit
          placeholder="输入文字，回车换行(每行一个字竖排效果最佳)"
        />

        <!-- 文字排列模式 + 重置位置 -->
        <div class="text-mode-controls">
          <el-button-group>
            <el-button
              :type="textMode === 'horizontal' ? 'primary' : 'default'"
              size="small"
              @click="textMode = 'horizontal'"
            >横排</el-button>
            <el-button
              :type="textMode === 'vertical' ? 'primary' : 'default'"
              size="small"
              @click="textMode = 'vertical'"
            >竖排</el-button>
          </el-button-group>
          <el-button class="reset-btn" @click="resetTextPosition" size="small">
            <el-icon><Position /></el-icon>
            重置位置
          </el-button>
        </div>

        <!-- 文字样式控制 -->
        <div class="text-controls">
          <el-color-picker v-model="textColor" />
          <el-slider
            v-model="textSize"
            :min="12"
            :max="48"
            :step="2"
          />
        </div>

        <!-- 滤镜选择器 -->
        <div class="filter-controls">
          <span class="label">滤镜效果：</span>
          <el-select 
            v-model="currentFilterType" 
            placeholder="选择滤镜"
            size="default"
          >
            <el-option
              v-for="filter in filters"
              :key="filter.value"
              :label="filter.label"
              :value="filter.value"
            />
          </el-select>
        </div>

        <div class="action-buttons">
          <!-- 复制按钮 -->
          <el-button class="copy-btn" @click="copyToClipboard">
            <el-icon><CopyDocument /></el-icon>
            复制
          </el-button>
          
          <!-- 下载按钮 -->
          <el-button class="download-btn" @click="generateEmoticon">
            <el-icon><Download /></el-icon>
            下载
          </el-button>
          
          <!-- 保存按钮 -->
          <el-button class="save-btn" @click="saveToCollection">
            <el-icon><FolderAdd /></el-icon>
            保存
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import html2canvas from 'html2canvas'
import { getPresetImages } from '@/utils/presetImages'
import { ElMessage } from 'element-plus'
import { Position, Download, FolderAdd, CopyDocument, Picture, Loading, Close } from '@element-plus/icons-vue'
import { useEmoticonStore } from '@/store/emoticon'
import type { Emoticon } from '@/types'

// 移除props定义，不再使用URL传递方式

const emoticonStore = useEmoticonStore()

// 分类数据
const categories = [
  { label: '全部', value: 'all' },
  { label: '搞笑', value: 'funny' },
  { label: '动物', value: 'animal' },
  { label: '表情', value: 'face' }
]

// 预设图片数据
const presetImages = ref<Array<{ url: string; name: string; category: string }>>([])

// 加载预设图片
const isLoading = ref(false)

const loadPresetImages = async () => {
  isLoading.value = true
  try {
    presetImages.value = await getPresetImages()
    if (presetImages.value.length === 0) {
      ElMessage.warning('未能加载预设图片，请检查网络或重启应用')
    }
  } catch (error) {
    console.error('Failed to load preset images:', error)
    ElMessage.error('加载预设图片失败')
  } finally {
    isLoading.value = false
  }
}

onMounted(async () => {
  loadPresetImages()
  
  console.log('表情工坊挂载') // 调试信息
  
  // 确保预览窗口获得焦点，以便接收粘贴事件
  setTimeout(() => {
    if (previewWindow.value) {
      previewWindow.value.focus()
      console.log('预览窗口已获得焦点') // 调试信息
    }
  }, 100)
  
  // 延迟尝试从剪贴板读取图片，给复制操作一些时间
  setTimeout(async () => {
    try {
      console.log('尝试从剪贴板读取图片...') // 调试信息
      const clipboardItems = await navigator.clipboard.read()
      console.log('剪贴板项目数量:', clipboardItems.length) // 调试信息
      
      for (const clipboardItem of clipboardItems) {
        console.log('剪贴板项目类型:', clipboardItem.types) // 调试信息
        for (const type of clipboardItem.types) {
          if (type.startsWith('image/')) {
            const blob = await clipboardItem.getType(type)
            const imageUrl = URL.createObjectURL(blob)
            selectedImage.value = imageUrl
            console.log('从剪贴板成功加载图片:', type, blob.size, 'bytes') // 调试信息
            ElMessage.success('已从剪贴板自动加载图片，可以开始编辑了！')
            return
          }
        }
      }
      console.log('剪贴板中没有找到图片') // 调试信息
    } catch (error) {
      console.log('从剪贴板读取图片失败:', error)
    }
  }, 500) // 延迟500ms给复制操作时间
})

// 移除props监听，不再使用URL传递方式

const currentCategory = ref('all')
const selectedImage = ref('')
const text = ref('')
const textColor = ref('#ffffff')
const textSize = ref(24)
const textMode = ref<'horizontal' | 'vertical'>('horizontal')
const previewWindow = ref<HTMLElement | null>(null)

// 文字位置状态
const textPosition = ref({ x: 50, y: 50 }) // 默认居中
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const elementStart = ref({ x: 0, y: 0 })

// 根据分类筛选图片
const filteredPresetImages = computed(() => {
  if (currentCategory.value === 'all') {
    return presetImages.value
  }
  return presetImages.value.filter(img => img.category === currentCategory.value)
})

// 选择预设图片
const selectPresetImage = (image: { url: string; name: string }) => {
  selectedImage.value = image.url
  // 分析图片亮度以选择合适的文字颜色
  analyzePreviewImageBrightness()
}

// 清除已添加的图片
const clearImage = () => {
  selectedImage.value = ''
}



// 开始拖动
const startDragging = (e: MouseEvent) => {
  isDragging.value = true
  dragStart.value = {
    x: e.clientX,
    y: e.clientY
  }
  elementStart.value = {
    x: textPosition.value.x,
    y: textPosition.value.y
  }
}

// 拖动过程
const handleDragging = (e: MouseEvent) => {
  if (!isDragging.value) return

  // 计算移动的百分比
  const previewWindow = document.querySelector('.preview-window') as HTMLElement
  if (!previewWindow) return

  const rect = previewWindow.getBoundingClientRect()
  const deltaX = ((e.clientX - dragStart.value.x) / rect.width) * 100
  const deltaY = ((e.clientY - dragStart.value.y) / rect.height) * 100

  // 更新位置，并限制在预览窗口内
  textPosition.value = {
    x: Math.min(Math.max(elementStart.value.x + deltaX, 0), 100),
    y: Math.min(Math.max(elementStart.value.y + deltaY, 0), 100)
  }
}

// 停止拖动
const stopDragging = () => {
  isDragging.value = false
}

// 重置文字位置
const resetTextPosition = () => {
  textPosition.value = { x: 50, y: 50 }
}

// 获取文字所在区域的平均亮度来判断文字颜色
const getBottomAreaBrightness = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => {
  const centerY = canvas.height * (textPosition.value.y / 100)
  const regionHeight = Math.floor(canvas.height * 0.2)
  const startY = Math.max(0, Math.min(Math.floor(centerY - regionHeight / 2), canvas.height - regionHeight))
  const imageData = ctx.getImageData(0, startY, canvas.width, regionHeight)
  const data = imageData.data
  let totalBrightness = 0
  let pixelCount = 0

  for (let i = 0; i < data.length; i += 16) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const brightness = (r * 0.299 + g * 0.587 + b * 0.114)
    totalBrightness += brightness
    pixelCount++
  }

  return pixelCount > 0 ? totalBrightness / pixelCount : 128
}

// 智能文字换行
const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
  const chars = text.split('')
  const lines: string[] = []
  let currentLine = ''

  for (const char of chars) {
    const testLine = currentLine + char
    const metrics = ctx.measureText(testLine)
    
    if (metrics.width > maxWidth && currentLine !== '') {
      lines.push(currentLine)
      currentLine = char
    } else {
      currentLine = testLine
    }
  }
  
  if (currentLine) {
    lines.push(currentLine)
  }

  return lines
}

// 生成表情包图片
const generateEmoticonImage = async () => {
  if (!selectedImage.value) {
    ElMessage.warning('请先选择或上传图片')
    return null
  }

  if (!previewWindow.value) return null

  try {
    // 创建临时图片加载原始图片
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = selectedImage.value
    })

    // 创建临时canvas
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    // 设置canvas尺寸，保持正方形比例
    const size = 512 // 使用固定尺寸确保一致性
    canvas.width = size
    canvas.height = size

    // 绘制图片并应用滤镜，保持原始比例
    ctx.filter = currentFilter.value
    
    // 计算图片在canvas中的位置和尺寸，保持比例
    const imgAspect = img.width / img.height
    const canvasAspect = canvas.width / canvas.height
    
    let drawWidth, drawHeight, drawX, drawY
    
    if (imgAspect > canvasAspect) {
      // 图片更宽，以高度为准
      drawHeight = canvas.height
      drawWidth = drawHeight * imgAspect
      drawX = (canvas.width - drawWidth) / 2
      drawY = 0
    } else {
      // 图片更高，以宽度为准
      drawWidth = canvas.width
      drawHeight = drawWidth / imgAspect
      drawX = 0
      drawY = (canvas.height - drawHeight) / 2
    }
    
    ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight)

    // 如果有文字，绘制文字
    if (text.value) {
      ctx.filter = 'none'  // 清除滤镜，不影响文字
      
      // 智能判断文字颜色（基于底部区域亮度）
      const brightness = getBottomAreaBrightness(canvas, ctx)
      // 亮度大于128使用黑色文字，小于等于128使用白色文字
      const smartTextColor = brightness > 128 ? '#000000' : '#ffffff'
      
      // 设置文字样式，与预览保持一致
      const fontSize = Math.round(textSize.value * (canvas.width / 280)) // 根据canvas尺寸缩放
      ctx.font = `bold ${fontSize}px "Microsoft YaHei", "PingFang SC", Arial, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      // 计算文字区域和换行
      const maxWidth = canvas.width * 0.9 // 文字最大宽度为画布的90%
      const centerX = canvas.width * (textPosition.value.x / 100)
      const centerY = canvas.height * (textPosition.value.y / 100)

      if (textMode.value === 'vertical') {
        // 竖排模式：每行文字为一列，从右到左排列，每列中字符从上到下
        const lines = text.value.split('\n').filter(l => l.length > 0)
        const charSpacing = fontSize * 1.3
        const columnSpacing = fontSize * 1.5
        const totalWidth = lines.length * columnSpacing
        const startX = centerX + totalWidth / 2 - columnSpacing / 2

        // 反转列顺序：最后一行在最左边，第一行在最右边
        lines.slice().reverse().forEach((line, colIndex) => {
          const chars = line.split('')
          const totalHeight = chars.length * charSpacing
          const startY = centerY - totalHeight / 2 + charSpacing / 2
          const x = startX - colIndex * columnSpacing

          chars.forEach((char, charIndex) => {
            const y = startY + charIndex * charSpacing
            ctx.strokeStyle = smartTextColor === '#ffffff' ? '#000000' : '#ffffff'
            ctx.lineWidth = Math.max(2, fontSize / 12)
            ctx.strokeText(char, x, y)
            ctx.fillStyle = smartTextColor
            ctx.fillText(char, x, y)
          })
        })
      } else {
        // 横排模式
        const lines = wrapText(ctx, text.value, maxWidth)
        const lineHeight = fontSize * 1.3
        const totalTextHeight = lines.length * lineHeight
        const startY = centerY - totalTextHeight / 2 + lineHeight / 2

        lines.forEach((line, index) => {
          const x = centerX
          const y = startY + index * lineHeight

          ctx.strokeStyle = smartTextColor === '#ffffff' ? '#000000' : '#ffffff'
          ctx.lineWidth = Math.max(2, fontSize / 12)
          ctx.strokeText(line, x, y)
          ctx.fillStyle = smartTextColor
          ctx.fillText(line, x, y)
        })
      }
    }

    return canvas.toDataURL('image/png')
  } catch (error) {
    console.error('生成表情包失败:', error)
    ElMessage.error('生成失败，请重试')
    return null
  }
}

// 复制到剪贴板
const copyToClipboard = async () => {
  const dataUrl = await generateEmoticonImage()
  if (!dataUrl) return

  try {
    // 将 base64 图片转换为 Blob
    const response = await fetch(dataUrl)
    const blob = await response.blob()

    // 创建 ClipboardItem 对象
    const item = new ClipboardItem({
      'image/png': blob
    })

    // 写入剪贴板
    await navigator.clipboard.write([item])
    
    ElMessage.success('复制成功！')
  } catch (error) {
    console.error('复制失败:', error)
    ElMessage.error('复制失败，请重试')
  }
}

// 下载表情包
const generateEmoticon = async () => {
  const dataUrl = await generateEmoticonImage()
  if (!dataUrl) return

  try {
    // 将 base64 转换为 Blob
    const response = await fetch(dataUrl)
    const blob = await response.blob()
    
    // 创建下载链接
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const timestamp = new Date().getTime()
    const filename = text.value ? 
      `${text.value}_${timestamp}.png` : 
      `emoticon_${timestamp}.png`
    link.download = filename
    
    // 触发下载
    document.body.appendChild(link)
    link.click()
    
    // 清理
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)

    ElMessage.success('下载成功！')
  } catch (error) {
    console.error('下载失败:', error)
    ElMessage.error('下载失败，请重试')
  }
}

// 保存到表情库
const saveToCollection = async () => {
  const dataUrl = await generateEmoticonImage()
  if (!dataUrl) return

  try {
    // 将 base64 转换为 Blob
    const response = await fetch(dataUrl)
    const blob = await response.blob()
    
    // 创建唯一ID
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2)
    
    // 创建表情包元数据
    const emoticon = {
      id,
      name: text.value || '未命名表情包',
      url: dataUrl,
      tags: [],
      favorite: false,
      createdAt: Date.now(),
      createTime: Date.now(),
      updateTime: Date.now(),
      type: 'image/png'
    }

    // 保存到表情库
    await emoticonStore.addEmoticon(emoticon, blob)

    ElMessage.success({
      message: '保存成功！可在"本地表情"中查看',
      duration: 2000
    })
  } catch (error) {
    console.error('保存失败:', error)
    ElMessage.error('保存失败，请重试')
  }
}

// 处理粘贴事件
const handlePaste = async (e: ClipboardEvent) => {
  console.log('粘贴事件触发') // 调试信息
  e.preventDefault() // 阻止默认行为
  
  const items = e.clipboardData?.items
  if (!items) {
    console.log('没有剪贴板数据') // 调试信息
    ElMessage.warning('剪贴板中没有数据')
    return
  }

  console.log('剪贴板项目数量:', items.length) // 调试信息

  let foundImage = false
  for (const item of items) {
    console.log('剪贴板项目类型:', item.type) // 调试信息
    
    if (item.type.startsWith('image')) {
      foundImage = true
      const file = item.getAsFile()
      if (!file) {
        console.log('无法获取图片文件') // 调试信息
        continue
      }

      console.log('找到图片文件:', file.name, file.type, file.size, 'bytes') // 调试信息

      try {
        const reader = new FileReader()
        reader.onload = (e) => {
          selectedImage.value = e.target?.result as string
          console.log('图片粘贴成功，数据URL长度:', selectedImage.value.length) // 调试信息
          ElMessage.success('图片粘贴成功！可以开始编辑了')
          // 分析图片亮度以选择合适的文字颜色
          analyzePreviewImageBrightness()
        }
        reader.onerror = (error) => {
          console.error('FileReader错误:', error)
          ElMessage.error('图片读取失败')
        }
        reader.readAsDataURL(file)
        break
      } catch (error) {
        console.error('粘贴图片失败:', error)
        ElMessage.error('粘贴图片失败，请重试')
      }
    }
  }
  
  if (!foundImage) {
    console.log('剪贴板中没有找到图片') // 调试信息
    ElMessage.warning('剪贴板中没有图片，请先复制图片')
  }
}

// 滤镜选项
const filters = [
  { label: '原图', value: '' },
  { label: '黑白', value: 'grayscale(100%)' },
  { label: '复古', value: 'sepia(100%)' },
  { label: '反色', value: 'invert(100%)' },
  { label: '高对比度', value: 'contrast(150%)' },
  { label: '高亮', value: 'brightness(130%)' },
  { label: '柔和', value: 'brightness(110%) contrast(90%) saturate(85%)' },
  { label: '冷色调', value: 'saturate(150%) hue-rotate(180deg)' },
  { label: '暖色调', value: 'saturate(150%) hue-rotate(-30deg)' },
  { label: '模糊', value: 'blur(2px)' }
]

const currentFilterType = ref('')

// 计算当前滤镜效果
const currentFilter = computed(() => {
  return currentFilterType.value
})

// 智能预览文字颜色（基于图片分析）
const smartPreviewTextColor = ref('#ffffff')

// 分析预览图片的底部亮度
const analyzePreviewImageBrightness = async () => {
  if (!selectedImage.value) {
    smartPreviewTextColor.value = '#000000'
    return
  }

  try {
    // 创建临时canvas来分析图片
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = selectedImage.value
    })

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 设置canvas尺寸
    canvas.width = 240
    canvas.height = 240
    
    // 绘制图片
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    
    // 分析底部区域亮度
    const brightness = getBottomAreaBrightness(canvas, ctx)
    
    // 根据亮度选择文字颜色
    smartPreviewTextColor.value = brightness > 128 ? '#000000' : '#ffffff'
    
  } catch (error) {
    console.error('分析图片亮度失败:', error)
    smartPreviewTextColor.value = '#ffffff' // 默认白色
  }
}

// 格式化预览文字（处理换行）
const formattedPreviewText = computed(() => {
  if (!text.value) return ''

  if (textMode.value === 'vertical') {
    // 竖排模式：原样返回，CSS writing-mode 处理排列
    // 用户用回车分隔的每一行会变成一列（从右到左）
    return text.value
  }

  // 横排模式：每8个字符换行
  const maxCharsPerLine = 8
  const chars = text.value.split('')
  const lines: string[] = []
  let currentLine = ''

  for (const char of chars) {
    if (currentLine.length >= maxCharsPerLine) {
      lines.push(currentLine)
      currentLine = char
    } else {
      currentLine += char
    }
  }

  if (currentLine) {
    lines.push(currentLine)
  }

  return lines.join('\n')
})

// 添加图片加载错误处理函数
const handleImageError = (event: Event, image: { name: string }) => {
  console.error('Image failed to load:', image)
  ElMessage.error(`图片 ${image.name} 加载失败`)
}

</script>

<style scoped lang="scss">
.emoticon-workshop {
  display: flex;
  gap: 15px;
  height: 100%;
  background: var(--ws-bg);
  color: var(--app-text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.preset-images {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--ws-panel-bg);
  border-radius: 16px;
  padding: 12px;
  box-shadow: var(--ws-panel-shadow);
  border: none;
  height: 100vh;
  max-height: 100vh;
  overflow: hidden;
}

.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 90px) !important;
  gap: 12px;
  justify-content: center;
  overflow-y: auto;
  flex: 1;
  min-height: 0;

  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.2) transparent;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 3px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: rgba(0, 0, 0, 0.3);
  }
}

.edit-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-width: 320px;
  background: var(--ws-panel-bg);
  border-radius: 16px;
  padding: 24px;
  box-shadow: var(--ws-panel-shadow);
}

.preview-window {
  width: 280px;
  height: 360px;
  position: relative;
  margin: 0 auto;
  border: 2px solid var(--ws-preview-border);
  overflow: hidden;
  outline: none;
  cursor: default;
  background: var(--ws-preview-bg);
  border-radius: 20px;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  user-select: none;
}

.base-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
  transition: filter 0.3s ease;
}

.text-overlay {
  position: absolute;
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8), -1px -1px 2px rgba(255, 255, 255, 0.3);
  overflow-wrap: break-word;
  user-select: none;
  touch-action: none;
  font-weight: bold;
  font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
}

.remove-image-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  z-index: 10;
  backdrop-filter: blur(4px);

  &:hover {
    background: rgba(0, 0, 0, 0.7);
    transform: scale(1.1);
  }

  .el-icon {
    font-size: 14px;
  }
}

.controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;

  :deep(.el-textarea__inner) {
    resize: none;
  }
}

.text-mode-controls {
  display: flex;
  align-items: center;
  gap: 8px;

  .el-button-group {
    flex: 1;

    .el-button {
      flex: 1;
    }
  }

  .reset-btn {
    flex-shrink: 0;
  }
}

.text-controls {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  background: var(--ws-control-bg);
  border-radius: 10px;
}

.el-slider {
  flex: 1;
}

.action-buttons {
  display: flex;
  gap: 8px;
  justify-content: center;

  .el-button {
    flex: 1;
    height: 34px;
    font-size: 13px;
    font-weight: 600;
    border: none;
    border-radius: 10px;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);

    &:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    &:active {
      transform: translateY(0);
    }
  }

  .copy-btn {
    background: #3b82f6;
    color: white;

    &:hover {
      background: #2563eb;
    }
  }

  .download-btn {
    background: #3b82f6;
    color: white;

    &:hover {
      background: #2563eb;
    }
  }

  .save-btn {
    background: #3b82f6;
    color: white;

    &:hover {
      background: #2563eb;
    }
  }
}

.preset-image-item {
  width: 90px !important;
  height: 90px !important;
  cursor: pointer;
  border: none;
  border-radius: 18px;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
  background-color: var(--ws-item-bg);

  &:hover {
    transform: scale(1.05);
    box-shadow: var(--ws-preset-hover-shadow);
  }

  &:active {
    transform: scale(0.98);
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 18px;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }
}

.empty-preview {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--ws-empty-color);
  background-color: var(--ws-preview-bg);
  gap: 16px;
  border-radius: 20px;
}

.paste-icon {
  font-size: 40px;
  opacity: 0.6;
  color: var(--ws-empty-color);
}

.empty-preview p {
  margin: 0;
  font-size: 15px;
  font-weight: 500;
  text-align: center;
  line-height: 1.5;
  color: var(--ws-empty-hint);
}

.header-controls {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.category-tabs {
  display: flex;
  gap: 0;
  background: var(--ws-tab-bg);
  border-radius: 12px;
  padding: 4px;
  flex: 1;
}

.category-tab {
  flex: 1;
  padding: 8px 12px;
  text-align: center;
  font-size: 13px;
  font-weight: 500;
  color: var(--ws-tab-color);
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  white-space: nowrap;

  &:hover {
    color: var(--ws-tab-hover-color);
    background: rgba(255, 255, 255, 0.5);
  }

  &.active {
    color: var(--ws-tab-active-color);
    background: var(--ws-tab-active-bg);
    font-weight: 600;
    box-shadow: var(--ws-tab-active-shadow);
  }
}

.filter-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--ws-control-bg);
  border-radius: 10px;

  .label {
    font-size: 13px;
    font-weight: 600;
    color: var(--ws-control-label);
    white-space: nowrap;
  }

  :deep(.el-select) {
    flex: 1;

    .el-input__wrapper {
      border-radius: 8px;
      border: 1px solid var(--ws-filter-select-border);
      box-shadow: none;

      &:hover {
        border-color: var(--el-border-color-dark);
      }

      &.is-focus {
        border-color: var(--el-color-primary);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }
    }
  }
}

.reset-btn {
  height: 32px;
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  font-size: 13px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);

  &:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(245, 87, 108, 0.3);
    background: linear-gradient(135deg, #e084ec 0%, #e6495d 100%);
  }

  &:active {
    transform: translateY(0);
  }
}

:deep(.el-input) {
  .el-input__wrapper {
    border-radius: 10px;
    border: 1px solid var(--ws-input-border);
    box-shadow: none;
    background: var(--ws-input-bg);
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);

    &:hover {
      border-color: var(--el-border-color-dark);
    }

    &.is-focus {
      border-color: var(--el-color-primary);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }
  }

  .el-input__inner {
    font-size: 15px;
    font-weight: 500;
    color: var(--ws-input-text);

    &::placeholder {
      color: var(--ws-input-placeholder);
      font-weight: 400;
    }
  }
}

:deep(.el-slider) {
  .el-slider__runway {
    background: var(--ws-slider-track);
    border-radius: 6px;
  }

  .el-slider__bar {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 6px;
  }

  .el-slider__button {
    border: 3px solid var(--ws-panel-bg);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  }
}

// 响应式设计
@media (max-width: 1024px) {
  .preset-images {
    width: 200px;
  }

  .image-grid {
    grid-template-columns: repeat(auto-fill, 44px);
    gap: 6px;
  }

  .preset-image-item {
    width: 44px;
    height: 44px;
    border-radius: 10px;

    &:hover {
      border-radius: 12px;
    }

    img {
      border-radius: 10px;
    }
  }

  .edit-area {
    min-width: 280px;
    padding: 20px;
  }

  .preview-window {
    width: 320px;
    height: 300px;
  }
}

@media (max-width: 768px) {
  .emoticon-workshop {
    flex-direction: column;
    gap: 16px;
    padding: 16px;
  }

  .preset-images {
    width: 100%;
    max-height: 220px;
  }

  .image-grid {
    grid-template-columns: repeat(auto-fill, 52px);
    gap: 8px;
    height: 160px;
  }

  .preset-image-item {
    width: 52px;
    height: 52px;
    border-radius: 10px;

    &:hover {
      border-radius: 12px;
      transform: translateY(-1px) scale(1.03);
    }

    img {
      border-radius: 10px;
    }
  }

  .edit-area {
    min-width: auto;
    padding: 20px;
  }

  .preview-window {
    width: 220px;
    height: 280px;
  }
}

@media (max-width: 480px) {
  .preset-images {
    padding: 8px;
  }

  .image-grid {
    grid-template-columns: repeat(auto-fill, 48px);
    gap: 3px;
  }

  .preset-image-item {
    width: 48px;
    height: 48px;
    border-radius: 6px;

    &:hover {
      border-radius: 10px;
    }

    img {
      border-radius: 4px;
    }
  }

  .header-controls {
    gap: 6px;

    .category-selector {
      font-size: 12px;
    }
  }
}
</style>

<!-- 暗黑模式适配 (需要全局选择器覆盖 scoped 样式) -->
<style lang="scss">
html.dark {
  .emoticon-workshop {
    .preset-images,
    .edit-area {
      background: var(--ws-panel-bg);
      box-shadow: var(--ws-panel-shadow);
    }

    .preview-window {
      border-color: var(--ws-preview-border);
      background: var(--ws-preview-bg);
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(46, 111, 239, 0.2);
    }

    .preset-image-item {
      background-color: var(--ws-item-bg);

      &:hover {
        box-shadow: var(--ws-preset-hover-shadow);
      }
    }

    .empty-preview {
      background-color: var(--ws-preview-bg);
      color: var(--ws-empty-color);
    }

    .paste-icon {
      color: var(--ws-empty-color);
    }

    .empty-preview p {
      color: var(--ws-empty-hint);
    }

    .category-tabs {
      background: var(--ws-tab-bg);
    }

    .category-tab {
      color: var(--ws-tab-color);

      &:hover {
        color: var(--ws-tab-hover-color);
        background: rgba(255, 255, 255, 0.05);
      }

      &.active {
        background: var(--ws-tab-active-bg);
        color: var(--ws-tab-active-color);
        box-shadow: var(--ws-tab-active-shadow);
      }
    }

    .text-controls,
    .filter-controls {
      background: var(--ws-control-bg);
    }

    .filter-controls .label {
      color: var(--ws-control-label);
    }

    .image-grid {
      scrollbar-color: rgba(255, 255, 255, 0.15) transparent;

      &::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.15);

        &:hover {
          background: rgba(255, 255, 255, 0.25);
        }
      }
    }
  }
}
</style>
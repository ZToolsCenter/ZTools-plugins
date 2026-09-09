<template>
  <div class="beauty-viewer">
    <!-- 主要内容区域 -->
    <div class="main-content">
      <!-- 当前图片显示区域 -->
      <div class="image-display">
        <div v-if="loading" class="loading-state">
          <div class="spinner"></div>
          <p>加载中...</p>
        </div>
        
        <div v-else-if="currentImage" class="image-container">
          <img 
            :src="currentImage" 
            alt="美女图片"
            class="main-image"
            @load="onImageLoad"
            @error="onImageError"
            @click="enterFullscreen"
          />
          
          <!-- 导航按钮 -->
          <button 
            class="nav-btn prev-btn" 
            @click="previousImage"
            :disabled="!canGoPrevious"
          >
            ←
          </button>
          
          <button 
            class="nav-btn next-btn" 
            @click="nextImage"
            :disabled="loading"
          >
            →
          </button>
          
          <!-- 全屏按钮 -->
          <button
            class="fullscreen-btn"
            @click="enterFullscreen"
            title="全屏查看"
          >
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
          </button>

          <!-- 下载按钮 -->
          <button
            class="download-btn"
            @click="downloadImage"
            title="下载图片"
          >
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
        </div>

        <div v-else class="empty-state">
          <p>暂无图片</p>
          <button @click="loadNewImage" class="load-btn">加载图片</button>
        </div>
      </div>


      <!-- 历史记录面板 -->
      <transition name="history-slide">
        <div v-if="showHistory" class="history-panel">
          <div class="history-header">
            <h3>全部历史记录 ({{ history.length }})</h3>
            <button @click="clearHistory" class="clear-btn" v-if="history.length > 0">
              清空历史
            </button>
          </div>
          
          <div v-if="history.length > 0" class="history-grid">
            <div 
              v-for="(image, index) in history.slice().reverse()" 
              :key="`history-${index}`"
              :class="['history-item', { active: image === currentImage }]"
              @click="selectHistoryImage(image, history.length - 1 - index)"
            >
              <img :src="image" :alt="`历史图片 ${history.length - index}`" />
              <div class="history-overlay">
                <span>{{ history.length - index }}</span>
              </div>
            </div>
          </div>
          
          <div v-else class="empty-history">
            <div class="empty-icon">📷</div>
            <p>暂无历史记录</p>
            <p class="empty-tip">浏览图片后会自动保存到这里</p>
          </div>
        </div>
      </transition>
    </div>

    <!-- 全屏模式 -->
    <div v-if="isFullscreen" class="fullscreen-overlay" @click="exitFullscreen">
      <div class="fullscreen-container" @click.stop>
        <img 
          :src="currentImage" 
          alt="美女图片"
          class="fullscreen-image"
          @load="onImageLoad"
          @error="onImageError"
        />
        
        <!-- 全屏导航按钮 -->
        <button 
          class="fullscreen-nav-btn fullscreen-prev-btn" 
          @click="previousImage"
          :disabled="!canGoPrevious"
        >
          ←
        </button>
        
        <button 
          class="fullscreen-nav-btn fullscreen-next-btn" 
          @click="nextImage"
          :disabled="loading"
        >
          →
        </button>
        
        <!-- 全屏退出按钮 -->
        <button 
          class="fullscreen-exit-btn" 
          @click="exitFullscreen"
          title="退出全屏"
        >
          ✕
        </button>
        
        <!-- 全屏信息栏 -->
        <div class="fullscreen-info">
          <span class="image-counter">{{ currentHistoryIndex + 1 }} / {{ history.length }}</span>
          <span class="image-category">美女图片</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'

const BEAUTY_IMAGE_API_URL = 'https://v2.xxapi.cn/api/meinvpic'

// 响应式数据
const currentImage = ref('')
const loading = ref(false)
const showHistory = ref(false)
const history = ref<string[]>([]) // 保存历史记录
const currentHistoryIndex = ref(-1)
const isFullscreen = ref(false)

// 计算属性
const canGoPrevious = computed(() => {
  return currentHistoryIndex.value > 0
})

// 方法
const loadNewImage = async () => {
  loading.value = true

  try {
    const imageUrl = await fetchImageUrl()

    // 预加载图片以确保可以正常显示
    await new Promise<void>((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        currentImage.value = imageUrl
        addToHistory(imageUrl)
        resolve()
      }
      img.onerror = () => {
        reject(new Error(`图片加载失败: ${imageUrl}`))
      }
      img.src = imageUrl
    })
  } catch (error) {
    console.error('美女图片接口请求失败:', error)
  } finally {
    loading.value = false
  }
}

const fetchImageUrl = async (): Promise<string> => {
  const apiUrl = withCacheBust(BEAUTY_IMAGE_API_URL)
  try {
    const response = await fetch(apiUrl, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json'
      }
    })
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const contentType = response.headers.get('content-type') || ''
    if (contentType.startsWith('image/')) {
      return apiUrl
    }

    const text = (await response.text()).trim()
    if (!text) {
      throw new Error('API返回空内容')
    }

    if (looksLikeImageUrl(text)) {
      return text
    }

    const data = JSON.parse(text) as { code?: number | string; msg?: string; data?: unknown }
    if (data.code !== undefined && String(data.code) !== '200') {
      throw new Error(`API error: ${data.msg || data.code}`)
    }

    const imageUrl = extractImageUrl(data.data ?? data)
    if (!imageUrl) {
      throw new Error('API返回内容中没有找到图片地址')
    }

    return imageUrl
  } catch (error) {
    console.warn('美女图片 JSON 接口解析失败，改用 302 图片地址:', error)
    return withCacheBust(`${BEAUTY_IMAGE_API_URL}?return=302`)
  }
}

const withCacheBust = (url: string) => {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}t=${Date.now()}&r=${Math.random()}`
}

const looksLikeImageUrl = (value: string) => {
  return /^https?:\/\/.+/i.test(value)
}

const extractImageUrl = (data: unknown): string => {
  if (typeof data === 'string') {
    return looksLikeImageUrl(data) ? data : ''
  }

  if (Array.isArray(data)) {
    for (const item of data) {
      const imageUrl = extractImageUrl(item)
      if (imageUrl) return imageUrl
    }
    return ''
  }

  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    for (const key of ['url', 'img', 'image', 'pic', 'data']) {
      const imageUrl = extractImageUrl(record[key])
      if (imageUrl) return imageUrl
    }
  }

  return ''
}

const addToHistory = (imageUrl: string) => {
  // 避免重复添加相同图片
  if (!history.value.includes(imageUrl)) {
    history.value.push(imageUrl)
    currentHistoryIndex.value = history.value.length - 1
    
    // 限制历史记录数量，最多保存100张（所有分类共享）
    if (history.value.length > 100) {
      history.value.shift()
      currentHistoryIndex.value = history.value.length - 1
    }
  } else {
    currentHistoryIndex.value = history.value.indexOf(imageUrl)
  }
}

const previousImage = () => {
  if (canGoPrevious.value) {
    currentHistoryIndex.value--
    currentImage.value = history.value[currentHistoryIndex.value]
  }
}

const nextImage = () => {
  if (currentHistoryIndex.value < history.value.length - 1) {
    currentHistoryIndex.value++
    currentImage.value = history.value[currentHistoryIndex.value]
  } else {
    // 如果是最后一张，加载新图片
    loadNewImage()
  }
}

const selectHistoryImage = (imageUrl: string, index: number) => {
  currentImage.value = imageUrl
  currentHistoryIndex.value = index
}

const toggleHistory = () => {
  showHistory.value = !showHistory.value
}

const clearHistory = () => {
  history.value = []
  currentHistoryIndex.value = -1
  if (currentImage.value && !history.value.includes(currentImage.value)) {
    addToHistory(currentImage.value)
  }
}

const downloadImage = async () => {
  if (!currentImage.value) return
  
  try {
    const response = await fetch(currentImage.value)
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `beauty-image-${Date.now()}.jpg`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
  } catch (error) {
    console.error('下载失败:', error)
  }
}

const onImageLoad = () => {
  // 图片加载成功的处理
}

const onImageError = () => {
  console.error('图片显示失败')
  // 可以设置默认图片或重新加载
}

// 全屏功能
const enterFullscreen = () => {
  isFullscreen.value = true
  // 阻止页面滚动
  document.body.style.overflow = 'hidden'
}

const exitFullscreen = () => {
  isFullscreen.value = false
  // 恢复页面滚动
  document.body.style.overflow = 'auto'
}

// 键盘事件处理
const handleKeydown = (event: KeyboardEvent) => {
  if (isFullscreen.value) {
    switch (event.key) {
      case 'Escape':
        exitFullscreen()
        break
      case 'ArrowLeft':
        if (canGoPrevious.value) previousImage()
        break
      case 'ArrowRight':
        if (!loading.value) nextImage()
        break
    }
  }
}

// 生命周期
onMounted(() => {
  loadNewImage()
  // 添加键盘事件监听
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  // 确保退出时恢复页面滚动
  document.body.style.overflow = 'auto'
})
</script>

<style scoped>
.beauty-viewer {
  height: 100%;
  min-height: 0;
  width: 100%;
  display: grid;
  padding: 14px;
  box-sizing: border-box;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.main-content {
  position: relative;
  display: grid;
  gap: 12px;
  min-height: 0;
  overflow: hidden;
}

.image-display {
  position: relative;
  min-height: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 12px;
  background: #0f172a;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08), 0 16px 44px rgba(15, 23, 42, 0.16);
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  width: 100%;
  height: 100%;
  color: rgba(255, 255, 255, 0.78);
  text-align: center;
}

.spinner {
  width: 38px;
  height: 38px;
  border: 3px solid rgba(255, 255, 255, 0.25);
  border-top-color: #60a5fa;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.image-container {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.main-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  cursor: zoom-in;
  user-select: none;
}

.nav-btn,
.fullscreen-btn,
.download-btn {
  position: absolute;
  z-index: 10;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  color: #fff;
  background: rgba(15, 23, 42, 0.62);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(10px);
  cursor: pointer;
  transition: background 0.2s ease, transform 0.2s ease, opacity 0.2s ease;
}

.nav-btn:hover:not(:disabled),
.fullscreen-btn:hover,
.download-btn:hover {
  background: rgba(15, 23, 42, 0.86);
}

.btn-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.nav-btn:disabled {
  opacity: 0.28;
  cursor: not-allowed;
}

.nav-btn {
  top: 50%;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  font-size: 18px;
  transform: translateY(-50%);
}

.nav-btn:hover:not(:disabled) {
  transform: translateY(-50%) scale(1.05);
}

.prev-btn {
  left: 16px;
}

.next-btn {
  right: 16px;
}

.fullscreen-btn {
  top: 14px;
  right: 14px;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  font-size: 18px;
}

.fullscreen-btn:hover {
  transform: scale(1.05);
}

.download-btn {
  top: 14px;
  right: 64px;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  font-size: 18px;
}

.download-btn:hover {
  transform: scale(1.05);
}

.load-btn,
.clear-btn {
  height: 36px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s ease, transform 0.2s ease, opacity 0.2s ease;
}

.load-btn {
  background: #2563eb;
  color: #fff;
}

.load-btn:hover {
  background: #1d4ed8;
}

.history-panel {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 66px;
  z-index: 30;
  max-height: min(46vh, 430px);
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.2);
  backdrop-filter: blur(18px);
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.history-header h3 {
  margin: 0;
  color: #0f172a;
  font-size: 16px;
  font-weight: 700;
}

.clear-btn {
  height: 30px;
  color: #fff;
  background: #dc2626;
}

.clear-btn:hover {
  background: #b91c1c;
}

.history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
  padding-right: 2px;
}

.history-item {
  position: relative;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  border: 2px solid transparent;
  border-radius: 8px;
  background: #e2e8f0;
  cursor: pointer;
  transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
}

.history-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.16);
}

.history-item.active {
  border-color: #2563eb;
}

.history-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.history-overlay {
  position: absolute;
  right: 6px;
  bottom: 6px;
  min-width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.72);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}

.empty-history {
  padding: 32px 16px;
  color: #64748b;
  text-align: center;
}

.empty-history .empty-icon {
  font-size: 34px;
  margin-bottom: 10px;
}

.empty-history p {
  margin: 6px 0;
}

.empty-tip {
  font-size: 13px;
}

.history-slide-enter-active,
.history-slide-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.history-slide-enter-from,
.history-slide-leave-to {
  opacity: 0;
  transform: translateY(14px);
}

.fullscreen-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.95);
  cursor: pointer;
}

.fullscreen-container {
  position: relative;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
}

.fullscreen-image {
  max-width: 95vw;
  max-height: 95vh;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 0 50px rgba(0, 0, 0, 0.5);
}

.fullscreen-nav-btn {
  position: absolute;
  top: 50%;
  z-index: 10;
  width: 60px;
  height: 60px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  color: #333;
  font-size: 24px;
  font-weight: bold;
  cursor: pointer;
  transform: translateY(-50%);
  transition: all 0.3s ease;
  backdrop-filter: blur(10px);
}

.fullscreen-nav-btn:hover:not(:disabled) {
  background: #fff;
  transform: translateY(-50%) scale(1.1);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.fullscreen-nav-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.fullscreen-prev-btn {
  left: 30px;
}

.fullscreen-next-btn {
  right: 30px;
}

.fullscreen-exit-btn {
  position: absolute;
  top: 30px;
  right: 30px;
  z-index: 10;
  width: 50px;
  height: 50px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  color: #333;
  font-size: 20px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.3s ease;
  backdrop-filter: blur(10px);
}

.fullscreen-exit-btn:hover {
  background: #fff;
  transform: scale(1.1);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.fullscreen-info {
  position: absolute;
  bottom: 30px;
  left: 50%;
  display: flex;
  gap: 20px;
  padding: 12px 24px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  font-size: 14px;
  font-weight: 500;
  transform: translateX(-50%);
  backdrop-filter: blur(10px);
}

.image-category {
  color: #d1d5db;
}

:global(html.dark) .history-panel {
  background: rgba(15, 23, 42, 0.88);
  border-color: rgba(148, 163, 184, 0.18);
  color: #e2e8f0;
}

:global(html.dark) .history-header h3 {
  color: #e2e8f0;
}

@media (max-width: 768px) {
  .beauty-viewer {
    padding: 10px;
  }

  .main-content {
    gap: 10px;
  }

  .image-display,
  .history-panel {
    border-radius: 10px;
  }

  .nav-btn {
    width: 38px;
    height: 38px;
    font-size: 18px;
  }

  .prev-btn {
    left: 10px;
  }

  .next-btn {
    right: 10px;
  }

  .fullscreen-btn {
    top: 10px;
    right: 10px;
    width: 38px;
    height: 38px;
  }

  .download-btn {
    top: 10px;
    right: 56px;
    width: 38px;
    height: 38px;
  }

  .history-panel {
    left: 8px;
    right: 8px;
    bottom: 62px;
    max-height: 48vh;
    padding: 12px;
  }

  .history-grid {
    grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
    gap: 8px;
  }

  .fullscreen-nav-btn {
    width: 50px;
    height: 50px;
    font-size: 20px;
  }

  .fullscreen-prev-btn {
    left: 16px;
  }

  .fullscreen-next-btn {
    right: 16px;
  }

  .fullscreen-exit-btn {
    top: 16px;
    right: 16px;
    width: 44px;
    height: 44px;
  }

  .fullscreen-info {
    bottom: 16px;
    padding: 10px 18px;
    font-size: 13px;
  }
}

@media (max-width: 480px) {
  .beauty-viewer {
    padding: 8px;
  }

  .history-header h3 {
    font-size: 14px;
  }

  .history-grid {
    grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  }
}
</style>

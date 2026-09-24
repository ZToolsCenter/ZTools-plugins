<template>
  <div class="video-viewer">
    <!-- 主要内容区域 -->
    <div class="main-content">
      <!-- 当前视频显示区域 -->
      <div class="video-display">
        <div v-if="loading" class="loading-state">
          <div class="spinner"></div>
          <p>加载中...</p>
        </div>
        
        <div v-else-if="currentVideo" class="video-container">
          <video
            ref="videoElement"
            :src="currentVideo"
            :poster="currentVideoPoster"
            controls
            autoplay
            muted
            loop
            class="main-video"
            @loadstart="onVideoLoadStart"
            @canplay="onVideoCanPlay"
            @error="onVideoError"
            @click="enterFullscreen"
          >
            您的浏览器不支持视频播放
          </video>
          
          <!-- 导航按钮 -->
          <button 
            class="nav-btn prev-btn" 
            @click="previousVideo"
            :disabled="!canGoPrevious"
          >
            ←
          </button>
          
          <button 
            class="nav-btn next-btn" 
            @click="nextVideo"
            :disabled="loading"
          >
            →
          </button>
          
          <!-- 全屏按钮 -->
          <button 
            class="fullscreen-btn" 
            @click="enterFullscreen"
            title="全屏播放"
          >
            ⛶
          </button>
        </div>

        <div v-else class="empty-state">
          <p>暂无视频</p>
          <button @click="loadNewVideo" class="load-btn">加载视频</button>
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
              v-for="(video, index) in history.slice().reverse()" 
              :key="`history-${index}`"
              :class="['history-item', { active: video.url === currentVideo }]"
              @click="selectHistoryVideo(video, history.length - 1 - index)"
            >
              <video :src="video.url" class="history-video" muted></video>
              <div class="history-overlay">
                <div class="play-icon">▶</div>
                <span>{{ history.length - index }}</span>
              </div>
            </div>
          </div>
          
          <div v-else class="empty-history">
            <div class="empty-icon">🎥</div>
            <p>暂无历史记录</p>
            <p class="empty-tip">观看视频后会自动保存到这里</p>
          </div>
        </div>
      </transition>
    </div>

    <!-- 全屏模式 -->
    <div v-if="isFullscreen" class="fullscreen-overlay" @click="exitFullscreen">
      <div class="fullscreen-container" @click.stop>
        <video
          ref="fullscreenVideoElement"
          :src="currentVideo"
          :poster="currentVideoPoster"
          controls
          autoplay
          muted
          loop
          class="fullscreen-video"
          @loadstart="onVideoLoadStart"
          @canplay="onVideoCanPlay"
          @error="onVideoError"
        >
          您的浏览器不支持视频播放
        </video>
        
        <!-- 全屏导航按钮 -->
        <button 
          class="fullscreen-nav-btn fullscreen-prev-btn" 
          @click="previousVideo"
          :disabled="!canGoPrevious"
        >
          ←
        </button>
        
        <button 
          class="fullscreen-nav-btn fullscreen-next-btn" 
          @click="nextVideo"
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
          <span class="video-counter">{{ currentHistoryIndex + 1 }} / {{ history.length }}</span>
          <span class="video-category">美女视频</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, onUnmounted, nextTick } from 'vue'

// 类型定义
interface VideoItem {
  url: string
  poster?: string
}

// 视频分类ID列表
const categoryIds = [
  'jk', 'YuMeng', 'NvDa', 'NvGao', 'ReWu', 'QingCun',
  'SheJie', 'ChuanDa', 'GaoZhiLiangXiaoJieJie', 'HanFu',
  'HeiSi', 'BianZhuang', 'LuoLi', 'TianMei', 'BaiSi',
]

// 响应式数据
const currentVideo = ref('')
const currentVideoPoster = ref('')
const loading = ref(false)
const showHistory = ref(false)
const history = ref<VideoItem[]>([])
const currentHistoryIndex = ref(-1)
const isFullscreen = ref(false)
const videoElement = ref<HTMLVideoElement | null>(null)
const fullscreenVideoElement = ref<HTMLVideoElement | null>(null)

// API 地址
const API_BASE = 'https://api.mmp.cc/api/ksvideo'

// 计算属性
const canGoPrevious = computed(() => {
  return currentHistoryIndex.value > 0
})

// 方法
const loadNewVideo = async () => {
  loading.value = true
  try {
    const randomId = categoryIds[Math.floor(Math.random() * categoryIds.length)]
    const url = `${API_BASE}?type=json&id=${randomId}&t=${Date.now()}`

    console.log('请求URL:', url)

    const response = await fetch(url)
    const data = await response.json()

    console.log('API返回数据:', data)

    // API返回格式: { "status": "success", "link": "视频URL" }
    if (data && data.status === 'success' && data.link) {
      const videoUrl = data.link
      if (videoUrl && typeof videoUrl === 'string' && videoUrl.startsWith('http')) {
        currentVideo.value = videoUrl
        currentVideoPoster.value = ''
        addToHistory({ url: videoUrl, poster: '' })
        console.log('视频加载成功:', videoUrl)

        nextTick(() => {
          const el = videoElement.value
          if (el) {
            el.muted = true
            el.play().catch((error: any) => {
              console.log('自动播放失败:', error)
            })
          }
        })
      } else {
        throw new Error('API返回的link字段不是有效的URL')
      }
    } else {
      console.error('API返回数据格式错误:', data)
      throw new Error('API返回异常')
    }
  } catch (error) {
    console.error('获取视频失败:', error)
  } finally {
    loading.value = false
  }
}

const addToHistory = (video: VideoItem) => {
  // 避免重复添加相同视频
  const existingIndex = history.value.findIndex(v => v.url === video.url)
  if (existingIndex === -1) {
    history.value.push(video)
    currentHistoryIndex.value = history.value.length - 1

    // 限制历史记录数量，最多保存50个视频
    if (history.value.length > 50) {
      history.value.shift()
      currentHistoryIndex.value = history.value.length - 1
    }
  } else {
    currentHistoryIndex.value = existingIndex
  }
}

const autoPlay = (el: HTMLVideoElement | null) => {
  if (!el) return
  el.muted = true
  el.play().catch((error: any) => {
    console.log('自动播放失败:', error)
  })
}

const previousVideo = () => {
  if (canGoPrevious.value) {
    currentHistoryIndex.value--
    const video = history.value[currentHistoryIndex.value]
    currentVideo.value = video.url
    currentVideoPoster.value = video.poster || ''

    nextTick(() => autoPlay(videoElement.value))
  }
}

const nextVideo = () => {
  if (currentHistoryIndex.value < history.value.length - 1) {
    currentHistoryIndex.value++
    const video = history.value[currentHistoryIndex.value]
    currentVideo.value = video.url
    currentVideoPoster.value = video.poster || ''

    nextTick(() => autoPlay(videoElement.value))
  } else {
    // 如果是最后一个，加载新视频
    loadNewVideo()
  }
}

const selectHistoryVideo = (video: VideoItem, index: number) => {
  currentVideo.value = video.url
  currentVideoPoster.value = video.poster || ''
  currentHistoryIndex.value = index

  nextTick(() => autoPlay(videoElement.value))
}

const toggleHistory = () => {
  showHistory.value = !showHistory.value
}

const clearHistory = () => {
  history.value = []
  currentHistoryIndex.value = -1
  if (currentVideo.value) {
    addToHistory({ url: currentVideo.value, poster: currentVideoPoster.value })
  }
}

const downloadVideo = async () => {
  if (!currentVideo.value) return
  
  try {
    const response = await fetch(currentVideo.value)
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `beauty-video-${Date.now()}.mp4`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
  } catch (error) {
    console.error('下载失败:', error)
  }
}

// 全屏功能
const enterFullscreen = () => {
  isFullscreen.value = true
  // 阻止页面滚动
  document.body.style.overflow = 'hidden'
  nextTick(() => autoPlay(fullscreenVideoElement.value))
}

const exitFullscreen = () => {
  isFullscreen.value = false
  // 恢复页面滚动
  document.body.style.overflow = 'auto'
}

// 视频事件处理
const onVideoLoadStart = () => {
  console.log('视频开始加载')
}

const onVideoCanPlay = () => {
  console.log('视频可以播放')
}

const onVideoError = () => {
  console.error('视频播放失败')
}

// 键盘事件处理
const handleKeydown = (event: KeyboardEvent) => {
  if (isFullscreen.value) {
    switch (event.key) {
      case 'Escape':
        exitFullscreen()
        break
      case 'ArrowLeft':
        if (canGoPrevious.value) previousVideo()
        break
      case 'ArrowRight':
        if (!loading.value) nextVideo()
        break
    }
  }
}

// 生命周期
onMounted(() => {
  loadNewVideo()
  document.addEventListener('keydown', handleKeydown)
})

// 清理事件监听
onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  // 确保退出时恢复页面滚动
  document.body.style.overflow = 'auto'
})
</script>

<style scoped>
.video-viewer {
  width: 100%;
  height: 100%;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  display: flex;
  flex-direction: column;
}

/* 主要内容区域 */
.main-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 8px;
}

/* 视频显示区域 */
.video-display {
  position: relative;
  background: #000;
  border-radius: 12px;
  overflow: hidden;
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  color: #666;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #f3f3f3;
  border-top: 3px solid #007bff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.video-container {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.main-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  cursor: pointer;
}

.nav-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 50px;
  height: 50px;
  border: none;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  font-size: 20px;
  font-weight: bold;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.3s ease;
  z-index: 10;
}

.nav-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.9);
  transform: translateY(-50%) scale(1.1);
}

.nav-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.prev-btn {
  left: 20px;
}

.next-btn {
  right: 20px;
}

.fullscreen-btn {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 50px;
  height: 50px;
  border: none;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  font-size: 20px;
  font-weight: bold;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.3s ease;
  z-index: 10;
}

.fullscreen-btn:hover {
  background: rgba(0, 0, 0, 0.9);
  transform: scale(1.1);
}

.empty-state {
  text-align: center;
  color: #666;
}

.load-btn {
  margin-top: 20px;
  padding: 12px 24px;
  background: #007bff;
  color: white;
  border: none;
  border-radius: 25px;
  cursor: pointer;
  font-size: 16px;
  transition: background 0.3s ease;
}

.load-btn:hover {
  background: #0056b3;
}

/* 控制面板 */
.controls {
  display: flex;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
  flex-shrink: 0;
  padding: 4px 0;
}

.control-btn {
  padding: 8px 18px;
  border: none;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
  min-width: 90px;
}

.control-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.control-btn.primary {
  background: #007bff;
  color: white;
}

.control-btn.primary:hover:not(:disabled) {
  background: #0056b3;
  transform: translateY(-2px);
}

.control-btn.secondary {
  background: #6c757d;
  color: white;
}

.control-btn.secondary:hover:not(:disabled) {
  background: #545b62;
  transform: translateY(-2px);
}

/* 历史记录面板 */
.history-panel {
  background: #f8f9fa;
  border-radius: 20px;
  padding: 30px;
  margin-top: 20px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.history-header h3 {
  margin: 0;
  color: #333;
  font-size: 20px;
  font-weight: 500;
}

.clear-btn {
  padding: 8px 16px;
  background: #dc3545;
  color: white;
  border: none;
  border-radius: 15px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.3s ease;
}

.clear-btn:hover {
  background: #c82333;
  transform: translateY(-2px);
}

.history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 15px;
  max-height: 400px;
  overflow-y: auto;
  padding: 10px 0;
}

.history-item {
  position: relative;
  aspect-ratio: 16/9;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.3s ease;
  border: 3px solid transparent;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.history-item:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.history-item.active {
  border-color: #007bff;
  box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.3);
  transform: scale(1.02);
}

.history-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.history-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(45deg, rgba(0, 0, 0, 0.3), rgba(0, 0, 0, 0.7));
  color: white;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.history-item:hover .history-overlay {
  opacity: 1;
}

.play-icon {
  font-size: 24px;
  margin-bottom: 8px;
}

.history-overlay span {
  font-size: 12px;
  font-weight: bold;
}

.empty-history {
  text-align: center;
  color: #666;
  padding: 60px 20px;
}

.empty-history .empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.empty-history p {
  margin: 8px 0;
  font-size: 16px;
}

.empty-history .empty-tip {
  font-size: 14px;
  color: #999;
}

/* 历史面板动画 */
.history-slide-enter-active,
.history-slide-leave-active {
  transition: all 0.3s ease;
}

.history-slide-enter-from {
  opacity: 0;
  transform: translateY(-20px);
}

.history-slide-leave-to {
  opacity: 0;
  transform: translateY(-20px);
}

/* 全屏模式样式 */
.fullscreen-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.95);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
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

.fullscreen-video {
  max-width: 95vw;
  max-height: 95vh;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 0 50px rgba(0, 0, 0, 0.5);
}

.fullscreen-nav-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 60px;
  height: 60px;
  border: none;
  background: rgba(255, 255, 255, 0.9);
  color: #333;
  font-size: 24px;
  font-weight: bold;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.3s ease;
  z-index: 10;
  backdrop-filter: blur(10px);
}

.fullscreen-nav-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 1);
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
  width: 50px;
  height: 50px;
  border: none;
  background: rgba(255, 255, 255, 0.9);
  color: #333;
  font-size: 20px;
  font-weight: bold;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.3s ease;
  z-index: 10;
  backdrop-filter: blur(10px);
}

.fullscreen-exit-btn:hover {
  background: rgba(255, 255, 255, 1);
  transform: scale(1.1);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.fullscreen-info {
  position: absolute;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 20px;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 12px 24px;
  border-radius: 25px;
  backdrop-filter: blur(10px);
  font-size: 14px;
  font-weight: 500;
}

.video-counter {
  color: #fff;
}

.video-category {
  color: #ccc;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .nav-btn {
    width: 40px;
    height: 40px;
    font-size: 16px;
  }

  .prev-btn {
    left: 10px;
  }

  .next-btn {
    right: 10px;
  }

  .controls {
    flex-direction: column;
    align-items: center;
  }

  .control-btn {
    width: 100%;
    max-width: 300px;
  }

  .history-grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
  }

  .fullscreen-nav-btn {
    width: 50px;
    height: 50px;
    font-size: 20px;
  }

  .fullscreen-prev-btn {
    left: 20px;
  }

  .fullscreen-next-btn {
    right: 20px;
  }

  .fullscreen-exit-btn {
    top: 20px;
    right: 20px;
    width: 45px;
    height: 45px;
    font-size: 18px;
  }

  .fullscreen-info {
    bottom: 20px;
    padding: 10px 20px;
    font-size: 13px;
  }
}

@media (max-width: 480px) {
  .history-panel {
    padding: 20px;
  }

  .history-grid {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  }

  .fullscreen-nav-btn {
    width: 45px;
    height: 45px;
    font-size: 18px;
  }

  .fullscreen-prev-btn {
    left: 15px;
  }

  .fullscreen-next-btn {
    right: 15px;
  }

  .fullscreen-exit-btn {
    top: 15px;
    right: 15px;
    width: 40px;
    height: 40px;
    font-size: 16px;
  }

  .fullscreen-info {
    bottom: 15px;
    padding: 8px 16px;
    font-size: 12px;
    gap: 15px;
  }
}
</style>
<template>
  <div class="video-to-gif">
    <!-- 顶部：上传/预览区域 -->
    <div class="preview-section">
      <div class="preview-container">
        <!-- 上传区域 -->
        <div v-if="!videoFile" class="upload-area">
          <el-upload
            class="upload-video"
            drag
            :auto-upload="false"
            :show-file-list="false"
            accept="video/*"
            :on-change="handleVideoChange"
          >
            <el-icon class="el-icon--upload"><Upload /></el-icon>
            <div class="el-upload__text">
              将视频拖到此处，或<em>点击上传</em>
            </div>
            <template #tip>
              <div class="el-upload__tip">
                支持的视频格式：MP4, WebM等
              </div>
            </template>
          </el-upload>
        </div>

        <!-- 视频预览区域 -->
        <div v-else class="video-container">
          <div class="video-wrapper">
            <video 
              ref="videoRef"
              :src="videoUrl" 
              controls
              class="video-preview"
              @loadedmetadata="handleVideoLoad"
              @timeupdate="handleTimeUpdate"
            ></video>
            <!-- 文字预览层 -->
            <div 
              v-if="textOverlay.text" 
              class="text-overlay"
              :style="{
                top: `${textOverlay.y}%`,
                left: `${textOverlay.x}%`,
                color: textOverlay.color,
                fontSize: `${textOverlay.size}px`,
                fontFamily: textOverlay.font
              }"
            >
              {{ textOverlay.text }}
            </div>
          </div>
          <canvas ref="canvasRef" style="display: none;"></canvas>
        </div>

        <!-- 操作按钮区域 -->
        <div v-if="videoFile" class="action-buttons">
          <el-button 
            @click="resetVideo" 
            type="info"
            size="large"
            plain
          >
            重新上传
          </el-button>
          <el-button 
            type="success" 
            @click="convertToGif" 
            :loading="converting" 
            size="large"
          >
            转换为GIF
          </el-button>
        </div>
      </div>
    </div>

    <!-- 底部：设置区域 -->
    <div class="settings-section">
      <el-card>
        <div class="settings-content">
          <!-- 进度条 -->
          <div v-if="converting" class="progress-bar">
            <el-progress 
              :percentage="Math.floor(convertProgress * 100)"
              format="正在转换: %"
              status="warning"
            />
            <div class="progress-text">
              {{ Math.floor(convertProgress * 100) }}% 完成
            </div>
          </div>

          <!-- GIF预览区域 -->
          <div v-if="previewUrl" class="gif-preview">
            <div class="preview-image">
              <img :src="previewUrl" alt="GIF预览" />
            </div>
            <div class="preview-actions">
              <el-button
                type="success"
                size="large"
                plain
                @click="saveToEmoticons"
              >
                保存到表情库
              </el-button>
              <el-button
                type="primary"
                size="large"
                plain
                @click="copyGifToClipboard"
              >
                复制GIF
              </el-button>
            </div>
          </div>

          <el-tabs v-model="activeTab">
            <!-- 视频裁剪标签页 -->
            <el-tab-pane label="视频裁剪" name="trim">
              <div class="setting-group">
                <div class="trim-controls">
                  <span>开始时间: {{ formatTime(trimStart) }}</span>
                  <el-slider 
                    v-model="trimStart" 
                    :min="0" 
                    :max="videoDuration"
                    :step="0.1"
                    @input="handleTrimChange"
                  />
                  <span>结束时间: {{ formatTime(trimEnd) }}</span>
                  <el-slider 
                    v-model="trimEnd" 
                    :min="0" 
                    :max="videoDuration"
                    :step="0.1"
                    @input="handleTrimChange"
                  />
                </div>
              </div>
            </el-tab-pane>

            <!-- GIF输出设置标签页 -->
            <el-tab-pane label="GIF设置" name="output">
              <div class="setting-group">
                <el-form>
                  <el-form-item label="帧率">
                    <div class="setting-row">
                      <el-slider v-model="fps" :min="1" :max="30" :step="1" class="setting-control" />
                      <div class="setting-tip">帧率越高，动画越流畅，文件越大</div>
                    </div>
                  </el-form-item>
                  
                  <el-form-item label="尺寸">
                    <div class="setting-row">
                      <el-select v-model="size" placeholder="选择输出尺寸" class="setting-control">
                        <el-option label="原始尺寸" value="original" />
                        <el-option label="480p" value="480" />
                        <el-option label="360p" value="360" />
                        <el-option label="240p" value="240" />
                      </el-select>
                      <div class="setting-tip">尺寸越小，文件越小</div>
                    </div>
                  </el-form-item>

                  <el-form-item label="循环播放">
                    <el-switch v-model="loop" />
                  </el-form-item>
                </el-form>
              </div>
            </el-tab-pane>

            <!-- 文字设置标签页 -->
            <el-tab-pane label="添加文字" name="text">
              <div class="setting-group">
                <el-form>
                  <el-form-item label="文字内容">
                    <el-input 
                      v-model="textOverlay.text" 
                      placeholder="请输入要添加的文字"
                    />
                  </el-form-item>

                  <el-form-item label="文字位置">
                    <div class="position-controls">
                      <div class="setting-row">
                        <div class="position-label">水平位置: {{ textOverlay.x }}%</div>
                        <el-slider 
                          v-model="textOverlay.x" 
                          :min="0" 
                          :max="100" 
                          :step="1"
                          :show-tooltip="false"
                          class="setting-control"
                        />
                      </div>
                      <div class="setting-row">
                        <div class="position-label">垂直位置: {{ textOverlay.y }}%</div>
                        <el-slider 
                          v-model="textOverlay.y" 
                          :min="0" 
                          :max="100" 
                          :step="1"
                          :show-tooltip="false"
                          class="setting-control"
                        />
                      </div>
                    </div>
                  </el-form-item>

                  <el-form-item label="文字样式">
                    <div class="text-style-controls">
                      <div class="setting-row">
                        <div class="position-label">字体大小: {{ textOverlay.size }}px</div>
                        <el-slider 
                          v-model="textOverlay.size" 
                          :min="24" 
                          :max="200" 
                          :step="2"
                          :show-tooltip="false"
                          class="setting-control"
                        />
                      </div>
                      <div class="style-controls">
                        <el-color-picker v-model="textOverlay.color" show-alpha />
                        <el-select v-model="textOverlay.font" placeholder="选择字体" size="default">
                          <el-option label="默认" value="Arial" />
                          <el-option label="黑体" value="SimHei" />
                          <el-option label="宋体" value="SimSun" />
                          <el-option label="微软雅黑" value="Microsoft YaHei" />
                        </el-select>
                      </div>
                    </div>
                  </el-form-item>
                </el-form>
              </div>
            </el-tab-pane>
          </el-tabs>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { 
  Upload, 
  RefreshLeft, 
  VideoPlay, 
  FolderAdd, 
  CopyDocument,
  Loading 
} from '@element-plus/icons-vue'
import gifshot from 'gifshot'
import { useEmoticonStore } from '@/store/emoticon'
import { nanoid } from 'nanoid'

// 添加 interface 定义
interface VideoFrame {
  width: number
  height: number
  dataUrl: string
}

// 状态变量
const videoFile = ref<File | null>(null)
const videoUrl = ref('')
const videoRef = ref<HTMLVideoElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const fps = ref(5)
const size = ref('240')
const converting = ref(false)
const convertProgress = ref(0)
const loop = ref(true)

// 视频相关状态
const videoDuration = ref(0)
const trimStart = ref(0)
const trimEnd = ref(0)
const currentTime = ref(0)

// 标签页状态
const activeTab = ref('trim')

// 文字叠加层状态
const textOverlay = ref({
  text: '',
  x: 50,
  y: 50,
  color: '#ffffff',
  size: 50,
  font: 'Arial'
})

// 添加预览URL状态
const previewUrl = ref('')
const previewBlob = ref<Blob | null>(null)

// 处理视频文件选择
const handleVideoChange = (uploadFile: { raw: File }) => {
  if (uploadFile && uploadFile.raw) {
    const file = uploadFile.raw
    // 检查文件类型
    if (!file.type.startsWith('video/')) {
      ElMessage.error('请上传视频文件')
      return
    }
    // 检查文件大小（限制为100MB）
    if (file.size > 100 * 1024 * 1024) {
      ElMessage.error('视频文件大小不能超过100MB')
      return
    }
    
    videoFile.value = file
    videoUrl.value = URL.createObjectURL(file)
    // 重置裁剪时间
    trimStart.value = 0
    trimEnd.value = 0
  }
}

// 处理视频加载完成
const handleVideoLoad = () => {
  if (videoRef.value) {
    videoDuration.value = videoRef.value.duration
    trimEnd.value = videoDuration.value
  }
}

// 处理视频时间更新
const handleTimeUpdate = () => {
  if (videoRef.value) {
    currentTime.value = videoRef.value.currentTime
  }
}

// 处理裁剪时间变化
const handleTrimChange = () => {
  if (videoRef.value) {
    // 确保开始时间小于结束时间
    if (trimStart.value >= trimEnd.value) {
      trimStart.value = trimEnd.value - 0.1
    }
    // 设置视频当前时间为开始时间
    videoRef.value.currentTime = trimStart.value
  }
}

// 格式化时间显示
const formatTime = (time: number) => {
  const minutes = Math.floor(time / 60)
  const seconds = Math.floor(time % 60)
  const milliseconds = Math.floor((time % 1) * 10)
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds}`
}

// 获取视频帧
const captureVideoFrame = (): VideoFrame | null => {
  if (!videoRef.value || !canvasRef.value) return null

  const video = videoRef.value
  const canvas = canvasRef.value
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // 设置canvas尺寸
  let width = video.videoWidth
  let height = video.videoHeight
  
  // 计算缩放比例
  let scale = 1
  if (size.value !== 'original') {
    const targetWidth = parseInt(size.value)
    scale = targetWidth / width
    width = targetWidth
    height = Math.floor(height * scale)
  }

  canvas.width = width
  canvas.height = height
  
  // 绘制当前帧
  ctx.drawImage(video, 0, 0, width, height)

  // 如果有文字，添加文字叠加
  if (textOverlay.value.text) {
    // 计算基于原始视频尺寸的缩放比例
    const originalScale = video.videoWidth / width
    
    // 根据原始视频尺寸计算字体大小，确保与预览时一致
    const scaledFontSize = Math.round(textOverlay.value.size / originalScale)
    
    ctx.font = `${scaledFontSize}px ${textOverlay.value.font}`
    ctx.fillStyle = textOverlay.value.color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    
    const x = (width * textOverlay.value.x) / 100
    const y = (height * textOverlay.value.y) / 100
    
    // 调整描边宽度，使其与字体大小成比例
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = Math.max(1, Math.round(scaledFontSize / 16))
    ctx.strokeText(textOverlay.value.text, x, y)
    ctx.fillText(textOverlay.value.text, x, y)
  }

  return {
    width,
    height,
    dataUrl: canvas.toDataURL('image/png')
  }
}

// 转换为GIF
const convertToGif = async () => {
  if (!videoFile.value || !videoRef.value) {
    ElMessage.warning('请先选择视频文件')
    return
  }

  converting.value = true
  convertProgress.value = 0
  const video = videoRef.value

  try {
    // 计算需要的帧数
    const duration = trimEnd.value - trimStart.value
    const frameCount = Math.floor(duration * fps.value)
    const frameInterval = duration / frameCount

    // 收集帧
    const frames: VideoFrame[] = []
    video.currentTime = trimStart.value

    for (let i = 0; i < frameCount; i++) {
      // 等待视频定位到指定时间
      await new Promise<void>((resolve) => {
        const timeupdate = () => {
          video.removeEventListener('timeupdate', timeupdate)
          resolve()
        }
        video.addEventListener('timeupdate', timeupdate)
      })

      // 捕获当前帧
      const frame = captureVideoFrame()
      if (frame) {
        frames.push(frame)
      }

      // 更新进度
      convertProgress.value = (i + 1) / frameCount
      
      // 移动到下一帧
      video.currentTime = trimStart.value + (i + 1) * frameInterval
    }

    // 使用gifshot生成GIF
    await new Promise<void>((resolve, reject) => {
      gifshot.createGIF({
        images: frames.map(f => f.dataUrl),
        gifWidth: frames[0]?.width,
        gifHeight: frames[0]?.height,
        interval: 1 / fps.value,
        numFrames: frames.length,
        loop: loop.value ? 0 : 1,
        progressCallback: (progress: number) => {
          convertProgress.value = 0.9 + progress * 0.1
        }
      }, async (obj) => {
        if (obj.error) {
          reject(obj.error)
          return
        }

        try {
          // 将 base64 转换为 Blob
          const response = await fetch(obj.image)
          const blob = await response.blob()
          
          // 保存 Blob 和预览 URL
          previewBlob.value = blob
          if (previewUrl.value) {
            URL.revokeObjectURL(previewUrl.value)
          }
          previewUrl.value = URL.createObjectURL(blob)

          ElMessage.success('转换完成！')
          resolve()
        } catch (error) {
          reject(error)
        }
      })
    })
  } catch (error) {
    console.error('转换失败:', error)
    ElMessage.error('转换失败，请重试')
  } finally {
    converting.value = false
    convertProgress.value = 0
    // 恢复视频播放位置
    video.currentTime = trimStart.value
  }
}

// 保存到表情库
const saveToEmoticons = async () => {
  if (!previewBlob.value) {
    ElMessage.warning('请先转换视频')
    return
  }

  try {
    // 创建表情包对象
    const emoticon = {
      id: nanoid(),
      name: videoFile.value!.name.replace(/\.[^/.]+$/, ''),
      url: '',
      type: 'image/gif',
      favorite: false,
      createdAt: Date.now(),
      createTime: Date.now(),
      updateTime: Date.now(),
      tags: []
    }

    // 保存到表情库
    const store = useEmoticonStore()
    await store.addEmoticon(emoticon, previewBlob.value)

    ElMessage.success({
      message: '保存成功！请在"本地表情"中查看',
      duration: 2000
    })
  } catch (error) {
    console.error('保存失败:', error)
    ElMessage.error('保存失败，请重试')
  }
}

// 重置视频
const resetVideo = () => {
  if (videoUrl.value) {
    URL.revokeObjectURL(videoUrl.value)
  }
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
  }
  videoFile.value = null
  videoUrl.value = ''
  previewUrl.value = ''
  previewBlob.value = null
  trimStart.value = 0
  trimEnd.value = 0
  convertProgress.value = 0
}

// 复制GIF到剪贴板
const copyGifToClipboard = async () => {
  if (!previewBlob.value) {
    ElMessage.warning('没有可复制的GIF')
    return
  }

  const loadingMessage = ElMessage({
    type: 'info',
    message: '正在复制...',
    duration: 0
  })

  try {
    // 1. 创建临时文件
    const tempFileName = `temp_${Date.now()}.gif`
    const tempPath = window.preload.utils.getTempPath(tempFileName)
    
    // 2. 将blob转换为buffer并写入临时文件
    const arrayBuffer = await previewBlob.value.arrayBuffer()
    const buffer = new Uint8Array(arrayBuffer)
    await window.preload.fs.writeFile(tempPath, buffer)

    // 3. 打开文件所在文件夹
    window.ztools.shellShowItemInFolder(tempPath)
    
    loadingMessage.close()
    ElMessage({
      message: 'GIF文件已打开，请手动复制使用',
      type: 'warning',
      duration: 5000,
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
  } catch (error) {
    console.error('复制失败:', error)
    loadingMessage.close()
    ElMessage.error('复制失败，请重试')
  }
}

// 清理工作
onUnmounted(() => {
  if (videoUrl.value) {
    URL.revokeObjectURL(videoUrl.value)
  }
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
  }
})
</script>

<style lang="scss" scoped>
.video-to-gif {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--el-fill-color-blank);
  overflow: hidden;

  .preview-section {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--el-bg-color);
    box-shadow: var(--el-box-shadow-light);
    padding: 16px;
    max-height: 50vh;
    min-height: 240px;

    .preview-container {
      height: 100%;
      display: flex;
      gap: 16px;
      
      .upload-area,
      .video-container {
        flex: 1;
        height: 100%;
        min-width: 0; // 防止内容溢出
      }
      
      .upload-area {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: var(--el-fill-color-lighter);
        border-radius: 8px;
        transition: all 0.3s ease;
        
        &:hover {
          background: var(--el-fill-color-light);
        }
        
        .upload-video {
          width: 100%;
          max-width: 500px;
        }

        :deep(.el-upload-dragger) {
          padding: 20px;
          height: auto;
        }

        :deep(.el-icon--upload) {
          margin: 8px 0;
        }

        :deep(.el-upload__tip) {
          margin-top: 8px;
        }
      }

      .video-container {
        display: flex;
        flex-direction: column;
        
        .video-wrapper {
          position: relative;
          width: 100%;
          height: 100%;
          min-height: 200px;
          background: var(--el-fill-color-darker);
          border-radius: 8px;
          overflow: hidden;
          
          .video-preview {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            object-fit: contain;
          }
          
          .text-overlay {
            position: absolute;
            transform: translate(-50%, -50%);
            text-shadow: 2px 2px 2px rgba(0, 0, 0, 0.5);
            pointer-events: none;
            white-space: nowrap;
          }
        }
      }

      .action-buttons {
        display: flex;
        flex-direction: column;
        gap: 12px;
        justify-content: center;
        align-items: center;
        min-width: 130px;
        padding: 0 16px;
        height: 100%;
        align-self: stretch;

        :deep(.el-button) {
          width: 130px;
          height: 40px;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 500;
          letter-spacing: 1px;
          transition: all 0.3s ease;
          margin: 0;

          &:hover {
            transform: translateY(-1px);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          }

          &.el-button--success {
            background: linear-gradient(45deg, var(--el-color-success), var(--el-color-success-light-3));
            border: none;
            color: white;
            
            &:hover {
              background: linear-gradient(45deg, var(--el-color-success-dark-2), var(--el-color-success));
              transform: translateY(-1px);
              box-shadow: 0 2px 12px rgba(var(--el-color-success-rgb), 0.4);
            }

            &.is-plain {
              background: transparent;
              border: 1px solid var(--el-color-success);
              color: var(--el-color-success);

              &:hover {
                background: var(--el-color-success);
                color: white;
              }
            }
          }

          &.el-button--info {
            background: linear-gradient(45deg, var(--el-color-info), var(--el-color-info-light-3));
            border: none;
            color: white;
            
            &:hover {
              background: linear-gradient(45deg, var(--el-color-info-dark-2), var(--el-color-info));
              transform: translateY(-1px);
              box-shadow: 0 2px 12px rgba(var(--el-color-info-rgb), 0.4);
            }

            &.is-plain {
              background: transparent;
              border: 1px solid var(--el-color-info);
              color: var(--el-color-info);

              &:hover {
                background: var(--el-color-info);
                color: white;
              }
            }
          }
        }
      }
    }
  }

  .settings-section {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    min-height: 0;

    :deep(.el-card) {
      margin-bottom: 16px;
      
      .el-card__header {
        display: none;
      }

      .el-card__body {
        padding: 0;
      }
    }

    .settings-content {
      padding: 8px 16px;

      .progress-bar {
        margin-bottom: 16px;
        padding: 12px;
        background: var(--el-fill-color-lighter);
        border-radius: 8px;
      }

      .gif-preview {
        margin: 12px 0;
        padding: 12px;
        background: var(--el-fill-color-lighter);
        border-radius: 8px;
        display: flex;
        align-items: center;
        gap: 16px;
        max-width: 500px;
        margin-left: auto;
        margin-right: auto;
        
        .preview-image {
          flex: 1;
          text-align: center;
          max-width: 320px;
          
          img {
            max-width: 100%;
            max-height: 180px;
            object-fit: contain;
            border-radius: 4px;
          }
        }

        .preview-actions {
          padding: 0;
        }
      }

      :deep(.el-tabs) {
        .el-tabs__header {
          margin-bottom: 12px;
        }

        .el-tabs__nav-wrap {
          padding: 0;
        }
      }

      .setting-group {
        background: var(--el-fill-color-blank);
        padding: 12px;
        border-radius: 8px;
        margin-bottom: 12px;

        h3 {
          margin: 0 0 12px;
          font-size: 14px;
          font-weight: 600;
          color: var(--el-text-color-primary);
        }

        .trim-controls {
          display: flex;
          flex-direction: column;
          gap: 8px;

          span {
            font-size: 13px;
            color: var(--el-text-color-secondary);
          }
        }

        .setting-row {
          display: flex;
          align-items: center;
          gap: 16px;
          width: 100%;

          .setting-control {
            flex: 1;
            min-width: 0; // 防止溢出
          }

          .setting-tip {
            flex: none;
            width: 180px;
            margin: 0;
            padding-left: 8px;
            border-left: 2px solid var(--el-border-color);
            font-size: 12px;
            color: var(--el-text-color-secondary);
            line-height: 1.4;
          }
        }

        .position-controls {
          display: flex;
          flex-direction: column;
          gap: 12px;
          width: 100%;

          .setting-row {
            display: flex;
            align-items: center;
            gap: 16px;
            width: 100%;

            .position-label {
              flex: none;
              width: 120px;
              font-size: 13px;
              color: var(--el-text-color-secondary);
              text-align: right;
            }

            .setting-control {
              flex: 1;
              min-width: 0;
            }
          }
        }

        .text-style-controls {
          display: flex;
          flex-direction: column;
          gap: 16px;
          width: 100%;

          .setting-row {
            display: flex;
            align-items: center;
            gap: 16px;
            width: 100%;

            .position-label {
              flex: none;
              width: 120px;
              font-size: 13px;
              color: var(--el-text-color-secondary);
              text-align: right;
            }

            .setting-control {
              flex: 1;
              min-width: 0;
            }
          }

          .style-controls {
            display: flex;
            gap: 12px;
            align-items: center;

            .el-color-picker {
              margin-right: 8px;
            }

            .el-select {
              width: 140px;
            }
          }
        }
      }
    }
  }
}

// 响应式布局优化
@media screen and (min-width: 1200px) {
  .video-to-gif {
    .preview-section {
      max-height: 45vh;
    }
  }
}

@media screen and (max-width: 768px) {
  .video-to-gif {
    .preview-section {
      max-height: none;
      padding: 12px;
      
      .preview-container {
        flex-direction: column;
        
        .action-buttons {
          flex-direction: row;
          flex-wrap: wrap;
          justify-content: center;
          gap: 8px;
          
          :deep(.el-button) {
            width: 130px;
            min-width: 130px;
            white-space: nowrap;
          }
        }
      }
    }
    
    .settings-section {
      padding: 12px;
      
      :deep(.el-card) {
        .settings-header {
          flex-direction: column;
          align-items: stretch;
          
          .el-button {
            width: 100%;
          }
        }
      }

      .settings-content {
        padding: 12px;
        
        .el-row {
          margin: 0 !important;
        }

        .el-col {
          padding: 0 !important;
          margin-bottom: 12px;
        }

        .gif-preview {
          flex-direction: column;
          
          .preview-image {
            max-width: 100%;
          }

          .preview-actions {
            flex-direction: row;
            justify-content: center;
            width: 100%;
            padding: 0;
            gap: 8px;
          }
        }
      }
    }
  }
}
</style> 
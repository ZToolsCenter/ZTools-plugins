<template>
  <div class="ai-emoticon-generator">
    <div class="hero-section">
      <h1 class="title">AI表情生成器</h1>
      <p class="subtitle">输入描述，让AI为你生成独一无二的表情包</p>
      
      <div class="input-section">
        <el-input
          v-model="prompt"
          placeholder="描述你想要的表情包，例如：'开心的猫咪'"
          :disabled="loading"
          @keyup.enter="generateEmoticon"
          class="prompt-input"
        >
          <template #prefix>
            <el-icon><Mic /></el-icon>
          </template>
        </el-input>
        
        <el-button
          type="primary"
          :loading="loading"
          @click="generateEmoticon"
          class="generate-btn"
        >
          <el-icon><MagicStick /></el-icon>
          {{ loading ? '生成中...' : '生成表情' }}
        </el-button>
      </div>
    </div>

    <div class="content-section">
      <transition-group 
        name="fade-slide"
        tag="div"
        class="result-container"
        v-if="generatedEmoticons.length > 0"
      >
        <div class="section-header" key="header">
          <h2>生成结果</h2>
          <span class="result-count">{{ generatedEmoticons.length }} 个表情</span>
        </div>
        
        <div class="emoticon-grid" key="grid">
          <div
            v-for="(emoticon, index) in generatedEmoticons"
            :key="index"
            class="emoticon-card"
            :style="{ animationDelay: `${index * 0.1}s` }"
          >
            <div class="emoticon-preview">
              <img :src="emoticon.url" alt="AI生成表情" />
              <div class="hover-overlay">
                <div class="action-buttons">
                  <el-tooltip content="复制" placement="top">
                    <el-button
                      type="primary"
                      circle
                      @click="copyEmoticon(emoticon)"
                      :icon="CopyDocument"
                    />
                  </el-tooltip>
                  <el-tooltip content="收藏" placement="top">
                    <el-button
                      type="success"
                      circle
                      @click="saveEmoticon(emoticon)"
                      :icon="Star"
                    />
                  </el-tooltip>
                  <el-tooltip content="下载" placement="top">
                    <el-button
                      type="warning"
                      circle
                      @click="downloadEmoticon(emoticon)"
                      :icon="Download"
                    />
                  </el-tooltip>
                </div>
              </div>
            </div>
            <div class="emoticon-info">
              <span class="prompt-text">{{ emoticon.prompt }}</span>
            </div>
          </div>
        </div>
      </transition-group>

      <div class="loading-state" v-if="loading">
        <div class="loading-cards">
          <div class="skeleton-card" v-for="n in 4" :key="n">
            <el-skeleton animated>
              <template #template>
                <div class="skeleton-content">
                  <el-skeleton-item variant="image" style="width: 100%; height: 200px"/>
                  <el-skeleton-item variant="p" style="width: 60%"/>
                </div>
              </template>
            </el-skeleton>
          </div>
        </div>
        <div class="loading-text">
          <el-icon class="rotating"><Loading /></el-icon>
          <span>AI正在发挥创意...</span>
          <p class="loading-note">预计需要10-30秒完成创作</p>
        </div>
      </div>

      <div class="empty-state" v-if="!loading && generatedEmoticons.length === 0">
        <el-empty>
          <template #description>
            <div class="empty-text">
              <p>开始创作你的专属表情包</p>
              <p class="sub-text">输入描述，让AI为你生成独特的表情</p>
            </div>
          </template>
        </el-empty>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { 
  Plus, 
  CopyDocument, 
  Mic,
  Warning,
  Check,
  Loading,
  MagicStick,
  Star,
  Download
} from '@element-plus/icons-vue'
import { useEmoticonStore } from '@/store/emoticon'
import axios from 'axios'
import { generateEmoticonWithAI } from '@/api/aiGenerator'

// 定义生成的表情包类型
interface GeneratedEmoticon {
  url: string
  prompt: string
}

const store = useEmoticonStore()
const prompt = ref('')
const loading = ref(false)
const generatedEmoticons = ref<GeneratedEmoticon[]>([])

// 生成表情包
const generateEmoticon = async () => {
  if (!prompt.value.trim()) {
    ElMessage.warning('请输入表情包描述')
    return
  }

  loading.value = true
  generatedEmoticons.value = []

  try {
    // 并行调用4次API
    const promises = Array(4).fill(null).map(() => generateEmoticonWithAI(prompt.value))
    const results = await Promise.all(promises)
    
    // 合并所有结果
    const allImageUrls = results.flat()
    
    if (allImageUrls.length > 0) {
      generatedEmoticons.value = allImageUrls.map(url => ({
        url,
        prompt: prompt.value
      }))
      ElMessage.success(`成功生成 ${allImageUrls.length} 个表情包`)
    } else {
      ElMessage({
        type: 'warning',
        message: '未能生成表情包，请尝试更详细的描述或不同的内容',
        duration: 5000
      })
    }
  } catch (error) {
    console.error('AI生成表情失败:', error)
    ElMessage.error(
      error instanceof Error && error.message.includes('未配置')
        ? error.message
        : '生成失败，请检查网络连接或稍后重试'
    )
  } finally {
    loading.value = false
  }
}

// 保存表情包到本地
const saveEmoticon = async (emoticon: GeneratedEmoticon) => {
  try {
    const response = await axios.get(emoticon.url, {
      responseType: 'blob'
    })
    
    const blob = response.data
    const fileName = `AI_${emoticon.prompt.substring(0, 10)}_${Date.now()}.png`
    const file = new File([blob], fileName, { type: 'image/png' })
    
    const emoticonObj = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      name: `AI: ${emoticon.prompt.substring(0, 20)}`,
      url: '',
      type: 'image/png',
      favorite: false,
      createdAt: Date.now(),
      createTime: Date.now(),
      updateTime: Date.now(),
      tags: ['AI生成', '自动']
    }
    
    await store.addEmoticon(emoticonObj, file)
    ElMessage.success('保存成功')
  } catch (error) {
    console.error('保存表情包失败:', error)
    ElMessage.error('保存失败，请重试')
  }
}

// 复制表情包到剪贴板
const copyEmoticon = async (emoticon: GeneratedEmoticon) => {
  try {
    const response = await axios.get(emoticon.url, {
      responseType: 'blob'
    })
    
    const blob = response.data
    
    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type]: blob
      })
    ])
    
    ElMessage.success('复制成功，可以直接粘贴使用')
  } catch (error) {
    console.error('复制表情包失败:', error)
    ElMessage.error('复制失败，请重试')
  }
}

// 添加下载函数
const downloadEmoticon = async (emoticon: GeneratedEmoticon) => {
  try {
    const response = await axios.get(emoticon.url, {
      responseType: 'blob'
    })
    
    const blob = response.data
    const fileName = `AI_${emoticon.prompt.substring(0, 10)}_${Date.now()}.png`
    
    // 创建下载链接
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(link.href)
    
    ElMessage.success('下载成功')
  } catch (error) {
    console.error('下载表情包失败:', error)
    ElMessage.error('下载失败，请重试')
  }
}
</script>

<style scoped lang="scss">
.ai-emoticon-generator {
  min-height: 100vh;
  background: linear-gradient(135deg, var(--el-bg-color) 0%, var(--el-bg-color-page) 100%);
  
  .hero-section {
    padding: 20px 24px;
    text-align: center;
    background: linear-gradient(180deg, rgba(var(--el-color-primary-rgb), 0.1) 0%, rgba(var(--el-color-primary-rgb), 0) 100%);
    
    .title {
      font-size: 24px;
      font-weight: 600;
      background: linear-gradient(120deg, var(--el-color-primary) 0%, var(--el-color-success) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin: 0 0 8px;
    }
    
    .subtitle {
      font-size: 14px;
      color: var(--el-text-color-secondary);
      margin-bottom: 16px;
    }
    
    .input-section {
      max-width: 600px;
      margin: 0 auto;
      display: flex;
      gap: 8px;
      
      .prompt-input {
        :deep(.el-input__wrapper) {
          padding: 4px 12px;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          
          &.is-focus {
            box-shadow: 0 2px 8px rgba(var(--el-color-primary-rgb), 0.2);
          }
        }
        
        :deep(.el-input__inner) {
          font-size: 14px;
          height: 32px;
        }
      }
      
      .generate-btn {
        padding: 0 16px;
        height: 40px;
        border-radius: 8px;
        font-size: 14px;
      }
    }
  }
  
  .content-section {
    max-width: 900px;
    margin: 0 auto;
    padding: 16px 24px;
    
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      
      h2 {
        font-size: 18px;
        margin: 0;
      }
      
      .result-count {
        color: var(--el-text-color-secondary);
        font-size: 12px;
      }
    }
    
    .emoticon-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
      max-height: 360px;
      overflow-y: auto;
      padding-right: 8px;
      
      &::-webkit-scrollbar {
        width: 6px;
      }
      
      &::-webkit-scrollbar-thumb {
        background-color: var(--el-border-color);
        border-radius: 3px;
      }
      
      &::-webkit-scrollbar-track {
        background-color: var(--el-fill-color-lighter);
        border-radius: 3px;
      }
    }
    
    .emoticon-card {
      background: var(--el-bg-color);
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      
      .emoticon-preview {
        position: relative;
        height: 140px;
        background: var(--el-fill-color-lighter);
        
        img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        
        .hover-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: opacity 0.2s;
          
          .action-buttons {
            display: flex;
            gap: 12px;
            
            .el-button {
              width: 32px;
              height: 32px;
              font-size: 16px;
              
              &:hover {
                transform: scale(1.1);
                transition: transform 0.2s;
              }
            }
          }
        }
      }
      
      .emoticon-info {
        padding: 8px 12px;
        
        .prompt-text {
          display: block;
          font-size: 12px;
          color: var(--el-text-color-regular);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }
      
      &:hover {
        .hover-overlay {
          opacity: 1;
        }
      }
    }
    
    .loading-state {
      text-align: center;
      padding: 12px 0;
      
      .loading-cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 12px;
        margin-bottom: 16px;
        max-height: 360px;
        overflow-y: hidden;
        
        .skeleton-card {
          .skeleton-content {
            .el-skeleton-item {
              &.el-skeleton-item--image {
                height: 140px !important;
              }
            }
          }
        }
      }
      
      .loading-text {
        color: var(--el-text-color-secondary);
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        
        .loading-note {
          font-size: 12px;
          margin-top: 4px;
          opacity: 0.8;
        }
      }
    }
    
    .empty-state {
      padding: 32px 0;
      
      .empty-text {
        p {
          margin: 0;
          font-size: 14px;
          
          &.sub-text {
            font-size: 12px;
            color: var(--el-text-color-secondary);
            margin-top: 4px;
          }
        }
      }
    }
  }
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.3s ease;
}

.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(20px);
}
</style> 
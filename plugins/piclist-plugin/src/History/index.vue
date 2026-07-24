<script lang="ts" setup>
import { ref, onMounted } from 'vue'
import Header from '../components/Header/index.vue'
import { ElButton, ElCard, ElMessage, ElEmpty } from 'element-plus'
import { Clock, CopyDocument, Picture, Delete, Link } from '@element-plus/icons-vue'

interface HistoryItem {
  id: string
  fileName: string
  url: string
  originalUrl: string
  timestamp: number
}

interface PicListConfig {
  copyFormat: 'markdown' | 'html' | 'url' | 'ubb' | 'custom'
  customFormat: string
}

const historyList = ref<HistoryItem[]>([])
const loading = ref(false)
const config = ref<PicListConfig>({
  copyFormat: 'markdown',
  customFormat: '![{filename}]({url})'
})

const extractUrl = (text: string): string => {
  if (!text) return ''
  
  const urlRegex = /https?:\/\/[^\s"'<>(){}[\]]+/gi
  const matches = text.match(urlRegex)
  
  if (matches && matches.length > 0) {
    return matches[0]
  }
  
  const markdownRegex = /!\[.*?\]\(([^)]+)\)/
  const mdMatch = text.match(markdownRegex)
  if (mdMatch) {
    return mdMatch[1]
  }
  
  const htmlRegex = /<img[^>]+src=["']([^"']+)["']/
  const htmlMatch = text.match(htmlRegex)
  if (htmlMatch) {
    return htmlMatch[1]
  }
  
  const ubbRegex = /\[img\]([^\[]+)\[\/img\]/
  const ubbMatch = text.match(ubbRegex)
  if (ubbMatch) {
    return ubbMatch[1]
  }
  
  return text.trim()
}

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - timestamp
  
  if (diff < 60000) {
    return '刚刚'
  } else if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}分钟前`
  } else if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}小时前`
  } else if (date.toDateString() === now.toDateString()) {
    return `今天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  } else {
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  }
}

const getFileNameWithoutExt = (fileName: string): string => {
  return fileName.replace(/\.[^/.]+$/, '')
}

const formatUrl = (url: string, fileName: string): string => {
  const pureUrl = extractUrl(url)
  const nameWithoutExt = getFileNameWithoutExt(fileName)
  
  switch (config.value.copyFormat) {
    case 'markdown':
      return `![${nameWithoutExt}](${pureUrl})`
    case 'html':
      return `<img src="${pureUrl}" alt="${nameWithoutExt}" />`
    case 'url':
      return pureUrl
    case 'ubb':
      return `[img]${pureUrl}[/img]`
    case 'custom':
      return config.value.customFormat
        .replace('{url}', pureUrl)
        .replace('{filename}', nameWithoutExt)
    default:
      return pureUrl
  }
}

const loadConfig = async () => {
  try {
    const savedConfig = await window.ztools.db.get('piclist_config')
    if (savedConfig) {
      const configStr = typeof savedConfig === 'string' ? savedConfig : savedConfig.data
      const saved = JSON.parse(configStr)
      config.value.copyFormat = saved.copyFormat || 'markdown'
      config.value.customFormat = saved.customFormat || '![{filename}]({url})'
    }
  } catch (error) {
    window.ztools.showNotification(`加载配置失败: ${error}`)
  }
}

const loadHistory = async () => {
  loading.value = true
  try {
    const saved = await window.ztools.db.get('piclist_history')
    if (saved) {
      const historyStr = typeof saved === 'string' ? saved : saved.data
      historyList.value = JSON.parse(historyStr) || []
    }
  } catch (error) {
    window.ztools.showNotification(`加载历史记录失败: ${error}`)
  } finally {
    loading.value = false
  }
}

const copyUrl = async (item: HistoryItem) => {
  const formattedUrl = formatUrl(item.url, item.fileName)
  try {
    await navigator.clipboard.writeText(formattedUrl)
    ElMessage.success('链接已复制')
  } catch (error) {
    ElMessage.error('复制失败')
  }
}

const clearHistory = async () => {
  try {
    await window.ztools.db.remove('piclist_history')
    await window.ztools.db.put({ _id: 'piclist_history', data: JSON.stringify([]) })
    historyList.value = []
    ElMessage.success('历史记录已清空')
  } catch (error) {
    ElMessage.error('清空失败')
    window.ztools.showNotification(`清空历史记录失败: ${error}`)
  }
}

const deleteItem = async (id: string) => {
  try {
    historyList.value = historyList.value.filter(item => item.id !== id)
    await window.ztools.db.remove('piclist_history')
    await window.ztools.db.put({ _id: 'piclist_history', data: JSON.stringify(historyList.value) })
    ElMessage.success('已删除')
  } catch (error) {
    ElMessage.error('删除失败')
    window.ztools.showNotification(`删除记录失败`)

  }
}

const openPreview = (url: string) => {
  window.open(extractUrl(url), '_blank')
}

onMounted(async () => {
  await loadConfig()
  await loadHistory()
})

defineEmits<{
  navigate: [view: 'home' | 'about' | 'settings' | 'history']
}>()
</script>

<template>
  <div class="history-page">
    <el-container>
      <Header current-view="history" @navigate="$emit('navigate', $event)" />

      <el-main>
        <div class="history-content">
          <!-- <div class="header-section">
            <div class="logo-wrapper">
              <div class="logo-icon">
                <Clock :size="48" />
              </div>
            </div>
            <h1 class="title">上传历史</h1>
            <p class="description">查看和管理已上传的图片记录</p>
          </div> -->

          <elCard class="history-card">
            <div class="card-header">
              <span class="history-count">共 {{ historyList.length }} 条记录</span>
              <ElButton 
                type="danger" 
                text
                :icon="Delete"
                :disabled="historyList.length === 0"
                @click="clearHistory"
              >
                清空历史
              </ElButton>
            </div>

            <div v-if="historyList.length === 0" class="empty-state">
              <ElEmpty description="暂无上传记录" />
            </div>

            <div v-else class="history-list">
              <div 
                v-for="item in historyList" 
                :key="item.id"
                class="history-item"
              >
                <div class="item-preview">
                  <img 
                    :src="extractUrl(item.url)" 
                    :alt="item.fileName"
                    class="preview-image"
                    loading="lazy"
                  />
                </div>
                <div class="item-info">
                  <p class="item-name">{{ item.fileName }}</p>
                  <p class="item-time">{{ formatTime(item.timestamp) }}</p>
                  <p class="item-url">{{ extractUrl(item.url).slice(0, 50) }}{{ extractUrl(item.url).length > 50 ? '...' : '' }}</p>
                </div>
                <div class="item-actions">
                  <ElButton 
                    type="text"
                    :icon="Link"
                    @click="openPreview(item.url)"
                  >
                    预览
                  </ElButton>
                  <ElButton 
                    type="text"
                    :icon="CopyDocument"
                    @click="copyUrl(item)"
                  >
                    复制
                  </ElButton>
                  <ElButton 
                    type="text"
                    :icon="Delete"
                    @click="deleteItem(item.id)"
                  >
                    删除
                  </ElButton>
                </div>
              </div>
            </div>
          </elCard>
        </div>
      </el-main>
    </el-container>
  </div>
</template>

<style scoped>
.history-page {
  width: 100%;
  height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  overflow: hidden;
}

.el-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.el-main {
  flex: 1;
  padding: 32px 24px;
  overflow-y: auto;
  box-sizing: border-box;
}

.history-content {
  max-width: 800px;
  margin: 0 auto;
}

.header-section {
  text-align: center;
  margin-bottom: 32px;
  padding: 40px 0;
}

.logo-wrapper {
  margin-bottom: 20px;
}

.logo-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100px;
  height: 100px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 24px;
  backdrop-filter: blur(10px);
  color: #fff;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
}

.title {
  margin: 0 0 8px 0;
  font-size: 32px;
  font-weight: 700;
  color: #fff;
}

.description {
  margin: 0;
  color: rgba(255, 255, 255, 0.85);
  font-size: 15px;
}

.history-card {
  background: #fff;
  border-radius: 20px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid #f0f0f0;
}

.history-count {
  font-size: 14px;
  color: #666;
}

.empty-state {
  padding: 60px 24px;
}

.history-list {
  padding: 12px 0;
}

.history-item {
  display: flex;
  align-items: center;
  padding: 16px 24px;
  border-bottom: 1px solid #f5f5f5;
  transition: background-color 0.2s;
}

.history-item:hover {
  background-color: #fafafa;
}

.history-item:last-child {
  border-bottom: none;
}

.item-preview {
  width: 64px;
  height: 64px;
  border-radius: 10px;
  overflow: hidden;
  background: #f5f5f5;
  flex-shrink: 0;
}

.preview-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.item-info {
  flex: 1;
  margin-left: 16px;
  min-width: 0;
}

.item-name {
  margin: 0 0 4px 0;
  font-size: 14px;
  font-weight: 500;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-time {
  margin: 0 0 4px 0;
  font-size: 12px;
  color: #999;
}

.item-url {
  margin: 0;
  font-size: 12px;
  color: #667eea;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-actions {
  display: flex;
  gap: 8px;
  margin-left: 16px;
}

.item-actions .el-button {
  font-size: 13px;
  padding: 6px 12px;
}
</style>
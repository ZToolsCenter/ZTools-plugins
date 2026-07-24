<script lang="ts" setup>
import { ref, onMounted, watch } from 'vue'
import Header from '../components/Header/index.vue'
import { ElButton, ElCard, ElMessage, ElProgress, ElLink } from 'element-plus'
import { Upload, Picture, CopyDocument, Check, Warning, Setting } from '@element-plus/icons-vue'

interface PicListConfig {
  host: string
  port: string
  apiKey: string
  useHttps: boolean
  copyFormat: 'markdown' | 'html' | 'url' | 'ubb' | 'custom'
  customFormat: string
}

interface UploadResult {
  success: boolean
  url?: string
  message: string
  fileName?: string
}

const config = ref<PicListConfig>({
  host: '127.0.0.1',
  port: '36677',
  apiKey: '',
  useHttps: false,
  copyFormat: 'markdown',
  customFormat: '![{filename}]({url})'
})
const props = defineProps<{
  launchParam?: { code?: string; payload?: string } | null
}>()
const fileInput = ref<HTMLInputElement | null>(null)
const selectedFiles = ref<File[]>([])
const uploading = ref(false)
const progress = ref(0)
const uploadResults = ref<UploadResult[]>([])
const createObjectURL = (file: File) => URL.createObjectURL(file)

const loadConfig = async () => {
  try {
    const savedConfig = await window.ztools.db.get('piclist_config')
    if (savedConfig) {
      const configStr = typeof savedConfig === 'string' ? savedConfig : savedConfig.data
      const saved = JSON.parse(configStr)
      config.value = {
        copyFormat: 'markdown',
        customFormat: '![{filename}]({url})',
        ...saved
      }
    }
  } catch (error) {
    window.ztools.showNotification(`加载配置失败: ${error}`)
    return
  }
}

const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement
  const files = target.files
  if (files) {
    const imageFiles = Array.from(files).filter(file => 
      file.type.startsWith('image/')
    )
    selectedFiles.value = [...selectedFiles.value, ...imageFiles]
    uploadResults.value = []
  }
}

const removeFile = (index: number) => {
  selectedFiles.value.splice(index, 1)
}

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

const copyUrl = async (url: string, fileName: string = '') => {
  const formattedUrl = formatUrl(url, fileName || 'image')
  try {
    await navigator.clipboard.writeText(formattedUrl)
    ElMessage.success('链接已复制')
  } catch (error) {
    ElMessage.error('复制失败')
  }
}

interface HistoryItem {
  id: string
  fileName: string
  url: string
  originalUrl: string
  timestamp: number
}

const saveToHistory = async (item: HistoryItem) => {
  try {
    const saved = await window.ztools.db.get('piclist_history')
    let history: HistoryItem[] = []
    if (saved) {
      const historyStr = typeof saved === 'string' ? saved : saved.data
      history = JSON.parse(historyStr) || []
    }

    const savedConfig = await window.ztools.db.get('piclist_config')
    let maxCount = 50
    if (savedConfig) {
      const configStr = typeof savedConfig === 'string' ? savedConfig : savedConfig.data
      const configData = JSON.parse(configStr)
      maxCount = configData.historyMaxCount || 50
    }

    history.unshift(item)
    
    if (history.length > maxCount) {
      history = history.slice(0, maxCount)
    }

    await window.ztools.db.remove('piclist_history')
    await window.ztools.db.put({ _id: 'piclist_history', data: JSON.stringify(history) })
  } catch (error) {    
    window.ztools.showNotification(`保存历史记录失败: ${error}`)
  }
}

const uploadImages = async () => {
  if (selectedFiles.value.length === 0) {
    ElMessage.warning('请先选择图片文件')
    return
  }
 const connected = await checkPicListConnection()
  if (!connected) {
    showConnectionWarning()
    return;
  }
  uploadResults.value = []
  uploading.value = true
  progress.value = 0

  const totalFiles = selectedFiles.value.length
  let completedCount = 0

  const protocol = config.value.useHttps ? 'https' : 'http'
  let url = `${protocol}://${config.value.host}:${config.value.port}/upload`
  if (config.value.apiKey) {
    url += `?key=${config.value.apiKey}`
  }

  for (const file of selectedFiles.value) {
    try {
      const formData = new FormData()
      formData.append('file', file)
      
      const response = await fetch(url, {
        method: 'POST',
        body: formData
      })
      
      let result
      const text = await response.text()
      try {
        result = JSON.parse(text)
      } catch {
        result = text
      }
      
      if (response.ok) {
        const imgUrl = result?.url || result?.data?.url || text.trim()
        uploadResults.value.push({
          success: true,
          url: imgUrl,
          message: '上传成功',
          fileName: file.name
        })

        await saveToHistory({
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          fileName: file.name,
          url: imgUrl,
          originalUrl: imgUrl,
          timestamp: Date.now()
        })
      } else {
        uploadResults.value.push({
          success: false,
          message: result?.message || `HTTP ${response.status}`,
          fileName: file.name
        })
      }
    } catch (error) {
      uploadResults.value.push({
        success: false,
        message: (error as Error).message,
        fileName: file.name
      })
    }
    
    completedCount++
    progress.value = Math.round((completedCount / totalFiles) * 100)
  }

  uploading.value = false
  selectedFiles.value = []

  const successCount = uploadResults.value.filter(r => r.success).length
  if (successCount === totalFiles) {
    ElMessage.success(`全部 ${totalFiles} 张图片上传成功`)
  } else if (successCount > 0) {
    ElMessage.warning(`${successCount}/${totalFiles} 张图片上传成功`)
  } else {
    ElMessage.error('所有图片上传失败')
  }
}

const emit = defineEmits<{
  navigate: [view: 'home' | 'about' | 'settings' | 'history']
}>()

const goToSettings = () => {
  emit('navigate', 'settings')
}

const checkPicListConnection = async () => {
  try {
    const protocol = config.value.useHttps ? 'https' : 'http'
    let url = `${protocol}://${config.value.host}:${config.value.port}/heartbeat`
    if (config.value.apiKey) {
      url += `?key=${config.value.apiKey}`
    }
    const response = await fetch(url, {
      method: 'GET',
    })
    
    if (response.ok) {
      return true;
    } else {
      return false;
    }
  } catch (error) {    
      return false;
  } 
}

const showConnectionWarning = () => {
  ElMessage({
    message: '未检测到 PicList 服务，请确保已启动 PicList 并开启内置 HTTP 服务',
    type: 'warning',
    duration: 5000,
    showClose: true
  })
}

onMounted(async () => {
  await loadConfig()
  
  const connected = await checkPicListConnection()
  if (!connected) {
    window.ztools.showNotification('未检测到 PicList 服务，请确保已启动 PicList 并开启内置 HTTP 服务')
    window.ztools.outPlugin(true)
  }
})

interface PastedFile {
  isDirectory: boolean
  isFile: boolean
  name: string
  path: string
}

const handleLaunchParam = async (param: { code?: string; payload?: string; inputState?: { pastedImage?: string, pastedText?: string, pastedFiles?: PastedFile[] } }) => {
  if (!param.code ) return
  if (param.code === 'piclistImg') {
    // 剪贴板图片上传
    if(param.inputState?.pastedImage){
      await uploadClipboardImage()
    }
    // 复制的文件上传
    if(param.inputState?.pastedFiles && param.inputState.pastedFiles.length > 0){
      const imageFiles = param.inputState.pastedFiles.filter(f => f.isFile && f.isDirectory === false)
      if (imageFiles.length > 0) {
        await uploadFilesByPath(imageFiles)
      }
    }
    if(param.inputState?.pastedText){
      const text = param.inputState.pastedText.trim()
      if (text.startsWith('http://') || text.startsWith('https://')) {
        const fileName = text.split('/').pop() || 'remote-image'
        const virtualFile: PastedFile = {
          isDirectory: false,
          isFile: true,
          name: fileName,
          path: text
        }
        await uploadFilesByPath([virtualFile])
      }
    }
  }
    
}

const uploadFilesByPath = async (files: PastedFile[]) => {
  if (!await checkPicListConnection()) {
    showConnectionWarning()
    return
  }

  uploading.value = true
  progress.value = 0

  try {
    const paths = files.map(f => f.path)
    const protocol = config.value.useHttps ? 'https' : 'http'
    let url = `${protocol}://${config.value.host}:${config.value.port}/upload`
    if (config.value.apiKey) {
      url += `?key=${config.value.apiKey}`
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ list: paths })
    })

    const result = await response.json()
    
    if (response.ok && result.success && result.result && result.result.length > 0) {
      result.result.forEach((imgUrl: string, index: number) => {
        const fileName = files[index]?.name || `image-${index + 1}`
        
        uploadResults.value.push({
          success: true,
          url: imgUrl,
          message: '上传成功',
          fileName: fileName
        })

        saveToHistory({
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          fileName: fileName,
          url: imgUrl,
          originalUrl: imgUrl,
          timestamp: Date.now()
        })
      })

      ElMessage.success(`成功上传 ${result.result.length} 张图片`)
      
      window.ztools.showNotification(`成功上传 ${result.result.length} 张图片`)
      window.ztools.outPlugin(true)
    } else {
      files.forEach(file => {
        uploadResults.value.push({
          success: false,
          message: result.message || '上传失败',
          fileName: file.name
        })
      })
      ElMessage.error('上传失败')      
      window.ztools.showNotification(`上传失败`)
    }
  } catch (error) {
    files.forEach(file => {
      uploadResults.value.push({
        success: false,
        message: (error as Error).message,
        fileName: file.name
      })
    })
    ElMessage.error('上传失败')
    window.ztools.showNotification(`上传失败`)
  }

  uploading.value = false
  progress.value = 100
}

const uploadClipboardImage = async () => {
  if (!await checkPicListConnection()) {
    showConnectionWarning()
    return
  }

  uploading.value = true
  progress.value = 0

  try {
    const protocol = config.value.useHttps ? 'https' : 'http'
    let url = `${protocol}://${config.value.host}:${config.value.port}/upload`
    if (config.value.apiKey) {
      url += `?key=${config.value.apiKey}`
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    })

    const result = await response.json()
    
    if (response.ok && result.success && result.result && result.result.length > 0) {
      const imgUrl = result.result[0]
      const fileName = imgUrl.split('/').pop() || 'clipboard-image.png'
      
      uploadResults.value.push({
        success: true,
        url: imgUrl,
        message: '上传成功',
        fileName: fileName
      })

      await saveToHistory({
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        fileName: fileName,
        url: imgUrl,
        originalUrl: imgUrl,
        timestamp: Date.now()
      })

      ElMessage.success('剪贴板图片上传成功')
      window.ztools.showNotification('剪贴板图片上传成功')
      window.ztools.outPlugin(true)
    } else {
      uploadResults.value.push({
        success: false,
        message: result.message || '上传失败',
        fileName: 'clipboard-image'
      })
      ElMessage.error('剪贴板图片上传失败')
      window.ztools.showNotification('剪贴板图片上传失败')
    }
  } catch (error) {
    uploadResults.value.push({
      success: false,
      message: (error as Error).message,
      fileName: 'clipboard-image'
    })
    ElMessage.error('剪贴板图片上传失败')
    window.ztools.showNotification('剪贴板图片上传失败')
  }

  uploading.value = false
  progress.value = 100
}
watch(() => config.value, () => {
  uploadResults.value = []
})
watch(() => props.launchParam, (param) => {
    handleLaunchParam(param)
})
</script>

<template>
  <div class="piclist-upload">
    <el-container>
      <Header current-view="home" @navigate="$emit('navigate', $event)" />

      <el-main>
        <div class="upload-content">
          <!-- <div class="header-section">
            <div class="logo-wrapper">
              <div class="logo-icon">
                <Picture :size="48" />
              </div>
            </div>
            <h1 class="title">PicList 图片上传</h1>
            <p class="description">将本地图片上传到 PicList 图床服务，支持多图同时上传</p>
          </div> -->

          <elCard class="upload-card">
            <div 
              class="upload-area"
              @click="fileInput?.click()"
              @dragover.prevent
              @drop.prevent="(e) => {
                const files = e.dataTransfer?.files
                if (files) {
                  selectedFiles = [...selectedFiles, ...Array.from(files).filter(f => f.type.startsWith('image/'))]
                  uploadResults = []
                }
              }"
            >
              <input 
                ref="fileInput"
                type="file" 
                multiple 
                accept="image/*" 
                class="file-input"
                @change="handleFileSelect"
              />
              <div class="upload-icon-wrapper">
                <div class="upload-icon">
                  <Upload :size="56" />
                </div>
              </div>
              <p class="upload-text">点击或拖拽图片到此处</p>
              <p class="upload-hint">支持 JPG、PNG、GIF 等格式</p>
            </div>

            <div v-if="selectedFiles.length > 0" class="selected-files">
              <div class="selected-header">
                <h3>已选择 {{ selectedFiles.length }} 张图片</h3>
                <span class="clear-btn" @click="selectedFiles = []">清空全部</span>
              </div>
              <div class="files-list">
                <div 
                  v-for="(file, index) in selectedFiles" 
                  :key="index" 
                  class="file-item"
                >
                  <img 
                    :src="createObjectURL(file)" 
                    :alt="file.name"
                    class="file-preview"
                  />
                  <div class="file-overlay">
                    <span class="file-name">{{ file.name }}</span>
                    <ElButton 
                      type="text" 
                      class="remove-btn"
                      @click.stop="removeFile(index)"
                    >
                      ×
                    </ElButton>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="uploading" class="upload-progress">
              <div class="progress-header">
                <span class="progress-title">上传中...</span>
                <span class="progress-percent">{{ progress }}%</span>
              </div>
              <ElProgress 
                :percentage="progress" 
                :stroke-width="8"
                :show-text="false"
              />
            </div>

            <div class="upload-actions">
              <ElButton 
                type="primary" 
                :loading="uploading"
                :disabled="selectedFiles.length === 0 || uploading"
                :icon="Upload"
                size="large"
                @click="uploadImages"
              >
                开始上传
              </ElButton>
              <ElButton 
                type="default"
                :icon="Setting"
                size="large"
                @click="goToSettings"
              >
                配置
              </ElButton>
            </div>
          </elCard>

          <elCard v-if="uploadResults.length > 0" class="results-card">
            <div class="results-header">
              <h3>上传结果</h3>
              <span class="result-count">
                {{ uploadResults.filter(r => r.success).length }}/{{ uploadResults.length }} 成功
              </span>
            </div>
            <div class="results-list">
              <div 
                v-for="(result, index) in uploadResults" 
                :key="index"
                class="result-item"
                :class="{ success: result.success, error: !result.success }"
              >
                <div class="result-icon">
                  <Check v-if="result.success" :size="24" />
                  <Warning v-else :size="24" />
                </div>
                <div class="result-info">
                  <p class="result-name">{{ result.fileName }}</p>
                  <p class="result-message">{{ result.message }}</p>
                </div>
                <div v-if="result.success && result.url" class="result-actions">
                  <ElLink 
                    :href="extractUrl(result.url!)" 
                    target="_blank"
                    :icon="Picture"
                    type="primary"
                  >
                    预览
                  </ElLink>
                  <ElButton 
                    type="text"
                    :icon="CopyDocument"
                    @click="copyUrl(result.url!, result.fileName)"
                  >
                    复制链接
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
.piclist-upload {
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
  -webkit-overflow-scrolling: touch;
}

.upload-content {
  max-width: 600px;
  margin: 0 auto;
}

.header-section {
  text-align: center;
  margin-bottom: 32px;
  padding: 20px 0;
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
  margin: 0 0 12px 0;
  font-size: 32px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 2px;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.description {
  margin: 0;
  color: rgba(255, 255, 255, 0.85);
  font-size: 15px;
  font-weight: 400;
}

.upload-card {
  background: #fff;
  border-radius: 20px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
  border: none;
  overflow: hidden;
}

.upload-area {
  margin: 24px;
  border: 2px dashed #e0e0e0;
  border-radius: 16px;
  padding: 48px 24px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  background: linear-gradient(145deg, #fafafa, #ffffff);
}

.upload-area:hover {
  border-color: #667eea;
  background: linear-gradient(145deg, #f0f4ff, #ffffff);
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
  transform: translateY(-2px);
}

.upload-area:active {
  transform: translateY(0);
}

.file-input {
  display: none;
}

.upload-icon-wrapper {
  margin-bottom: 16px;
}

.upload-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100px;
  height: 100px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  border-radius: 50%;
  color: #fff;
  box-shadow: 0 10px 40px rgba(102, 126, 234, 0.4);
  transition: all 0.3s ease;
}

.upload-area:hover .upload-icon {
  transform: scale(1.1);
  box-shadow: 0 15px 50px rgba(102, 126, 234, 0.5);
}

.upload-text {
  margin: 0 0 8px 0;
  font-size: 18px;
  font-weight: 600;
  color: #333;
}

.upload-hint {
  margin: 0;
  font-size: 13px;
  color: #999;
}

.selected-files {
  margin: 0 24px 24px;
  padding: 20px;
  background: #f8f9fa;
  border-radius: 12px;
}

.selected-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.selected-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #333;
}

.clear-btn {
  font-size: 13px;
  color: #667eea;
  cursor: pointer;
  transition: color 0.2s;
}

.clear-btn:hover {
  color: #5a6fd6;
}

.files-list {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
}

.file-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: 10px;
  overflow: hidden;
  background: #e9ecef;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.file-preview {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.file-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.7), transparent);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 8px;
  opacity: 0;
  transition: opacity 0.2s;
}

.file-item:hover .file-overlay {
  opacity: 1;
}

.file-name {
  font-size: 11px;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 4px;
}

.remove-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 24px;
  height: 24px;
  padding: 0;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  border-radius: 50%;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all 0.2s;
}

.file-item:hover .remove-btn {
  opacity: 1;
}

.remove-btn:hover {
  background: #f56c6c;
}

.upload-progress {
  margin: 0 24px 24px;
  padding: 20px;
  background: #f0f9ff;
  border-radius: 12px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.progress-title {
  font-size: 14px;
  font-weight: 500;
  color: #333;
}

.progress-percent {
  font-size: 16px;
  font-weight: 600;
  color: #667eea;
}

.upload-actions {
  display: flex;
  gap: 12px;
  margin: 0 24px 24px;
  justify-content: center;
}

.upload-actions .el-button {
  padding: 12px 32px;
  border-radius: 12px;
  font-weight: 500;
}

.upload-actions .el-button--primary {
  background: linear-gradient(135deg, #667eea, #764ba2);
  border: none;
  box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
}

.upload-actions .el-button--primary:hover {
  background: linear-gradient(135deg, #5a6fd6, #6a4191);
  box-shadow: 0 6px 25px rgba(102, 126, 234, 0.5);
}

.results-card {
  margin-top: 24px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
  border: none;
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid #f0f0f0;
}

.results-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.result-count {
  font-size: 13px;
  color: #67c23a;
  font-weight: 500;
}

.results-list {
  padding: 12px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.result-item {
  display: flex;
  align-items: center;
  padding: 14px 16px;
  border-radius: 12px;
  background: #f8f9fa;
  transition: all 0.2s;
}

.result-item:hover {
  background: #f0f0f0;
}

.result-item.success {
  border-left: 4px solid #67c23a;
}

.result-item.error {
  border-left: 4px solid #f56c6c;
}

.result-icon {
  margin-right: 14px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.result-item.success .result-icon {
  color: #67c23a;
  background: rgba(103, 194, 58, 0.1);
}

.result-item.error .result-icon {
  color: #f56c6c;
  background: rgba(245, 108, 108, 0.1);
}

.result-info {
  flex: 1;
}

.result-name {
  margin: 0 0 4px 0;
  font-size: 14px;
  font-weight: 500;
  color: #333;
}

.result-message {
  margin: 0;
  font-size: 12px;
  color: #888;
}

.result-actions {
  display: flex;
  gap: 12px;
}

.result-actions .el-button,
.result-actions .el-link {
  font-size: 13px;
}
</style>
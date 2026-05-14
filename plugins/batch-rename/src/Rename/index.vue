<script setup lang="ts">
import { ref, watch, computed } from 'vue'

interface FileItem {
  path: string
  oldName: string
  newName: string
}

const props = defineProps({
  enterAction: {
    type: Object,
    required: true
  }
})

const files = ref<FileItem[]>([])
const prefix = ref('')
const suffix = ref('')
const replaceFrom = ref('')
const replaceTo = ref('')
const useNumber = ref(false)
const numberStart = ref(1)
const numberDigits = ref(2)
const previewLoading = ref(false)
const executing = ref(false)
const executed = ref(false)
const executeResults = ref<any[]>([])
const copyMode = ref(false)
const isDragging = ref(false)

const fileInputRef = ref<HTMLInputElement | null>(null)

const hasFiles = computed(() => files.value.length > 0)

const hasZtoolsEnv = computed(() => {
  return typeof window !== 'undefined' && 
         (window as any).ztools && 
         (window as any).services
})

const getFileNameInfo = (fileName: string) => {
  const lastDotIndex = fileName.lastIndexOf('.')
  if (lastDotIndex === -1) {
    return { name: fileName, ext: '' }
  }
  return {
    name: fileName.substring(0, lastDotIndex),
    ext: fileName.substring(lastDotIndex)
  }
}

const calculateNewName = (oldName: string, index: number) => {
  const { name, ext } = getFileNameInfo(oldName)
  let newName = name
  
  if (replaceFrom.value) {
    newName = name.replace(new RegExp(replaceFrom.value, 'g'), replaceTo.value || '')
  }
  
  if (useNumber.value) {
    const numStr = String(numberStart.value + index).padStart(numberDigits.value, '0')
    newName = prefix.value + numStr + suffix.value
  } else {
    newName = prefix.value + newName + suffix.value
  }
  
  return newName + ext
}

const loadFiles = (filePaths: string[], fileNames?: string[]) => {
  files.value = filePaths.map((p, i) => {
    const fileName = fileNames ? fileNames[i] : (p.split(/[/\\]/).pop() || '')
    return {
      path: p,
      oldName: fileName,
      newName: ''
    }
  })
  executed.value = false
  executeResults.value = []
  updatePreview()
}

const handleSelectFiles = () => {
  if (hasZtoolsEnv.value) {
    const selected = (window as any).ztools.showOpenDialog({
      title: '选择要重命名的文件',
      properties: ['openFile', 'multiSelections']
    })
    if (selected && selected.length > 0) {
      loadFiles(selected)
    }
  } else {
    fileInputRef.value?.click()
  }
}

const handleFileInputChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  const selectedFiles = target.files
  if (selectedFiles && selectedFiles.length > 0) {
    const fileArray = Array.from(selectedFiles)
    const paths = fileArray.map(f => (f as any).path || f.name)
    const names = fileArray.map(f => f.name)
    loadFiles(paths, names)
  }
  target.value = ''
}

const handleDragOver = (event: DragEvent) => {
  event.preventDefault()
  if (!hasZtoolsEnv.value) {
    isDragging.value = true
  }
}

const handleDragLeave = (event: DragEvent) => {
  event.preventDefault()
  isDragging.value = false
}

const handleDrop = (event: DragEvent) => {
  event.preventDefault()
  isDragging.value = false
  
  if (hasZtoolsEnv.value) {
    return
  }
  
  const droppedFiles = event.dataTransfer?.files
  if (droppedFiles && droppedFiles.length > 0) {
    const fileArray = Array.from(droppedFiles)
    const paths = fileArray.map(f => (f as any).path || f.name)
    const names = fileArray.map(f => f.name)
    loadFiles(paths, names)
  }
}

const updatePreview = () => {
  if (!hasFiles.value) return
  
  previewLoading.value = true
  try {
    if (hasZtoolsEnv.value && (window as any).services.previewRename) {
      const rule = {
        prefix: prefix.value,
        suffix: suffix.value,
        replace: replaceFrom.value ? { from: replaceFrom.value, to: replaceTo.value } : null,
        number: useNumber.value ? { start: numberStart.value, digits: numberDigits.value } : null
      }
      const results = (window as any).services.previewRename(files.value.map(f => f.path), rule)
      files.value = results.map((r: any) => ({
        path: r.path,
        oldName: r.oldName,
        newName: r.newName
      }))
    } else {
      files.value = files.value.map((f, index) => ({
        ...f,
        newName: calculateNewName(f.oldName, index)
      }))
    }
  } catch (err) {
    console.error('预览失败:', err)
  } finally {
    previewLoading.value = false
  }
}

const executeRename = async () => {
  if (!hasFiles.value || executing.value) return
  
  if (!hasZtoolsEnv.value) {
    executeResults.value = files.value.map(f => ({
      success: true,
      oldPath: f.path,
      newName: f.newName
    }))
    executed.value = true
    alert(`浏览器环境: 模拟${copyMode.value ? '复制' : '重命名'}成功！\n\n` + 
      files.value.map(f => `${f.oldName} → ${f.newName}`).join('\n'))
    return
  }
  
  executing.value = true
  try {
    const rule = {
      prefix: prefix.value,
      suffix: suffix.value,
      replace: replaceFrom.value ? { from: replaceFrom.value, to: replaceTo.value } : null,
      number: useNumber.value ? { start: numberStart.value, digits: numberDigits.value } : null
    }
    
    if ((window as any).services.batchRename) {
      const results = (window as any).services.batchRename(files.value.map(f => f.path), rule, copyMode.value)
      executeResults.value = results
      executed.value = true
      
      const successCount = results.filter((r: any) => r.success).length
      const failCount = results.filter((r: any) => !r.success).length
      
      if ((window as any).ztools.showNotification) {
        if (failCount === 0) {
          (window as any).ztools.showNotification(`成功${copyMode.value ? '复制' : '重命名'} ${successCount} 个文件`)
        } else {
          (window as any).ztools.showNotification(`成功 ${successCount} 个，失败 ${failCount} 个`)
        }
      }
    }
  } catch (err: any) {
    if ((window as any).ztools.showNotification) {
      (window as any).ztools.showNotification('操作失败: ' + err.message)
    }
  } finally {
    executing.value = false
  }
}

const handleClose = () => {
  if (hasZtoolsEnv.value && (window as any).ztools.outPlugin) {
    (window as any).ztools.outPlugin()
  }
}

const clearFiles = () => {
  files.value = []
  executed.value = false
  executeResults.value = []
}

watch([prefix, suffix, replaceFrom, replaceTo, useNumber, numberStart, numberDigits], () => {
  updatePreview()
})

watch(
  () => props.enterAction,
  (action: any) => {
    if (action && action.type === 'files' && action.payload && action.payload.length > 0) {
      loadFiles(action.payload.map((f: any) => f.path))
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="rename-container">
    <input
      ref="fileInputRef"
      type="file"
      multiple
      style="display: none"
      @change="handleFileInputChange"
    />
    
    <div class="rename-header">
      <h2>批量重命名文件</h2>
      <div class="header-actions">
        <button v-if="hasFiles" class="btn-clear" @click="clearFiles">清空</button>
        <button class="btn-select" @click="handleSelectFiles">选择文件</button>
      </div>
    </div>

    <div v-if="!hasZtoolsEnv && !hasFiles" class="dev-notice">
      浏览器环境：预览功能可用，执行操作为模拟测试
    </div>

    <div v-if="hasZtoolsEnv && !hasFiles" class="dev-notice ztools-notice">
      请点击下方按钮选择文件
    </div>

    <div v-if="!hasFiles" 
      class="rename-dropzone"
      :class="{ dragging: isDragging, 'ztools-mode': hasZtoolsEnv }"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
      @click="handleSelectFiles"
    >
      <div class="dropzone-content">
        <div class="dropzone-icon">📁</div>
        <p class="dropzone-text">{{ hasZtoolsEnv ? '点击选择文件' : '拖拽文件到此处' }}</p>
        <p class="dropzone-tip">{{ hasZtoolsEnv ? '支持多选文件进行批量重命名' : '或点击选择文件' }}</p>
      </div>
    </div>

    <div v-if="hasFiles" class="rename-content">
      <div class="rename-rules">
        <h3>重命名规则</h3>
        <div class="rule-row">
          <label>前缀：</label>
          <input type="text" v-model="prefix" placeholder="添加前缀" />
        </div>
        <div class="rule-row">
          <label>后缀：</label>
          <input type="text" v-model="suffix" placeholder="添加后缀" />
        </div>
        <div class="rule-row">
          <label>替换：</label>
          <input type="text" v-model="replaceFrom" placeholder="查找内容" />
          <span class="arrow">→</span>
          <input type="text" v-model="replaceTo" placeholder="替换为" />
        </div>
        <div class="rule-row">
          <label>
            <input type="checkbox" v-model="useNumber" />
            使用序号
          </label>
          <template v-if="useNumber">
            <label>起始：</label>
            <input type="number" v-model.number="numberStart" min="0" />
            <label>位数：</label>
            <input type="number" v-model.number="numberDigits" min="1" max="10" />
          </template>
        </div>
        <div class="rule-row mode-row">
          <label>操作模式：</label>
          <label class="radio-label">
            <input type="radio" :value="false" v-model="copyMode" />
            重命名（替换源文件）
          </label>
          <label class="radio-label">
            <input type="radio" :value="true" v-model="copyMode" />
            复制（保留原文件）
          </label>
        </div>
      </div>

      <div class="rename-preview">
        <h3>预览 ({{ files.length }} 个文件)</h3>
        <div class="file-list">
          <div class="file-item file-header">
            <span class="col-old">原文件名</span>
            <span class="col-arrow"></span>
            <span class="col-new">新文件名</span>
          </div>
          <div v-for="(file, index) in files" :key="index" class="file-item">
            <span class="col-old">{{ file.oldName }}</span>
            <span class="col-arrow">→</span>
            <span class="col-new" :class="{ changed: file.oldName !== file.newName }">
              {{ file.newName }}
            </span>
          </div>
        </div>
      </div>

      <div class="rename-actions">
        <button 
          class="btn-execute" 
          @click="executeRename" 
          :disabled="executing || executed"
        >
          {{ executing ? '执行中...' : executed ? '已完成' : (copyMode ? '复制文件' : '执行重命名') }}
        </button>
        <button class="btn-close" @click="handleClose">关闭</button>
      </div>

      <div v-if="executed" class="rename-results">
        <h3>执行结果</h3>
        <div v-for="(result, index) in executeResults" :key="index" class="result-item">
          <span v-if="result.success" class="success">✓ {{ result.newName }}</span>
          <span v-else class="fail">✗ {{ result.error }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.rename-container {
  padding: 20px;
  box-sizing: border-box;
}

.rename-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.rename-header h2 {
  margin: 0;
  font-size: 18px;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.btn-select {
  padding: 8px 16px;
  font-size: 14px;
}

.btn-clear {
  padding: 8px 16px;
  font-size: 14px;
  background: #ff7875;
}

.dev-notice {
  background: #fff7e6;
  border: 1px solid #ffd591;
  border-radius: 6px;
  padding: 10px 16px;
  margin-bottom: 16px;
  font-size: 13px;
  color: #d46b08;
}

.ztools-notice {
  background: #e6f7ff;
  border-color: #91d5ff;
  color: #0050b3;
}

.rename-dropzone {
  border: 2px dashed #ddd;
  border-radius: 12px;
  padding: 60px 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  background: var(--light);
}

.rename-dropzone.ztools-mode {
  border-style: solid;
}

.rename-dropzone:hover {
  border-color: var(--blue);
  background: rgba(88, 164, 246, 0.05);
}

.rename-dropzone.dragging {
  border-color: var(--blue);
  background: rgba(88, 164, 246, 0.1);
  transform: scale(1.02);
}

.dropzone-content {
  pointer-events: none;
}

.dropzone-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.dropzone-text {
  font-size: 16px;
  color: #666;
  margin: 0 0 8px 0;
}

.dropzone-tip {
  font-size: 13px;
  color: #999;
  margin: 0;
}

.rename-rules {
  background: var(--light);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 20px;
}

.rename-rules h3 {
  margin: 0 0 12px 0;
  font-size: 14px;
  color: #666;
}

.rule-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.rule-row:last-child {
  margin-bottom: 0;
}

.rule-row label {
  font-size: 13px;
  color: #555;
  white-space: nowrap;
}

.rule-row input[type="text"],
.rule-row input[type="number"] {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
  max-width: 150px;
}

.rule-row input[type="number"] {
  width: 60px;
  max-width: 60px;
}

.rule-row .arrow {
  color: #999;
}

.mode-row {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #eee;
}

.radio-label {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.radio-label input[type="radio"] {
  margin: 0;
}

.rename-preview {
  background: var(--light);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 20px;
}

.rename-preview h3 {
  margin: 0 0 12px 0;
  font-size: 14px;
  color: #666;
}

.file-list {
  max-height: 300px;
  overflow-y: auto;
}

.file-item {
  display: flex;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid #eee;
  font-size: 13px;
}

.file-item:last-child {
  border-bottom: none;
}

.file-header {
  font-weight: bold;
  color: #666;
  background: #f9f9f9;
  margin: -16px -16px 0 -16px;
  padding: 12px 16px;
  border-radius: 8px 8px 0 0;
}

.col-old {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col-arrow {
  width: 30px;
  text-align: center;
  color: #999;
}

.col-new {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col-new.changed {
  color: var(--blue);
  font-weight: 500;
}

.rename-actions {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

.btn-execute {
  flex: 1;
  padding: 12px;
  font-size: 15px;
}

.btn-close {
  padding: 12px 24px;
  background: #f0f0f0;
  color: #666;
}

.rename-results {
  background: var(--light);
  border-radius: 8px;
  padding: 16px;
}

.rename-results h3 {
  margin: 0 0 12px 0;
  font-size: 14px;
  color: #666;
}

.result-item {
  font-size: 13px;
  padding: 4px 0;
}

.result-item .success {
  color: #52c41a;
}

.result-item .fail {
  color: #ff4d4f;
}

@media (prefers-color-scheme: dark) {
  .rename-dropzone {
    border-color: #555;
  }

  .rename-dropzone:hover {
    background: rgba(88, 164, 246, 0.1);
  }

  .dev-notice {
    background: #4d3800;
    border-color: #856000;
    color: #ffc53d;
  }

  .rename-rules,
  .rename-preview,
  .rename-results {
    background: #424242;
  }

  .rule-row label {
    color: #ccc;
  }

  .rule-row input {
    background: #333;
    border-color: #555;
    color: #fff;
  }

  .mode-row {
    border-top-color: #555;
  }

  .file-header {
    background: #383838;
  }

  .file-item {
    border-color: #555;
  }

  .btn-close {
    background: #555;
    color: #ccc;
  }

  .dropzone-text {
    color: #ccc;
  }
}
</style>

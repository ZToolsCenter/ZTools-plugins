<script lang="ts" setup>
import { ref, computed } from 'vue'

interface AppConfig {
  id: string
  name: string
  url: string
  icon: string
  description: string
  defaultLoad: boolean
  createdAt: number
  basicAuth?: {
    username: string
    password: string
  }
}

interface ImportData {
  version: string
  exportedAt: string
  apps: AppConfig[]
}

const props = defineProps<{
  apps: AppConfig[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'update'): void
  (e: 'import', data: { apps: AppConfig[], mode: 'merge' | 'replace' }): void
}>()

// 导入状态
const importData = ref<ImportData | null>(null)
const importMode = ref<'merge' | 'replace'>('merge')
const fileError = ref('')
const fileName = ref('')

const importCount = computed(() => importData.value?.apps.length || 0)
const duplicateCount = computed(() => {
  if (!importData.value) return 0
  const existingIds = new Set(props.apps.map(a => a.id))
  return importData.value.apps.filter(a => existingIds.has(a.id)).length
})

// 允许的URL协议白名单
const ALLOWED_PROTOCOLS = ['http:', 'https:']

// 校验URL是否安全
const isValidImportUrl = (url: string): boolean => {
  try {
    const urlObj = new URL(url)
    return ALLOWED_PROTOCOLS.includes(urlObj.protocol)
  } catch {
    return false
  }
}

// 处理文件选择
const handleFileSelect = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  fileName.value = file.name
  fileError.value = ''

  if (!file.name.endsWith('.json')) {
    fileError.value = '请选择 JSON 格式的文件'
    return
  }

  // 限制文件大小（1MB）
  if (file.size > 1024 * 1024) {
    fileError.value = '文件大小不能超过 1MB'
    return
  }

  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const content = e.target?.result as string
      const data = JSON.parse(content) as ImportData

      if (!data.apps || !Array.isArray(data.apps)) {
        fileError.value = '无效的配置文件格式'
        return
      }

      // 限制导入数量（最多100个）
      if (data.apps.length > 100) {
        fileError.value = '单次导入不能超过 100 个应用'
        return
      }

      // 过滤并验证应用配置
      const validApps = data.apps.filter(app => {
        // 基础字段验证
        if (!app.id || !app.name || !app.url) return false
        // URL协议验证
        if (!isValidImportUrl(app.url)) return false
        // 清理多余字段，只保留必要的
        return true
      }).map(app => ({
        id: String(app.id).substring(0, 50),
        name: String(app.name).substring(0, 100),
        url: String(app.url),
        icon: String(app.icon || '').substring(0, 500),
        description: String(app.description || '').substring(0, 500),
        defaultLoad: Boolean(app.defaultLoad),
        createdAt: Number(app.createdAt) || Date.now(),
        basicAuth: app.basicAuth ? {
          username: String(app.basicAuth.username || ''),
          password: String(app.basicAuth.password || '')
        } : undefined
      }))

      // 对导入数据内部的 id 进行去重
      const seenIds = new Set<string>()
      const dedupedApps = validApps.filter(app => {
        if (seenIds.has(app.id)) return false
        seenIds.add(app.id)
        return true
      })

      if (dedupedApps.length === 0) {
        fileError.value = '文件中没有有效的应用配置'
        return
      }

      importData.value = {
        version: data.version || '1.0.0',
        exportedAt: data.exportedAt || new Date().toISOString(),
        apps: dedupedApps
      }
    } catch {
      fileError.value = '无法解析文件，请确保文件格式正确'
    }
  }
  reader.onerror = () => {
    fileError.value = '文件读取失败，请重试'
  }
  reader.readAsText(file)
}

// 确认导入
const handleImport = () => {
  if (!importData.value) return

  // 通过emit事件通知父组件进行数据更新
  emit('import', {
    apps: importData.value.apps,
    mode: importMode.value
  })

  emit('update')
  resetImport()
}

// 导出配置
const handleExport = () => {
  const exportData = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    apps: props.apps
  }
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const date = new Date().toISOString().split('T')[0]
  a.href = url
  a.download = `webapp-configs-${date}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// 重置导入状态
const resetImport = () => {
  importData.value = null
  importMode.value = 'merge'
  fileError.value = ''
  fileName.value = ''
}

// 关闭弹窗
const handleClose = () => {
  resetImport()
  emit('close')
}

const handleOverlayClick = (e: MouseEvent) => {
  if (e.target === e.currentTarget) {
    handleClose()
  }
}
</script>

<template>
  <div class="dialog-overlay" @click="handleOverlayClick">
    <div class="dialog" role="dialog" aria-modal="true">
      <!-- Header -->
      <header class="dialog-header">
        <h2>设置</h2>
        <button class="dialog-close" @click="handleClose" aria-label="关闭">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </header>

      <!-- Body -->
      <div class="dialog-body">
        <!-- 导入区域 -->
        <div class="section">
          <h3 class="section-title">导入配置</h3>
          <div class="file-drop" :class="{ active: importData }">
            <input
              type="file"
              id="import-file"
              accept=".json"
              @change="handleFileSelect"
              class="file-input"
            />
            <label for="import-file" class="file-label">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span class="file-name">{{ fileName || '选择文件' }}</span>
            </label>
          </div>

          <!-- 错误提示 -->
          <p v-if="fileError" class="error-text">{{ fileError }}</p>

          <!-- 预览信息 -->
          <div v-if="importData" class="preview">
            <div class="preview-row">
              <span class="preview-label">将导入</span>
              <span class="preview-value">{{ importCount }} 个应用</span>
            </div>
            <div v-if="duplicateCount > 0" class="preview-row">
              <span class="preview-label">其中</span>
              <span class="preview-value warning">{{ duplicateCount }} 个重复</span>
            </div>
          </div>

          <!-- 导入模式 -->
          <div v-if="importData && duplicateCount > 0" class="mode-select">
            <label class="radio">
              <input type="radio" v-model="importMode" value="merge" />
              <span class="radio-mark"></span>
              <span class="radio-text">合并到现有配置</span>
            </label>
            <label class="radio">
              <input type="radio" v-model="importMode" value="replace" />
              <span class="radio-mark"></span>
              <span class="radio-text">覆盖现有配置</span>
            </label>
          </div>

          <!-- 导入按钮 -->
          <button
            v-if="importData"
            class="btn btn-primary btn-full"
            @click="handleImport"
          >
            确认导入
          </button>
        </div>

        <!-- 分隔线 -->
        <div class="divider"></div>

        <!-- 导出区域 -->
        <div class="section">
          <h3 class="section-title">导出配置</h3>
          <p class="section-desc">当前共有 {{ apps.length }} 个应用</p>
          <button
            class="btn btn-secondary btn-full"
            @click="handleExport"
            :disabled="apps.length === 0"
          >
            导出配置
          </button>
        </div>
      </div>

      <!-- Footer -->
      <footer class="dialog-footer">
        <button type="button" class="btn btn-secondary" @click="handleClose">关闭</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
/* ================================================
   DIALOG OVERLAY
   ================================================ */
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: oklch(0 0 0 / 0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: overlayIn 150ms var(--ease-out);
}

@keyframes overlayIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* ================================================
   DIALOG
   ================================================ */
.dialog {
  width: 380px;
  max-width: 92vw;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  display: flex;
  flex-direction: column;
  animation: dialogIn 200ms var(--ease-out);
}

@keyframes dialogIn {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

/* ================================================
   DIALOG HEADER
   ================================================ */
.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-xl) var(--space-xl) var(--space-lg);
}

.dialog-header h2 {
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  color: var(--color-text);
}

.dialog-close {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-fast) var(--ease-out);
}

.dialog-close:hover {
  background: var(--color-surface-hover);
  color: var(--color-text);
}

/* ================================================
   DIALOG BODY
   ================================================ */
.dialog-body {
  padding: 0 var(--space-xl);
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

/* ================================================
   SECTION
   ================================================ */
.section {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.section-title {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.section-desc {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.divider {
  height: 1px;
  background: var(--color-border);
}

/* ================================================
   FILE INPUT
   ================================================ */
.file-drop {
  position: relative;
}

.file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.file-label {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  padding: var(--space-lg);
  background: var(--color-bg);
  border: 2px dashed var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}

.file-label:hover {
  border-color: var(--color-gradient-end);
  background: var(--color-accent-subtle);
}

.file-drop.active .file-label {
  border-style: solid;
  border-color: var(--color-gradient-end);
}

.file-label svg {
  color: var(--color-text-muted);
}

.file-name {
  font-size: var(--text-sm);
  color: var(--color-text);
}

/* ================================================
   ERROR
   ================================================ */
.error-text {
  font-size: var(--text-sm);
  color: var(--color-danger);
  margin: 0;
}

/* ================================================
   PREVIEW
   ================================================ */
.preview {
  background: var(--color-bg);
  border-radius: var(--radius-sm);
  padding: var(--space-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.preview-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--text-sm);
}

.preview-label {
  color: var(--color-text-muted);
}

.preview-value {
  color: var(--color-text);
  font-weight: var(--font-medium);
}

.preview-value.warning {
  color: var(--color-danger);
}

/* ================================================
   MODE SELECT
   ================================================ */
.mode-select {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.radio {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  cursor: pointer;
  font-size: var(--text-sm);
}

.radio input {
  position: absolute;
  opacity: 0;
}

.radio-mark {
  width: 16px;
  height: 16px;
  border: 2px solid var(--color-border);
  border-radius: 50%;
  transition: all var(--duration-fast) var(--ease-out);
  position: relative;
}

.radio input:checked + .radio-mark {
  border-color: var(--color-accent);
}

.radio input:checked + .radio-mark::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 8px;
  height: 8px;
  background: var(--color-accent);
  border-radius: 50%;
}

.radio-text {
  color: var(--color-text-secondary);
}

/* ================================================
   DIALOG FOOTER
   ================================================ */
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
  padding: var(--space-lg) var(--space-xl);
  border-top: 1px solid var(--color-border);
  margin-top: var(--space-lg);
}

/* ================================================
   BUTTONS
   ================================================ */
.btn {
  padding: var(--space-md) var(--space-xl);
  border: none;
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  font-weight: var(--font-medium);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}

.btn:active {
  transform: scale(0.97);
}

.btn-full {
  width: 100%;
}

.btn-secondary {
  background: var(--color-surface-hover);
  color: var(--color-text-secondary);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--color-border);
  color: var(--color-text);
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--gradient-brand);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: var(--gradient-brand);
  filter: brightness(1.1);
  box-shadow: 0 2px 8px var(--color-accent-subtle);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

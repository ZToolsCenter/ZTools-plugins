<script setup lang="ts">
import { computed, ref } from 'vue'
import { ZButton } from 'ztools-ui'
import type { AuthUser } from '../../types/auth'
import type {
  MyPluginUploadRecord,
  MyPluginUploadStatus,
  PluginHashCheckStatus,
} from '../../types/pluginMarket'
import { formatDateTime } from './utils'
import { formatSize, formatDownloads } from './detail/formatters'

const props = defineProps<{
  currentUser: AuthUser | null
  selectedFile: File | null
  validationError: string
  hashCheckResult: { status: PluginHashCheckStatus; pluginName?: string; version?: string } | null
  isHashing: boolean
  isCheckingHash: boolean
  isUploading: boolean
  uploadProgress: number
  uploadStage: 'hashing' | 'uploading' | 'merging' | 'completed' | null
  canUpload: boolean
  uploads: MyPluginUploadRecord[]
  uploadsTotal: number
  uploadsPage: number
  uploadsLoading: boolean
  uploadsError: string
  deletingIds: Set<string>
}>()

const emit = defineEmits<{
  (e: 'select-file', file: File): void
  (e: 'clear-file'): void
  (e: 'upload'): void
  (e: 'cancel-upload'): void
  (e: 'refresh-uploads'): void
  (e: 'delete-upload', record: MyPluginUploadRecord): void
  (e: 'open-plugin', name: string): void
  (e: 'go-login'): void
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)
const isDragActive = ref(false)

const isLoggedIn = computed(() => !!props.currentUser)
const canSelectFile = computed(() => isLoggedIn.value && !props.isUploading && !props.isHashing && !props.isCheckingHash)
const totalPages = computed(() =>
  Math.max(1, Math.ceil(props.uploadsTotal / 20)),
)

/**
 * 打开隐藏的单文件选择框；仅在登录且没有上传中的任务时响应上传区域点击。
 */
function openFilePicker(): void {
  if (!canSelectFile.value) return
  fileInputRef.value?.click()
}

/**
 * 统一处理点击选择和拖拽上传来源，始终只取第一份插件包进入现有预检流程。
 */
function selectFirstFile(files: FileList | null | undefined): void {
  const file = files?.[0]
  if (file) {
    emit('select-file', file)
  }
}

/**
 * 接收原生文件选择结果并重置 input，让用户可以连续选择同一个文件重试。
 */
function handleFileInput(event: Event): void {
  const target = event.target as HTMLInputElement | null
  selectFirstFile(target?.files)
  if (target) {
    target.value = ''
  }
}

/**
 * 标记拖拽悬停状态，用于提示当前区域可以接收单个插件包文件。
 */
function handleDragEnter(): void {
  if (canSelectFile.value) {
    isDragActive.value = true
  }
}

/**
 * 清理拖拽悬停状态，避免离开上传区域后仍保持高亮。
 */
function handleDragLeave(): void {
  isDragActive.value = false
}

/**
 * 接收拖拽释放的文件列表，并复用单文件选择逻辑进入上传预检。
 */
function handleDrop(event: DragEvent): void {
  isDragActive.value = false
  if (!canSelectFile.value) return
  selectFirstFile(event.dataTransfer?.files)
}

/**
 * 触发上传记录刷新；按钮动画由父级传入的加载状态驱动。
 */
function handleRefreshUploads(): void {
  if (!props.uploadsLoading) {
    emit('refresh-uploads')
  }
}

/**
 * 优先展示服务端进度文案，兼容列表仅返回状态码时的本地兜底文案。
 */
function getStatusLabel(record: MyPluginUploadRecord): string {
  if (record.progress?.label) {
    return record.progress.label
  }

  switch (record.status) {
    case 'AI_CLASSIFYING': return 'AI分类中'
    case 'AI_REVIEWING': return 'AI审查中'
    case 'MANUAL_REVIEW': return '人工审核'
    case 'PUBLISHED': return '已发布'
    case 'PUBLISH_FAILED': return '发布失败'
    default: return record.status
  }
}

/**
 * 将上传进度状态映射为对应的视觉层级，区分 AI 处理中、人工审核、发布成功和发布失败。
 */
function getStatusClass(status: MyPluginUploadStatus): string {
  switch (status) {
    case 'AI_CLASSIFYING': return 'status-ai-classifying'
    case 'AI_REVIEWING': return 'status-ai-reviewing'
    case 'MANUAL_REVIEW': return 'status-manual-review'
    case 'PUBLISHED': return 'status-published'
    case 'PUBLISH_FAILED': return 'status-publish-failed'
    default: return ''
  }
}

function getHashCheckMessage(): string {
  if (!props.hashCheckResult) return ''
  switch (props.hashCheckResult.status) {
    case 'blocked': return '该文件哈希已被封禁，无法上传'
    case 'processing': return '该文件正在后台分析中，请勿重复上传'
    case 'exists': return `该插件已存在：${props.hashCheckResult.pluginName || ''} ${props.hashCheckResult.version || ''}`
    case 'safe': return '预检通过，可以上传'
    default: return ''
  }
}

function isDeleting(id: string): boolean {
  return props.deletingIds.has(id)
}

/**
 * 仅允许删除已发布版本或取消人工审核中的上传；发布失败记录由服务端保留为最终进度，不再展示删除入口。
 */
function canDelete(record: MyPluginUploadRecord): boolean {
  return record.status === 'PUBLISHED' || record.status === 'MANUAL_REVIEW'
}

/**
 * 获取上传阶段的显示文本
 */
function getUploadStageText(): string {
  if (props.isHashing) return '计算哈希中...'
  if (props.isCheckingHash) return '预检中...'
  if (!props.isUploading) return '确认上传'

  switch (props.uploadStage) {
    case 'hashing': return '计算文件哈希...'
    case 'uploading': return `上传中 ${props.uploadProgress}%`
    case 'merging': return '合并分片中...'
    case 'completed': return '上传完成'
    default: return `上传中 ${props.uploadProgress}%`
  }
}

/**
 * 判断是否正在上传分片（大于20MB的文件）
 */
const isChunkedUploading = computed(() => {
  return props.isUploading && props.selectedFile && props.selectedFile.size > 20 * 1024 * 1024
})
</script>

<template>
  <div class="upload-panel">
    <div v-if="!isLoggedIn" class="panel-card section-card empty-card">
      <h3 class="section-title">登录后上传插件</h3>
      <p class="panel-description">登录后可以提交插件包并查看自己的上传记录。</p>
      <div class="login-cta">
        <ZButton type="primary" @click="emit('go-login')">前往登录</ZButton>
      </div>
    </div>

    <template v-else>
      <div class="panel-card section-card upload-card">
        <input
          ref="fileInputRef"
          type="file"
          accept=".zpx,.zip"
          class="hidden-input"
          :disabled="!canSelectFile"
          @change="handleFileInput"
        />

        <div
          class="upload-dropzone"
          :class="{ 'is-drag-active': isDragActive, 'is-disabled': !canSelectFile }"
          role="button"
          :tabindex="canSelectFile ? 0 : -1"
          :aria-disabled="!canSelectFile"
          @click="openFilePicker"
          @keydown.enter.prevent="openFilePicker"
          @keydown.space.prevent="openFilePicker"
          @dragenter.prevent="handleDragEnter"
          @dragover.prevent="handleDragEnter"
          @dragleave.prevent="handleDragLeave"
          @drop.prevent="handleDrop"
        >
          <div class="dropzone-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M12 15.5V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15.5v2.25A2.25 2.25 0 007.25 20h9.5A2.25 2.25 0 0019 17.75V15.5"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>
          <div class="dropzone-copy">
            <strong>{{ selectedFile ? '已选择插件包' : '拖拽插件包到这里，或点击选择文件' }}</strong>
            <span v-if="selectedFile" class="selected-file-line">
              <span class="file-name">{{ selectedFile.name }}</span>
              <span class="file-size">{{ formatSize(selectedFile.size) }}</span>
            </span>
            <span v-else>拖入多个文件时仅会使用第一个文件。</span>
          </div>
        </div>

        <div v-if="validationError" class="validation-error">{{ validationError }}</div>

        <div v-if="selectedFile && !validationError" class="upload-actions">
          <div v-if="isHashing || isCheckingHash" class="hash-check-result hash-safe">
            <span>{{ isHashing ? '计算哈希中...' : '预检中...' }}</span>
          </div>

          <div v-if="hashCheckResult" class="hash-check-result" :class="`hash-${hashCheckResult.status}`">
            <span>{{ getHashCheckMessage() }}</span>
            <ZButton
              v-if="hashCheckResult.status === 'exists' && hashCheckResult.pluginName"
              size="small"
              @click="emit('open-plugin', hashCheckResult.pluginName!)"
            >
              查看插件
            </ZButton>
          </div>

          <div class="upload-button-row">
            <ZButton
              type="primary"
              :disabled="!canUpload"
              :loading="isUploading || isHashing || isCheckingHash"
              @click="emit('upload')"
            >
              {{ getUploadStageText() }}
            </ZButton>
            <ZButton
              v-if="isUploading && isChunkedUploading"
              type="danger"
              @click="emit('cancel-upload')"
            >
              取消
            </ZButton>
            <ZButton
              v-else
              :disabled="isUploading || isHashing || isCheckingHash"
              @click="emit('clear-file')"
            >
              清空
            </ZButton>
          </div>

          <!-- 上传进度条 -->
          <div v-if="isUploading && uploadProgress > 0" class="upload-progress-bar">
            <div class="progress-fill" :style="{ width: `${uploadProgress}%` }"></div>
          </div>
        </div>
      </div>

      <div class="panel-card section-card record-card">
        <div class="section-header">
          <h3 class="section-title">上传记录</h3>
          <button
            class="refresh-icon-btn"
            :class="{ 'is-refreshing': uploadsLoading }"
            type="button"
            :disabled="uploadsLoading"
            aria-label="刷新上传记录"
            title="刷新上传记录"
            @click="handleRefreshUploads"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path
                d="M17.65 6.35A7.958 7.958 0 0012 4a8 8 0 107.73 10h-2.08A6 6 0 1116.22 7.78L13 11h7V4l-2.35 2.35z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>

        <div v-if="uploadsLoading && uploads.length === 0" class="loading-container">
          <div class="spinner"></div>
          <span>加载中...</span>
        </div>

        <div v-else-if="uploadsError" class="error-container">
          <span>{{ uploadsError }}</span>
          <ZButton @click="emit('refresh-uploads')">重试</ZButton>
        </div>

        <div v-else-if="uploads.length === 0" class="empty-message">暂无上传记录</div>

        <div v-else class="upload-list">
          <div v-for="record in uploads" :key="record.id" class="upload-record">
            <div class="record-main">
              <div class="record-info">
                <span class="record-name">{{ record.pluginName || record.originalName }}</span>
                <span v-if="record.version" class="record-version">v{{ record.version }}</span>
              </div>
              <div class="record-meta">
                <span class="record-filename">{{ record.originalName }}</span>
                <span>{{ formatSize(record.fileSize) }}</span>
                <span>{{ formatDateTime(record.createdAt) }}</span>
                <span v-if="record.status === 'PUBLISHED'">{{ formatDownloads(record.downloads) }} 次下载</span>
              </div>
            </div>
            <div class="record-actions">
              <span class="status-badge" :class="getStatusClass(record.status)">
                {{ getStatusLabel(record) }}
              </span>
              <ZButton
                v-if="canDelete(record)"
                type="danger"
                size="small"
                :disabled="isDeleting(record.id)"
                :loading="isDeleting(record.id)"
                @click="emit('delete-upload', record)"
              >
                删除
              </ZButton>
            </div>
          </div>
        </div>

        <div v-if="uploadsTotal > 20" class="pagination-row">
          <span class="pagination-text">共 {{ uploadsTotal }} 条，当前第 {{ uploadsPage }} / {{ totalPages }} 页</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.upload-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel-card {
  padding: 18px;
  border: 1px solid var(--divider-color);
  border-radius: 8px;
  background: var(--card-bg);
  backdrop-filter: blur(40px) saturate(180%);
}

.panel-description {
  margin: 8px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.section-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.empty-card {
  align-items: flex-start;
}

.login-cta,
.pagination-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.section-heading {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.section-title {
  margin: 0;
  font-size: 16px;
  color: var(--text-color);
}

.hidden-input {
  display: none;
}

.upload-dropzone {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 132px;
  padding: 22px;
  border: 1px dashed color-mix(in srgb, var(--primary-color) 36%, var(--divider-color));
  border-radius: 12px;
  background: color-mix(in srgb, var(--primary-color) 6%, var(--card-bg));
  color: var(--text-color);
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease, transform 0.2s ease;
}

.upload-dropzone:hover,
.upload-dropzone.is-drag-active,
.upload-dropzone:focus-visible {
  border-color: var(--primary-color);
  background: color-mix(in srgb, var(--primary-color) 12%, var(--card-bg));
}

.upload-dropzone.is-drag-active {
  transform: translateY(-1px);
}

.upload-dropzone:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-color) 18%, transparent);
}

.upload-dropzone.is-disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.dropzone-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--primary-color) 12%, transparent);
  color: var(--primary-color);
}

.dropzone-copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.dropzone-copy strong {
  color: var(--text-color);
  font-size: 15px;
}

.selected-file-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.file-name {
  color: var(--text-color);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  color: var(--text-secondary);
  font-size: 12px;
}

.validation-error {
  color: var(--danger-color, #e74c3c);
  font-size: 13px;
}

.upload-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.upload-button-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.upload-progress-bar {
  height: 6px;
  width: 100%;
  border-radius: 3px;
  background: var(--divider-color);
  overflow: hidden;
  position: relative;
}

.upload-progress-bar .progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary-color), color-mix(in srgb, var(--primary-color) 80%, #fff));
  border-radius: 3px;
  transition: width 0.3s ease;
  position: relative;
}

.upload-progress-bar .progress-fill::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
  animation: progress-shimmer 1.5s infinite;
}

@keyframes progress-shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

.hash-check-result {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid var(--divider-color);
  background: var(--surface-elevated);
}

.hash-check-result.hash-safe {
  color: var(--success-color, #27ae60);
  background: color-mix(in srgb, var(--success-color, #27ae60) 10%, transparent);
}

.hash-check-result.hash-blocked,
.hash-check-result.hash-processing,
.hash-check-result.hash-exists {
  color: var(--warning-color, #e67e22);
  background: color-mix(in srgb, var(--warning-color, #e67e22) 10%, transparent);
}

.refresh-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--divider-color);
  border-radius: 9px;
  background: var(--surface-elevated);
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color 0.2s ease, color 0.2s ease, background 0.2s ease;
}

.refresh-icon-btn:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--primary-color) 45%, var(--divider-color));
  background: color-mix(in srgb, var(--primary-color) 8%, var(--surface-elevated));
  color: var(--primary-color);
}

.refresh-icon-btn:disabled {
  cursor: default;
  opacity: 0.75;
}

.refresh-icon-btn svg {
  transform-origin: center;
}

.refresh-icon-btn.is-refreshing svg {
  animation: refresh-spin 0.8s linear infinite;
}

.loading-container,
.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 20px;
  color: var(--text-secondary);
  font-size: 13px;
  text-align: center;
}

.error-container {
  color: var(--danger-color, #e74c3c);
}

.spinner {
  width: 24px;
  height: 24px;
  border: 3px solid var(--divider-color);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.empty-message {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  padding: 24px 0;
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
}

.upload-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.upload-record {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--divider-color);
  border-radius: 8px;
  background: var(--card-bg);
  backdrop-filter: blur(40px) saturate(180%);
  transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
}

.upload-record:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--primary-color) 28%, var(--divider-color));
}

.record-main {
  flex: 1;
  min-width: 0;
}

.record-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.record-name {
  color: var(--text-color);
  font-size: 13px;
  font-weight: 600;
}

.record-version {
  color: var(--text-secondary);
  font-size: 12px;
}

.record-meta {
  display: flex;
  gap: 12px;
  margin-top: 6px;
  color: var(--text-secondary);
  font-size: 12px;
  flex-wrap: wrap;
}

.record-filename {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.record-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 64px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--surface-elevated);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.status-ai-classifying {
  color: var(--primary-color);
  background: color-mix(in srgb, var(--primary-color) 12%, transparent);
}

.status-ai-reviewing {
  color: var(--primary-color);
  background: color-mix(in srgb, var(--primary-color) 12%, transparent);
}

.status-manual-review {
  color: var(--warning-color, #e67e22);
  background: color-mix(in srgb, var(--warning-color, #e67e22) 12%, transparent);
}

.status-publish-failed {
  color: var(--danger-color, #e74c3c);
  background: color-mix(in srgb, var(--danger-color, #e74c3c) 12%, transparent);
}

.status-published {
  color: var(--success-color, #27ae60);
  background: color-mix(in srgb, var(--success-color, #27ae60) 12%, transparent);
}

.pagination-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pagination-text {
  color: var(--text-secondary);
  font-size: 13px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes refresh-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 640px) {
  .upload-dropzone,
  .upload-record {
    align-items: flex-start;
    flex-direction: column;
  }

  .record-actions {
    width: 100%;
    justify-content: space-between;
  }
}
</style>

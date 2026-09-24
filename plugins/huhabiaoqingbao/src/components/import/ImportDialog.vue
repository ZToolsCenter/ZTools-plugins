<template>
  <el-dialog
    v-model="visible"
    title="导入表情包"
    width="460px"
    :close-on-click-modal="false"
    :append-to-body="true"
    destroy-on-close
    class="import-dialog"
  >
    <div class="import-content">
      <div class="source-tabs">
        <button
          class="source-tab"
          :class="{ active: activeSource === 'qq' }"
          :disabled="importing"
          @click="switchSource('qq')"
        >
          <div class="source-icon qq-icon small-icon">QQ</div>
          <span>QQ 表情</span>
        </button>
        <button
          class="source-tab"
          :class="{ active: activeSource === 'feishu' }"
          :disabled="importing"
          @click="switchSource('feishu')"
        >
          <div class="source-icon feishu-icon small-icon">飞</div>
          <span>飞书表情</span>
        </button>
        <button
          class="source-tab"
          :class="{ active: activeSource === 'wechat' }"
          :disabled="importing"
          @click="switchSource('wechat')"
        >
          <div class="source-icon wechat-icon small-icon">微</div>
          <span>微信表情</span>
        </button>
      </div>

      <!-- 导入卡片 -->
      <div class="source-card">
        <div class="card-header">
          <div class="source-icon" :class="activeConfig.iconClass">{{ activeConfig.shortName }}</div>
          <div class="source-info">
            <h3>{{ activeConfig.title }}</h3>
            <p class="source-desc">{{ activeConfig.desc }}</p>
          </div>
        </div>

        <!-- 自动检测结果 -->
        <div class="detect-section" v-if="detectStatus === 'detecting'">
          <div class="detect-loading">
            <div class="spinner"></div>
            <span>正在检测 {{ activeConfig.appName }} 安装路径...</span>
          </div>
        </div>
        <div class="detect-section" v-else-if="detectedPaths.length > 0">
          <div class="detected-paths">
            <div
              v-for="(item, idx) in detectedPaths"
              :key="idx"
              class="path-item"
              :class="{ selected: selectedPath === item.path }"
              @click="selectPath(item.path)"
            >
              <div class="path-icon">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                  <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
                </svg>
              </div>
              <div class="path-text">
                <span class="path-desc">{{ item.description }}</span>
                <span class="path-dir">{{ item.path }}</span>
              </div>
              <div class="path-check" v-if="selectedPath === item.path">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
              </div>
            </div>
          </div>
        </div>
        <div class="detect-section" v-else-if="detectStatus === 'done'">
          <div class="detect-empty">
            <span>未自动检测到 {{ activeConfig.appName }} 目录，请手动选择</span>
          </div>
        </div>

        <!-- 扫描结果 + 操作按钮 -->
        <div class="card-bottom">
          <div class="scan-info" v-if="scanResult !== null">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
            </svg>
            <span>发现 <strong>{{ scanResult }}</strong> 张{{ activeConfig.scanLabel }}</span>
          </div>
          <div class="card-actions">
            <button class="action-btn secondary" @click="handleSelectDir" :disabled="importing">
              选择目录
            </button>
            <button
              class="action-btn primary"
              @click="handleImport"
              :disabled="!selectedPath || importing || (scanResult !== null && scanResult === 0)"
            >
              <div class="spinner small" v-if="importing"></div>
              {{ importing ? `导入中 ${importProgress}/${importTotal}` : '开始导入' }}
            </button>
          </div>
        </div>

        <!-- 进度条 -->
        <div class="progress-section" v-if="importing">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
          </div>
          <span class="progress-text">{{ progressPercent }}%</span>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <button class="apple-btn secondary" @click="handleClose">
          {{ importDone ? '完成' : '关闭' }}
        </button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useEmoticonStore } from '@/store/emoticon'
import {
  detectQQPath,
  scanEmoticons,
  createImportItem,
  type QQDetectResult
} from '@/services/importers/qqImporter'
import {
  detectLarkPath,
  scanLarkEmoticons,
  createLarkImportItem,
  type LarkDetectResult
} from '@/services/importers/larkImporter'
import {
  detectWechatPath,
  scanWechatEmoticons,
  createWechatImportItem,
  type WechatDetectResult
} from '@/services/importers/wechatImporter'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'imported'): void
}>()

const store = useEmoticonStore()

type ImportSource = 'qq' | 'feishu' | 'wechat'
type DetectResult = QQDetectResult | LarkDetectResult | WechatDetectResult

const sourceConfigs: Record<ImportSource, {
  appName: string
  title: string
  desc: string
  shortName: string
  iconClass: string
  successName: string
  scanLabel: string
}> = {
  qq: {
    appName: 'QQ',
    title: 'QQ 表情',
    desc: '从本机 QQ 导入自定义表情',
    shortName: 'QQ',
    iconClass: 'qq-icon',
    successName: 'QQ 表情',
    scanLabel: '表情'
  },
  feishu: {
    appName: '飞书',
    title: '飞书表情',
    desc: '导入本机飞书的所有表情包',
    shortName: '飞',
    iconClass: 'feishu-icon',
    successName: '飞书表情',
    scanLabel: '表情'
  },
  wechat: {
    appName: '微信',
    title: '微信表情',
    desc: '从本机微信导入自定义表情',
    shortName: '微',
    iconClass: 'wechat-icon',
    successName: '微信表情',
    scanLabel: '表情'
  }
}

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

// Detection state
const activeSource = ref<ImportSource>('qq')
const detectStatus = ref<'idle' | 'detecting' | 'done'>('idle')
const detectedPaths = ref<DetectResult[]>([])
const selectedPath = ref('')
const scanResult = ref<number | null>(null)

// Import state
const importing = ref(false)
const importProgress = ref(0)
const importTotal = ref(0)
const importDone = ref(false)

const progressPercent = computed(() => {
  if (importTotal.value === 0) return 0
  return Math.round((importProgress.value / importTotal.value) * 100)
})

const activeConfig = computed(() => sourceConfigs[activeSource.value])

// Auto-detect on open
watch(visible, (val) => {
  if (val) {
    runDetection()
  }
})

function switchSource(source: ImportSource) {
  if (activeSource.value === source || importing.value) return
  activeSource.value = source
  if (visible.value) runDetection()
}

async function runDetection() {
  detectStatus.value = 'detecting'
  detectedPaths.value = []
  selectedPath.value = ''
  scanResult.value = null
  importDone.value = false

  // Use setTimeout to allow UI to render the loading state
  setTimeout(() => {
    try {
      let results: DetectResult[]
      if (activeSource.value === 'qq') {
        results = detectQQPath()
      } else if (activeSource.value === 'feishu') {
        results = detectLarkPath()
      } else {
        results = detectWechatPath()
      }
      detectedPaths.value = results
      if (results.length > 0) {
        selectedPath.value = results[0].path
        doScan(results[0].path)
      }
    } catch (err) {
      console.error(`${activeConfig.value.appName} detection failed:`, err)
    }
    detectStatus.value = 'done'
  }, 100)
}

function selectPath(path: string) {
  selectedPath.value = path
  doScan(path)
}

function doScan(path: string) {
  try {
    let results: { name: string; filePath: string; type: string }[]
    if (activeSource.value === 'qq') {
      results = scanEmoticons(path)
    } else if (activeSource.value === 'feishu') {
      results = scanLarkEmoticons(path)
    } else {
      results = scanWechatEmoticons(path)
    }
    scanResult.value = results.length
  } catch (err) {
    console.error('Scan failed:', err)
    scanResult.value = 0
  }
}

function handleSelectDir() {
  const ztools = (window as any).ztools
  if (ztools?.showOpenDialog) {
    const result = ztools.showOpenDialog({
      title: `选择 ${activeConfig.value.appName} 表情目录`,
      properties: ['openDirectory']
    })
    if (result && result.length > 0) {
      selectedPath.value = result[0]
      doScan(result[0])
    }
  } else {
    ElMessage.info('请在 ZTools 环境中使用此功能')
  }
}

async function handleImport() {
  if (!selectedPath.value || importing.value) return

  importing.value = true
  importProgress.value = 0
  importDone.value = false

  try {
    let scannedItems: { name: string; filePath: string; type: string }[]
    if (activeSource.value === 'qq') {
      scannedItems = scanEmoticons(selectedPath.value)
    } else if (activeSource.value === 'feishu') {
      scannedItems = scanLarkEmoticons(selectedPath.value)
    } else {
      scannedItems = scanWechatEmoticons(selectedPath.value)
    }
    const importItems: { emoticon: any; file: Blob }[] = []
    importTotal.value = scannedItems.length

    for (let i = 0; i < scannedItems.length; i += 20) {
      const batch = scannedItems.slice(i, i + 20)
      for (const item of batch) {
        let importItem: { emoticon: any; file: Blob } | null = null
        if (activeSource.value === 'qq') {
          importItem = createImportItem(item)
        } else if (activeSource.value === 'feishu') {
          importItem = createLarkImportItem(item)
        } else {
          importItem = createWechatImportItem(item)
        }
        if (importItem) importItems.push(importItem)
      }
      importProgress.value = Math.min(i + batch.length, scannedItems.length)
      // Yield to UI thread
      await new Promise(resolve => setTimeout(resolve, 0))
    }

    if (importItems.length > 0) {
      await store.addEmoticons(importItems)
    }

    importDone.value = true
    ElMessage.success(`成功导入 ${importItems.length} 张${activeConfig.value.successName}`)
    emit('imported')
  } catch (err) {
    console.error('Import failed:', err)
    ElMessage.error('导入失败，请重试')
  } finally {
    importing.value = false
  }
}

function handleClose() {
  visible.value = false
}
</script>

<style scoped lang="scss">
.import-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.source-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.source-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 40px;
  border: 1px solid var(--el-border-color-lighter, #e4e7ed);
  border-radius: 8px;
  background: var(--el-fill-color-lighter, #fafafa);
  color: var(--el-text-color-regular, #606266);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    border-color: var(--el-color-primary, #409eff);
    background: rgba(64, 158, 255, 0.06);
  }

  &.active {
    border-color: var(--el-color-primary, #409eff);
    background: rgba(64, 158, 255, 0.1);
    color: var(--el-color-primary, #409eff);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
}

.source-card {
  border: 1px solid var(--el-border-color-lighter, #e4e7ed);
  border-radius: 10px;
  padding: 12px;
  transition: all 0.2s ease;
  background: var(--el-bg-color, #fff);

  &:hover {
    border-color: var(--el-color-primary, #409eff);
    box-shadow: 0 2px 12px rgba(64, 158, 255, 0.1);
  }
}

.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.source-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;

  &.qq-icon {
    background: linear-gradient(135deg, #12b7f5, #0099ff);
  }
  &.wechat-icon {
    background: linear-gradient(135deg, #07c160, #06ae56);
  }
  &.feishu-icon {
    background: linear-gradient(135deg, #3370ff, #2b5ef5);
  }
  &.small-icon {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    font-size: 11px;
  }
}

.source-info {
  h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-primary, #303133);
  }
  .source-desc {
    margin: 1px 0 0;
    font-size: 11px;
    color: var(--el-text-color-secondary, #909399);
  }
}

// Detection section
.detect-section {
  margin-bottom: 8px;
}

.detect-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--el-fill-color-light, #f5f7fa);
  border-radius: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
}

.detect-empty {
  padding: 6px 10px;
  background: var(--el-fill-color-light, #f5f7fa);
  border-radius: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
}

.detected-paths {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.path-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--el-fill-color-lighter, #fafafa);
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: var(--el-fill-color, #f0f0f0);
  }

  &.selected {
    background: rgba(64, 158, 255, 0.06);
    border-color: var(--el-color-primary, #409eff);
  }
}

.path-icon {
  color: var(--el-color-primary, #409eff);
  flex-shrink: 0;
}

.path-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;

  .path-desc {
    font-size: 12px;
    font-weight: 500;
    color: var(--el-text-color-primary, #303133);
  }
  .path-dir {
    font-size: 10px;
    color: var(--el-text-color-placeholder, #c0c4cc);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.path-check {
  color: var(--el-color-primary, #409eff);
  flex-shrink: 0;
}

// Card bottom: scan info + actions
.card-bottom {
  display: flex;
  align-items: center;
  gap: 8px;
}

.scan-info {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: rgba(64, 158, 255, 0.06);
  border-radius: 6px;
  font-size: 12px;
  color: var(--el-color-primary, #409eff);
  white-space: nowrap;
  flex-shrink: 0;

  strong {
    font-weight: 600;
  }
}

// Actions
.card-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &.primary {
    background: var(--el-color-primary, #409eff);
    color: #fff;

    &:hover:not(:disabled) {
      background: var(--el-color-primary-light-3, #337ecc);
    }
  }

  &.secondary {
    background: var(--el-fill-color-light, #f5f7fa);
    color: var(--el-text-color-regular, #606266);

    &:hover:not(:disabled) {
      background: var(--el-fill-color, #e6e8eb);
    }
  }
}

// Progress
.progress-section {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.progress-bar {
  flex: 1;
  height: 4px;
  background: var(--el-fill-color-light, #f5f7fa);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--el-color-primary, #409eff);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 11px;
  color: var(--el-text-color-secondary, #909399);
  min-width: 32px;
  text-align: right;
}

// Spinner
.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--el-border-color-lighter, #e4e7ed);
  border-top-color: var(--el-color-primary, #409eff);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;

  &.small {
    width: 12px;
    height: 12px;
    border-width: 1.5px;
  }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

// Footer
.dialog-footer {
  display: flex;
  justify-content: flex-end;
}

.apple-btn {
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;

  &.primary {
    background: var(--el-color-primary, #409eff);
    color: #fff;

    &:hover {
      background: var(--el-color-primary-light-3, #337ecc);
    }
  }

  &.secondary {
    background: var(--el-fill-color-light, #f5f7fa);
    color: var(--el-text-color-regular, #606266);

    &:hover {
      background: var(--el-fill-color, #e6e8eb);
    }
  }
}

// Dark mode
:root.dark {
  .source-card {
    background: rgba(255, 255, 255, 0.04);
    border-color: rgba(255, 255, 255, 0.1);
  }

  .detect-loading,
  .detect-empty {
    background: rgba(255, 255, 255, 0.06);
  }

  .path-item {
    background: rgba(255, 255, 255, 0.04);

    &:hover {
      background: rgba(255, 255, 255, 0.08);
    }

    &.selected {
      background: rgba(64, 158, 255, 0.1);
    }
  }

  .action-btn.secondary,
  .apple-btn.secondary {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.8);

    &:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.12);
    }
  }

  .spinner {
    border-color: rgba(255, 255, 255, 0.1);
    border-top-color: var(--el-color-primary, #409eff);
  }

  .progress-bar {
    background: rgba(255, 255, 255, 0.08);
  }
}
</style>

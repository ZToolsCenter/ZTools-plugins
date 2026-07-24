<script setup lang="ts">
import { ref, watch, computed, onMounted } from 'vue'
import type { ScanResult, BreakRecord, ConflictStrategy } from '../types'

import DropArea from './widgets/DropArea.vue'
import FolderBar from './widgets/FolderBar.vue'
import ConfigBar from './widgets/ConfigBar.vue'
import PreviewPanel from './widgets/PreviewPanel.vue'
import ConfirmDialog from './widgets/ConfirmDialog.vue'
import HistoryList from './widgets/HistoryList.vue'

const props = defineProps({
  enterAction: { type: Object, required: true }
})

const targetDir = ref('')
const recursive = ref(false)
const conflictStrategy = ref<ConflictStrategy>('rename')
const scanResult = ref<ScanResult | null>(null)
const isLoading = ref(false)
const isBreaking = ref(false)
const breakResult = ref<BreakRecord | null>(null)
const history = ref<BreakRecord[]>([])
const error = ref('')
const successMessage = ref('')

const isDragOver = ref(false)
const showConfirm = ref(false)

const MAX_PREVIEW_FILES = 40
const MAX_PREVIEW_DIRS = 20
const showAllFiles = ref(false)
const showAllDirs = ref(false)

function basename(p: string) {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return idx >= 0 ? p.slice(idx + 1) : p
}

function formatRelativeTime(ts: number) {
  const diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
  return Math.floor(diff / 86400000) + '天前'
}

const previewFiles = computed(() => {
  if (!scanResult.value) return { items: [], remaining: 0 }
  const max = showAllFiles.value ? Infinity : MAX_PREVIEW_FILES
  const items = scanResult.value.files.slice(0, max)
  const remaining = scanResult.value.totalFiles - items.length
  return { items, remaining: Math.max(0, remaining) }
})

const previewDirs = computed(() => {
  if (!scanResult.value) return { items: [], remaining: 0 }
  const topDirs = scanResult.value.dirs.filter(d => d.relativePath.indexOf('/') === -1)
  const max = showAllDirs.value ? Infinity : MAX_PREVIEW_DIRS
  const items = topDirs.slice(0, max)
  const remaining = topDirs.length - items.length
  return { items, remaining: Math.max(0, remaining) }
})

interface DiffNode { name: string; type: 'file' | 'dir'; depth: number; status: 'move' | 'delete' | 'keep'; label: string }

const diffTree = computed(() => {
  if (!scanResult.value) return { nodes: [], after: '' }
  const sr = scanResult.value
  const nodes: DiffNode[] = []
  const isRecur = recursive.value
  const topFiles = sr.files.filter(f => f.relativePath.indexOf('/') === -1)
  const topDirs = sr.dirs.filter(d => d.relativePath.indexOf('/') === -1)
  let mc = 0; let dc = 0

  for (const f of topFiles) { nodes.push({ name: f.name, type: 'file', depth: 0, status: 'move', label: '移到父目录' }); mc++ }
  for (const d of topDirs) {
    const nf = sr.files.filter(f => f.relativePath.startsWith(d.name + '/'))
    const nd = sr.dirs.filter(dd => dd.relativePath.startsWith(d.name + '/') && dd.relativePath.indexOf('/') === d.name.length)
    const hn = nf.length > 0 || nd.length > 0
    if (isRecur) {
      nodes.push({ name: d.name, type: 'dir', depth: 0, status: 'delete', label: '提取后清空删除' }); dc++
      for (const f of nf) { nodes.push({ name: f.name, type: 'file', depth: f.relativePath.split('/').length, status: 'move', label: '提取到父目录' }); mc++ }
      const pnd = (pr: string, pd: number) => {
        for (const dd of sr.dirs.filter(x => x.relativePath.startsWith(pr) && x.relativePath.split('/').length === pd + 1)) {
          nodes.push({ name: dd.name, type: 'dir', depth: dd.relativePath.split('/').length, status: 'delete', label: '提取后清空删除' }); dc++
          pnd(dd.relativePath, dd.relativePath.split('/').length)
        }
      }
      pnd(d.name, 1)
    } else {
      nodes.push({ name: d.name, type: 'dir', depth: 0, status: 'move', label: hn ? '整体移到父目录' : '移到父目录' }); mc++
      if (hn) {
        for (const f of nf) nodes.push({ name: f.name, type: 'file', depth: f.relativePath.split('/').length, status: 'keep', label: '随目录移动' })
        for (const dd of nd) nodes.push({ name: dd.name, type: 'dir', depth: dd.relativePath.split('/').length, status: 'keep', label: '随目录移动' })
      }
    }
  }
  const after = isRecur
    ? (mc + dc) + ' 项变化 · ' + mc + ' 个文件移到父目录 · ' + dc + ' 个目录被清空'
    : mc + ' 项移到父目录' + (dc > 0 ? ' · ' + dc + ' 个空目录已删除' : '')
  return { nodes, after }
})

function loadHistory() {
  try { history.value = window.services.getHistory() } catch { history.value = [] }
}

function setRecursive(val: boolean) {
  recursive.value = val; showAllFiles.value = false; showAllDirs.value = false
  if (targetDir.value) loadDirectory(targetDir.value)
}

function loadDirectory(dirPath: string) {
  if (!dirPath) return
  targetDir.value = dirPath; error.value = ''; successMessage.value = ''; breakResult.value = null; isLoading.value = true
  setTimeout(() => {
    try {
      const r = window.services.scanDirectory(dirPath, recursive.value)
      r.files.forEach(f => f.relativePath = f.relativePath.replace(/\\/g, '/'))
      r.dirs.forEach(d => d.relativePath = d.relativePath.replace(/\\/g, '/'))
      scanResult.value = r
      if (r.totalFiles === 0 && r.totalDirs === 0) error.value = '该文件夹为空'
    } catch (err: any) { error.value = err.message || '读取文件夹失败'; scanResult.value = null }
    finally { isLoading.value = false }
  }, 0)
}

function handleSelectFolder() {
  const dirs = window.ztools.showOpenDialog({ title: '选择要解散的文件夹', properties: ['openDirectory'] })
  if (dirs && dirs.length > 0) loadDirectory(dirs[0])
}

function handleDragOver(e: DragEvent) { e.preventDefault(); isDragOver.value = true }
function handleDragLeave() { isDragOver.value = false }
function handleDrop(e: DragEvent) {
  e.preventDefault(); isDragOver.value = false
  const files = e.dataTransfer?.files
  if (files && files.length > 0) {
    const path = (window.ztools as any).getPathForFile(files[0])
    if (path) loadDirectory(path)
  }
}

function handleOpenInExplorer() { if (targetDir.value) (window.ztools as any).shellOpenPath(targetDir.value) }

function handleBreak() {
  if (!targetDir.value || !scanResult.value || (scanResult.value.totalFiles === 0 && scanResult.value.totalDirs === 0)) return
  showConfirm.value = true
}

function confirmExecute() {
  showConfirm.value = false
  if (!targetDir.value || !scanResult.value) return
  const startTime = Date.now(); isBreaking.value = true; error.value = ''; successMessage.value = ''
  try {
    const record = window.services.breakDirectory(targetDir.value, { recursive: recursive.value, conflictStrategy: conflictStrategy.value })
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    breakResult.value = record
    const p: string[] = ['已解散 ' + record.targetName]
    if (record.summary.totalMoved > 0) p.push('移动 ' + record.summary.totalMoved + ' 个文件')
    if (record.summary.totalDirsMoved > 0) p.push('移动 ' + record.summary.totalDirsMoved + ' 个目录')
    if (record.summary.totalDeleted > 0) p.push('删除 ' + record.summary.totalDeleted + ' 个空文件夹')
    p.push('耗时 ' + elapsed + 's')
    successMessage.value = p.join(' · ')
    scanResult.value = null; targetDir.value = ''; loadHistory()
  } catch (err: any) { error.value = err.message || '解散失败' }
  finally { isBreaking.value = false }
}

function handleUndo(record: BreakRecord) {
  try {
    const result = window.services.undoBreak(record)
    if (result.success) { successMessage.value = '已撤回 ' + record.targetName + ' 的解散操作'; breakResult.value = null; loadHistory() }
    else { error.value = result.errors.join('; ') }
  } catch (err: any) { error.value = err.message || '撤回失败' }
}

function handleClearHistory() { window.services.clearHistory(); history.value = [] }

function handleNewBreak() {
  breakResult.value = null; successMessage.value = ''; error.value = ''
  targetDir.value = ''; scanResult.value = null
}

watch(() => props.enterAction, (action: any) => {
  if (action.type === 'files' && action.payload && action.payload.length > 0) loadDirectory(action.payload[0].path)
}, { immediate: true })

onMounted(() => { loadHistory() })
</script>

<template>
  <div class="break-container">
    <div class="break-header">
      <span class="break-title">解散文件夹</span>
    </div>

    <DropArea
      v-if="!targetDir && !breakResult"
      :isDragOver="isDragOver"
      @select-folder="handleSelectFolder"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    />

    <FolderBar
      v-if="targetDir && !breakResult"
      :path="targetDir"
      @open-explorer="handleOpenInExplorer"
      @change="handleSelectFolder"
    />

    <div v-if="isLoading" class="loading">
      <div class="loading-spinner"></div>
      <span>扫描文件夹中...</span>
    </div>

    <div v-if="error && !isLoading" class="message message--error">
      <span>{{ error }}</span>
      <button class="btn btn-ghost btn-small" @click="error = ''">关闭</button>
    </div>

    <div v-if="successMessage && !targetDir" class="message message--success">
      <span>{{ successMessage }}</span>
      <button class="btn btn-ghost btn-small" @click="handleNewBreak">继续解散</button>
    </div>

    <ConfigBar
      v-if="targetDir && scanResult && !isLoading && !breakResult"
      :recursive="recursive"
      :conflictStrategy="conflictStrategy"
      @update:recursive="setRecursive"
      @update:conflictStrategy="conflictStrategy = $event"
    />

    <div v-if="targetDir && scanResult && !breakResult && !isLoading" class="action-bar">
      <button class="btn btn-primary btn-action"
        :disabled="isBreaking || (scanResult.totalFiles === 0 && scanResult.totalDirs === 0)"
        @click="handleBreak">
        <span v-if="isBreaking" class="loading-spinner loading-spinner--small"></span>
        <span>{{ isBreaking ? '解散中...' : '解散文件夹' }}</span>
      </button>
    </div>

    <PreviewPanel
      v-if="scanResult && targetDir && !breakResult && !isLoading"
      :scanResult="scanResult"
      :recursive="recursive"
      :diffTree="diffTree"
      :previewFiles="previewFiles"
      :previewDirs="previewDirs"
      :showAllFiles="showAllFiles"
      :showAllDirs="showAllDirs"
      @toggle-files="showAllFiles = true"
      @toggle-dirs="showAllDirs = true"
    />

    <HistoryList
      v-if="history.length > 0 && !targetDir"
      :history="history"
      @undo="handleUndo"
      @clear="handleClearHistory"
    />

    <ConfirmDialog
      :show="showConfirm"
      :scanResult="scanResult"
      :targetDir="targetDir"
      :recursive="recursive"
      :conflictStrategy="conflictStrategy"
      :isBreaking="isBreaking"
      @confirm="confirmExecute"
      @cancel="showConfirm = false"
    />
  </div>
</template>

<style scoped>
.break-container { padding: 16px 20px 20px; min-height: 200px; }
.break-header { margin-bottom: 16px; }
.break-title { font-size: 16px; font-weight: 600; color: var(--text); }
.loading {
  display: flex; align-items: center; gap: 8px;
  padding: 20px; justify-content: center;
  color: var(--text-secondary); font-size: 13px;
}
.action-bar { margin-bottom: 12px; }
</style>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import type { ProcessInfo } from '../env'

const props = defineProps<{
  addLog: (msg: string) => void
  flushDebugLog: () => void
  initialPath: string
  pathNonce: number
}>()

const filePath = ref('')
const processes = ref<ProcessInfo[]>([])
const loading = ref('')
const error = ref('')
const isDragOver = ref(false)
let dragCounter = 0

function handleDragEnter(e: DragEvent) { e.preventDefault(); dragCounter++; isDragOver.value = true }
function handleDragLeave(e: DragEvent) { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { isDragOver.value = false; dragCounter = 0 } }
function handleDragOver(e: DragEvent) { e.preventDefault(); e.stopPropagation() }

function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = false
  dragCounter = 0
  var dt = e.dataTransfer
  if (!dt || !dt.files || !dt.files[0]) {
    props.addLog('拖放: 无文件')
    return
  }
  var file = dt.files[0]
  props.addLog('拖放: ' + file.name)
  var fullPath = ''
  if (window.services.getPathForFile) {
    try { fullPath = window.services.getPathForFile(file) } catch (e) {}
  }
  if (!fullPath && (file as any).path) fullPath = (file as any).path
  if (fullPath) { filePath.value = fullPath; handleFind() }
}

onMounted(function () {
  if (props.initialPath) {
    filePath.value = props.initialPath
    handleFind()
  }
})

watch(
  function () { return props.pathNonce },
  function () {
    if (props.initialPath) {
      filePath.value = props.initialPath
      handleFind()
    }
  }
)

function handleBrowse() {
  var files = window.ztools.showOpenDialog({ title: '选择文件或目录', properties: ['openFile', 'openDirectory'] })
  if (files && files.length > 0) { filePath.value = files[0]; handleFind() }
}

async function handleFind() {
  if (!filePath.value.trim()) { error.value = '请输入文件路径'; return }
  loading.value = '正在扫描...'
  error.value = ''
  processes.value = []
  props.addLog('查找: ' + filePath.value.trim())
  try {
    var result = await window.services.findLockingProcesses(filePath.value.trim())
    props.flushDebugLog()
    processes.value = result
    props.addLog('找到 ' + result.length + ' 个进程')
    if (result.length === 0) error.value = '未检测到占用进程'
  } catch (err: any) {
    props.flushDebugLog()
    error.value = err.message || '扫描失败'
    props.addLog('错误: ' + error.value)
  } finally { loading.value = '' }
}

async function handleKill(proc: ProcessInfo) {
  loading.value = '正在结束 ' + proc.name + ' (PID:' + proc.pid + ')...'
  props.addLog('结束: ' + proc.name + ' PID:' + proc.pid)
  try {
    var result = await window.services.killProcess(proc.pid)
    props.flushDebugLog()
    props.addLog('结束结果: ' + result.message)
    window.ztools.showNotification(result.message)
    if (result.success) { await handleFind() }
    else { error.value = result.message }
  } catch (err: any) {
    props.flushDebugLog()
    error.value = err.message || '结束失败'
    props.addLog('结束出错: ' + error.value)
  } finally { loading.value = '' }
}

async function handleKillAll() {
  if (processes.value.length === 0) return
  const uniquePids = Array.from(new Set(processes.value.map(p => p.pid)))
  const count = uniquePids.length
  loading.value = '正在结束全部 ' + count + ' 个进程...'
  props.addLog('一键结束: ' + count + ' 个进程')

  const results: { success: boolean; message: string }[] = []
  for (const pid of uniquePids) {
    try {
      const result = await window.services.killProcess(pid)
      results.push(result)
      props.addLog('已结束 PID ' + pid + ': ' + (result.success ? '成功' : '失败'))
    } catch (err: any) {
      results.push({ success: false, message: err.message || '结束失败' })
      props.addLog('结束 PID ' + pid + ' 出错: ' + (err.message || '未知'))
    }
  }

  props.flushDebugLog()
  const successCount = results.filter(r => r.success).length
  const failCount = results.length - successCount

  if (failCount === 0) {
    window.ztools.showNotification('已结束全部 ' + successCount + ' 个进程')
  } else {
    window.ztools.showNotification('成功 ' + successCount + ', 失败 ' + failCount)
    error.value = failCount + ' 个进程无法结束'
  }

  await handleFind()
  loading.value = ''
}
</script>

<template>
  <div
    class="unlock"
    :class="{ 'drag-active': isDragOver }"
    @drop="handleDrop"
    @dragover="handleDragOver"
    @dragenter="handleDragEnter"
    @dragleave="handleDragLeave"
  >
    <div class="input-area">
      <input
        v-model="filePath"
        class="input"
        placeholder="输入路径或拖拽文件到此处"
        @keyup.enter="handleFind"
      />
      <button class="btn" @click="handleBrowse">浏览</button>
    </div>

    <div v-if="isDragOver" class="drop-hint">松开鼠标即可扫描</div>
    <div v-if="loading" class="loading">{{ loading }}</div>
    <div v-if="error && !loading" class="error">{{ error }}</div>

    <div v-if="processes.length > 0" class="results">
      <div class="kill-all-bar">
        <span class="count">找到 {{ processes.length }} 个进程</span>
        <button
          :disabled="!!loading"
          class="kill-all-btn"
          @click="handleKillAll"
        >一键结束全部</button>
      </div>
      <div v-for="(proc, idx) in processes" :key="idx" class="card" :class="{ suspicious: proc.source === 'suspicious' }">
        <div class="info">
          <span class="name">{{ proc.name }}</span>
          <span class="pid">PID: {{ proc.pid }}</span>
        </div>
        <div v-if="proc.exePath" class="exe-path">{{ proc.exePath }}</div>
        <div v-if="proc.reason" class="reason">{{ proc.reason }}</div>
        <div v-if="proc.cmdLine && proc.source === 'suspicious'" class="cmd-line" :title="proc.cmdLine">
          {{ proc.cmdLine.substring(0, 100) }}{{ proc.cmdLine.length > 100 ? '...' : '' }}
        </div>
        <button
          :disabled="!!loading"
          class="kill-btn"
          @click="handleKill(proc)"
        >kill</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.unlock { position: relative; border: 2px solid transparent; border-radius: 8px; min-height: 100px; transition: border-color 0.2s, background 0.2s; }
.unlock.drag-active { border-color: var(--primary-color, #42b883); background: rgba(66, 184, 131, 0.08); }
.drop-hint { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 16px; font-weight: 600; color: var(--primary-color, #42b883); pointer-events: none; }
.input-area { display: flex; gap: 8px; padding: 8px; border: 1px dashed var(--border-color, #555); border-radius: 6px; }
.input { flex: 1; border: none; outline: none; font-size: 14px; background: transparent; color: var(--text-color, #e0e0e0); }
.input::placeholder { color: var(--text-secondary, #888); }
.btn { padding: 4px 12px; border: 1px solid var(--border-color, #555); border-radius: 4px; background: transparent; cursor: pointer; font-size: 13px; color: var(--text-color, #e0e0e0); }
.btn:hover { background: var(--hover-color, #333); }
.loading { margin-top: 12px; text-align: center; color: var(--text-secondary, #aaa); }
.error { margin-top: 12px; padding: 10px; border-radius: 6px; background: #fff2f0; color: #cf1322; font-size: 13px; }
.results { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.card { padding: 12px; border: 1px solid var(--border-color, #444); border-radius: 8px; background: var(--card-bg, #2a2a2a); }
.info { display: flex; justify-content: space-between; align-items: center; }
.name { font-weight: 600; font-size: 14px; }
.pid { font-size: 12px; color: var(--text-secondary, #999); }
.exe-path { margin-top: 4px; font-size: 12px; color: var(--text-secondary, #999); word-break: break-all; }
.kill-btn { margin-top: 8px; padding: 6px 14px; border: none; border-radius: 4px; font-size: 13px; cursor: pointer; background: #fff1f0; color: #cf1322; }
.kill-btn:hover:not(:disabled) { background: #ffccc7; }
.kill-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.kill-all-bar { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: #2a2a2a; border: 1px solid #444; border-radius: 8px; margin-bottom: 8px; }
.kill-all-bar .count { font-size: 13px; color: #aaa; }
.kill-all-btn { padding: 6px 16px; border: none; border-radius: 4px; font-size: 13px; cursor: pointer; background: #ff4d4f; color: white; font-weight: 600; }
.kill-all-btn:hover:not(:disabled) { background: #ff7875; }
.kill-all-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.card.suspicious { border-color: #faad14; background: #fffbe6; }
.card.suspicious .name { color: #d48806; }
.reason { margin-top: 4px; font-size: 12px; color: #d48806; font-style: italic; }
.cmd-line { margin-top: 4px; font-size: 11px; color: #888; font-family: monospace; background: #1a1a1a; padding: 4px 6px; border-radius: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>

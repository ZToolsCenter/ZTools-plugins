<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import type { ProcessInfo, WhyInfo, MessageLevel } from '../env'
import { sourceLabel } from './labels'

const props = defineProps<{
  addLog: (msg: string) => void
  flushDebugLog: () => void
  initialPath: string
  pathNonce: number
}>()

const filePath = ref('')
const processes = ref<ProcessInfo[]>([])
const status = ref<{ text: string; level: MessageLevel } | null>(null)
const locked = ref<boolean | null>(null)
const blocked = ref<boolean | null>(null)
const pathState = ref('')
const isDirectory = ref(false)
const degraded = ref(false)
const loading = ref('')
const isDragOver = ref(false)
let dragCounter = 0

const stateLabel = computed(() => {
  if (pathState.value === 'missing') return '路径已不存在'
  if (processes.value.length > 0 || pathState.value === 'locked') {
    return blocked.value === false ? '已打开，但仍可删除' : (isDirectory.value ? '文件夹被占用' : '正在被占用')
  }
  if (pathState.value === 'directory') {
    if (blocked.value === true) return '文件夹被占用'
    if (blocked.value === false) return '文件夹未被占用'
    return '状态未知'
  }
  if (pathState.value === 'free') return isDirectory.value ? '文件夹未被占用' : '未被占用'
  return '状态未知'
})

const scanHint = computed(() => {
  if (!degraded.value) return ''
  return isDirectory.value
    ? '检测没有覆盖全部内容（权限不足或文件夹过大），可能还有占用者没有列出。以管理员身份运行 ZTools 可提高检出率。'
    : '检测没有全部完成，可能还有占用者没有列出。'
})

const processRows = computed(function () {
  return processes.value.map(function (proc) {
    return Object.assign({}, proc, { sourceText: sourceLabel(proc.why) })
  })
})

const stateTone = computed(() => {
  if (pathState.value === 'free') return 'ok'
  if (pathState.value === 'directory') {
    if (blocked.value === false) return 'ok'
    if (blocked.value === true) return 'bad'
    return 'warn'
  }
  if (pathState.value === 'unknown' || pathState.value === 'missing') return 'warn'
  return blocked.value === false ? 'warn' : 'bad'
})

function showStatus(text: string, level: MessageLevel) {
  status.value = { text: text, level: level }
}

function clearStatus() {
  status.value = null
}

function gitLabel(why?: WhyInfo): string {
  if (!why) return ''
  const repo = why.gitRepo || (why.process && why.process.gitRepo) || ''
  const branch = why.gitBranch || (why.process && why.process.gitBranch) || ''
  if (!repo) return ''
  return branch ? repo + '（' + branch + '）' : repo
}

function userLabel(why?: WhyInfo): string {
  return (why && (why.user || (why.process && why.process.user))) || ''
}

function startedLabel(why?: WhyInfo): string {
  return (why && (why.startedAt || (why.process && why.process.startedAt))) || ''
}

function workingDirLabel(why?: WhyInfo): string {
  return (why && (why.workingDir || (why.process && why.process.workingDir))) || ''
}

function handleDragEnter(e: DragEvent) { e.preventDefault(); dragCounter++; isDragOver.value = true }
function handleDragLeave(e: DragEvent) { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { isDragOver.value = false; dragCounter = 0 } }
function handleDragOver(e: DragEvent) { e.preventDefault(); e.stopPropagation() }

function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = false
  dragCounter = 0
  var dt = e.dataTransfer
  if (!dt || !dt.files || !dt.files[0]) return
  var file = dt.files[0]
  var fullPath = ''
  if (window.services.getPathForFile) {
    try { fullPath = window.services.getPathForFile(file) } catch (e) {}
  }
  if (!fullPath && (file as any).path) fullPath = (file as any).path
  if (fullPath) { filePath.value = fullPath; handleFind() }
  else { showStatus('没能读取到这个文件的完整路径，请改用「浏览」按钮选择。', 'warning') }
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
  var files = window.ztools.showOpenDialog({ title: '选择文件或文件夹', properties: ['openFile', 'openDirectory'] })
  if (files && files.length > 0) { filePath.value = files[0]; handleFind() }
}

async function handleFind(options?: { keepStatus?: boolean }) {
  if (!filePath.value.trim()) { showStatus('请先拖入文件，或输入完整路径。', 'warning'); return }
  if (!options || !options.keepStatus) clearStatus()
  loading.value = '正在检查占用情况…'
  processes.value = []
  locked.value = null
  blocked.value = null
  pathState.value = ''
  isDirectory.value = false
  degraded.value = false
  props.addLog('查找: ' + filePath.value.trim())
  try {
    var result = await window.services.findLockingProcesses(filePath.value.trim())
    props.flushDebugLog()
    processes.value = result.processes
    locked.value = result.locked
    blocked.value = result.blocked === undefined ? null : result.blocked
    pathState.value = result.state || ''
    isDirectory.value = !!result.isDirectory
    degraded.value = !!result.degraded
    props.addLog('结果: ' + result.processes.length + ' 个占用进程, engine=' + result.engine + ', state=' + result.state)
    result.processes.forEach(function (p) {
      if (p.why && p.why.ancestryText) props.addLog('  启动链 ' + p.name + ': ' + p.why.ancestryText)
    })

    if (!options || !options.keepStatus) {
      const kind = result.isDirectory ? '文件夹' : '文件'
      if (result.processes.length > 0) {
        showStatus('发现 ' + result.processes.length + ' 个进程正在使用该' + kind + '。' + (result.note || ''), result.noteLevel || 'warning')
      } else {
        showStatus(result.note || '未检测到占用。', result.noteLevel || 'info')
      }
    }
  } catch (err: any) {
    props.flushDebugLog()
    showStatus(err.message || '检查失败，请重试。', 'error')
    props.addLog('错误: ' + (err.message || err))
  } finally { loading.value = '' }
}

async function handleKill(proc: ProcessInfo) {
  loading.value = '正在结束「' + proc.name + '」…'
  props.addLog('结束进程: ' + proc.name + ' (PID ' + proc.pid + ')')
  try {
    var result = await window.services.killLockingProcess(filePath.value.trim(), proc.pid, proc.name)
    props.flushDebugLog()
    showStatus(result.message, result.level || (result.success ? 'success' : 'error'))
    props.addLog('结束结果: ' + result.message)
    window.ztools.showNotification(result.message)
    // 成功结束后刷新列表：仍在占用时保留提示，避免"以为已经解除"
    if (result.success) await handleFind({ keepStatus: true })
  } catch (err: any) {
    props.flushDebugLog()
    showStatus(err.message || '结束进程失败，请重试。', 'error')
    props.addLog('结束出错: ' + (err.message || err))
  } finally { loading.value = '' }
}

async function handleKillAll() {
  if (processes.value.length === 0) return
  const uniquePids = Array.from(new Set(processes.value.map(p => p.pid)))
  loading.value = '正在结束 ' + uniquePids.length + ' 个占用进程…'
  props.addLog('全部结束: ' + uniquePids.length + ' 个进程')
  try {
    const result = await window.services.killAllLockingProcesses(filePath.value.trim(), processes.value)
    props.flushDebugLog()
    showStatus(result.message, result.level || 'info')
    props.addLog('全部结束结果: ' + result.message)
    window.ztools.showNotification(result.message)
    if (result.success) await handleFind({ keepStatus: true })
  } catch (err: any) {
    props.flushDebugLog()
    showStatus(err.message || '结束进程失败，请重试。', 'error')
    props.addLog('全部结束出错: ' + (err.message || err))
  } finally { loading.value = '' }
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
        placeholder="拖入文件或文件夹，也可以直接输入路径"
        @keyup.enter="handleFind()"
      />
      <button class="btn" @click="handleBrowse">浏览</button>
    </div>

    <div v-if="isDragOver" class="drop-hint">松开鼠标即可检查</div>
    <div v-if="loading" class="loading">{{ loading }}</div>

    <div v-if="status && !loading" :class="['status', status.level]">{{ status.text }}</div>
    <div v-if="scanHint && !loading" class="scan-hint">{{ scanHint }}</div>

    <div v-if="processes.length > 0" class="results">
      <div class="kill-all-bar">
        <span class="count">{{ processes.length }} 个进程正在使用该{{ isDirectory ? '文件夹' : '文件' }}</span>
        <button
          :disabled="!!loading"
          class="kill-all-btn"
          @click="handleKillAll"
        >全部结束</button>
      </div>
      <div v-for="(proc, idx) in processRows" :key="proc.pid + '-' + idx" class="card">
        <div class="info">
          <span class="name">{{ proc.name }}</span>
          <span class="pid">PID {{ proc.pid }}</span>
        </div>
        <div v-if="proc.exePath" class="exe-path">{{ proc.exePath }}</div>

        <div v-if="proc.why && proc.why.ancestryText" class="why-block">
          <div class="why-label">它是怎么跑起来的</div>
          <div class="why-chain" :title="proc.why.ancestryText">{{ proc.why.ancestryText }}</div>
          <div class="why-meta">
            <span v-if="proc.sourceText" class="why-source">来源：{{ proc.sourceText }}</span>
          </div>
          <div v-if="workingDirLabel(proc.why)" class="why-cwd">工作目录：{{ workingDirLabel(proc.why) }}</div>
          <div v-if="gitLabel(proc.why)" class="why-cwd">代码仓库：{{ gitLabel(proc.why) }}</div>
          <div v-if="userLabel(proc.why)" class="why-cwd">运行用户：{{ userLabel(proc.why) }}</div>
          <div v-if="startedLabel(proc.why)" class="why-cwd">启动时间：{{ startedLabel(proc.why) }}</div>
        </div>

        <div v-if="proc.service" class="service-hint">
          该进程属于 Windows 服务「{{ proc.service }}」。直接结束可能触发服务自动重启，建议先停止该服务。
        </div>
        <div class="card-actions">
          <button
            :disabled="!!loading"
            class="kill-btn"
            @click="handleKill(proc)"
          >结束进程</button>
        </div>
      </div>
    </div>

    <div v-if="!loading && pathState && processes.length === 0" class="state-row">
      <span class="state-chip" :class="stateTone">{{ stateLabel }}</span>
    </div>
    <div v-else-if="!loading && !status && filePath.trim()" class="idle-hint">
      按回车开始检查。
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
.idle-hint { margin-top: 12px; text-align: center; font-size: 13px; color: var(--text-secondary, #888); }
.status { margin-top: 12px; padding: 10px 12px; border-radius: 6px; font-size: 13px; line-height: 1.6; border-left: 3px solid transparent; }
.status.success { background: rgba(82, 196, 26, 0.12); color: #95de64; border-left-color: #52c41a; }
.status.info { background: rgba(66, 184, 131, 0.10); color: #9fd8bd; border-left-color: #42b883; }
.status.warning { background: rgba(250, 173, 20, 0.12); color: #ffd666; border-left-color: #faad14; }
.status.error { background: rgba(255, 77, 79, 0.12); color: #ff9c9e; border-left-color: #ff4d4f; }
.scan-hint { margin-top: 8px; font-size: 12px; line-height: 1.6; color: var(--text-secondary, #999); }
.state-chip { display: inline-block; margin-top: 12px; padding: 4px 10px; border-radius: 10px; font-size: 12px; }
.state-chip.ok { background: rgba(82, 196, 26, 0.15); color: #95de64; }
.state-chip.warn { background: rgba(250, 173, 20, 0.15); color: #ffd666; }
.state-chip.bad { background: rgba(255, 77, 79, 0.15); color: #ff9c9e; }
.results { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.card { padding: 12px; border: 1px solid var(--border-color, #444); border-radius: 8px; background: var(--card-bg, #2a2a2a); }
.info { display: flex; justify-content: space-between; align-items: center; }
.name { font-weight: 600; font-size: 14px; }
.pid { font-size: 12px; color: var(--text-secondary, #999); }
.exe-path { margin-top: 4px; font-size: 12px; color: var(--text-secondary, #999); word-break: break-all; }
.why-block { margin-top: 8px; padding: 8px 10px; border-radius: 6px; background: rgba(66, 184, 131, 0.08); border-left: 3px solid var(--primary-color, #42b883); }
.why-label { font-size: 11px; letter-spacing: 0.4px; color: var(--primary-color, #42b883); font-weight: 700; margin-bottom: 4px; }
.why-chain { font-size: 12px; line-height: 1.5; color: var(--text-color, #e0e0e0); word-break: break-all; font-family: ui-monospace, Consolas, monospace; }
.why-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.why-source { font-size: 11px; padding: 1px 6px; border-radius: 3px; background: rgba(66, 184, 131, 0.2); color: var(--primary-color, #42b883); }
.why-cwd { margin-top: 4px; font-size: 11px; color: var(--text-secondary, #888); word-break: break-all; }
.service-hint { margin-top: 8px; padding: 8px 10px; border-radius: 6px; background: rgba(250, 173, 20, 0.10); color: #ffd666; font-size: 12px; line-height: 1.6; }
.card-actions { margin-top: 8px; display: flex; justify-content: flex-end; }
.kill-btn { padding: 6px 14px; border: none; border-radius: 4px; font-size: 13px; cursor: pointer; background: #fff1f0; color: #cf1322; }
.kill-btn:hover:not(:disabled) { background: #ffccc7; }
.kill-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.kill-all-bar { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: #2a2a2a; border: 1px solid #444; border-radius: 8px; margin-bottom: 8px; }
.kill-all-bar .count { font-size: 13px; color: #aaa; }
.kill-all-btn { padding: 6px 16px; border: none; border-radius: 4px; font-size: 13px; cursor: pointer; background: #ff4d4f; color: white; font-weight: 600; }
.kill-all-btn:hover:not(:disabled) { background: #ff7875; }
.kill-all-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>

<script setup lang="ts">
import { ref } from 'vue'
import type { ProcessInfo } from '../env'

const props = defineProps<{
  addLog: (msg: string) => void
  flushDebugLog: () => void
}>()

const filePath = ref('')
const mode = ref<'delete' | 'shred'>('shred')
const loading = ref('')
const error = ref('')
const result = ref('')
const isDragOver = ref(false)
let dragCounter = 0

// 占用确认弹窗状态
const lockedProcesses = ref<ProcessInfo[]>([])
const showLockConfirm = ref(false)

function handleDragEnter(e: DragEvent) { e.preventDefault(); dragCounter++; isDragOver.value = true }
function handleDragLeave(e: DragEvent) { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { isDragOver.value = false; dragCounter = 0 } }
function handleDragOver(e: DragEvent) { e.preventDefault(); e.stopPropagation() }

function handleDrop(e: DragEvent) {
  e.preventDefault(); isDragOver.value = false; dragCounter = 0
  var dt = e.dataTransfer; if (!dt || !dt.files || !dt.files[0]) return
  var file = dt.files[0]; props.addLog('拖放: ' + file.name)
  var fullPath = ''
  if (window.services.getPathForFile) { try { fullPath = window.services.getPathForFile(file) } catch (e) {} }
  if (!fullPath && (file as any).path) fullPath = (file as any).path
  if (fullPath) filePath.value = fullPath
}

function handleBrowse() {
  var files = window.ztools.showOpenDialog({ title: '选择文件或目录', properties: ['openFile', 'openDirectory'] })
  if (files && files.length > 0) filePath.value = files[0]
}

async function handleStart() {
  if (!filePath.value.trim()) { error.value = '请输入文件路径'; return }
  showLockConfirm.value = false
  lockedProcesses.value = []
  await doShred()
}

async function doShred() {
  if (!filePath.value.trim()) { error.value = '请输入文件路径'; return }
  loading.value = (mode.value === 'shred' ? '正在粉碎' : '正在删除') + '...'
  error.value = ''
  result.value = ''
  props.addLog('处理: ' + filePath.value.trim() + ' 模式=' + mode.value)
  try {
    var res = await window.services.shredPath(filePath.value.trim(), mode.value)
    props.flushDebugLog()

    if (res.locked) {
      props.addLog('文件被占用,正在查找占用进程...')
      loading.value = '文件被占用,正在查找占用进程...'
      var procs = await window.services.findLockingProcesses(filePath.value.trim())
      props.flushDebugLog()

      if (procs.length > 0) {
        // 找到占用进程,弹出确认对话框
        lockedProcesses.value = procs
        showLockConfirm.value = true
        loading.value = ''
        return
      }

      // 没找到具体进程,直接提示
      props.addLog('未找到占用进程,无法自动解除')
      error.value = res.message + '。未能检测到具体占用进程,请尝试以管理员身份运行或手动关闭相关程序。'
      return
    }

    if (res.success) {
      result.value = res.message
      props.addLog('完成: ' + res.message)
    } else {
      error.value = res.message
      props.addLog('失败: ' + res.message)
    }
  } catch (err: any) {
    props.flushDebugLog()
    error.value = err.message || '操作失败'
    props.addLog('错误: ' + error.value)
  } finally { loading.value = '' }
}

async function handleConfirmUnlock() {
  showLockConfirm.value = false
  var procs = lockedProcesses.value
  var uniqueProcs = procs.filter(function (p, idx, self) {
    return idx === self.findIndex(function (t) { return t.pid === p.pid })
  })
  loading.value = '正在结束 ' + uniqueProcs.length + ' 个占用进程...'
  props.addLog('确认解除占用,结束 ' + uniqueProcs.length + ' 个进程')

  for (var i = 0; i < uniqueProcs.length; i++) {
    var killRes = await window.services.killProcess(uniqueProcs[i].pid)
    props.flushDebugLog()
    props.addLog('已结束 ' + uniqueProcs[i].name + ' (PID:' + uniqueProcs[i].pid + ') ' + (killRes.success ? '成功' : '失败'))
  }

  lockedProcesses.value = []

  // 重试删除/粉碎
  loading.value = (mode.value === 'shred' ? '正在粉碎' : '正在删除') + ' (重试)...'
  try {
    var res = await window.services.shredPath(filePath.value.trim(), mode.value)
    props.flushDebugLog()
    if (res.success) {
      result.value = res.message
      props.addLog('完成: ' + res.message)
    } else {
      error.value = res.message
      props.addLog('失败: ' + res.message)
    }
  } catch (err: any) {
    props.flushDebugLog()
    error.value = err.message || '操作失败'
    props.addLog('错误: ' + error.value)
  } finally { loading.value = '' }
}

function handleCancelUnlock() {
  showLockConfirm.value = false
  lockedProcesses.value = []
  error.value = '已取消,文件未被处理'
}
</script>

<template>
  <div
    class="shredder"
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
        @keyup.enter="handleStart"
      />
      <button class="btn" @click="handleBrowse">浏览</button>
    </div>

    <div v-if="isDragOver" class="drop-hint">松开鼠标即可处理</div>

    <div class="mode-select">
      <label :class="{ active: mode === 'delete' }">
        <input type="radio" v-model="mode" value="delete" /> 删除
      </label>
      <label :class="{ active: mode === 'shred' }">
        <input type="radio" v-model="mode" value="shred" /> 粉碎
      </label>
    </div>

    <button class="start-btn" :disabled="!!loading" @click="handleStart">
      {{ mode === 'shred' ? '粉碎' : '删除' }}
    </button>

    <div v-if="loading" class="loading">{{ loading }}</div>
    <div v-if="result && !loading" class="success">{{ result }}</div>
    <div v-if="error && !loading" class="error">{{ error }}</div>

    <!-- 占用确认弹窗 -->
    <div v-if="showLockConfirm" class="lock-confirm-overlay">
      <div class="lock-confirm-dialog">
        <div class="lock-confirm-title">文件被占用</div>
        <div class="lock-confirm-desc">
          以下 {{ lockedProcesses.length }} 个进程正在占用该文件。是否结束这些进程并继续{{ mode === 'shred' ? '粉碎' : '删除' }}？
        </div>
        <div class="lock-proc-list">
          <div v-for="(proc, idx) in lockedProcesses" :key="idx" class="lock-proc-item">
            <span class="lock-proc-name">{{ proc.name }}</span>
            <span class="lock-proc-pid">PID: {{ proc.pid }}</span>
          </div>
        </div>
        <div class="lock-confirm-actions">
          <button class="lock-cancel-btn" @click="handleCancelUnlock">取消</button>
          <button class="lock-confirm-btn" @click="handleConfirmUnlock">结束进程并继续</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shredder { position: relative; border: 2px solid transparent; border-radius: 8px; min-height: 100px; transition: border-color 0.2s, background 0.2s; }
.shredder.drag-active { border-color: var(--primary-color, #42b883); background: rgba(66, 184, 131, 0.08); }
.drop-hint { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 16px; font-weight: 600; color: var(--primary-color, #42b883); pointer-events: none; }
.input-area { display: flex; gap: 8px; padding: 8px; border: 1px dashed var(--border-color, #555); border-radius: 6px; }
.input { flex: 1; border: none; outline: none; font-size: 14px; background: transparent; color: var(--text-color, #e0e0e0); }
.input::placeholder { color: var(--text-secondary, #888); }
.btn { padding: 4px 12px; border: 1px solid var(--border-color, #555); border-radius: 4px; background: transparent; cursor: pointer; font-size: 13px; color: var(--text-color, #e0e0e0); }
.btn:hover { background: var(--hover-color, #333); }
.mode-select { margin-top: 12px; display: flex; gap: 16px; }
.mode-select label { display: flex; align-items: center; gap: 4px; font-size: 14px; cursor: pointer; color: var(--text-secondary, #999); padding: 4px 10px; border-radius: 4px; border: 1px solid transparent; }
.mode-select label.active { color: var(--primary-color, #42b883); border-color: var(--primary-color, #42b883); }
.start-btn { margin-top: 12px; padding: 8px 20px; border: none; border-radius: 4px; font-size: 14px; cursor: pointer; background: var(--primary-color, #42b883); color: #fff; }
.start-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.loading { margin-top: 12px; text-align: center; color: var(--text-secondary, #aaa); }
.success { margin-top: 12px; padding: 10px; border-radius: 6px; background: #f6ffed; color: #389e0d; font-size: 13px; }
.error { margin-top: 12px; padding: 10px; border-radius: 6px; background: #fff2f0; color: #cf1322; font-size: 13px; }

.lock-confirm-overlay { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; border-radius: 8px; }
.lock-confirm-dialog { background: var(--card-bg, #2a2a2a); border-radius: 10px; padding: 20px; max-width: 90%; width: 360px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
.lock-confirm-title { font-size: 16px; font-weight: 700; color: var(--text-color, #e0e0e0); margin-bottom: 8px; }
.lock-confirm-desc { font-size: 13px; color: var(--text-secondary, #aaa); line-height: 1.6; margin-bottom: 14px; }
.lock-proc-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; max-height: 160px; overflow-y: auto; }
.lock-proc-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: rgba(255,255,255,0.05); border-radius: 6px; }
.lock-proc-name { font-size: 13px; font-weight: 600; color: var(--text-color, #e0e0e0); }
.lock-proc-pid { font-size: 12px; color: var(--text-secondary, #999); }
.lock-confirm-actions { display: flex; gap: 10px; justify-content: flex-end; }
.lock-cancel-btn { padding: 6px 16px; border: 1px solid var(--border-color, #555); border-radius: 4px; background: transparent; color: var(--text-color, #e0e0e0); font-size: 13px; cursor: pointer; }
.lock-cancel-btn:hover { background: var(--hover-color, #333); }
.lock-confirm-btn { padding: 6px 16px; border: none; border-radius: 4px; background: #ff4d4f; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; }
.lock-confirm-btn:hover { background: #ff7875; }
</style>

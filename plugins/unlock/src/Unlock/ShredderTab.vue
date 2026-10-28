<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ProcessInfo, MessageLevel } from '../env'

const props = defineProps<{
  addLog: (msg: string) => void
  flushDebugLog: () => void
}>()

const filePath = ref('')
const mode = ref<'delete' | 'shred'>('shred')
const loading = ref('')
const status = ref<{ text: string; level: MessageLevel } | null>(null)
const isDragOver = ref(false)
let dragCounter = 0

// 占用确认弹窗状态
const lockedProcesses = ref<ProcessInfo[]>([])
const showLockConfirm = ref(false)
const isDirectory = ref(false)
// 结束进程后重试仍被占用时，只自动重新扫描并弹出一次，避免死循环
let reopenUsed = false

const targetKind = computed(() => isDirectory.value ? '文件夹' : '文件')

function showStatus(text: string, level: MessageLevel) {
  status.value = { text: text, level: level }
}

function actionName(): string {
  return mode.value === 'shred' ? '粉碎' : '删除'
}

function handleDragEnter(e: DragEvent) { e.preventDefault(); dragCounter++; isDragOver.value = true }
function handleDragLeave(e: DragEvent) { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { isDragOver.value = false; dragCounter = 0 } }
function handleDragOver(e: DragEvent) { e.preventDefault(); e.stopPropagation() }

function handleDrop(e: DragEvent) {
  e.preventDefault(); isDragOver.value = false; dragCounter = 0
  var dt = e.dataTransfer; if (!dt || !dt.files || !dt.files[0]) return
  var file = dt.files[0]
  var fullPath = ''
  if (window.services.getPathForFile) { try { fullPath = window.services.getPathForFile(file) } catch (e) {} }
  if (!fullPath && (file as any).path) fullPath = (file as any).path
  if (fullPath) filePath.value = fullPath
  else showStatus('没能读取到这个文件的完整路径，请改用「浏览」按钮选择。', 'warning')
}

function handleBrowse() {
  var files = window.ztools.showOpenDialog({ title: '选择文件或文件夹', properties: ['openFile', 'openDirectory'] })
  if (files && files.length > 0) filePath.value = files[0]
}

async function handleStart() {
  if (!filePath.value.trim()) { showStatus('请先拖入文件，或输入完整路径。', 'warning'); return }
  showLockConfirm.value = false
  lockedProcesses.value = []
  reopenUsed = false
  isDirectory.value = false
  await doShred()
}

async function doShred() {
  if (!filePath.value.trim()) { showStatus('请先拖入文件，或输入完整路径。', 'warning'); return }
  loading.value = '正在' + actionName() + '…'
  status.value = null
  props.addLog('处理: ' + filePath.value.trim() + ' 模式=' + mode.value)
  try {
    var res = await window.services.shredPath(filePath.value.trim(), mode.value)
    props.flushDebugLog()

    // 有占用时优先走结束进程流程；只有纯权限问题才直接提示
    if (res.locked) {
      props.addLog('目标被占用，正在查找占用进程...')
      loading.value = '正在查找占用它的程序…'
      var scan = await window.services.findLockingProcesses(filePath.value.trim())
      props.flushDebugLog()
      isDirectory.value = !!scan.isDirectory
      var procs = scan.processes || []
      var kind = scan.isDirectory ? '文件夹' : '文件'

      if (procs.length > 0) {
        lockedProcesses.value = procs
        showLockConfirm.value = true
        loading.value = ''
        return
      }

      // 没能查到具体进程：给出可执行的下一步，而不是"未知错误"
      props.addLog('未找到占用进程，无法自动解除')
      showStatus(
        kind + '正被占用，但没能查到具体是哪个程序。' + (scan.note || '可以尝试以管理员身份运行 ZTools 后重试。'),
        'warning'
      )
      return
    }

    if (res.permissionDenied) {
      props.addLog('权限不足: ' + res.message)
      showStatus(res.message, 'warning')
      return
    }

    if (res.success) {
      showStatus('已完成：' + res.message + '。', 'success')
      props.addLog('完成: ' + res.message)
    } else {
      showStatus(res.message || (actionName() + '失败，请重试。'), res.partial ? 'warning' : 'error')
      props.addLog('失败: ' + res.message)
    }
  } catch (err: any) {
    props.flushDebugLog()
    showStatus(err.message || '操作失败，请重试。', 'error')
    props.addLog('错误: ' + (err.message || err))
  } finally { loading.value = '' }
}

async function handleConfirmUnlock() {
  showLockConfirm.value = false
  var procs = lockedProcesses.value
  var uniqueProcs = procs.filter(function (p, idx, self) {
    return idx === self.findIndex(function (t) { return t.pid === p.pid })
  })
  var target = filePath.value.trim()
  loading.value = '正在结束 ' + uniqueProcs.length + ' 个占用进程…'
  props.addLog('确认解除占用，结束 ' + uniqueProcs.length + ' 个进程')

  try {
    var killResult = await window.services.killAllLockingProcesses(target, uniqueProcs)
    props.flushDebugLog()
    props.addLog('解除结果: ' + killResult.message)
    window.ztools.showNotification(killResult.message)
    lockedProcesses.value = []

    // 占用没解除就没必要立刻重试删除/粉碎，先把原因讲清楚
    if (killResult.released === false) {
      showStatus(killResult.message, 'warning')
      return
    }

    loading.value = '正在' + actionName() + '…'
    var res = await window.services.shredPath(target, mode.value)
    props.flushDebugLog()
    if (res.success) {
      showStatus('已解除占用并完成' + actionName() + '：' + res.message + '。', 'success')
      props.addLog('完成: ' + res.message)
      return
    }

    // 结束后重试仍被占用：自动重新扫描并再弹出一次占用确认，最多一次
    if (res.locked && !reopenUsed) {
      reopenUsed = true
      loading.value = '仍有占用，正在重新检查…'
      var again = await window.services.findLockingProcesses(target)
      props.flushDebugLog()
      isDirectory.value = !!again.isDirectory
      var remain = again.processes || []
      if (remain.length > 0) {
        lockedProcesses.value = remain
        showLockConfirm.value = true
        loading.value = ''
        showStatus('还有 ' + remain.length + ' 个进程在使用该' + targetKind.value + '。', 'warning')
        return
      }
      showStatus(res.message || ('仍有内容被占用，无法继续' + actionName() + '。'), 'warning')
      return
    }

    showStatus(res.message || (actionName() + '失败，请重试。'), res.locked ? 'warning' : 'error')
    props.addLog('失败: ' + res.message)
  } catch (err: any) {
    props.flushDebugLog()
    showStatus(err.message || '操作失败，请重试。', 'error')
    props.addLog('错误: ' + (err.message || err))
  } finally { loading.value = '' }
}

function handleCancelUnlock() {
  showLockConfirm.value = false
  lockedProcesses.value = []
  showStatus('已取消，' + targetKind.value + '保持不变。', 'info')
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
        placeholder="拖入文件或文件夹，也可以直接输入路径"
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

    <div class="hint-row">
      <span class="hint-text">粉碎：覆写内容后再删除，无法恢复；删除：直接移除，不覆写内容</span>
    </div>

    <button class="start-btn" :disabled="!!loading" @click="handleStart">
      {{ mode === 'shred' ? '开始粉碎' : '开始删除' }}
    </button>

    <div v-if="loading" class="loading">{{ loading }}</div>
    <div v-if="status && !loading" :class="['status', status.level]">{{ status.text }}</div>

    <!-- 占用确认弹窗 -->
    <div v-if="showLockConfirm" class="lock-confirm-overlay">
      <div class="lock-confirm-dialog">
        <div class="lock-confirm-title">{{ targetKind }}正被占用</div>
        <div class="lock-confirm-desc">
          <template v-if="isDirectory">下面 {{ lockedProcesses.length }} 个程序打开了这个文件夹里的内容，或工作目录就在其中。结束它们后即可继续{{ actionName() }}，未保存的内容可能会丢失。</template>
          <template v-else>下面 {{ lockedProcesses.length }} 个程序正在使用这个文件。结束它们后即可继续{{ actionName() }}，未保存的内容可能会丢失。</template>
        </div>
        <div class="lock-proc-list">
          <div v-for="(proc, idx) in lockedProcesses" :key="idx" class="lock-proc-item">
            <div class="lock-proc-main">
              <span class="lock-proc-name">{{ proc.name }}</span>
              <span class="lock-proc-pid">PID {{ proc.pid }}</span>
            </div>
            <div v-if="proc.why && proc.why.ancestryText" class="lock-proc-why">{{ proc.why.ancestryText }}</div>
            <div v-if="proc.service" class="lock-proc-why">Windows 服务：{{ proc.service }}</div>
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
.hint-row { margin-top: 8px; }
.hint-text { font-size: 12px; color: var(--text-secondary, #888); }
.start-btn { margin-top: 12px; padding: 8px 20px; border: none; border-radius: 4px; font-size: 14px; cursor: pointer; background: var(--primary-color, #42b883); color: #fff; }
.start-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.loading { margin-top: 12px; text-align: center; color: var(--text-secondary, #aaa); }
.status { margin-top: 12px; padding: 10px 12px; border-radius: 6px; font-size: 13px; line-height: 1.6; border-left: 3px solid transparent; }
.status.success { background: rgba(82, 196, 26, 0.12); color: #95de64; border-left-color: #52c41a; }
.status.info { background: rgba(66, 184, 131, 0.10); color: #9fd8bd; border-left-color: #42b883; }
.status.warning { background: rgba(250, 173, 20, 0.12); color: #ffd666; border-left-color: #faad14; }
.status.error { background: rgba(255, 77, 79, 0.12); color: #ff9c9e; border-left-color: #ff4d4f; }

.lock-confirm-overlay { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; border-radius: 8px; }
.lock-confirm-dialog { background: var(--card-bg, #2a2a2a); border-radius: 10px; padding: 20px; max-width: 90%; width: 380px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
.lock-confirm-title { font-size: 16px; font-weight: 700; color: var(--text-color, #e0e0e0); margin-bottom: 8px; }
.lock-confirm-desc { font-size: 13px; color: var(--text-secondary, #aaa); line-height: 1.6; margin-bottom: 14px; }
.lock-proc-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; max-height: 200px; overflow-y: auto; }
.lock-proc-item { padding: 8px 10px; background: rgba(255,255,255,0.05); border-radius: 6px; }
.lock-proc-main { display: flex; justify-content: space-between; align-items: center; }
.lock-proc-name { font-size: 13px; font-weight: 600; color: var(--text-color, #e0e0e0); }
.lock-proc-pid { font-size: 12px; color: var(--text-secondary, #999); }
.lock-proc-why { margin-top: 4px; font-size: 11px; color: var(--text-secondary, #888); font-family: ui-monospace, Consolas, monospace; word-break: break-all; }
.lock-confirm-actions { display: flex; gap: 10px; justify-content: flex-end; }
.lock-cancel-btn { padding: 6px 16px; border: 1px solid var(--border-color, #555); border-radius: 4px; background: transparent; color: var(--text-color, #e0e0e0); font-size: 13px; cursor: pointer; }
.lock-cancel-btn:hover { background: var(--hover-color, #333); }
.lock-confirm-btn { padding: 6px 16px; border: none; border-radius: 4px; background: #ff4d4f; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; }
.lock-confirm-btn:hover { background: #ff7875; }
</style>

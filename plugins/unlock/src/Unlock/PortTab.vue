<script setup lang="ts">
import { ref, computed } from 'vue'
import type { PortInfo, MessageLevel } from '../env'
import { sourceLabel, stateLabel } from './labels'

const props = defineProps<{
  addLog: (msg: string) => void
  flushDebugLog: () => void
}>()

const port = ref<number | string>('')
const entries = ref<PortInfo[]>([])
const loading = ref('')
const status = ref<{ text: string; level: MessageLevel } | null>(null)

const rows = computed(function () {
  return entries.value.map(function (entry) {
    return Object.assign({}, entry, {
      stateText: stateLabel(entry.state),
      sourceText: sourceLabel(entry.why)
    })
  })
})

function showStatus(text: string, level: MessageLevel) {
  status.value = { text: text, level: level }
}

async function handleScan() {
  var portNum = parseInt(String(port.value), 10)
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    showStatus('请输入 1 - 65535 之间的端口号。', 'warning')
    return
  }
  loading.value = '正在检查端口 ' + portNum + ' …'
  status.value = null
  entries.value = []
  props.addLog('端口扫描: ' + portNum)
  try {
    var result = await window.services.findPortProcess(portNum)
    props.flushDebugLog()
    entries.value = result
    props.addLog('找到 ' + result.length + ' 条记录')
    result.forEach(function (e) {
      if (e.why && e.why.ancestryText) props.addLog('  启动链 ' + e.processName + ': ' + e.why.ancestryText)
    })
    if (result.length === 0) {
      showStatus('端口 ' + portNum + ' 当前没有程序在监听，可以放心使用。', 'success')
    } else {
      showStatus('端口 ' + portNum + ' 上有 ' + result.length + ' 条监听或连接记录。结束进程前请先确认它们可以安全关闭。', 'info')
    }
  } catch (err: any) {
    props.flushDebugLog()
    showStatus(err.message || '检查失败，请重试。', 'error')
    props.addLog('错误: ' + (err.message || err))
  } finally { loading.value = '' }
}

async function handleKill(entry: PortInfo) {
  loading.value = '正在结束「' + entry.processName + '」…'
  props.addLog('结束进程: ' + entry.processName + ' (PID ' + entry.pid + ')')
  try {
    var result = await window.services.killPortProcess(parseInt(String(port.value), 10), entry.pid, entry.processName)
    props.flushDebugLog()
    showStatus(result.message, result.level || 'info')
    props.addLog('结束结果: ' + result.message)
    window.ztools.showNotification(result.message)
    if (result.success) await handleScan()
  } catch (err: any) {
    props.flushDebugLog()
    showStatus(err.message || '结束进程失败，请重试。', 'error')
    props.addLog('结束出错: ' + (err.message || err))
  } finally { loading.value = '' }
}

async function handleKillAll() {
  if (entries.value.length === 0) return
  const uniquePids = Array.from(new Set(entries.value.map(e => e.pid)))
  loading.value = '正在结束 ' + uniquePids.length + ' 个进程…'
  props.addLog('全部结束: ' + uniquePids.length + ' 个进程')
  try {
    const result = await window.services.killAllPortProcesses(parseInt(String(port.value), 10), entries.value)
    props.flushDebugLog()
    showStatus(result.message, result.level || 'info')
    props.addLog('全部结束结果: ' + result.message)
    window.ztools.showNotification(result.message)
    if (result.success) await handleScan()
  } catch (err: any) {
    props.flushDebugLog()
    showStatus(err.message || '结束进程失败，请重试。', 'error')
    props.addLog('全部结束出错: ' + (err.message || err))
  } finally { loading.value = '' }
}
</script>

<template>
  <div class="port">
    <div class="input-area">
      <input
        v-model.number="port"
        class="input"
        type="number"
        min="1"
        max="65535"
        placeholder="端口号，例如 8080"
        @keyup.enter="handleScan"
      />
      <button class="btn" @click="handleScan">检查</button>
    </div>
    <div v-if="loading" class="loading">{{ loading }}</div>
    <div v-if="status && !loading" :class="['status', status.level]">{{ status.text }}</div>

    <div v-if="entries.length > 0" class="table-wrap">
      <div class="kill-all-bar">
        <span class="count">{{ entries.length }} 条监听或连接记录</span>
        <button
          :disabled="!!loading"
          class="kill-all-btn"
          @click="handleKillAll"
        >全部结束</button>
      </div>
      <table class="port-table">
        <thead>
          <tr>
            <th>进程</th>
            <th>PID</th>
            <th>协议</th>
            <th>状态</th>
            <th>地址</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, idx) in rows" :key="idx">
            <td>
              <div class="proc-name">{{ row.processName }}</div>
              <div v-if="row.exePath" class="proc-path">{{ row.exePath }}</div>
              <div v-if="row.why && row.why.ancestryText" class="why-chain" :title="row.why.ancestryText">{{ row.why.ancestryText }}</div>
              <div v-if="row.sourceText" class="why-source">来源：{{ row.sourceText }}</div>
              <div v-if="row.why && row.why.workingDir" class="why-source">工作目录：{{ row.why.workingDir }}</div>
            </td>
            <td>{{ row.pid }}</td>
            <td><span :class="['proto', row.protocol === 'TCP' ? 'tcp' : 'udp']">{{ row.protocol }}</span></td>
            <td>{{ row.stateText }}</td>
            <td>{{ row.localAddress }}:{{ row.localPort }}</td>
            <td>
              <button
                :disabled="!!loading"
                class="kill-btn"
                @click="handleKill(row)"
              >结束进程</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.input-area { display: flex; gap: 8px; padding: 8px; border: 1px dashed var(--border-color, #555); border-radius: 6px; }
.input { flex: 1; border: none; outline: none; font-size: 14px; background: transparent; color: var(--text-color, #e0e0e0); }
.input::placeholder { color: var(--text-secondary, #888); }
.input[type=number] { appearance: textfield; -moz-appearance: textfield; -webkit-appearance: textfield; }
.input[type=number]::-webkit-inner-spin-button { display: none; }
.btn { padding: 4px 12px; border: 1px solid var(--border-color, #555); border-radius: 4px; background: transparent; cursor: pointer; font-size: 13px; color: var(--text-color, #e0e0e0); }
.btn:hover { background: var(--hover-color, #333); }
.loading { margin-top: 12px; text-align: center; color: var(--text-secondary, #aaa); }
.status { margin-top: 12px; padding: 10px 12px; border-radius: 6px; font-size: 13px; line-height: 1.6; border-left: 3px solid transparent; }
.status.success { background: rgba(82, 196, 26, 0.12); color: #95de64; border-left-color: #52c41a; }
.status.info { background: rgba(66, 184, 131, 0.10); color: #9fd8bd; border-left-color: #42b883; }
.status.warning { background: rgba(250, 173, 20, 0.12); color: #ffd666; border-left-color: #faad14; }
.status.error { background: rgba(255, 77, 79, 0.12); color: #ff9c9e; border-left-color: #ff4d4f; }
.table-wrap { margin-top: 12px; overflow-x: auto; }
.kill-all-bar { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: #2a2a2a; border: 1px solid #444; border-radius: 8px; margin-bottom: 8px; }
.kill-all-bar .count { font-size: 13px; color: #aaa; }
.kill-all-btn { padding: 6px 16px; border: none; border-radius: 4px; font-size: 13px; cursor: pointer; background: #ff4d4f; color: white; font-weight: 600; }
.kill-all-btn:hover:not(:disabled) { background: #ff7875; }
.kill-all-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.port-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.port-table th { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border-color, #444); color: var(--text-secondary, #999); font-weight: 600; font-size: 11px; letter-spacing: 0.5px; }
.port-table td { padding: 8px 10px; border-bottom: 1px solid var(--border-color, #333); vertical-align: top; }
.proc-name { font-weight: 600; }
.proc-path { font-size: 11px; color: var(--text-secondary, #999); word-break: break-all; max-width: 220px; }
.why-chain { margin-top: 4px; font-size: 11px; font-family: ui-monospace, Consolas, monospace; color: var(--primary-color, #42b883); word-break: break-all; max-width: 280px; }
.why-source { margin-top: 2px; font-size: 11px; color: var(--text-secondary, #888); }
.proto { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: 600; }
.proto.tcp { background: #096dd9; color: #fff; }
.proto.udp { background: #722ed1; color: #fff; }
.kill-btn { padding: 4px 10px; border: none; border-radius: 4px; font-size: 12px; cursor: pointer; background: #fff1f0; color: #cf1322; white-space: nowrap; }
.kill-btn:hover:not(:disabled) { background: #ffccc7; }
.kill-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>

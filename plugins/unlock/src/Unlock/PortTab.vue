<script setup lang="ts">
import { ref } from 'vue'
import type { PortInfo } from '../env'

const props = defineProps<{
  addLog: (msg: string) => void
  flushDebugLog: () => void
}>()

const port = ref<number | string>('')
const entries = ref<PortInfo[]>([])
const loading = ref('')
const error = ref('')

async function handleScan() {
  var portNum = parseInt(String(port.value), 10)
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) { error.value = '请输入有效端口 (1-65535)'; return }
  loading.value = '正在扫描端口 ' + portNum + '...'
  error.value = ''
  entries.value = []
  props.addLog('端口扫描: ' + portNum)
  try {
    var result = await window.services.findPortProcess(portNum)
    props.flushDebugLog()
    entries.value = result
    props.addLog('找到 ' + result.length + ' 条记录')
    if (result.length === 0) error.value = '没有进程监听端口 ' + portNum
  } catch (err: any) {
    props.flushDebugLog()
    error.value = err.message || '扫描失败'
    props.addLog('错误: ' + error.value)
  } finally { loading.value = '' }
}

async function handleKill(entry: PortInfo) {
  loading.value = '正在结束 PID:' + entry.pid + '...'
  props.addLog('端口结束: ' + entry.processName + ' PID:' + entry.pid)
  try {
    var result = await window.services.killProcess(entry.pid)
    props.flushDebugLog()
    props.addLog('结束结果: ' + result.message)
    window.ztools.showNotification(result.message)
    if (result.success) { await handleScan() }
    else { error.value = result.message }
  } catch (err: any) {
    props.flushDebugLog()
    error.value = err.message || '结束失败'
    props.addLog('结束出错: ' + error.value)
  } finally { loading.value = '' }
}

async function handleKillAll() {
  if (entries.value.length === 0) return
  const uniquePids = Array.from(new Set(entries.value.map(e => e.pid)))
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

  await handleScan()
  loading.value = ''
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
        placeholder="端口号 (如 8080)"
        @keyup.enter="handleScan"
      />
      <button class="btn" @click="handleScan">扫描</button>
    </div>

    <div v-if="loading" class="loading">{{ loading }}</div>
    <div v-if="error && !loading" class="error">{{ error }}</div>

    <div v-if="entries.length > 0" class="table-wrap">
      <div class="kill-all-bar">
        <span class="count">找到 {{ entries.length }} 条记录</span>
        <button
          :disabled="!!loading"
          class="kill-all-btn"
          @click="handleKillAll"
        >一键结束全部</button>
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
          <tr v-for="(entry, idx) in entries" :key="idx">
            <td>
              <div class="proc-name">{{ entry.processName }}</div>
              <div v-if="entry.exePath" class="proc-path">{{ entry.exePath }}</div>
            </td>
            <td>{{ entry.pid }}</td>
            <td><span :class="['proto', entry.protocol === 'TCP' ? 'tcp' : 'udp']">{{ entry.protocol }}</span></td>
            <td>{{ entry.state }}</td>
            <td>{{ entry.localAddress }}:{{ entry.localPort }}</td>
            <td>
              <button
                :disabled="!!loading"
                class="kill-btn"
                @click="handleKill(entry)"
              >kill</button>
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
.error { margin-top: 12px; padding: 10px; border-radius: 6px; background: #fff2f0; color: #cf1322; font-size: 13px; }
.table-wrap { margin-top: 12px; overflow-x: auto; }
.kill-all-bar { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: #2a2a2a; border: 1px solid #444; border-radius: 8px; margin-bottom: 8px; }
.kill-all-bar .count { font-size: 13px; color: #aaa; }
.kill-all-btn { padding: 6px 16px; border: none; border-radius: 4px; font-size: 13px; cursor: pointer; background: #ff4d4f; color: white; font-weight: 600; }
.kill-all-btn:hover:not(:disabled) { background: #ff7875; }
.kill-all-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.port-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.port-table th { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border-color, #444); color: var(--text-secondary, #999); font-weight: 600; font-size: 11px; letter-spacing: 0.5px; }
.port-table td { padding: 8px 10px; border-bottom: 1px solid var(--border-color, #333); }
.proc-name { font-weight: 600; }
.proc-path { font-size: 11px; color: var(--text-secondary, #999); word-break: break-all; max-width: 200px; }
.proto { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: 600; }
.proto.tcp { background: #096dd9; color: #fff; }
.proto.udp { background: #722ed1; color: #fff; }
.kill-btn { padding: 4px 10px; border: none; border-radius: 4px; font-size: 12px; cursor: pointer; background: #fff1f0; color: #cf1322; }
.kill-btn:hover:not(:disabled) { background: #ffccc7; }
.kill-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>

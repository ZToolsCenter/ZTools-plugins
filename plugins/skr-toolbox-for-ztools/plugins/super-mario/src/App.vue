<script setup>
import { ref, onMounted, computed } from 'vue'

const ports = ref([])
const loading = ref(false)
const error = ref(null)
const searchQuery = ref('')

// Execute shell command
const runCommand = async (cmd) => {
  try {
    const result = await window.ztools.shell.exec(cmd)
    return typeof result === 'string' ? result : result.stdout
  } catch (err) {
    console.error(`Command failed: ${cmd}`, err)
    throw err
  }
}

const parseLsofOutput = (output) => {
  const lines = output.trim().split('\n')
  const parsed = []
  
  for (const line of lines) {
    if (!line.trim()) continue
    if (line.startsWith('COMMAND')) continue

    const parts = line.trim().split(/\s+/)
    
    if (parts.length >= 9) {
      parsed.push({
        command: parts[0],
        pid: parts[1],
        user: parts[2],
        fd: parts[3],
        type: parts[4],
        device: parts[5],
        sizeOff: parts[6],
        node: parts[7],
        name: parts.find(p => p.includes(':') && !p.startsWith('0x')) || parts[8],
        protocol: parts.find(p => p === 'TCP' || p === 'UDP') || 'TCP',
        state: parts.find(p => p === '(LISTEN)') || '(LISTEN)'
      })
    }
  }
  return parsed
}

const fetchPorts = async () => {
  loading.value = true
  error.value = null
  try {
    const cmd = 'lsof -Pn -i -sTCP:LISTEN | grep "TCP"'
    const output = await runCommand(cmd)
    ports.value = parseLsofOutput(output || '')
  } catch (err) {
    error.value = '获取端口失败。请确保已安装 lsof 且有权限。'
    console.error(err)
  } finally {
    loading.value = false
  }
}

const killProcess = async (pid, force = false) => {
  if (!pid) return
  
  const cmd = force ? `kill -9 ${pid}` : `kill ${pid}`
  try {
    await runCommand(cmd)
    setTimeout(() => {
      fetchPorts()
    }, 500)
  } catch (err) {
    alert(`终止进程 ${pid} 失败: ${err.message}`)
  }
}

const handleRefresh = () => {
  fetchPorts()
}

const filteredPorts = computed(() => {
  if (!searchQuery.value) return ports.value
  const lower = searchQuery.value.toLowerCase()
  return ports.value.filter(p => 
    p.command.toLowerCase().includes(lower) ||
    p.pid.includes(lower) ||
    p.name.toLowerCase().includes(lower)
  )
})

onMounted(() => {
  fetchPorts()
  
  // Setup search input
  if (window.ztools && window.ztools.setSubInput) {
    window.ztools.setSubInput((text) => {
      console.log('Search input:', text)
      searchQuery.value = text.text
    }, '搜索端口 (进程名, PID, 地址)...')
  }
})
</script>

<template>
  <div class="port-app">
    <div class="header">
      <div></div>
      <div class="actions">
        <button class="btn primary" @click="handleRefresh" :disabled="loading">
          {{ loading ? '刷新中...' : '刷新' }}
        </button>
      </div>
    </div>

    <div v-if="error" class="error-message">
      {{ error }}
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>进程名称</th>
            <th>PID</th>
            <!-- User column removed -->
            <th>协议</th>
            <th>地址 (端口)</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="filteredPorts.length === 0 && !loading">
            <td colspan="6" class="empty-state">
              {{ searchQuery ? '未找到匹配的端口。' : '未发现监听端口。' }}
            </td>
          </tr>
          <tr v-for="port in filteredPorts" :key="port.pid + port.name">
            <td>{{ port.command }}</td>
            <td>{{ port.pid }}</td>
            <!-- User column removed -->
            <td>{{ port.protocol }}</td>
            <td class="highlight">{{ port.name }}</td>
            <td>{{ port.state }}</td>
            <td>
              <div class="action-group">
                <button class="btn danger small" @click="killProcess(port.pid)">终止</button>
                <button class="btn danger small outline" @click="killProcess(port.pid, true)">强制终止</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style>
:root {
  --primary-color: #3b82f6;
  --danger-color: #ef4444;
  --bg-color: #f9fafb;
  --text-color: #1f2937;
  --border-color: #e5e7eb;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background-color: var(--bg-color);
  color: var(--text-color);
}
</style>

<style scoped>
.port-app {
  max-width: 1000px;
  margin: 0 auto;
  padding: 20px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.table-container {
  background: white;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

th, td {
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
}

th {
  background-color: #f3f4f6;
  font-weight: 600;
  color: #4b5563;
}

tr:last-child td {
  border-bottom: none;
}

tr:hover {
  background-color: #f9fafb;
}

.highlight {
  color: var(--primary-color);
  font-family: monospace;
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.btn.primary {
  background-color: var(--primary-color);
  color: white;
}

.btn.primary:hover {
  background-color: #2563eb;
}

.btn.danger {
  background-color: var(--danger-color);
  color: white;
}

.btn.danger:hover {
  background-color: #dc2626;
}

.btn.small {
  padding: 4px 8px;
  font-size: 12px;
}

.btn.outline {
  background-color: transparent;
  border: 1px solid currentColor;
  color: var(--danger-color);
}

.btn.outline:hover {
  background-color: #fef2f2;
}

.action-group {
  display: flex;
  gap: 8px;
}

.error-message {
  background-color: #fee2e2;
  color: #991b1b;
  padding: 12px;
  border-radius: 6px;
  margin-bottom: 20px;
}

.empty-state {
  text-align: center;
  color: #6b7280;
  padding: 32px;
}
</style>

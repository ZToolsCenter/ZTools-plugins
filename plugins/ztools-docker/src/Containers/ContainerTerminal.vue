<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { imageBasename } from './imageBadge'
import { imageCommands } from './shellCommands'
import CSelect from './CSelect.vue'
import type { TerminalInfo } from '../types'

const props = defineProps<{
  containerId: string
  running: boolean
  image: string
}>()

const emit = defineEmits<{ (e: 'toast', msg: string): void }>()

// 系统终端检测与选择（跳转外部终端用）
const terminals = ref<TerminalInfo[]>([])
const selectedTerminalId = ref('')

const terminalOptions = computed(() => terminals.value.map((t) => ({ value: t.id, label: t.name })))

// 每容器独立终端会话池：切换容器时旧会话保活（handle 不 stop、xterm 实例保留），
// 仅把对应容器的 xterm DOM 挂到唯一 term-body 上显示。
interface TermSession {
  id: string
  term: Terminal | null
  fit: FitAddon | null
  handle: { write(s: string): void; stop(): void } | null
  status: Ref<'idle' | 'connecting' | 'connected' | 'closed'>
  inputBuffer: string
}

const sessions = new Map<string, TermSession>()
const activeId = ref(props.containerId)
const termBodyEl = ref<HTMLDivElement | null>(null)

const activeSession = computed(() => sessions.get(activeId.value) || null)
const activeStatus = computed(() => activeSession.value?.status.value || 'idle')
const statusText = computed(
  () => ({ idle: '未连接', connecting: '连接中…', connected: '已连接', closed: '已断开' })[activeStatus.value]
)

// ===== 会话管理 =====

function createSession(id: string) {
  const s: TermSession = { id, term: null, fit: null, handle: null, status: ref('idle'), inputBuffer: '' }
  sessions.set(id, s)
  return s
}

// 清空唯一 term-body（切换会话前移除上一个 xterm DOM）
function clearTermBody() {
  if (termBodyEl.value) termBodyEl.value.innerHTML = ''
}

// 初始化 xterm 并 open 到唯一 term-body；首次连接
function initTerm(s: TermSession) {
  if (!termBodyEl.value || s.term) return
  clearTermBody()
  const term = new Terminal({
    cursorBlink: true,
    convertEol: true,
    fontSize: 12,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    theme: { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#aeafad' }
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(termBodyEl.value)
  try { fit.fit() } catch (e) { /* 忽略 */ }
  term.onData((d) => onInput(s, d))
  s.term = term
  s.fit = fit
  if (props.running) connect(s)
}

// 把会话的 xterm DOM 挂到 term-body（切换容器时移动，内容保留）
function showSession(s: TermSession) {
  if (s.term && termBodyEl.value && s.term.element) {
    clearTermBody()
    termBodyEl.value.appendChild(s.term.element)
    try { s.fit?.fit() } catch (e) { /* 忽略 */ }
    try { s.term.focus() } catch (e) { /* 忽略 */ }
  }
}

// 确保容器会话可见（无则创建并初始化）
function ensureSession(id: string) {
  nextTick(() => {
    if (!termBodyEl.value) return
    let s = sessions.get(id)
    if (!s) s = createSession(id)
    if (!s.term) initTerm(s)
    else showSession(s)
  })
}

function connect(s: TermSession) {
  if (!s.id || !props.running) return
  if (s.handle) { s.handle.stop(); s.handle = null }
  s.status.value = 'connecting'
  s.handle = window.services.docker.attachContainerShell(
    s.id,
    (data) => s.term?.write(data),
    (err) => {
      s.status.value = 'closed'
      s.term?.write(`\r\n[${err.code === 'SHELL_CLOSED' ? '会话已结束' : '错误'}] ${err.message}\r\n`)
    }
  )
  s.status.value = 'connected'
}

function stopSession(s: TermSession) {
  if (s.handle) { s.handle.stop(); s.handle = null }
}

function onResize() {
  const s = activeSession.value
  if (s?.fit) {
    try { s.fit.fit() } catch (e) { /* 忽略 */ }
  }
}

// 手动断开当前容器终端
function disconnectActive() {
  const s = activeSession.value
  if (!s) return
  stopSession(s)
  s.status.value = 'closed'
  s.inputBuffer = ''
  s.term?.write('\r\n[已手动断开]\r\n')
}

function reconnectActive() {
  const s = activeSession.value
  if (!s) return
  stopSession(s)
  s.term?.clear()
  s.inputBuffer = ''
  connect(s)
}

// ===== 输入（本地行编辑 + 回显） =====

function onInput(s: TermSession, d: string) {
  if (!s.handle) return
  if (d === '\r') {
    s.term?.write('\r\n')
    s.handle.write(s.inputBuffer + '\n')
    saveCommand(s.inputBuffer)
    s.inputBuffer = ''
    return
  }
  if (d === '\x7f' || d === '\b') {
    if (s.inputBuffer.length) {
      s.inputBuffer = s.inputBuffer.slice(0, -1)
      s.term?.write('\b \b')
    }
    return
  }
  if (d === '\x03') {
    s.term?.write('^C\r\n')
    s.handle.write('\x03')
    s.inputBuffer = ''
    return
  }
  if (d.startsWith('\x1b')) return
  if (/^[\x20-\x7e -￿]+$/.test(d)) {
    s.inputBuffer += d
    s.term?.write(d)
  }
}

// ===== 命令面板：镜像常用命令 + 本镜像历史 =====

const commands = computed(() => imageCommands(props.image))
const history = ref<string[]>([])

function historyKey() {
  return 'term_cmds_' + imageBasename(props.image)
}

function loadHistory(): string[] {
  const v = window.ztools.dbStorage.getItem(historyKey())
  return Array.isArray(v) ? v.filter((x: unknown) => typeof x === 'string') : []
}

function saveCommand(cmd: string) {
  const text = cmd.trim()
  if (!text) return
  const list = loadHistory().filter((x) => x !== text)
  list.unshift(text)
  const trimmed = list.slice(0, 50)
  window.ztools.dbStorage.setItem(historyKey(), trimmed)
  history.value = trimmed
}

function runCommand(cmd: string) {
  const s = activeSession.value
  if (!s?.handle) return
  s.term?.write(cmd + '\r\n')
  s.handle.write(cmd + '\n')
  s.inputBuffer = ''
  saveCommand(cmd)
}

function clearHistory() {
  window.ztools.dbStorage.setItem(historyKey(), [])
  history.value = []
}

// 跳转外部系统终端
async function openSystemTerminal() {
  if (!selectedTerminalId.value) return
  const conn = window.services.docker.getConnection()
  const prefix =
    conn.type === 'context' ? `--context ${conn.name} ` : conn.type === 'host' ? `--host ${conn.host} ` : ''
  const res = await window.services.terminals.openTerminal(
    selectedTerminalId.value,
    `docker ${prefix}exec -it ${activeId.value} sh`
  )
  emit('toast', res.ok ? (res.message || `已用 ${res.used} 打开终端`) : res.message)
}

// ===== 生命周期 =====

watch(
  () => props.containerId,
  (id) => {
    activeId.value = id
    ensureSession(id)
  },
  { immediate: true }
)

watch(
  () => props.running,
  (running) => {
    const s = activeSession.value
    if (!s) return
    if (running) {
      if (!s.handle || s.status.value === 'closed') connect(s)
    } else {
      stopSession(s)
      s.status.value = 'idle'
      s.inputBuffer = ''
      s.term?.clear()
    }
  }
)

watch(
  () => props.image,
  () => {
    history.value = loadHistory()
  }
)

onMounted(() => {
  history.value = loadHistory()
  terminals.value = window.services.terminals.detectTerminals()
  if (terminals.value.length) selectedTerminalId.value = terminals.value[0].id
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  // 程序关闭/组件卸载：释放所有会话
  for (const s of sessions.values()) {
    stopSession(s)
    s.term?.dispose()
  }
  sessions.clear()
})
</script>

<template>
  <div class="term-panel">
    <div class="term-toolbar">
      <span class="term-status" :class="activeStatus">{{ statusText }}</span>
      <button class="btn" :disabled="!running || activeStatus === 'connecting'" @click="reconnectActive">重连</button>
      <button class="btn danger" :disabled="!activeSession" @click="disconnectActive">断开</button>
      <span class="term-hint">输入命令回车执行 · 每容器独立终端，切换不中断</span>
      <button class="btn" :disabled="!selectedTerminalId" @click="openSystemTerminal">打开终端</button>
      <CSelect v-model="selectedTerminalId" :options="terminalOptions" :disabled="!terminals.length" placeholder="选择终端" />
    </div>

    <div ref="termBodyEl" class="term-body"></div>
    <div v-if="!running" class="term-cover">容器未运行，无法进入终端</div>

    <div class="cmd-panel">
      <div class="cmd-section">
        <span class="cmd-label">常用</span>
        <button v-for="c in commands" :key="c" class="chip" @click="runCommand(c)">{{ c }}</button>
      </div>
      <div class="cmd-section">
        <span class="cmd-label">历史</span>
        <button v-for="c in history" :key="c" class="chip" @click="runCommand(c)">{{ c }}</button>
        <button v-if="history.length" class="chip clear" @click="clearHistory">清空历史</button>
        <span v-if="!history.length" class="cmd-empty">暂无历史命令，输入命令回车后自动记录</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.term-panel {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}
.term-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.term-status { font-size: 12px; font-weight: 600; }
.term-status.connected { color: var(--ok); }
.term-status.connecting { color: var(--warn); }
.term-status.idle, .term-status.closed { color: var(--text-secondary); }
.term-hint {
  flex: 1;
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.term-select {
  height: var(--ctrl-height);
  border: 1px solid var(--border-color);
  background: var(--panel-bg);
  color: inherit;
  padding: 0 6px;
  border-radius: var(--ctrl-radius);
  min-width: 90px;
}
.term-body {
  flex: 1;
  min-height: 0;
  border-radius: var(--ctrl-radius);
  overflow: hidden;
  background: #1e1e1e;
  padding: 4px;
}
.term-cover {
  position: absolute;
  inset: 34px 0 0 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(30, 30, 30, 0.92);
  color: #d4d4d4;
  font-size: 13px;
  border-radius: 0 0 var(--ctrl-radius) var(--ctrl-radius);
  z-index: 2;
}
.cmd-panel {
  margin-top: 6px;
  border: 1px solid var(--border-color);
  border-radius: var(--ctrl-radius);
  background: var(--panel-bg);
  padding: 6px 8px;
  max-height: 140px;
  overflow-y: auto;
}
.cmd-section {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
}
.cmd-section:last-child { margin-bottom: 0; }
.cmd-label { font-size: 11px; color: var(--text-secondary); flex-shrink: 0; margin-right: 4px; }
.chip {
  border: 1px solid var(--border-color);
  background: transparent;
  color: inherit;
  font-size: 11px;
  padding: 0 8px;
  height: 20px;
  line-height: 1;
  border-radius: 10px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip:hover { border-color: var(--blue); color: var(--blue); }
.chip.clear { color: var(--text-secondary); }
.cmd-empty { font-size: 11px; color: var(--text-secondary); }
</style>

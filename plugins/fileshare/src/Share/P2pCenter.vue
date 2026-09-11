<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'

// Props: an event tick that increments every time the parent sees a P2P event,
// so this modal can refresh without owning its own global listener.
const props = defineProps<{
  eventTick: number
}>()

const emit = defineEmits<{
  close: []
  preview: [payload: { name: string; path: string }]
}>()

// ---- State ----
const sessions = ref<any[]>([])
const selectedId = ref('')
const messages = ref<any[]>([])
const draft = ref('')
const msgSince = ref(0)
const listScrollEl = ref<HTMLElement | null>(null)
const msgScrollEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLElement | null>(null)
const showList = ref(false) // narrow layout: list vs chat view

const selected = computed(() => sessions.value.find(s => s.id === selectedId.value) || null)

const pendingSessions = computed(() => sessions.value.filter(s => s.status === 'pending'))
const otherSessions = computed(() => sessions.value.filter(s => s.status === 'active'))

let refreshTimer: ReturnType<typeof setInterval> | null = null
let msgTimer: ReturnType<typeof setInterval> | null = null

// ---- Load / poll ----
function loadSessions() {
  sessions.value = window.services.getP2pSessions()
  // If the selected session was deleted, fall back to none
  if (selectedId.value && !sessions.value.some(s => s.id === selectedId.value)) {
    selectedId.value = ''
    messages.value = []
  }
}

function loadMessages() {
  if (!selectedId.value) return
  const next = window.services.getP2pMessages(selectedId.value, msgSince.value)
  if (next.length > 0) {
    messages.value = messages.value.concat(next)
    msgSince.value = next[next.length - 1].seq
    scrollToBottom()
  }
  // While this conversation is open, keep its unread badge cleared.
  window.services.markP2pRead(selectedId.value)
  loadSessions()
}

function scrollToBottom() {
  nextTick(() => {
    const el = msgScrollEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

// ---- Actions ----
function openChat(id: string) {
  selectedId.value = id
  msgSince.value = 0
  messages.value = []
  showList.value = false
  loadMessages()
  scrollToBottom()
  nextTick(() => inputEl.value?.focus())
}

function backToList() {
  selectedId.value = ''
  messages.value = []
  showList.value = true
}

function respond(session: any, accept: boolean) {
  window.services.respondP2p(session.id, accept)
  loadSessions()
}

function send() {
  const text = draft.value.trim()
  if (!text || !selectedId.value) return
  if (window.services.sendP2pMessage(selectedId.value, text)) {
    draft.value = ''
    loadMessages()
    loadSessions()
  }
}

function onInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

function sendFiles() {
  if (!selectedId.value) return
  const files = window.ztools.showOpenDialog({
    title: '选择要发送的文件（可多选）',
    properties: ['openFile', 'multiSelections']
  })
  if (!files || files.length === 0) return
  window.services.sendP2pFiles(selectedId.value, files)
  loadMessages()
  loadSessions()
}

// ---- Custom confirm (replaces native window.confirm) + in-app toast ----
const confirmBox = ref<{ show: boolean; title: string; message: string; resolve: ((v: boolean) => void) | null }>({
  show: false, title: '', message: '', resolve: null
})

function askConfirm(message: string, title: string): Promise<boolean> {
  return new Promise((resolve) => {
    confirmBox.value = { show: true, title, message, resolve }
  })
}

function confirmOk() {
  const r = confirmBox.value.resolve
  confirmBox.value.show = false
  if (r) r(true)
}

function confirmCancel() {
  const r = confirmBox.value.resolve
  confirmBox.value.show = false
  if (r) r(false)
}

const toastMsg = ref('')
const toastShow = ref(false)
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string) {
  toastMsg.value = msg
  toastShow.value = true
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastShow.value = false }, 2000)
}

async function removeSession(session: any) {
  const ok = await askConfirm(
    `确定删除与 ${session.peerName || session.peerIp} 的私密连接？`,
    '删除连接'
  )
  if (!ok) return
  window.services.deleteP2p(session.id)
  if (selectedId.value === session.id) {
    selectedId.value = ''
    messages.value = []
  }
  loadSessions()
  showToast('已删除连接')
}

// Click a text bubble to copy it to the clipboard.
const copiedId = ref('')
let copiedTimer: ReturnType<typeof setTimeout> | null = null

function copyText(m: any) {
  if (!m || m.kind !== 'text') return
  window.ztools.copyText(m.text)
  copiedId.value = m.id
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => { copiedId.value = '' }, 1200)
  showToast('已复制')
}

async function removeMessage(m: any) {
  const ok = await askConfirm('删除这条消息？服务端留存也会一并删除。', '删除消息')
  if (!ok) return
  window.services.deleteP2pMessage(selectedId.value, m.id)
  loadMessages()
  showToast('已删除消息')
}

function previewFile(m: any, f: any) {
  const path = window.services.getP2pFileSavePath(selectedId.value, f.fileId)
  if (path) emit('preview', { name: f.name, path })
}

function revealFile(m: any, f: any) {
  const path = window.services.getP2pFileSavePath(selectedId.value, f.fileId)
  if (path) window.ztools.shellShowItemInFolder(path)
}

function saveFileAs(m: any, f: any) {
  const dest = window.ztools.showSaveDialog({ title: '另存为', defaultPath: f.name })
  if (!dest) return
  if (window.services.saveP2pFileAs(selectedId.value, f.fileId, dest)) {
    // no toast infra inside modal; use system notification as lightweight feedback
    window.ztools.showNotification('文件已保存')
  }
}

// ---- Lifecycle ----
function refresh() {
  loadSessions()
  if (selectedId.value) loadMessages()
}

onMounted(() => {
  loadSessions()
  if (sessions.value.length > 0) showList.value = true
  refreshTimer = setInterval(() => {
    loadSessions()
    if (selectedId.value) loadMessages()
  }, 2500)
  msgTimer = setInterval(() => {
    if (selectedId.value) loadMessages()
  }, 1500)
})

onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  if (msgTimer) clearInterval(msgTimer)
})

watch(() => props.eventTick, () => refresh())

// ---- Formatting helpers ----
function formatTime(ts: number) {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDay(ts: number) {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatSize(size: number) {
  if (size >= 1024 * 1024 * 1024) return (size / 1024 / 1024 / 1024).toFixed(1) + ' GB'
  if (size >= 1024 * 1024) return (size / 1024 / 1024).toFixed(1) + ' MB'
  if (size >= 1024) return (size / 1024).toFixed(1) + ' KB'
  return size + ' B'
}

function lastPreview(s: any) {
  if (s.lastMessage) return s.lastMessage
  return s.status === 'pending' ? '等待你同意连接申请' : ''
}

function statusText(s: any) {
  if (s.status === 'pending') return '待处理'
  if (s.status === 'rejected') return '已拒绝'
  if (s.status === 'deleted') return '已删除'
  return s.peerOnline ? '在线' : '离线'
}

const PREVIEW_EXTS = ['jpg','jpeg','png','gif','svg','webp','bmp','ico','mp3','wav','ogg','flac','aac','m4a','mp4','webm','mkv','avi','mov','flv','txt','log','csv','json','xml','yml','yaml','toml','ini','cfg','conf','env','md','markdown','js','mjs','cjs','ts','tsx','jsx','py','java','c','cpp','h','hpp','rs','go','rb','php','swift','kt','kts','scala','dart','lua','r','sql','sh','bash','zsh','bat','cmd','ps1','html','htm','css','scss','less','vue','svelte']

function canPreviewFileByName(name: string) {
  const ext = (name || '').split('.').pop()?.toLowerCase() || ''
  return PREVIEW_EXTS.includes(ext)
}
</script>

<template>
  <div class="p2p-overlay" @click.self="emit('close')">
    <div class="p2p-window">
      <div class="p2p-header">
        <span class="p2p-title">消息</span>
        <span v-if="pendingSessions.length > 0" class="p2p-pending-hint">{{ pendingSessions.length }} 个待处理申请</span>
        <div style="flex:1"></div>
        <button class="p2p-close" @click="emit('close')">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="p2p-body">
        <!-- Left: session list -->
        <aside class="p2p-list" :class="{ 'p2p-list-mobile': showList }">
          <template v-if="pendingSessions.length > 0">
            <div class="p2p-group-label">连接申请</div>
            <div v-for="s in pendingSessions" :key="s.id" class="p2p-session pending">
              <div class="p2p-session-main">
                <div class="p2p-avatar">{{ (s.peerName || s.peerIp).slice(0, 1) }}</div>
                <div class="p2p-session-info">
                  <div class="p2p-session-name">{{ s.peerName }} <span class="p2p-session-ip">{{ s.peerIp }}</span></div>
                  <div class="p2p-session-preview">{{ s.requestMessage || '想与你建立私密连接' }}</div>
                </div>
              </div>
              <div class="p2p-session-actions">
                <button class="p2p-btn accept" @click="respond(s, true)">同意</button>
                <button class="p2p-btn reject" @click="respond(s, false)">拒绝</button>
              </div>
            </div>
          </template>

          <div v-if="otherSessions.length > 0" class="p2p-group-label">会话</div>
          <div v-for="s in otherSessions" :key="s.id" class="p2p-session" :class="{ active: selectedId === s.id }" @click="openChat(s.id)">
            <div class="p2p-session-main">
              <div class="p2p-avatar">{{ (s.peerName || s.peerIp).slice(0, 1) }}</div>
              <div class="p2p-session-info">
                <div class="p2p-session-name">
                  {{ s.peerName }}
                  <span class="p2p-session-ip">{{ s.peerIp }}</span>
                  <span class="p2p-status-dot" :class="{ online: s.peerOnline }"></span>
                </div>
                <div class="p2p-session-preview">{{ lastPreview(s) }}</div>
              </div>
            </div>
            <div class="p2p-session-side">
              <span v-if="s.unreadByHost > 0" class="p2p-unread">{{ s.unreadByHost }}</span>
              <button v-if="s.status === 'active'" class="p2p-del" title="删除连接" @click.stop="removeSession(s)">
                <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
              </button>
              <span v-else class="p2p-status-text">{{ statusText(s) }}</span>
            </div>
          </div>

          <div v-if="sessions.length === 0" class="p2p-list-empty">
            <p>暂无连接</p>
            <p class="p2p-list-empty-sub">远程设备访问你的共享页面后，可申请点对点私密连接</p>
          </div>
        </aside>

        <!-- Right: chat -->
        <section v-if="selected" class="p2p-chat" :class="{ 'p2p-chat-mobile': !showList }">
          <div class="p2p-chat-header">
            <button v-if="showList" class="p2p-back" @click="backToList">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span class="p2p-chat-title">{{ selected.peerName || selected.peerIp }}</span>
            <span class="p2p-chat-sub">{{ selected.peerIp }}</span>
            <span class="p2p-status-dot" :class="{ online: selected.peerOnline }"></span>
            <div style="flex:1"></div>
            <button class="p2p-del" title="删除连接" @click="removeSession(selected)">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </div>

          <div class="p2p-msgs" ref="msgScrollEl">
            <template v-if="messages.length > 0">
              <div v-for="m in messages" :key="m.seq">
                <div v-if="m.kind === 'system'" class="p2p-msg-system">{{ m.text }}</div>
                <div v-else class="p2p-msg-row" :class="m.from === 'host' ? 'mine' : 'theirs'">
                  <div class="p2p-msg-head">
                    <span class="p2p-msg-time">{{ formatTime(m.createdAt) }}</span>
                    <button v-if="m.kind === 'text'" class="p2p-msg-copy" :class="{ copied: copiedId === m.id }" title="复制内容" @click="copyText(m)">
                      <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" fill="none" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                    </button>
                    <button class="p2p-msg-del" title="删除消息" @click="removeMessage(m)">
                      <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" fill="none" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    </button>
                  </div>
                  <template v-if="m.kind === 'text'">
                    <div class="p2p-bubble">{{ m.text }}</div>
                  </template>
                  <div v-else-if="m.kind === 'files' && m.files && m.files.length > 0" class="p2p-file-card">
                    <div class="p2p-files-list">
                      <div v-for="f in m.files" :key="f.fileId" class="p2p-file-item">
                        <div class="p2p-file-icon">
                          <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" fill="none" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        </div>
                        <div class="p2p-file-info">
                          <div class="p2p-file-name">{{ f.name }}</div>
                          <div class="p2p-file-meta">{{ formatSize(f.size) }}</div>
                          <div class="p2p-file-actions">
                            <button v-if="canPreviewFileByName(f.name)" class="p2p-file-btn" @click="previewFile(m, f)">预览</button>
                            <button class="p2p-file-btn" @click="revealFile(m, f)">在文件夹中显示</button>
                            <button v-if="f.direction === 'in'" class="p2p-file-btn" @click="saveFileAs(m, f)">另存为</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </template>
            <div v-else class="p2p-chat-empty">还没有消息，打个招呼吧</div>
          </div>

          <div class="p2p-inputbar">
            <button class="p2p-file-send" title="发送文件" @click="sendFiles">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
            </button>
            <textarea
              ref="inputEl"
              v-model="draft"
              class="p2p-input"
              rows="1"
              placeholder="输入消息，Enter 发送，Shift+Enter 换行"
              @keydown="onInputKeydown"
            ></textarea>
            <button class="p2p-send" :disabled="!draft.trim()" @click="send">发送</button>
          </div>
        </section>

        <section v-else class="p2p-chat p2p-chat-empty-view">
          <svg viewBox="0 0 24 24" width="52" height="52" stroke="currentColor" fill="none" stroke-width="1" opacity="0.25"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>
          <p>选择左侧会话开始对话</p>
        </section>
      </div>
    </div>

    <!-- In-app toast -->
    <Transition name="toast-fade">
      <div v-if="toastShow" class="p2p-toast">{{ toastMsg }}</div>
    </Transition>

    <!-- Custom confirm (replaces native window.confirm) -->
    <div v-if="confirmBox.show" class="p2p-confirm-overlay" @click.self="confirmCancel">
      <div class="p2p-confirm">
        <div class="p2p-confirm-title">{{ confirmBox.title }}</div>
        <div class="p2p-confirm-msg">{{ confirmBox.message }}</div>
        <div class="p2p-confirm-actions">
          <button class="p2p-confirm-btn" @click="confirmCancel">取消</button>
          <button class="p2p-confirm-btn danger" @click="confirmOk">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.p2p-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 150;
}

.p2p-window {
  background: var(--bg);
  border-radius: 12px;
  width: 92%;
  max-width: 880px;
  height: 74vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.p2p-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.p2p-title {
  font-size: 14px;
  font-weight: 600;
}

.p2p-pending-hint {
  font-size: 11px;
  color: var(--primary);
  background: var(--primary-light);
  padding: 2px 10px;
  border-radius: 10px;
}

.p2p-close {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
}

.p2p-close:hover {
  background: var(--bg-tertiary);
}

.p2p-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* ---- List ---- */
.p2p-list {
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  overflow-y: auto;
  padding: 8px 0;
}

.p2p-group-label {
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 10px 16px 4px;
}

.p2p-session {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  cursor: pointer;
  transition: background 0.1s;
}

.p2p-session:hover {
  background: var(--bg-secondary);
}

.p2p-session.active {
  background: var(--primary-light);
}

.p2p-session.pending {
  background: var(--bg-secondary);
  border-left: 3px solid var(--warning);
  cursor: default;
}

.p2p-session-main {
  display: flex;
  align-items: center;
  gap: 9px;
  flex: 1;
  min-width: 0;
}

.p2p-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--primary-light);
  color: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 0;
}

.p2p-session-info {
  min-width: 0;
  flex: 1;
}

.p2p-session-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  white-space: nowrap;
}

.p2p-session-ip {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 400;
  color: var(--text-tertiary);
}

.p2p-session-preview {
  font-size: 11px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}

.p2p-session-side {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.p2p-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #94a3b8;
  flex-shrink: 0;
}

.p2p-status-dot.online {
  background: #22c55e;
}

.p2p-status-text {
  font-size: 10px;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.p2p-unread {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--danger);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.p2p-del {
  width: 24px;
  height: 24px;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: var(--text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
}

.p2p-del:hover {
  background: var(--danger-light);
  color: var(--danger);
}

.p2p-session-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.p2p-btn {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
}

.p2p-btn.accept {
  background: var(--success);
  border-color: var(--success);
  color: #fff;
}

.p2p-btn.reject {
  color: var(--danger);
  border-color: var(--border);
}

.p2p-btn.reject:hover {
  background: var(--danger-light);
}

.p2p-list-empty {
  padding: 40px 20px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12px;
}

.p2p-list-empty-sub {
  font-size: 11px;
  margin-top: 6px;
}

/* ---- Chat ---- */
.p2p-chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.p2p-chat-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.p2p-chat-title {
  font-size: 13px;
  font-weight: 600;
}

.p2p-chat-sub {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
}

.p2p-back {
  width: 24px;
  height: 24px;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  display: none;
}

.p2p-msgs {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--bg-secondary);
}

.p2p-msg-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  cursor: default;
}

.p2p-msg-row.mine {
  align-items: flex-end;
}

.p2p-msg-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.p2p-msg-del {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  opacity: 0.55;
  transition: opacity 0.12s;
  padding: 0;
  flex-shrink: 0;
}

.p2p-msg-copy {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  opacity: 0.55;
  transition: opacity 0.12s;
  padding: 0;
  flex-shrink: 0;
}

.p2p-msg-del:hover {
  opacity: 1;
  background: var(--danger-light);
  color: var(--danger);
}

.p2p-msg-copy:hover {
  opacity: 1;
  background: var(--bg-tertiary);
  color: var(--primary);
}

.p2p-msg-copy.copied {
  opacity: 1;
  color: var(--success);
  background: var(--success-light);
}

.p2p-msg-time {
  font-size: 10px;
  color: var(--text-tertiary);
}

/* Message head layout: theirs = [时间][复制][删除], mine = [删除][复制][时间] */
.p2p-msg-row.theirs .p2p-msg-time {
  order: 0;
}

.p2p-msg-row.theirs .p2p-msg-copy {
  order: 1;
}

.p2p-msg-row.theirs .p2p-msg-del {
  order: 2;
}

.p2p-msg-row.mine .p2p-msg-del {
  order: 0;
}

.p2p-msg-row.mine .p2p-msg-copy {
  order: 1;
}

.p2p-msg-row.mine .p2p-msg-time {
  order: 2;
}

.p2p-bubble {
  max-width: 78%;
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.55;
  word-break: break-word;
  white-space: pre-wrap;
  user-select: text;
  cursor: default;
}

.p2p-msg-row.theirs .p2p-bubble {
  background: var(--bg);
  border: 1px solid var(--border);
  border-top-left-radius: 2px;
  color: var(--text);
}

.p2p-msg-row.mine .p2p-bubble {
  background: var(--primary);
  color: #fff;
  border-top-right-radius: 2px;
}

.p2p-msg-system {
  text-align: center;
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 2px 0;
}

.p2p-file-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px 8px;
  max-width: 340px;
  min-width: 230px;
}

.p2p-msg-row.mine .p2p-file-card {
  background: var(--primary-light);
  border-color: var(--primary-light);
}

.p2p-files-list {
  display: flex;
  flex-direction: column;
}

.p2p-file-item {
  display: flex;
  gap: 10px;
  padding: 5px 4px;
}

.p2p-file-item + .p2p-file-item {
  border-top: 1px solid var(--border);
}

.p2p-msg-row.mine .p2p-file-item + .p2p-file-item {
  border-color: rgba(0, 0, 0, 0.08);
}

.p2p-file-icon {
  color: var(--primary);
  flex-shrink: 0;
}

.p2p-file-info {
  min-width: 0;
  flex: 1;
}

.p2p-file-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  word-break: break-all;
  margin-bottom: 2px;
}

.p2p-file-meta {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-bottom: 6px;
}

.p2p-file-actions {
  display: flex;
  gap: 6px;
}

.p2p-file-btn {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--primary);
  cursor: pointer;
}

.p2p-file-btn:hover {
  background: var(--primary-light);
}

.p2p-chat-empty {
  margin: auto;
  color: var(--text-tertiary);
  font-size: 12px;
}

.p2p-chat-empty-view {
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  gap: 10px;
  font-size: 13px;
}

.p2p-inputbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.p2p-file-send {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
}

.p2p-file-send:hover {
  color: var(--primary);
  border-color: var(--primary);
}

.p2p-input {
  flex: 1;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 10px;
  min-height: 34px;
  font-size: 13px;
  font-family: inherit;
  background: var(--bg);
  color: var(--text);
  resize: none;
  outline: none;
  max-height: 96px;
  line-height: 1.5;
}

.p2p-input:focus {
  border-color: var(--primary);
}

.p2p-input::placeholder {
  color: var(--text-tertiary);
}

.p2p-send {
  height: 34px;
  padding: 0 16px;
  border-radius: 8px;
  background: var(--primary);
  color: #fff;
  font-size: 13px;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
}

.p2p-send:hover {
  background: var(--primary-hover);
}

.p2p-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ---- Narrow layout (<700px): list and chat become two pages ---- */
@media (max-width: 699px) {
  .p2p-window {
    width: 96%;
    height: 82vh;
  }

  .p2p-list {
    width: 100%;
    display: none;
  }

  .p2p-list.p2p-list-mobile {
    display: block;
  }

  .p2p-chat {
    display: none;
  }

  .p2p-chat.p2p-chat-mobile {
    display: flex;
  }

  .p2p-back {
    display: flex;
  }
}

/* In-app toast */
.p2p-toast {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: #1e293b;
  color: #fff;
  padding: 8px 20px;
  border-radius: 8px;
  font-size: 13px;
  z-index: 300;
  pointer-events: none;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  white-space: nowrap;
  max-width: 90vw;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toast-fade-enter-active {
  transition: all 0.2s ease-out;
}

.toast-fade-leave-active {
  transition: all 0.25s ease-in;
}

.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px);
}

/* Custom confirm (replaces native window.confirm) */
.p2p-confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 400;
}

.p2p-confirm {
  background: var(--bg);
  border-radius: 12px;
  width: 90%;
  max-width: 360px;
  padding: 22px 22px 16px;
  box-shadow: var(--shadow-lg);
  text-align: center;
}

.p2p-confirm-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 10px;
}

.p2p-confirm-msg {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  word-break: break-all;
  margin-bottom: 18px;
}

.p2p-confirm-actions {
  display: flex;
  gap: 10px;
}

.p2p-confirm-btn {
  flex: 1;
  height: 34px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text);
  cursor: pointer;
}

.p2p-confirm-btn:hover {
  background: var(--bg-tertiary);
}

.p2p-confirm-btn.danger {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
}

.p2p-confirm-btn.danger:hover {
  background: #dc2626;
}
</style>

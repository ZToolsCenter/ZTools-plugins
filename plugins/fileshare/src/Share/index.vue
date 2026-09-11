<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import QRCode from 'qrcode'
import type { SharedItem, NetworkInterface, ServerConfig, ScanResult, DownloadLog } from './types'
import NetworkSelector from './NetworkSelector.vue'
import FileTree from './FileTree.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import P2pCenter from './P2pCenter.vue'

const props = defineProps<{
  enterAction: { type: string; payload: any; code: string }
}>()

// ---- State ----
const shareList = ref<SharedItem[]>([])
const networkInterfaces = ref<NetworkInterface[]>([])
const selectedNic = ref<NetworkInterface | null>(null)
const serverConfig = ref<ServerConfig>({
  port: 23456, ip: '', token: '', running: false
})
const showConfirm = ref(false)
const confirmDirPath = ref('')
const confirmDirName = ref('')
const confirmFileCount = ref(0)
const pendingPaths = ref<string[]>([])
const copyFeedback = ref(false)
const copiedItemId = ref('')
const portInput = ref('23456')
const portError = ref('')
const pickingPort = ref(false)

// QR code
const mainQrSvg = ref('')
const showQrModal = ref(false)
const qrItemName = ref('')
const qrItemPath = ref('')
const qrItemSvg = ref('')
const qrCurrentUrl = ref('')
const qrCopied = ref(false)

// Logs
const showLogs = ref(false)
const downloadLogs = ref<DownloadLog[]>([])

// Whitelist
const whitelist = ref<string[]>([])
const newWhitelistIp = ref('')
const showWhitelist = ref(false)

// P2P private messaging
const showP2pCenter = ref(false)
const p2pBadge = ref(0)
const p2pEventTick = ref(0)
const p2pEventSince = ref(0)
let p2pPollTimer: ReturnType<typeof setInterval> | null = null

// File Preview
const showPreview = ref(false)
const previewItem = ref<SharedItem | null>(null)
const previewContent = ref('')
const previewType = ref<'image' | 'audio' | 'video' | 'text' | 'markdown' | 'code' | 'too-large' | 'error'>('error')
const previewLoading = ref(false)
const previewExt = ref('')
const previewModalRef = ref<HTMLElement | null>(null)

// Fullscreen image viewer (within plugin)
const showImgViewer = ref(false)
const imgViewerScale = ref(1)
const imgViewerX = ref(0)
const imgViewerY = ref(0)
let imgViewerDragging = false
let imgViewerLastX = 0
let imgViewerLastY = 0

const PREVIEW_IMG_EXTS = ['jpg','jpeg','png','gif','svg','webp','bmp','ico']
const PREVIEW_AUDIO_EXTS = ['mp3','wav','ogg','flac','aac','m4a']
const PREVIEW_VIDEO_EXTS = ['mp4','webm','mkv','avi','mov','flv']
const PREVIEW_MD_EXTS = ['md','markdown','mdown','mkd']
const PREVIEW_CODE_EXTS = ['js','mjs','cjs','ts','tsx','jsx','py','java','c','cpp','h','hpp','rs','go','rb','php','swift','kt','kts','scala','dart','lua','r','sql','sh','bash','zsh','bat','cmd','ps1','html','htm','css','scss','less','vue','svelte']
const PREVIEW_TEXT_EXTS = ['txt','log','csv','json','xml','yml','yaml','toml','ini','cfg','conf','env','properties']

function getPreviewCategory(ext: string): 'image' | 'audio' | 'video' | 'text' | 'markdown' | 'code' | null {
  if (PREVIEW_IMG_EXTS.includes(ext)) return 'image'
  if (PREVIEW_AUDIO_EXTS.includes(ext)) return 'audio'
  if (PREVIEW_VIDEO_EXTS.includes(ext)) return 'video'
  if (PREVIEW_MD_EXTS.includes(ext)) return 'markdown'
  if (PREVIEW_CODE_EXTS.includes(ext)) return 'code'
  if (PREVIEW_TEXT_EXTS.includes(ext)) return 'text'
  return null
}

function handlePreview(item: SharedItem) {
  if (item.isDirectory) return
  const ext = (item.name || '').split('.').pop()?.toLowerCase() || ''
  const cat = getPreviewCategory(ext)
  if (!cat) return

  previewItem.value = item
  previewExt.value = ext
  previewLoading.value = true
  showPreview.value = true

  const result = window.services.readFile(item.path)
  previewLoading.value = false

  if (!result) {
    previewType.value = 'error'
    return
  }
  if (result.type === 'too-large') {
    previewType.value = 'too-large'
    return
  }

  if (cat === 'image') {
    previewType.value = 'image'
    previewContent.value = result.type === 'base64' ? result.data : ''
  } else if (cat === 'audio') {
    previewType.value = 'audio'
    previewContent.value = result.type === 'base64' ? result.data : ''
  } else if (cat === 'video') {
    previewType.value = 'video'
    previewContent.value = result.type === 'base64' ? result.data : ''
  } else {
    // text / code / markdown
    previewType.value = cat
    previewContent.value = result.type === 'text' ? result.data : ''
  }
}

function closePreview() {
  showPreview.value = false
  showImgViewer.value = false
  previewItem.value = null
  previewContent.value = ''
}

// Simple HTML escape for text preview
function escHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

// Simple code highlight (same as Web UI)
function highlightCode(code: string, ext: string): string {
  let html = escHtml(code)
  // Strings
  html = html.replace(/(['"`])((?:\\.|(?!\1).)*?)\1/g, '<span style="color:#16a34a">$1$2$1</span>')
  // Comments
  if (['js','ts','jsx','tsx','java','c','cpp','go','rs','swift','kt','dart','scss','less','css'].includes(ext)) {
    html = html.replace(/(\/\/[^\n]*)/g, '<span style="color:#94a3b8">$1</span>')
    html = html.replace(/(\/\*[\s\S]*?\*\/)/g, '<span style="color:#94a3b8">$1</span>')
  }
  if (['py','rb','sh','bash','zsh','yaml','yml','toml','ini','cfg','conf','env','properties'].includes(ext)) {
    html = html.replace(/(#[^\n]*)/g, '<span style="color:#94a3b8">$1</span>')
  }
  // Keywords
  const kwMap: Record<string, string[]> = {
    js: ['const','let','var','function','return','if','else','for','while','class','import','export','from','new','await','async','try','catch','throw','typeof','instanceof','break','continue','switch','case','default','do','in','of','void','delete'],
    ts: ['const','let','var','function','return','if','else','for','while','class','import','export','from','new','await','async','try','catch','throw','typeof','instanceof','break','continue','switch','case','default','do','in','of','void','delete','interface','type','enum','public','private','protected','readonly','extends','implements','as','namespace','declare','abstract'],
    py: ['def','class','return','if','elif','else','for','while','import','from','as','try','except','finally','with','raise','lambda','yield','global','nonlocal','pass','break','continue','assert','del','in','is','not','and','or','None','True','False'],
  }
  const kws = kwMap[ext] || kwMap['js']
  const kwRe = new RegExp('\\b(' + kws.join('|') + ')\\b','g')
  html = html.replace(kwRe, '<span style="color:#2563eb">$1</span>')
  // Numbers
  html = html.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#ea580c">$1</span>')
  return html
}

// Simple Markdown parser (same as Web UI)
function parseMarkdown(src: string): string {
  let html = src.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function(_, lang, code) {
    const h = lang ? highlightCode(code.trim(), lang) : escHtml(code.trim())
    return '<pre><code>' + h + '</code></pre>'
  })
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>')
  html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>')
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')
  html = html.replace(/^(---|\*\*\*|___)\s*$/gm, '<hr>')
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '<br>')
  html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>')
  const lines = html.split('\n')
  const result: string[] = []
  let inList = false
  for (const line of lines) {
    if (line.startsWith('<li>')) {
      if (!inList) { result.push('<ul>'); inList = true }
      result.push(line)
    } else {
      if (inList) { result.push('</ul>'); inList = false }
      result.push(line)
    }
  }
  if (inList) result.push('</ul>')
  return result.join('\n')
}

// Fullscreen image viewer handlers
function openImgViewer() {
  if (previewType.value !== 'image' || !previewContent.value) return
  imgViewerScale.value = 1
  imgViewerX.value = 0
  imgViewerY.value = 0
  showImgViewer.value = true
}

function closeImgViewer() {
  showImgViewer.value = false
}

function onImgViewerWheel(e: WheelEvent) {
  e.preventDefault()
  const delta = e.deltaY > 0 ? 0.9 : 1.1
  imgViewerScale.value = Math.max(0.1, Math.min(20, imgViewerScale.value * delta))
}

function onImgViewerMouseDown(e: MouseEvent) {
  imgViewerDragging = true
  imgViewerLastX = e.clientX
  imgViewerLastY = e.clientY
}

function onImgViewerMouseMove(e: MouseEvent) {
  if (!imgViewerDragging) return
  imgViewerX.value += e.clientX - imgViewerLastX
  imgViewerY.value += e.clientY - imgViewerLastY
  imgViewerLastX = e.clientX
  imgViewerLastY = e.clientY
}

function onImgViewerMouseUp() {
  imgViewerDragging = false
}

function onImgViewerDblClick() {
  imgViewerScale.value = 1
  imgViewerX.value = 0
  imgViewerY.value = 0
}

function onPreviewKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (showImgViewer.value) closeImgViewer()
    else closePreview()
  }
}

// Text sharing
const shareTextInput = ref('')
const sharingText = ref(false)

// Toast
const toastMsg = ref('')
const toastShow = ref(false)
let toastTimer: ReturnType<typeof setTimeout> | null = null

// Poll the share list so uploads from web clients show up live
let pollTimer: ReturnType<typeof setInterval> | null = null

function showToast(msg: string) {
  toastMsg.value = msg
  toastShow.value = true
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastShow.value = false }, 2000)
}

// ---- Load initial data ----
onMounted(() => {
  loadData()
  handleEnterAction()
  tryAutoStart()
  generateMainQr()
  pollTimer = setInterval(pollShareList, 3000)
  window.addEventListener('keydown', onPreviewKeydown)
  initP2p()
})

onBeforeUnmount(() => {
  window.removeEventListener('zshare:p2p', onP2pEvent)
  if (p2pPollTimer) clearInterval(p2pPollTimer)
})

// ---- P2P: badge, realtime events (CustomEvent), and missed-event catch-up ----
function initP2p() {
  const ev = window.services.getP2pEvents(0)
  p2pEventSince.value = ev.since
  refreshP2pBadge()
  window.addEventListener('zshare:p2p', onP2pEvent)
  p2pPollTimer = setInterval(pollP2p, 2500)
}

function onP2pEvent() {
  pollP2p()
}

function pollP2p() {
  const res = window.services.getP2pEvents(p2pEventSince.value)
  if (res.since !== p2pEventSince.value) {
    for (const ev of res.events) {
      if (ev.type === 'p2p.request') {
        showToast(`收到连接申请：${ev.data.peerName || ev.data.peerIp}`)
      }
    }
    p2pEventSince.value = res.since
    p2pEventTick.value++
  }
  refreshP2pBadge()
}

function refreshP2pBadge() {
  const summary = window.services.getP2pSummary()
  p2pBadge.value = summary.unreadTotal
}

function openP2pCenter() {
  showP2pCenter.value = true
  p2pEventTick.value++
}

function handleP2pPreview(payload: { name: string; path: string }) {
  handlePreview({ name: payload.name, path: payload.path, isDirectory: false } as SharedItem)
}

// Auto-focus preview modal when opened so keyboard events work
watch(showPreview, (val) => {
  if (val) {
    setTimeout(() => previewModalRef.value?.focus(), 50)
  }
})

function pollShareList() {
  const latest = window.services.getShareList()
  if (JSON.stringify(latest) !== JSON.stringify(shareList.value)) {
    shareList.value = latest
  }
}

function loadData() {
  shareList.value = window.services.getShareList()
  networkInterfaces.value = window.services.getNetworkInterfaces()
  serverConfig.value = window.services.getServerStatus()
  portInput.value = String(serverConfig.value.port)
  if (networkInterfaces.value.length > 0) {
    const match = networkInterfaces.value.find(n => n.ip === serverConfig.value.ip)
    if (match) selectedNic.value = match
    else if (!selectedNic.value) selectedNic.value = networkInterfaces.value[0]
  }
}

async function tryAutoStart() {
  if (!window.services.shouldAutoStart()) return
  if (!serverConfig.value.running && selectedNic.value && serverConfig.value.token) {
    const result = await window.services.startServer(serverConfig.value.port, selectedNic.value.ip)
    serverConfig.value = window.services.getServerStatus()
    if (!result.ok) portError.value = result.error || '启动失败'
    generateMainQr()
  }
}

function handleEnterAction() {
  watch(() => props.enterAction, (action) => {
    if (action && action.type === 'files' && action.payload && action.payload.length > 0) {
      const paths = action.payload.map((f: any) => f.path)
      handleAddPaths(paths)
    }
  }, { immediate: true })
}

// ---- QR Code ----
async function generateMainQr() {
  if (!shareUrl.value) { mainQrSvg.value = ''; return }
  try {
    mainQrSvg.value = await QRCode.toString(shareUrl.value, {
      type: 'svg', width: 200, margin: 1,
      color: { dark: '#1e293b', light: '#ffffff' }
    })
  } catch (_) { mainQrSvg.value = '' }
}

async function showItemQr(item: SharedItem) {
  qrItemName.value = item.name
  qrItemPath.value = item.path
  const itemUrl = buildItemUrl(item)
  qrCurrentUrl.value = itemUrl
  qrCopied.value = false
  try {
    qrItemSvg.value = await QRCode.toString(itemUrl, {
      type: 'svg', width: 200, margin: 1,
      color: { dark: '#1e293b', light: '#ffffff' }
    })
  } catch (_) { qrItemSvg.value = '' }
  showQrModal.value = true
}

function buildItemUrl(item: SharedItem): string {
  if (!shareUrl.value) return ''
  const base = shareUrl.value
  const sep = base.includes('?') ? '&' : '?'
  return base + sep + 'path=' + encodeURIComponent(item.path)
}

// ---- Add files ----
function handleOpenDialog() {
  const files = window.ztools.showOpenDialog({
    title: '选择要共享的文件',
    properties: ['openFile', 'multiSelections']
  })
  if (!files || files.length === 0) return
  handleAddPaths(files)
}

function handleOpenDirDialog() {
  const dirs = window.ztools.showOpenDialog({
    title: '选择要共享的文件夹',
    properties: ['openDirectory']
  })
  if (!dirs || dirs.length === 0) return
  handleAddPaths(dirs)
}

async function handleAddPaths(paths: string[]) {
  const needsConfirm: { path: string; name: string; count: number }[] = []
  const safePaths: string[] = []
  for (const fp of paths) {
    const scanResult: ScanResult = window.services.scanDirectory(fp)
    if (scanResult.fileCount > 20) {
      needsConfirm.push({ path: fp, name: fp.split(/[/\\]/).pop() || fp, count: scanResult.fileCount })
    } else {
      safePaths.push(fp)
    }
  }
  if (safePaths.length > 0) addPathsToShare(safePaths)
  if (needsConfirm.length > 0) {
    const first = needsConfirm[0]
    confirmDirPath.value = first.path; confirmDirName.value = first.name; confirmFileCount.value = first.count
    pendingPaths.value = needsConfirm.slice(1).map(n => n.path)
    showConfirm.value = true
  }
}

function addPathsToShare(paths: string[]) {
  window.services.addShares(paths)
  shareList.value = window.services.getShareList()
}

function handleConfirm() {
  showConfirm.value = false
  addPathsToShare([confirmDirPath.value])
  if (pendingPaths.value.length > 0) {
    const remaining = [...pendingPaths.value]; pendingPaths.value = []
    handleAddPaths(remaining)
  }
}

function handleCancelConfirm() {
  showConfirm.value = false
  if (pendingPaths.value.length > 0) {
    const remaining = [...pendingPaths.value]; pendingPaths.value = []
    handleAddPaths(remaining)
  }
}

// ---- Toggle / Remove ----
function handleToggle(itemId: string, enabled: boolean) {
  window.services.toggleShare(itemId, enabled)
  shareList.value = window.services.getShareList()
}

function handleRemove(itemId: string) {
  window.services.removeShare(itemId)
  shareList.value = window.services.getShareList()
}

// ---- Server control ----
async function handleStartServer() {
  if (!selectedNic.value) { showToast('请先选择网卡'); return }
  portError.value = ''
  const port = normalizePort(portInput.value)
  const result = await window.services.startServer(port, selectedNic.value.ip)
  serverConfig.value = window.services.getServerStatus()
  portInput.value = String(serverConfig.value.port)
  if (!result.ok) {
    portError.value = result.error || '启动失败'
    showToast(portError.value)
  }
  generateMainQr()
}

function handleStopServer() {
  window.services.stopServer()
  serverConfig.value = window.services.getServerStatus()
  mainQrSvg.value = ''
  portError.value = ''
}

function normalizePort(raw: string): number {
  const p = parseInt(raw, 10)
  if (!Number.isFinite(p) || p < 1 || p > 65535) return serverConfig.value.port
  return p
}

function handlePortChange() {
  portError.value = ''
  if (serverConfig.value.running) {
    portInput.value = String(serverConfig.value.port)
    return
  }
  const port = normalizePort(portInput.value)
  window.services.setPort(port)
  serverConfig.value = window.services.getServerStatus()
}

async function handlePickPort() {
  if (serverConfig.value.running || !selectedNic.value) return
  pickingPort.value = true
  const freePort = await window.services.getFreePort(selectedNic.value.ip)
  pickingPort.value = false
  if (freePort && freePort > 0) {
    portInput.value = String(freePort)
    window.services.setPort(freePort)
    serverConfig.value = window.services.getServerStatus()
    showToast('已选择空闲端口 ' + freePort)
  } else {
    showToast('未找到可用端口')
  }
}

async function handleNicChange(nic: NetworkInterface) {
  selectedNic.value = nic
  portError.value = ''
  if (serverConfig.value.running) {
    // Restart on the new interface only when the server is already running
    const result = await window.services.startServer(serverConfig.value.port, nic.ip)
    serverConfig.value = window.services.getServerStatus()
    if (!result.ok) {
      portError.value = result.error || '启动失败'
      showToast(portError.value)
    }
    generateMainQr()
  }
}

// ---- Token ----
function handleRefreshToken() {
  window.services.regenerateToken()
  serverConfig.value = window.services.getServerStatus()
  generateMainQr()
  showToast('Token 已刷新')
}

// ---- Logs ----
function openLogs() {
  downloadLogs.value = window.services.getDownloadLogs()
  showLogs.value = true
}

function clearLogs() {
  window.services.clearDownloadLogs()
  downloadLogs.value = []
}

// ---- Computed ----
const shareUrl = computed(() => {
  if (!serverConfig.value.running || !selectedNic.value) return ''
  return `http://${selectedNic.value.ip}:${serverConfig.value.port}/?token=${serverConfig.value.token}`
})

// ---- Grouped view: host shares vs per-IP client uploads ----
function countGroupFiles(items: SharedItem[]): number {
  let n = 0
  for (const item of items) {
    if (!item.isDirectory) n++
    if (item.children && item.children.length > 0) n += countGroupFiles(item.children)
  }
  return n
}

const shareGroups = computed(() => {
  const host: SharedItem[] = []
  const byIp: Record<string, SharedItem[]> = {}
  for (const item of shareList.value) {
    // Uploads made from the plugin machine itself (origin.local) are host-side
    // files — show them under 主机共享, not as a remote client's upload.
    if (item.origin && item.origin.type === 'upload' && !item.origin.local) {
      const ip = item.origin.ip || '未知来源'
      if (!byIp[ip]) byIp[ip] = []
      byIp[ip].push(item)
    } else {
      host.push(item)
    }
  }
  const uploadSections = Object.entries(byIp)
    .map(([ip, items]) => ({
      ip,
      items: [...items].sort((a, b) =>
        ((b.origin?.time) || '').localeCompare((a.origin?.time) || ''))
    }))
    .sort((a, b) =>
      ((b.items[0]?.origin?.time) || '').localeCompare((a.items[0]?.origin?.time) || ''))
  return { host, uploadSections }
})

function handleCopyUrl() {
  if (shareUrl.value) { window.ztools.copyText(shareUrl.value); copyFeedback.value = true; setTimeout(() => copyFeedback.value = false, 2000); showToast('地址已复制') }
}

function handleCopyItemUrl(item: SharedItem) {
  const url = buildItemUrl(item)
  if (url) { window.ztools.copyText(url); copiedItemId.value = item.id; setTimeout(() => copiedItemId.value = '', 2000); showToast('链接已复制') }
}

function handleCopyQrUrl() {
  if (qrCurrentUrl.value) { window.ztools.copyText(qrCurrentUrl.value); qrCopied.value = true; setTimeout(() => qrCopied.value = false, 2000); showToast('链接已复制') }
}

function handleCopyQrImage() {
  const svgEl = document.querySelector('.qr-svg svg')
  if (!svgEl) return
  const svgData = new XMLSerializer().serializeToString(svgEl)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const img = new Image()
  img.onload = () => {
    canvas.width = img.width
    canvas.height = img.height
    ctx!.drawImage(img, 0, 0)
    canvas.toBlob((blob) => {
      if (blob) {
        // @ts-ignore
        const item = new ClipboardItem({ 'image/png': blob })
        navigator.clipboard.write([item]).then(() => {
          qrCopied.value = true; setTimeout(() => qrCopied.value = false, 2000); showToast('二维码已复制')
        }).catch(() => {})
      }
    })
  }
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)))
}

// ---- Drag & Drop ----
function handleDragOver(e: DragEvent) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy' }

function handleDrop(e: DragEvent) {
  e.preventDefault()
  if (!e.dataTransfer) return

  // 1. Check for text content first (Ditto text items, text selections, etc.)
  const textData = e.dataTransfer.getData('text/plain')
  const htmlData = e.dataTransfer.getData('text/html')

  // 2. Collect file paths from the drop
  const paths: string[] = []
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      const file = e.dataTransfer.files[i]
      const filePath = (window as any).ztools?.getPathForFile?.(file) || (file as any).path
      if (filePath) paths.push(filePath)
    }
  }

  // 3. Prefer text content when there's a meaningful text payload and no valid file paths
  //    (handles Ditto clipboard text items that create temp files which may be stale)
  const hasRealFiles = paths.length > 0
  const hasTextPayload = textData && textData.trim().length > 0

  if (hasTextPayload && !hasRealFiles) {
    // Pure text drop: share as text
    const result = window.services.shareText(textData)
    if (result) {
      shareList.value = window.services.getShareList()
      showToast('文本已共享')
    }
    return
  }

  if (hasTextPayload && hasRealFiles) {
    // Both text and files: if the text looks like it could be the full content
    // and the file names look like temp files, prefer text
    const hasTempFiles = paths.some(p => {
      const name = p.split(/[/\\]/).pop() || ''
      return /^[A-Z]{3}\d{4}\.tmp$/i.test(name) || /^~/.test(name) || name.startsWith('.') || /^ditto/i.test(name)
    })
    if (hasTempFiles && textData.length > 100) {
      // Likely a clipboard manager text drop with stale temp files — use text
      const result = window.services.shareText(textData)
      if (result) {
        shareList.value = window.services.getShareList()
        window.ztools.showNotification('文本已共享')
      }
      return
    }
  }

  // 4. Standard file drop
  if (paths.length > 0) {
    handleAddPaths(paths)
  } else if (hasTextPayload) {
    // Fallback: treat as text
    const result = window.services.shareText(textData)
    if (result) {
      shareList.value = window.services.getShareList()
    }
  }
}

function formatTime(ts: string) {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// ---- Whitelist ----
function openWhitelist() {
  whitelist.value = window.services.getWhitelist()
  showWhitelist.value = true
}

function addWhitelistIp() {
  const ip = newWhitelistIp.value.trim()
  if (!ip) return
  if (window.services.addWhitelist(ip)) {
    whitelist.value = window.services.getWhitelist()
    newWhitelistIp.value = ''
  }
}

function removeWhitelistIp(ip: string) {
  window.services.removeWhitelist(ip)
  whitelist.value = window.services.getWhitelist()
}

// ---- Text Sharing ----
function handleShareText() {
  const text = shareTextInput.value.trim()
  if (!text) return
  sharingText.value = true
  const result = window.services.shareText(text)
  if (result) {
    shareList.value = window.services.getShareList()
    shareTextInput.value = ''
    showToast('文本已共享')
  }
  sharingText.value = false
}
</script>

<template>
  <div class="share-app" @dragover="handleDragOver" @drop="handleDrop">
    <!-- Toast -->
    <Transition name="toast-fade">
      <div v-if="toastShow" class="toast">{{ toastMsg }}</div>
    </Transition>

    <!-- Toolbar -->
    <div class="share-toolbar">
      <div class="toolbar-left">
        <button class="btn btn-primary" @click="handleOpenDialog">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          添加文件
        </button>
        <button class="btn btn-sm" @click="handleOpenDirDialog">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6.5l-1.5-2H5a2 2 0 00-2 2z"/></svg>
          添加文件夹
        </button>
        <NetworkSelector :interfaces="networkInterfaces" :selected="selectedNic" @change="handleNicChange" />
        <div class="port-config" :class="{ error: !!portError }" :title="portError">
          <span class="port-label">端口</span>
          <input
            class="port-input"
            type="number"
            min="1"
            max="65535"
            v-model="portInput"
            :disabled="serverConfig.running"
            @change="handlePortChange"
          />
          <button v-if="!serverConfig.running" class="port-auto-btn" :disabled="pickingPort" @click="handlePickPort" title="自动选择空闲端口">
            <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" fill="none" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
          </button>
        </div>
        <span v-if="portError" class="port-error-text">{{ portError }}</span>
      </div>
      <div class="toolbar-right">
        <button v-if="!serverConfig.running" class="btn btn-success" @click="handleStartServer">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          启动服务
        </button>
        <button v-else class="btn btn-danger" @click="handleStopServer">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          停止服务
        </button>
        <span class="status-dot" :class="{ running: serverConfig.running }"></span>
        <span class="status-text">{{ serverConfig.running ? '运行中' : '已停止' }}</span>
        <button class="btn btn-sm p2p-toolbar-btn" @click="openP2pCenter" title="消息">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>
          <span v-if="p2pBadge > 0" class="p2p-toolbar-badge">{{ p2pBadge > 99 ? '99+' : p2pBadge }}</span>
        </button>
        <button class="btn btn-sm" @click="openLogs" title="下载日志">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        </button>
        <button class="btn btn-sm" @click="openWhitelist" title="IP 白名单">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
        </button>
      </div>
    </div>

    <!-- URL Info -->
    <div v-if="serverConfig.running && shareUrl" class="share-info">
      <div class="info-row">
        <span class="info-label">访问地址</span>
        <code class="info-value" :title="shareUrl">{{ shareUrl }}</code>
        <span class="info-actions">
          <button class="btn-icon" :class="{ copied: copyFeedback }" :title="copyFeedback?'已复制':'复制'" @click="handleCopyUrl">
            <svg v-if="!copyFeedback" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            <svg v-else viewBox="0 0 24 24" width="14" height="14" stroke="#22c55e" fill="none" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
          <button class="btn-icon" title="刷新 Token" @click="handleRefreshToken">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
          </button>
          <button v-if="mainQrSvg" class="btn-icon" title="二维码" @click="showQrModal = true; qrItemName = ''; qrItemPath = ''; qrItemSvg = mainQrSvg; qrCurrentUrl = shareUrl; qrCopied = false">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          </button>
        </span>
      </div>
    </div>

    <!-- Text Sharing -->
    <div class="text-share-bar">
      <textarea
        v-model="shareTextInput"
        class="text-share-input"
        placeholder="粘贴文本内容，将自动生成为 .txt 文件共享..."
        rows="2"
      ></textarea>
      <button
        class="btn btn-primary"
        :disabled="!shareTextInput.trim() || sharingText"
        @click="handleShareText"
      >
        分享文本
      </button>
    </div>

    <!-- File Tree (grouped: host shares vs per-IP client uploads) -->
    <div class="share-body">
      <template v-if="shareList.length > 0">
        <div v-if="shareGroups.host.length > 0" class="share-section">
          <div class="share-section-header">
            <span class="share-section-label">
              <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6.5l-1.5-2H5a2 2 0 00-2 2z"/></svg>
              主机共享
            </span>
            <span class="share-section-count">{{ countGroupFiles(shareGroups.host) }} 个文件</span>
          </div>
          <FileTree
            :items="shareGroups.host"
            :server-running="serverConfig.running"
            :share-url="shareUrl"
            :copied-item-id="copiedItemId"
            @toggle="handleToggle"
            @remove="handleRemove"
            @show-qr="showItemQr"
            @copy-url="handleCopyItemUrl"
            @preview="handlePreview"
          />
        </div>

        <div v-for="section in shareGroups.uploadSections" :key="section.ip" class="share-section">
          <div class="share-section-header">
            <span class="share-section-label">
              <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              客户端上传
            </span>
            <span class="share-section-ip">{{ section.ip }}</span>
            <span class="share-section-count">{{ countGroupFiles(section.items) }} 个文件</span>
          </div>
          <FileTree
            :items="section.items"
            :server-running="serverConfig.running"
            :share-url="shareUrl"
            :copied-item-id="copiedItemId"
            @toggle="handleToggle"
            @remove="handleRemove"
            @show-qr="showItemQr"
            @copy-url="handleCopyItemUrl"
            @preview="handlePreview"
          />
        </div>
      </template>
      <div v-else class="empty-state">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" width="56" height="56" stroke="currentColor" fill="none" stroke-width="1" opacity="0.2"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6.5l-1.5-2H5a2 2 0 00-2 2z"/></svg>
        </div>
        <p class="empty-title">暂无共享文件</p>
        <p class="empty-desc">拖拽文件或文件夹到此处，或点击下方按钮添加</p>
        <div class="empty-actions">
          <button class="btn btn-primary btn-lg" @click="handleOpenDialog">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            添加文件
          </button>
          <button class="btn btn-sm btn-lg" @click="handleOpenDirDialog">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="1.5"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6.5l-1.5-2H5a2 2 0 00-2 2z"/></svg>
            添加文件夹
          </button>
        </div>
      </div>
    </div>

    <div class="drop-zone-hint">
      <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" stroke-width="1.5" opacity="0.3"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      <span>拖拽文件或文件夹到此处共享</span>
    </div>

    <!-- Confirm Dialog -->
    <ConfirmDialog v-if="showConfirm" :dir-name="confirmDirName" :file-count="confirmFileCount" @confirm="handleConfirm" @cancel="handleCancelConfirm" />

    <!-- QR Code Modal -->
    <div v-if="showQrModal" class="modal-overlay" @click.self="showQrModal = false">
      <div class="qr-modal">
        <div class="qr-title">{{ qrItemName || 'FileShare - 访问二维码' }}</div>
        <div v-if="qrItemSvg" v-html="qrItemSvg" class="qr-svg" ref="qrSvgRef"></div>
        <div v-if="qrCurrentUrl" class="qr-url-row">
          <code class="qr-url-text">{{ qrCurrentUrl }}</code>
        </div>
        <div class="qr-actions">
          <button class="btn btn-sm" @click="handleCopyQrUrl">复制链接</button>
          <button class="btn btn-sm" @click="handleCopyQrImage">复制二维码</button>
          <button class="btn btn-sm" @click="showQrModal = false">关闭</button>
        </div>
        <span v-if="qrCopied" class="qr-copied-hint">已复制</span>
      </div>
    </div>

    <!-- Download Logs Modal -->
    <div v-if="showLogs" class="modal-overlay" @click.self="showLogs = false">
      <div class="log-modal">
        <div class="log-header">
          <span class="log-title">下载日志</span>
          <button class="btn btn-sm btn-danger-text" @click="clearLogs" v-if="downloadLogs.length > 0">清空</button>
          <button class="modal-close-btn" @click="showLogs = false">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="log-body">
          <table v-if="downloadLogs.length > 0" class="log-table">
            <thead><tr><th>时间</th><th>IP</th><th>类型</th><th>文件</th></tr></thead>
            <tbody>
              <tr v-for="(log, idx) in downloadLogs.slice().reverse()" :key="idx">
                <td class="log-time">{{ formatTime(log.timestamp) }}</td>
                <td class="log-ip">{{ log.ip }}</td>
                <td class="log-type">
                  <span class="log-type-badge" :class="log.type === 'upload' ? 'upload' : 'download'">{{ log.type === 'upload' ? '上传' : '下载' }}</span>
                </td>
                <td class="log-file" :title="log.filePath">{{ log.fileName }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else class="log-empty">暂无下载记录</div>
        </div>
      </div>
    </div>
    <!-- Whitelist Modal -->
    <div v-if="showWhitelist" class="modal-overlay" @click.self="showWhitelist = false">
      <div class="log-modal">
        <div class="log-header">
          <span class="log-title">IP 白名单</span>
          <span style="font-size:11px;color:var(--text-tertiary)">白名单内 IP 无需 Token 即可访问</span>
          <div style="flex:1"></div>
          <button class="modal-close-btn" @click="showWhitelist = false">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="log-body" style="padding:14px">
          <div style="display:flex;gap:8px;margin-bottom:14px">
            <input
              v-model="newWhitelistIp"
              class="whitelist-input"
              placeholder="输入 IP 地址，如 192.168.1.100"
              @keyup.enter="addWhitelistIp"
            />
            <button class="btn btn-primary" @click="addWhitelistIp">添加</button>
          </div>
          <div v-if="whitelist.length > 0" class="whitelist-list">
            <div v-for="ip in whitelist" :key="ip" class="whitelist-row">
              <span class="whitelist-ip">{{ ip }}</span>
              <button class="btn btn-sm btn-danger-text" @click="removeWhitelistIp(ip)">移除</button>
            </div>
          </div>
          <div v-else class="log-empty">白名单为空，所有访问均需 Token</div>
        </div>
      </div>
    </div>

    <!-- File Preview Modal -->
    <div v-if="showPreview" class="modal-overlay" @click.self="closePreview" @keydown="onPreviewKeydown" tabindex="0" ref="previewModalRef">
      <div class="preview-modal">
        <div class="preview-header">
          <span class="preview-title">{{ previewItem?.name || '预览' }}</span>
          <span class="preview-ext-badge">{{ previewExt.toUpperCase() }}</span>
          <div style="flex:1"></div>
          <button class="modal-close-btn" @click="closePreview">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="preview-body">
          <div v-if="previewLoading" class="preview-loading">加载中…</div>
          <template v-else>
            <!-- Image -->
            <div v-if="previewType === 'image' && previewContent" class="preview-image-wrap">
              <img :src="previewContent" class="preview-img" @click="openImgViewer" title="点击全屏查看" />
            </div>
            <!-- Audio -->
            <div v-else-if="previewType === 'audio' && previewContent" class="preview-media-wrap">
              <audio :src="previewContent" controls class="preview-audio"></audio>
            </div>
            <!-- Video -->
            <div v-else-if="previewType === 'video' && previewContent" class="preview-media-wrap">
              <video :src="previewContent" controls class="preview-video"></video>
            </div>
            <!-- Markdown -->
            <div v-else-if="previewType === 'markdown'" class="preview-text-wrap">
              <div class="preview-md" v-html="parseMarkdown(previewContent)"></div>
            </div>
            <!-- Code -->
            <div v-else-if="previewType === 'code'" class="preview-text-wrap">
              <pre class="preview-code"><code v-html="highlightCode(previewContent, previewExt)"></code></pre>
            </div>
            <!-- Text -->
            <div v-else-if="previewType === 'text'" class="preview-text-wrap">
              <pre class="preview-text">{{ previewContent }}</pre>
            </div>
            <!-- Too large -->
            <div v-else-if="previewType === 'too-large'" class="preview-error">
              <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" fill="none" stroke-width="1" opacity="0.3"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <p>文件过大，暂不支持预览</p>
              <p class="preview-error-sub">文本文件上限 2MB，二进制文件上限 20MB</p>
            </div>
            <!-- Error -->
            <div v-else class="preview-error">
              <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" fill="none" stroke-width="1" opacity="0.3"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <p>无法预览此文件</p>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Fullscreen Image Viewer -->
    <div v-if="showImgViewer" class="img-viewer-overlay" @click.self="closeImgViewer" @wheel.prevent="onImgViewerWheel" @mousedown="onImgViewerMouseDown" @mousemove="onImgViewerMouseMove" @mouseup="onImgViewerMouseUp" @mouseleave="onImgViewerMouseUp" @dblclick="onImgViewerDblClick">
      <img
        :src="previewContent"
        class="img-viewer-img"
        :style="{ transform: `translate(${imgViewerX}px, ${imgViewerY}px) scale(${imgViewerScale})` }"
        draggable="false"
      />
      <div class="img-viewer-info">
        <span>{{ Math.round(imgViewerScale * 100) }}%</span>
        <span class="img-viewer-hint">滚轮缩放 · 拖拽移动 · 双击重置 · ESC 退出</span>
      </div>
      <button class="img-viewer-close" @click="closeImgViewer">
        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>

    <!-- P2P Workbench -->
    <P2pCenter v-if="showP2pCenter" :event-tick="p2pEventTick" @close="showP2pCenter = false" @preview="handleP2pPreview" />

  </div>
</template>

<style scoped>
.share-app { display: flex; flex-direction: column; height: 100vh; overflow: hidden; position: relative; }
.share-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--border); gap: 10px; flex-shrink: 0; flex-wrap: nowrap; min-width: 0; }
.toolbar-left { display: flex; align-items: center; gap: 6px; flex: 1 1 auto; min-width: 0; overflow: hidden; }
.toolbar-right { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.share-info { padding: 8px 14px; background: var(--bg-secondary); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.info-row { display: flex; align-items: center; gap: 6px; }
.info-label { font-size: 11px; color: var(--text-secondary); flex-shrink: 0; }
.info-value { font-size: 11px; color: var(--primary); background: var(--bg-tertiary); padding: 2px 7px; border-radius: 4px; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.info-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
.share-body { flex: 1; overflow-y: auto; padding: 6px 0; }
.share-section { margin-bottom: 2px; }
.share-section-header { display: flex; align-items: center; gap: 8px; margin: 10px 12px 2px; padding: 7px 10px; font-size: 12px; font-weight: 600; color: var(--text-secondary); border-bottom: 1px solid var(--border); }
.share-section-label { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.share-section-label svg { width: 14px; height: 14px; stroke: var(--primary); flex-shrink: 0; }
.share-section-ip { font-family: var(--font-mono); color: var(--primary); background: var(--primary-light); padding: 1px 8px; border-radius: 10px; font-size: 11px; font-weight: 500; flex-shrink: 0; }
.share-section-count { font-weight: 400; color: var(--text-tertiary); margin-left: auto; font-size: 11px; flex-shrink: 0; }
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary); gap: 10px; padding: 40px 20px; }
.empty-icon { margin-bottom: 8px; }
.empty-title { font-size: 16px; font-weight: 600; color: var(--text); margin: 0; }
.empty-desc { font-size: 13px; color: var(--text-tertiary); margin: 0 0 8px 0; }
.empty-actions { display: flex; gap: 10px; }
.drop-zone-hint { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px; border-top: 1px dashed var(--border); color: var(--text-tertiary); font-size: 11px; flex-shrink: 0; }
.status-dot { width: 7px; height: 7px; border-radius: 50%; background: #94a3b8; flex-shrink: 0; }
.status-dot.running { background: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,0.2); }
.status-text { font-size: 11px; color: var(--text-secondary); }

/* P2P toolbar button badge */
.p2p-toolbar-btn { position: relative; }
.p2p-toolbar-badge {
  position: absolute; top: -5px; right: -5px;
  min-width: 16px; height: 16px; padding: 0 4px;
  border-radius: 8px; background: var(--danger); color: #fff;
  font-size: 10px; font-weight: 600; line-height: 16px;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 0 0 2px var(--bg);
}

/* Buttons */
.btn { display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.15s; border: 1px solid transparent; white-space: nowrap; flex-shrink: 0; }
.btn-primary { background: var(--primary); color: #fff; border-color: var(--primary); }
.btn-primary:hover { background: var(--primary-hover); }
.btn-lg { padding: 10px 28px; font-size: 14px; border-radius: 8px; }
.btn-success { background: var(--success); color: #fff; border-color: var(--success); }
.btn-danger { background: var(--bg-secondary); color: var(--danger); border-color: var(--border); }
.btn-danger:hover { background: #fef2f2; }
.btn-danger-text { background: none; color: var(--danger); border: none; padding: 4px 8px; }
.btn-danger-text:hover { background: #fef2f2; }
.btn-sm { background: var(--bg-secondary); color: var(--text-secondary); border-color: var(--border); }
.btn-sm:hover { background: var(--bg-tertiary); }
.btn-icon { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 4px; color: var(--text-secondary); cursor: pointer; background: none; border: none; }
.btn-icon:hover { background: var(--bg-tertiary); color: var(--text); }
.btn-icon.copied { color: #22c55e; background: #dcfce7; }
[data-theme="dark"] .btn-danger:hover { background: #3b1515; }
[data-theme="dark"] .btn-danger-text:hover { background: #3b1515; }
[data-theme="dark"] .btn-icon.copied { background: #14532d; }

/* Modal */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 200; }
.qr-modal { background: var(--bg); border-radius: 12px; padding: 28px 32px; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,0.15); max-width: 380px; width: 90%; }
.qr-title { font-size: 14px; font-weight: 600; margin-bottom: 20px; color: var(--text); }
.qr-svg { display: inline-block; margin-bottom: 16px; }
.qr-svg :deep(svg) { display: block; border-radius: 6px; }
.qr-url-row { margin-bottom: 18px; }
.qr-url-text { font-size: 11px; color: var(--text-secondary); word-break: break-all; background: var(--bg-secondary); padding: 6px 10px; border-radius: 4px; display: block; font-family: monospace; max-height: 48px; overflow-y: auto; line-height: 1.4; }
.qr-actions { display: flex; gap: 8px; justify-content: center; }
.qr-copied-hint { display: inline-block; margin-top: 10px; font-size: 12px; color: #22c55e; }

/* Log Modal */
.log-modal { background: var(--bg); border-radius: 10px; width: 90%; max-width: 640px; max-height: 70vh; display: flex; flex-direction: column; box-shadow: 0 4px 24px rgba(0,0,0,0.15); }
.log-header { display: flex; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--border); gap: 10px; }
.log-title { font-size: 14px; font-weight: 600; flex: 1; }
.modal-close-btn { width: 28px; height: 28px; border-radius: 4px; display: flex; align-items: center; justify-content: center; background: none; border: none; cursor: pointer; color: var(--text-secondary); }
.modal-close-btn:hover { background: var(--bg-tertiary); }
.log-body { flex: 1; overflow-y: auto; padding: 0; }
.log-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.log-table th { text-align: left; padding: 8px 14px; background: var(--bg-secondary); color: var(--text-secondary); font-weight: 500; border-bottom: 1px solid var(--border); position: sticky; top: 0; }
.log-table td { padding: 7px 14px; border-bottom: 1px solid var(--border-light); }
.log-time { color: var(--text-secondary); white-space: nowrap; width: 150px; }
.log-ip { font-family: monospace; color: var(--primary); width: 130px; }
.log-file { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 300px; }
.log-empty { padding: 40px; text-align: center; color: var(--text-tertiary); }

/* Text Share */
.text-share-bar { display: flex; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; align-items: flex-start; }
.text-share-input { flex: 1; border: 1px solid var(--border); border-radius: 6px; padding: 7px 10px; font-size: 12px; font-family: inherit; background: var(--bg); color: var(--text); resize: vertical; outline: none; min-height: 36px; }
.text-share-input:focus { border-color: var(--primary); }
.text-share-input::placeholder { color: var(--text-tertiary); }

/* Whitelist */
.whitelist-input { flex: 1; border: 1px solid var(--border); border-radius: 6px; padding: 7px 10px; font-size: 13px; background: var(--bg); color: var(--text); outline: none; font-family: monospace; }
.whitelist-input:focus { border-color: var(--primary); }
.whitelist-list { display: flex; flex-direction: column; gap: 4px; }
.whitelist-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: var(--bg-secondary); border-radius: 6px; }
.whitelist-ip { font-family: monospace; font-size: 13px; color: var(--text); }

/* Port config */
.port-config { display: flex; align-items: center; gap: 4px; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; padding: 2px 6px; transition: border-color 0.15s; flex-shrink: 0; }
.port-config.error { border-color: var(--danger); }
.port-label { font-size: 11px; color: var(--text-secondary); flex-shrink: 0; }
.port-input { width: 56px; border: none; background: transparent; color: var(--text); font-size: 12px; font-family: monospace; outline: none; padding: 3px 2px; }
.port-input:disabled { color: var(--text-tertiary); cursor: not-allowed; }
.port-input::-webkit-inner-spin-button { display: none; }
.port-auto-btn { width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border: none; background: none; color: var(--text-secondary); cursor: pointer; border-radius: 4px; flex-shrink: 0; padding: 0; }
.port-auto-btn:hover { background: var(--bg-tertiary); color: var(--primary); }
.port-auto-btn:disabled { color: var(--text-tertiary); cursor: wait; }
.port-error-text { font-size: 11px; color: var(--danger); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px; flex-shrink: 1; }

/* Log type badge */
.log-type { width: 76px; white-space: nowrap; }
.log-type-badge { display: inline-block; font-size: 10px; padding: 1px 8px; border-radius: 8px; line-height: 16px; white-space: nowrap; }
.log-type-badge.download { background: #dbeafe; color: #2563eb; }
.log-type-badge.upload { background: #dcfce7; color: #16a34a; }
[data-theme="dark"] .log-type-badge.download { background: #1e3a5f; color: #60a5fa; }
[data-theme="dark"] .log-type-badge.upload { background: #14532d; color: #4ade80; }

/* Toast */
.toast {
  position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
  background: #1e293b; color: #fff; padding: 8px 20px; border-radius: 8px;
  font-size: 13px; z-index: 200; pointer-events: none;
  box-shadow: 0 4px 16px rgba(0,0,0,0.25);
}
.toast-fade-enter-active { transition: all 0.2s ease-out; }
.toast-fade-leave-active { transition: all 0.25s ease-in; }
.toast-fade-enter-from, .toast-fade-leave-to { opacity: 0; transform: translateX(-50%) translateY(-8px); }

/* File Preview Modal */
.preview-modal { background: var(--bg); border-radius: 12px; width: 90%; max-width: 900px; max-height: 85vh; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,0.2); overflow: hidden; }
.preview-header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.preview-title { font-size: 13px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 400px; }
.preview-ext-badge { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: var(--bg-tertiary); color: var(--text-secondary); white-space: nowrap; }
.preview-body { flex: 1; overflow: auto; display: flex; align-items: center; justify-content: center; padding: 16px; min-height: 200px; }
.preview-loading { color: var(--text-tertiary); font-size: 13px; }
.preview-image-wrap { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.preview-img { max-width: 100%; max-height: 70vh; object-fit: contain; border-radius: 4px; cursor: zoom-in; transition: opacity 0.15s; }
.preview-img:hover { opacity: 0.92; }
.preview-media-wrap { display: flex; flex-direction: column; align-items: center; gap: 12px; width: 100%; }
.preview-audio { width: 100%; max-width: 500px; }
.preview-video { max-width: 100%; max-height: 70vh; border-radius: 4px; }
.preview-text-wrap { width: 100%; height: 100%; display: flex; flex-direction: column; }
.preview-text, .preview-code { width: 100%; flex: 1; overflow: auto; font-family: 'Cascadia Code', 'Fira Code', 'Consolas', 'Monaco', monospace; font-size: 12px; line-height: 1.6; padding: 12px; margin: 0; background: var(--bg-secondary); border-radius: 6px; color: var(--text-primary); white-space: pre-wrap; word-break: break-all; tab-size: 2; }
.preview-code code { font-family: inherit; }
.preview-md { width: 100%; overflow: auto; font-size: 13px; line-height: 1.7; color: var(--text-primary); padding: 4px; }
.preview-md h1 { font-size: 1.5em; font-weight: 700; margin: 0.6em 0 0.4em; border-bottom: 1px solid var(--border); padding-bottom: 0.2em; }
.preview-md h2 { font-size: 1.3em; font-weight: 700; margin: 0.6em 0 0.4em; border-bottom: 1px solid var(--border); padding-bottom: 0.2em; }
.preview-md h3 { font-size: 1.15em; font-weight: 600; margin: 0.5em 0 0.3em; }
.preview-md h4 { font-size: 1em; font-weight: 600; margin: 0.5em 0 0.3em; }
.preview-md h5, .preview-md h6 { font-size: 0.9em; font-weight: 600; margin: 0.4em 0 0.3em; }
.preview-md p { margin: 0.4em 0; }
.preview-md ul { margin: 0.4em 0; padding-left: 1.5em; }
.preview-md li { margin: 0.2em 0; }
.preview-md code { font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace; font-size: 0.88em; background: var(--bg-tertiary); padding: 1px 4px; border-radius: 3px; }
.preview-md pre { background: var(--bg-secondary); border-radius: 6px; padding: 10px; overflow: auto; margin: 0.5em 0; }
.preview-md pre code { background: none; padding: 0; font-size: 12px; }
.preview-md a { color: #2563eb; text-decoration: none; }
.preview-md a:hover { text-decoration: underline; }
.preview-md blockquote { border-left: 3px solid var(--border); padding-left: 12px; color: var(--text-secondary); margin: 0.5em 0; }
.preview-md img { max-width: 100%; border-radius: 4px; }
.preview-md hr { border: none; border-top: 1px solid var(--border); margin: 1em 0; }
.preview-error { display: flex; flex-direction: column; align-items: center; gap: 8px; color: var(--text-tertiary); }
.preview-error p { font-size: 14px; margin: 0; }
.preview-error-sub { font-size: 12px !important; color: var(--text-tertiary); }

/* Fullscreen Image Viewer */
.img-viewer-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.92); z-index: 300; display: flex; align-items: center; justify-content: center; cursor: grab; user-select: none; }
.img-viewer-overlay:active { cursor: grabbing; }
.img-viewer-img { max-width: 90vw; max-height: 90vh; object-fit: contain; transform-origin: center center; transition: transform 0.05s ease-out; pointer-events: none; }
.img-viewer-info { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 4px; color: rgba(255,255,255,0.7); font-size: 12px; pointer-events: none; }
.img-viewer-hint { font-size: 11px; opacity: 0.6; }
.img-viewer-close { position: fixed; top: 16px; right: 16px; width: 36px; height: 36px; border: none; border-radius: 50%; background: rgba(255,255,255,0.15); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.15s; }
.img-viewer-close:hover { background: rgba(255,255,255,0.3); }
</style>

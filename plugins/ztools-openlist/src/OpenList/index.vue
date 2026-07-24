<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  CopyDocument,
  Delete,
  Download,
  Edit,
  Folder,
  FolderAdd,
  Grid,
  HomeFilled,
  List,
  Moon,
  Rank,
  Search,
  Share,
  Sunny,
  SwitchButton,
  Upload,
  User,
  View,
  View as EyeIcon,
  Hide
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import 'element-plus/es/components/message/style/css'
import OperationFeedback from '../components/OperationFeedback.vue'

defineProps({
  enterAction: {
    type: Object,
    required: true
  }
})

const baseUrl = ref('')
const username = ref('')
const password = ref('')
const token = ref('')
const currentPath = ref('/')
const files = ref<OpenListFile[]>([])
const total = ref(0)
const loading = ref(false)
const connecting = ref(false)
const uploading = ref(false)
const uploadRef = ref()
const detailLoading = ref(false)
const error = ref('')
const selectedFile = ref<OpenListFile | null>(null)
const detailDrawer = ref(false)
const loginDialog = ref(false)
const mkdirDialog = ref(false)
const uploadDialog = ref(false)
const searchQuery = ref('')
const viewMode = ref<'list' | 'grid'>('list')
const isDark = ref(false)
const revealBaseUrl = ref(false)
const mobileSearchOpen = ref(false)
const newFolderName = ref('')
const creatingFolder = ref(false)
const deleting = ref(false)
const sharing = ref(false)
const downloading = ref(false)
const transferProgress = ref(0)
const transferStatus = ref('')
const transferIndeterminate = ref(false)
const confirmDialog = ref({
  visible: false,
  title: '',
  message: '',
  confirmText: '确认',
  danger: false
})

let confirmResolver: ((value: boolean) => void) | null = null

type UploadQueueItem = {
  uid: number | string
  name: string
  size: number
  raw?: File
  path?: string
}

type FileTransferMode = 'copy' | 'move'
type DirectoryTreeNode = {
  label: string
  path: string
  children: DirectoryTreeNode[]
  loaded?: boolean
}

const uploadQueue = ref<UploadQueueItem[]>([])
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0
})
const contextMenuFile = ref<OpenListFile | null>(null)
const mobileSearchInputRef = ref()
const renameDialog = ref(false)
const renameName = ref('')
const renaming = ref(false)
const fileActionDialog = ref<{ visible: boolean; mode: FileTransferMode }>({
  visible: false,
  mode: 'copy'
})
const targetDir = ref('/')
const directoryTreeData = ref<DirectoryTreeNode[]>([])
const directoryExpandedKeys = ref<string[]>(['/'])
const directoryTreeLoading = ref(false)
const fileOperating = ref(false)
const selectedFileNames = ref<Set<string>>(new Set())
const activeActionNames = ref<string[]>([])
const fileLinkCache = ref<Map<string, { raw_url: string; size: number }>>(new Map())
const pageSize = 10
const currentPage = ref(1)
const directoryTreeProps = {
  children: 'children',
  label: 'label'
}
const uploadTotalSize = computed(() => uploadQueue.value.reduce((sum, file) => sum + file.size, 0))

const isConnected = computed(() => Boolean(baseUrl.value && token.value))
const maskedBaseUrl = computed(() => maskBaseUrl(baseUrl.value))
const displayBaseUrl = computed(() => {
  if (!baseUrl.value) return '未连接 OpenList'
  return revealBaseUrl.value ? baseUrl.value : maskedBaseUrl.value
})
const userLabel = computed(() => (isConnected.value ? username.value || '已连接' : '用户'))
const selectedFilePath = computed(() => {
  if (!selectedFile.value) return ''
  return joinRemotePath(currentPath.value, selectedFile.value.name)
})

const breadcrumbs = computed(() => {
  const parts = currentPath.value.split('/').filter(Boolean)
  const result = [{ label: '我的文件', path: '/' }]
  let cursor = ''

  parts.forEach((part) => {
    cursor += `/${part}`
    result.push({ label: part, path: cursor })
  })

  return result
})

const sortedFiles = computed(() => {
  return [...files.value].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
})

const visibleFiles = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return sortedFiles.value
  return sortedFiles.value.filter((file) => file.name.toLowerCase().includes(query))
})

const pagedFiles = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return visibleFiles.value.slice(start, start + pageSize)
})
const selectedFiles = computed(() => {
  if (selectedFileNames.value.size === 0) return []
  return files.value.filter((file) => selectedFileNames.value.has(file.name))
})
const selectedNames = computed(() => selectedFiles.value.map((file) => file.name))
const isMultiSelecting = computed(() => selectedFileNames.value.size > 0)
const allCurrentPageSelected = computed(() => {
  return pagedFiles.value.length > 0 && pagedFiles.value.every((file) => selectedFileNames.value.has(file.name))
})
const fileActionTitle = computed(() => (fileActionDialog.value.mode === 'copy' ? '复制到' : '移动到'))
const fileActionConfirmText = computed(() => (fileActionDialog.value.mode === 'copy' ? '复制' : '移动'))

watch(searchQuery, () => {
  currentPage.value = 1
})

watch(visibleFiles, () => {
  const maxPage = Math.max(1, Math.ceil(visibleFiles.value.length / pageSize))
  if (currentPage.value > maxPage) {
    currentPage.value = maxPage
  }
})

watch(isDark, syncThemeClass, { immediate: true })

function getSelectionKey(file: OpenListFile) {
  return file.name
}

function isFileSelected(file: OpenListFile) {
  return selectedFileNames.value.has(getSelectionKey(file))
}

function setFileSelected(file: OpenListFile, checked: boolean) {
  const next = new Set(selectedFileNames.value)
  const key = getSelectionKey(file)

  if (checked) {
    next.add(key)
  } else {
    next.delete(key)
  }

  selectedFileNames.value = next
}

function toggleFileSelection(file: OpenListFile) {
  setFileSelected(file, !isFileSelected(file))
}

function clearSelection() {
  selectedFileNames.value = new Set()
}

function toggleSelectAllCurrentPage() {
  if (pagedFiles.value.length === 0) return

  const currentPageNames = pagedFiles.value.map((file) => file.name)
  const next = new Set(selectedFileNames.value)

  if (allCurrentPageSelected.value) {
    currentPageNames.forEach((name) => next.delete(name))
    selectedFileNames.value = next
    return
  }

  currentPageNames.forEach((name) => next.add(name))
  selectedFileNames.value = next
}

function getActionNames(file: OpenListFile | null) {
  if (activeActionNames.value.length > 0) return [...activeActionNames.value]
  return file ? [file.name] : []
}

function handleFileClick(file: OpenListFile) {
  if (isMultiSelecting.value) {
    toggleFileSelection(file)
    return
  }

  file.is_dir ? openFolder(file) : showFileDetail(file)
}

function handleFileDoubleClick(file: OpenListFile) {
  if (isMultiSelecting.value) return
  file.is_dir ? openFolder(file) : showFileDetail(file)
}

function joinRemotePath(dir: string, name: string) {
  const normalizedDir = dir === '/' ? '' : dir.replace(/\/+$/, '')
  return `${normalizedDir}/${name}` || '/'
}

function getRemotePath(file: OpenListFile) {
  return joinRemotePath(currentPath.value, file.name)
}

function normalizeRemoteDir(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return '/'
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.replace(/\/+$/, '') || '/'
}

function getDirectoryName(dirPath: string) {
  if (dirPath === '/') return '/'
  const parts = dirPath.split('/').filter(Boolean)
  return parts[parts.length - 1] || dirPath
}

function getParentPath(dirPath: string) {
  if (dirPath === '/') return ''
  const parts = dirPath.split('/').filter(Boolean)
  parts.pop()
  return parts.length ? `/${parts.join('/')}` : '/'
}

function createDirectoryNode(dirPath: string): DirectoryTreeNode {
  return {
    label: getDirectoryName(dirPath),
    path: dirPath,
    children: [],
    loaded: false
  }
}

function findDirectoryNode(nodes: DirectoryTreeNode[], dirPath: string): DirectoryTreeNode | null {
  for (const node of nodes) {
    if (node.path === dirPath) return node
    const child = findDirectoryNode(node.children, dirPath)
    if (child) return child
  }
  return null
}

function sortDirectoryNodes(nodes: DirectoryTreeNode[]) {
  nodes.sort((a, b) => {
    if (a.path === '/') return -1
    if (b.path === '/') return 1
    return a.label.localeCompare(b.label)
  })
}

function ensureDirectoryNode(dirPath: string) {
  const normalizedPath = normalizeRemoteDir(dirPath)

  if (directoryTreeData.value.length === 0) {
    directoryTreeData.value = [createDirectoryNode('/')]
  }

  const existingNode = findDirectoryNode(directoryTreeData.value, normalizedPath)
  if (existingNode) return existingNode
  if (normalizedPath === '/') return directoryTreeData.value[0]

  const parentPath = getParentPath(normalizedPath)
  const parentNode = ensureDirectoryNode(parentPath)
  const node = createDirectoryNode(normalizedPath)
  parentNode.children.push(node)
  sortDirectoryNodes(parentNode.children)
  return node
}

function expandDirectoryPath(dirPath: string) {
  const paths = new Set(directoryExpandedKeys.value)
  paths.add('/')

  let cursor = ''
  normalizeRemoteDir(dirPath)
    .split('/')
    .filter(Boolean)
    .forEach((part) => {
      cursor += `/${part}`
      paths.add(cursor)
    })

  directoryExpandedKeys.value = [...paths]
}

function maskBaseUrl(value: string) {
  if (!value) return ''
  return value.replace(/(\b\d{1,3}\.)(\d{1,3}\.\d{1,3}\.)(\d{1,3}\b)/, '$1******.$3')
}

function openProject(url: string) {
  window.ztools.shellOpenExternal(url)
}

async function copyBaseUrl() {
  if (!baseUrl.value) {
    showToast('warning', '当前没有可复制的链接')
    return
  }

  try {
    await navigator.clipboard.writeText(baseUrl.value)
    showToast('success', '链接地址已复制')
  } catch {
    showToast('warning', '复制失败，请手动复制链接')
  }
}

function formatSize(size: number) {
  if (!size) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = size
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function formatDate(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function getLocalFileName(filePath: string) {
  return filePath.split(/[\\/]/).pop() || filePath
}

function getSavePath(result: unknown) {
  if (!result) return ''
  if (typeof result === 'string') return result
  if (typeof result === 'object') {
    const dialogResult = result as { canceled?: boolean; filePath?: string }
    if (dialogResult.canceled) return ''
    return dialogResult.filePath || ''
  }
  return ''
}

function getDirectoryPath(result: unknown) {
  if (!result) return ''
  if (typeof result === 'string') return result
  if (Array.isArray(result)) return String(result[0] || '')
  if (typeof result === 'object') {
    const dialogResult = result as { canceled?: boolean; filePath?: string; filePaths?: string[] }
    if (dialogResult.canceled) return ''
    return dialogResult.filePaths?.[0] || dialogResult.filePath || ''
  }
  return ''
}

function setError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  error.value = message
  showToast('error', message)
}

function getMessageAppendTarget() {
  return document.querySelector<HTMLElement>('#app') || document.body
}

function showToast(type: 'success' | 'warning' | 'error', message: string) {
  ElMessage({
    appendTo: getMessageAppendTarget(),
    message,
    type,
    placement: 'top',
    customClass: 'openlist-message',
    grouping: true,
    duration: 2800,
    offset: 18,
    zIndex: 5000
  })
}

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
}

function askConfirm(options: {
  title: string
  message: string
  confirmText?: string
  danger?: boolean
}) {
  confirmDialog.value = {
    visible: true,
    title: options.title,
    message: options.message,
    confirmText: options.confirmText || '确认',
    danger: Boolean(options.danger)
  }

  return new Promise<boolean>((resolve) => {
    confirmResolver = resolve
  })
}

function resolveConfirm(value: boolean) {
  confirmDialog.value.visible = false
  if (confirmResolver) {
    confirmResolver(value)
    confirmResolver = null
  }
}

function getExtension(name: string) {
  const index = name.lastIndexOf('.')
  return index > -1 ? name.slice(index + 1).toLowerCase() : ''
}

function getFileKind(file: OpenListFile) {
  if (file.is_dir) return 'folder'
  const ext = getExtension(file.name)
  if (['doc', 'docx'].includes(ext)) return 'word'
  if (ext === 'pdf') return 'pdf'
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'excel'
  if (['mp4', 'mov', 'mkv', 'avi', 'webm'].includes(ext)) return 'video'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive'
  return 'file'
}

function getFileBadge(file: OpenListFile) {
  if (file.is_dir) return ''
  const ext = getExtension(file.name)
  return ext ? ext.slice(0, 3).toUpperCase() : 'FILE'
}

function openContextMenu(event: MouseEvent, file: OpenListFile) {
  event.preventDefault()
  const menuWidth = 176
  const menuHeight = 172
  contextMenuFile.value = file
  contextMenu.value = {
    visible: true,
    x: Math.min(event.clientX, window.innerWidth - menuWidth - 8),
    y: Math.min(event.clientY, window.innerHeight - menuHeight - 8)
  }
}

function closeContextMenu() {
  contextMenu.value.visible = false
}

function handleShellClick() {
  closeContextMenu()
  mobileSearchOpen.value = false
}

async function openMobileSearch() {
  mobileSearchOpen.value = true
  await nextTick()
  mobileSearchInputRef.value?.focus?.()
}

function openRenameDialog(file = contextMenuFile.value) {
  if (!file) return
  closeContextMenu()
  contextMenuFile.value = file
  renameName.value = file.name
  renameDialog.value = true
}

async function loadDirectoryChildren(dirPath: string, force = false) {
  const normalizedPath = normalizeRemoteDir(dirPath)
  const node = ensureDirectoryNode(normalizedPath)

  if (node.loaded && !force) return

  const result = await window.services.listOpenList(baseUrl.value, token.value, normalizedPath, '', force)
  node.children = (result.content || [])
    .filter((file) => file.is_dir)
    .map((file) => createDirectoryNode(joinRemotePath(normalizedPath, file.name)))
  node.loaded = true
  sortDirectoryNodes(node.children)
  expandDirectoryPath(normalizedPath)
}

async function browseTargetDir(dirPath: string, force = false) {
  const normalizedPath = normalizeRemoteDir(dirPath)
  directoryTreeLoading.value = true
  targetDir.value = normalizedPath

  try {
    const parts = normalizedPath.split('/').filter(Boolean)
    let cursor = '/'

    await loadDirectoryChildren('/', force)

    for (const part of parts) {
      cursor = joinRemotePath(cursor, part)
      ensureDirectoryNode(cursor)
      await loadDirectoryChildren(cursor, force)
    }

    const parentPath = getParentPath(normalizedPath)
    if (parentPath) {
      await loadDirectoryChildren(parentPath, force)
    }

    expandDirectoryPath(normalizedPath)
  } catch (err) {
    setError(err)
  } finally {
    directoryTreeLoading.value = false
  }
}

function selectTargetDir(data: DirectoryTreeNode) {
  browseTargetDir(data.path)
}

function goTargetParent() {
  const parentPath = getParentPath(normalizeRemoteDir(targetDir.value))
  if (!parentPath) return
  browseTargetDir(parentPath)
}

function goTargetRoot() {
  browseTargetDir('/')
}

function goTargetCurrentPath() {
  browseTargetDir(currentPath.value)
}

async function openFileActionDialog(mode: FileTransferMode, file = contextMenuFile.value) {
  if (!file) return
  closeContextMenu()
  contextMenuFile.value = file
  activeActionNames.value = [file.name]
  fileActionDialog.value = {
    visible: true,
    mode
  }
  targetDir.value = currentPath.value
  directoryTreeData.value = [createDirectoryNode('/')]
  directoryExpandedKeys.value = ['/']
  await browseTargetDir(currentPath.value, true)
}

async function openBatchFileActionDialog(mode: FileTransferMode) {
  const names = selectedNames.value
  if (names.length === 0) return

  closeContextMenu()
  contextMenuFile.value = null
  activeActionNames.value = names
  fileActionDialog.value = {
    visible: true,
    mode
  }
  targetDir.value = currentPath.value
  directoryTreeData.value = [createDirectoryNode('/')]
  directoryExpandedKeys.value = ['/']
  await browseTargetDir(currentPath.value, true)
}

function openContextDetail(file = contextMenuFile.value) {
  if (!file) return
  closeContextMenu()
  showFileDetail(file)
}

function openLoginDialog() {
  loginDialog.value = true
}

function handleUserCommand(command: string | number | object) {
  if (command === 'login') {
    openLoginDialog()
    return
  }

  if (isConnected.value) {
    logout()
  }
}

async function logout() {
  const confirmed = await askConfirm({
    title: '退出登录',
    message: '确定退出当前 OpenList 连接吗？本地保存的地址和 Token 会被清空。',
    confirmText: '退出',
    danger: true
  })

  if (!confirmed) return

  window.services.clearOpenListConfig()
  baseUrl.value = ''
  username.value = ''
  password.value = ''
  token.value = ''
  currentPath.value = '/'
  files.value = []
  total.value = 0
  selectedFile.value = null
  detailDrawer.value = false
  searchQuery.value = ''
  currentPage.value = 1
  uploadQueue.value = []
  uploadRef.value?.clearFiles()
  fileLinkCache.value = new Map()
  loginDialog.value = true
  showToast('success', '已退出登录')
}

function openMkdirDialog() {
  if (!isConnected.value) {
    showToast('warning', '请先连接 OpenList')
    loginDialog.value = true
    return
  }
  newFolderName.value = ''
  mkdirDialog.value = true
}

function openUploadDialog() {
  if (!isConnected.value) {
    showToast('warning', '请先连接 OpenList')
    loginDialog.value = true
    return
  }

  uploadDialog.value = true
}

function normalizeUploadFile(file: any): UploadQueueItem {
  const raw = file.raw || file
  const filePath = (raw as File & { path?: string })?.path || file.path || ''

  return {
    uid: file.uid || raw?.uid || `${raw?.name || file.name}-${raw?.size || file.size || Date.now()}`,
    name: raw?.name || file.name || getLocalFileName(filePath),
    size: raw?.size || file.size || 0,
    raw,
    path: filePath
  }
}

function syncUploadQueue(_: any, files: any[]) {
  uploadQueue.value = files.map(normalizeUploadFile)
}

function removeUploadFile(_: any, files: any[]) {
  uploadQueue.value = files.map(normalizeUploadFile)
}

function clearUploadQueue() {
  if (uploading.value) return
  uploadQueue.value = []
  uploadRef.value?.clearFiles()
}

function syncThemeClass() {
  document.documentElement.classList.toggle('openlist-theme-dark', isDark.value)
}

function toggleTheme() {
  isDark.value = !isDark.value
  window.localStorage.setItem('openlist-theme', isDark.value ? 'dark' : 'light')
}

function loadTheme() {
  isDark.value = window.localStorage.getItem('openlist-theme') === 'dark'
}

async function loadConfig() {
  const config = window.services.loadOpenListConfig()
  baseUrl.value = config.baseUrl || ''
  username.value = config.username || ''
  token.value = config.token || ''

  if (baseUrl.value && token.value) {
    await refreshList()
  } else {
    loginDialog.value = true
  }
}

async function connect() {
  if (!baseUrl.value || !username.value || !password.value) {
    showToast('warning', '请填写 OpenList 地址、用户名和密码')
    return
  }

  connecting.value = true
  error.value = ''

  try {
    const config = await window.services.loginOpenList(baseUrl.value, username.value, password.value)
    baseUrl.value = config.baseUrl
    username.value = config.username
    token.value = config.token
    password.value = ''
    currentPath.value = '/'
    await refreshList()
    loginDialog.value = false
    showToast('success', '已连接 OpenList')
  } catch (err) {
    setError(err)
  } finally {
    connecting.value = false
  }
}

async function saveToken() {
  if (!baseUrl.value || !token.value) {
    showToast('warning', '请填写 OpenList 地址和 Token')
    return
  }

  const config = window.services.saveOpenListConfig({
    baseUrl: baseUrl.value,
    username: username.value,
    token: token.value
  })
  baseUrl.value = config.baseUrl
  token.value = config.token
  await refreshList()
  loginDialog.value = false
  showToast('success', 'Token 已保存')
}

async function refreshList(path = currentPath.value, forceRefresh = false) {
  if (!baseUrl.value || !token.value) return

  loading.value = true
  error.value = ''
  clearSelection()

  try {
    const result = await window.services.listOpenList(
      baseUrl.value,
      token.value,
      path,
      '',
      forceRefresh
    )
    currentPath.value = path
    currentPage.value = 1
    files.value = result.content || []
    total.value = result.total ?? files.value.length
  } catch (err) {
    setError(err)
  } finally {
    loading.value = false
  }
}

function openFolder(file: any) {
  if (!file.is_dir) return
  searchQuery.value = ''
  refreshList(joinRemotePath(currentPath.value, file.name))
}

async function showFileDetail(file: any) {
  selectedFile.value = { ...file, raw_url: '' }
  detailDrawer.value = true
  detailLoading.value = true
  error.value = ''

  try {
    const remotePath = getRemotePath(file)
    const detail = await window.services.getOpenListFile(baseUrl.value, token.value, remotePath)
    if (detail?.raw_url) {
      cacheFileLink(remotePath, detail.raw_url, Number(detail.size) || Number(file.size) || 0)
    }
    selectedFile.value = detail ? { ...file, ...detail, raw_url: fileLinkCache.value.get(remotePath)?.raw_url || detail.raw_url } : file
  } catch (err) {
    setError(err)
  } finally {
    detailLoading.value = false
  }
}

function cacheFileLink(remotePath: string, rawUrl: string, size = 0) {
  if (!rawUrl) return

  const next = new Map(fileLinkCache.value)
  next.set(remotePath, {
    raw_url: new URL(rawUrl, baseUrl.value).toString(),
    size
  })
  fileLinkCache.value = next
}

async function getFileLinkDetail(file: any) {
  const remotePath = getRemotePath(file)
  const knownRawUrl = typeof file.raw_url === 'string' ? file.raw_url : ''
  const knownSize = Number(file.size) || 0

  if (knownRawUrl) {
    cacheFileLink(remotePath, knownRawUrl, knownSize)
    return fileLinkCache.value.get(remotePath)
  }

  const cached = fileLinkCache.value.get(remotePath)
  if (cached) return cached

  const detail = await window.services.getOpenListFile(baseUrl.value, token.value, remotePath)
  const rawUrl = detail?.raw_url

  if (!rawUrl) return null

  const size = Number(detail?.size) || knownSize
  cacheFileLink(remotePath, rawUrl, size)

  if (selectedFile.value?.name === file.name) {
    selectedFile.value = { ...selectedFile.value, ...detail, raw_url: fileLinkCache.value.get(remotePath)?.raw_url || rawUrl }
  }

  return fileLinkCache.value.get(remotePath)
}

async function downloadFile(file: any) {
  if (file.is_dir) {
    await downloadFolder(file)
    return
  }

  const remotePath = joinRemotePath(currentPath.value, file.name)
  let detailError: unknown = null
  const linkPromise = getFileLinkDetail(file).catch((err) => {
    detailError = err
    return null
  })
  let savePath = ''
  downloading.value = true
  transferProgress.value = 0
  transferIndeterminate.value = true
  transferStatus.value = `准备下载：${file.name}`
  error.value = ''

  await nextTick()
  await waitForNextFrame()

  try {
    const result = await Promise.resolve(window.ztools.showSaveDialog({
      title: '保存文件',
      defaultPath: file.name,
      buttonLabel: '下载'
    }))
    savePath = getSavePath(result)
  } catch (err) {
    setError(err)
    downloading.value = false
    transferProgress.value = 0
    transferIndeterminate.value = false
    transferStatus.value = ''
    return
  }

  if (!savePath) {
    downloading.value = false
    transferProgress.value = 0
    transferIndeterminate.value = false
    transferStatus.value = ''
    return
  }

  downloading.value = true
  transferProgress.value = 0
  transferIndeterminate.value = true
  transferStatus.value = `正在获取下载链接：${file.name}`
  error.value = ''

  try {
    const linkDetail = await linkPromise
    if (detailError) {
      throw detailError
    }
    const rawUrl = linkDetail?.raw_url || ''
    const size = Number(linkDetail?.size) || Number(file.size) || 0

    if (!rawUrl) {
      showToast('warning', 'OpenList 未返回文件直链')
      return
    }

    const outputPath = await window.services.downloadOpenListFile(
      baseUrl.value,
      token.value,
      rawUrl,
      savePath,
      (progress) => {
        transferIndeterminate.value = false
        transferStatus.value = `正在下载：${file.name}`
        transferProgress.value = progress.percent || 0
      },
      size
    )
    transferProgress.value = 100
    transferIndeterminate.value = false
    transferStatus.value = '下载完成'
    window.ztools.shellShowItemInFolder(outputPath)
    showToast('success', '下载完成')
  } catch (err) {
    setError(err)
  } finally {
    window.setTimeout(() => {
      downloading.value = false
      transferProgress.value = 0
      transferIndeterminate.value = false
      transferStatus.value = ''
    }, 600)
  }
}

async function downloadFolder(file: any) {
  if (!file.is_dir) return

  let directoryPath = ''
  downloading.value = true
  transferProgress.value = 0
  transferIndeterminate.value = true
  transferStatus.value = `准备下载文件夹：${file.name}`
  error.value = ''

  await nextTick()
  await waitForNextFrame()

  try {
    const result = await Promise.resolve(window.ztools.showOpenDialog({
      title: '选择保存位置',
      buttonLabel: '下载到这里',
      properties: ['openDirectory', 'createDirectory']
    }))
    directoryPath = getDirectoryPath(result)
  } catch (err) {
    setError(err)
    downloading.value = false
    transferProgress.value = 0
    transferIndeterminate.value = false
    transferStatus.value = ''
    return
  }

  if (!directoryPath) {
    downloading.value = false
    transferProgress.value = 0
    transferIndeterminate.value = false
    transferStatus.value = ''
    return
  }

  downloading.value = true
  transferProgress.value = 0
  transferIndeterminate.value = true
  transferStatus.value = `正在收集文件夹下载链接：${file.name}`
  error.value = ''

  try {
    const outputPath = await window.services.downloadOpenListDir(
      baseUrl.value,
      token.value,
      getRemotePath(file),
      directoryPath,
      (progress) => {
        transferIndeterminate.value = false
        transferStatus.value = `正在下载文件夹：${file.name}`
        transferProgress.value = progress.percent || 0
      }
    )

    transferProgress.value = 100
    transferIndeterminate.value = false
    transferStatus.value = '文件夹下载完成'
    window.ztools.shellShowItemInFolder(outputPath)
    showToast('success', '文件夹下载完成')
  } catch (err) {
    setError(err)
  } finally {
    window.setTimeout(() => {
      downloading.value = false
      transferProgress.value = 0
      transferIndeterminate.value = false
      transferStatus.value = ''
    }, 600)
  }
}

async function downloadSelectedFiles() {
  const names = selectedNames.value
  if (names.length === 0) return

  let directoryPath = ''
  downloading.value = true
  transferProgress.value = 0
  transferIndeterminate.value = true
  transferStatus.value = `准备下载 ${names.length} 项`
  error.value = ''

  await nextTick()
  await waitForNextFrame()

  try {
    const result = await Promise.resolve(window.ztools.showOpenDialog({
      title: '选择保存位置',
      buttonLabel: '下载到这里',
      properties: ['openDirectory', 'createDirectory']
    }))
    directoryPath = getDirectoryPath(result)
  } catch (err) {
    setError(err)
    downloading.value = false
    transferProgress.value = 0
    transferIndeterminate.value = false
    transferStatus.value = ''
    return
  }

  if (!directoryPath) {
    downloading.value = false
    transferProgress.value = 0
    transferIndeterminate.value = false
    transferStatus.value = ''
    return
  }

  downloading.value = true
  transferProgress.value = 0
  transferIndeterminate.value = true
  transferStatus.value = `正在收集 ${names.length} 项下载链接`
  error.value = ''

  try {
    const outputPath = await window.services.downloadOpenListItems(
      baseUrl.value,
      token.value,
      currentPath.value,
      names,
      directoryPath,
      (progress) => {
        transferIndeterminate.value = false
        transferStatus.value = `正在下载 ${names.length} 项`
        transferProgress.value = progress.percent || 0
      }
    )

    transferProgress.value = 100
    transferIndeterminate.value = false
    transferStatus.value = '批量下载完成'
    clearSelection()
    window.ztools.shellShowItemInFolder(outputPath)
    showToast('success', '批量下载完成')
  } catch (err) {
    setError(err)
  } finally {
    window.setTimeout(() => {
      downloading.value = false
      transferProgress.value = 0
      transferIndeterminate.value = false
      transferStatus.value = ''
    }, 600)
  }
}

async function uploadFiles() {
  if (!isConnected.value) {
    showToast('warning', '请先连接 OpenList')
    loginDialog.value = true
    return
  }

  if (uploadQueue.value.length === 0) {
    showToast('warning', '请先选择要上传的文件')
    return
  }

  uploading.value = true
  transferProgress.value = 0
  transferIndeterminate.value = false
  transferStatus.value = ''
  error.value = ''

  try {
    const uploadedNames: string[] = []
    const queue = [...uploadQueue.value]

    for (let index = 0; index < queue.length; index += 1) {
      const localFile = queue[index]
      transferStatus.value = `正在上传 ${index + 1}/${queue.length}：${localFile.name}`
      const onProgress = (progress: { percent: number }) => {
        const fileBase = index / queue.length
        const filePart = (progress.percent || 0) / 100 / queue.length
        transferProgress.value = Math.min(100, Math.round((fileBase + filePart) * 100))
      }

      if (!localFile.path && !localFile.raw) {
        throw new Error(`无法读取文件：${localFile.name}`)
      }

      const result: any = localFile.path
        ? await window.services.uploadOpenListFile(
            baseUrl.value,
            token.value,
            currentPath.value,
            localFile.path,
            onProgress
          )
        : await window.services.uploadOpenListFileContent(
            baseUrl.value,
            token.value,
            currentPath.value,
            localFile.name,
            await localFile.raw.arrayBuffer(),
            onProgress
          )
      if (result?.fileName) {
        uploadedNames.push(result.fileName)
      }
    }

    await refreshList(currentPath.value, true)

    const visibleNames = new Set(files.value.map((file) => file.name))
    const missingNames = uploadedNames.filter((name) => !visibleNames.has(name))

    if (missingNames.length > 0) {
      await sleep(1000)
      await refreshList(currentPath.value, true)
    }

    transferProgress.value = 100
    transferStatus.value = '上传完成'
    uploadDialog.value = false
    uploadQueue.value = []
    uploadRef.value?.clearFiles()
    showToast('success', `已上传 ${queue.length} 个文件`)
  } catch (err) {
    setError(err)
  } finally {
    window.setTimeout(() => {
      uploading.value = false
      transferProgress.value = 0
      transferIndeterminate.value = false
      transferStatus.value = ''
    }, 600)
  }
}

async function createFolder() {
  const name = newFolderName.value.trim()
  if (!name) {
    showToast('warning', '请输入文件夹名称')
    return
  }

  if (name.includes('/')) {
    showToast('warning', '文件夹名称不能包含 /')
    return
  }

  creatingFolder.value = true
  error.value = ''

  try {
    await window.services.makeOpenListDir(baseUrl.value, token.value, currentPath.value, name)
    mkdirDialog.value = false
    await refreshList(currentPath.value, true)
    showToast('success', '文件夹已创建')
  } catch (err) {
    setError(err)
  } finally {
    creatingFolder.value = false
  }
}

async function renameFile() {
  const file = contextMenuFile.value
  const nextName = renameName.value.trim()

  if (!file) return
  if (!nextName) {
    showToast('warning', '请输入新的名称')
    return
  }
  if (nextName.includes('/')) {
    showToast('warning', '名称不能包含 /')
    return
  }
  if (nextName === file.name) {
    renameDialog.value = false
    return
  }

  renaming.value = true
  error.value = ''

  try {
    await window.services.renameOpenListFile(baseUrl.value, token.value, getRemotePath(file), nextName)
    renameDialog.value = false
    if (selectedFile.value?.name === file.name) {
      detailDrawer.value = false
      selectedFile.value = null
    }
    await refreshList(currentPath.value, true)
    showToast('success', '已重命名')
  } catch (err) {
    setError(err)
  } finally {
    renaming.value = false
  }
}

async function runFileAction() {
  const file = contextMenuFile.value
  const dstDir = normalizeRemoteDir(targetDir.value)
  const mode = fileActionDialog.value.mode
  const names = getActionNames(file)
  const actionNameSet = new Set(names)
  const actionFiles = files.value.filter((item) => actionNameSet.has(item.name))

  if (names.length === 0) return
  if (mode === 'move' && dstDir === currentPath.value) {
    showToast('warning', '目标目录不能和当前目录相同')
    return
  }
  const invalidMoveDir = actionFiles.find((item) => {
    if (!item.is_dir) return false
    const sourceDir = getRemotePath(item)
    return dstDir === sourceDir || dstDir.startsWith(`${sourceDir}/`)
  })

  if (mode === 'move' && invalidMoveDir) {
    const sourceDir = getRemotePath(invalidMoveDir)
    if (dstDir === sourceDir || dstDir.startsWith(`${sourceDir}/`)) {
      showToast('warning', '不能移动到自身或子目录')
      return
    }
  }

  fileOperating.value = true
  error.value = ''

  try {
    const action = mode === 'copy' ? window.services.copyOpenListFiles : window.services.moveOpenListFiles
    await action(baseUrl.value, token.value, currentPath.value, dstDir, names)
    fileActionDialog.value.visible = false
    activeActionNames.value = []
    await refreshList(currentPath.value, true)
    clearSelection()
    showToast('success', mode === 'copy' ? '已复制' : '已移动')
  } catch (err) {
    setError(err)
  } finally {
    fileOperating.value = false
  }
}

async function removeFile(file: any) {
  const label = file.is_dir ? '文件夹' : '文件'
  const confirmed = await askConfirm({
    title: '删除确认',
    message: `确定删除${label}「${file.name}」吗？此操作不可撤销。`,
    confirmText: '删除',
    danger: true
  })

  if (!confirmed) {
    return
  }

  deleting.value = true
  error.value = ''

  try {
    await window.services.removeOpenListFiles(baseUrl.value, token.value, currentPath.value, [file.name])
    if (selectedFile.value?.name === file.name) {
      detailDrawer.value = false
      selectedFile.value = null
    }
    await refreshList(currentPath.value, true)
    showToast('success', '已删除')
  } catch (err) {
    setError(err)
  } finally {
    deleting.value = false
  }
}

async function removeSelectedFiles() {
  const names = selectedNames.value
  if (names.length === 0) return

  const confirmed = await askConfirm({
    title: '删除确认',
    message: `确定删除选中的 ${names.length} 项吗？此操作不可撤销。`,
    confirmText: '删除',
    danger: true
  })

  if (!confirmed) return

  deleting.value = true
  error.value = ''

  try {
    await window.services.removeOpenListFiles(baseUrl.value, token.value, currentPath.value, names)
    if (selectedFile.value && names.includes(selectedFile.value.name)) {
      detailDrawer.value = false
      selectedFile.value = null
    }
    await refreshList(currentPath.value, true)
    clearSelection()
    showToast('success', '已删除')
  } catch (err) {
    setError(err)
  } finally {
    deleting.value = false
  }
}

async function shareFile(file: any) {
  if (file.is_dir) {
    showToast('warning', '文件夹没有可复制的文件直链')
    return
  }

  sharing.value = true
  error.value = ''

  try {
    const linkDetail = await getFileLinkDetail(file)
    const rawUrl = linkDetail?.raw_url

    if (!rawUrl) {
      showToast('warning', 'OpenList 未返回文件直链')
      return
    }

    await navigator.clipboard.writeText(rawUrl)
    showToast('success', '文件链接已复制')
  } catch (err) {
    setError(err)
  } finally {
    sharing.value = false
  }
}

function goParent() {
  if (currentPath.value === '/') return
  const parts = currentPath.value.split('/').filter(Boolean)
  parts.pop()
  searchQuery.value = ''
  refreshList(parts.length ? `/${parts.join('/')}` : '/')
}

onMounted(() => {
  loadTheme()
  loadConfig()
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('openlist-theme-dark')
})
</script>

<template>
  <main class="drive-shell" :class="{ dark: isDark }" @click="handleShellClick">
    <aside class="sidebar">
      <div class="brand">
        <img class="brand-logo" src="/logo.png" alt="OpenListUI" />
        <div>
          <strong>OpenListUI</strong>
          <span>ZTools OpenList</span>
        </div>
      </div>
      <p class="brand-description">
        在 ZTools 中连接 OpenList，快速浏览、上传和下载你的文件。
      </p>
      <section class="connection-card">
        <span class="sidebar-label">当前链接</span>
        <button
          class="connection-row"
          type="button"
          :disabled="!baseUrl"
          title="点击复制完整链接"
          @click="copyBaseUrl"
        >
          <span class="connection-text" :title="baseUrl || '未连接 OpenList'">
            {{ displayBaseUrl }}
          </span>
          <button
            v-if="baseUrl"
            class="reveal-button"
            type="button"
            :title="revealBaseUrl ? '隐藏完整链接' : '显示完整链接'"
            @click.stop="revealBaseUrl = !revealBaseUrl"
          >
            <el-icon>
              <Hide v-if="revealBaseUrl" />
              <EyeIcon v-else />
            </el-icon>
          </button>
        </button>
      </section>

      <section class="project-links">
        <span class="sidebar-label">依赖项目</span>
        <button
          class="project-link"
          type="button"
          @click="openProject('https://github.com/ZToolsCenter/ZTools')"
        >
          <span class="repo-mark">Z</span>
          <span>ZTools</span>
        </button>
        <button
          class="project-link"
          type="button"
          @click="openProject('https://github.com/OpenListTeam/OpenList')"
        >
          <span class="repo-mark openlist">O</span>
          <span>OpenList</span>
        </button>
      </section>
    </aside>

    <section class="workspace">
      <header class="topbar">
        <el-input
          v-model="searchQuery"
          class="search-input desktop-search-input"
          size="large"
          placeholder="搜索文件或文件夹..."
          clearable
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>

        <div class="top-actions">
          <button class="icon-button" type="button" title="切换主题" @click="toggleTheme">
            <el-icon>
              <Sunny v-if="!isDark" />
              <Moon v-else />
            </el-icon>
          </button>
          <div class="mobile-search-shell" :class="{ open: mobileSearchOpen }" @click.stop>
            <el-input
              ref="mobileSearchInputRef"
              v-model="searchQuery"
              class="mobile-search-inline"
              placeholder="搜索..."
              clearable
              @keydown.esc="mobileSearchOpen = false"
            >
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>
            <button
              class="icon-button mobile-search-button"
              type="button"
              title="搜索"
              @click.stop="openMobileSearch"
            >
              <el-icon><Search /></el-icon>
            </button>
          </div>
          <el-dropdown
            trigger="hover"
            :show-timeout="120"
            :hide-timeout="900"
            placement="bottom-end"
            popper-class="openlist-user-menu"
            @command="handleUserCommand"
          >
            <el-button type="primary" size="large" circle :title="userLabel">
              <el-icon><User /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="login">
                  <el-icon><User /></el-icon>
                  <span>登录</span>
                </el-dropdown-item>
                <el-dropdown-item command="logout" :disabled="!isConnected">
                  <el-icon><SwitchButton /></el-icon>
                  <span>登出</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <section class="content">
        <div class="page-heading">
          <div>
            <h1>我的文件</h1>
            <div class="breadcrumb-line">
              <button class="home-button" type="button" @click="refreshList('/')">
                <el-icon><HomeFilled /></el-icon>
              </button>
              <template v-for="item in breadcrumbs" :key="item.path">
                <span>/</span>
                <button class="crumb-button" type="button" @click="refreshList(item.path)">
                  {{ item.label }}
                </button>
              </template>
            </div>
          </div>

          <div class="primary-actions">
            <el-button-group>
              <el-button :disabled="!isConnected" @click="openMkdirDialog">
                <el-icon><FolderAdd /></el-icon>
                <span>新建文件夹</span>
              </el-button>
              <el-button
                type="primary"
                :loading="uploading"
                :disabled="!isConnected"
                @click="openUploadDialog"
              >
                <el-icon><Upload /></el-icon>
                <span>上传文件</span>
              </el-button>
            </el-button-group>
          </div>
        </div>

        <section class="file-card">
          <div class="file-card-toolbar">
            <div v-if="isConnected" class="batch-actions">
              <el-button
                size="small"
                :disabled="pagedFiles.length === 0"
                @click="toggleSelectAllCurrentPage"
              >
                {{ allCurrentPageSelected ? '取消全选' : '全选' }}
              </el-button>
              <template v-if="isMultiSelecting">
                <span class="selected-count">已选 {{ selectedFileNames.size }} 项</span>
                <el-button-group class="batch-button-group">
                  <el-button
                    size="small"
                    :disabled="fileOperating"
                    @click="openBatchFileActionDialog('copy')"
                  >
                    <el-icon><CopyDocument /></el-icon>
                    <span>复制</span>
                  </el-button>
                  <el-button
                    size="small"
                    :disabled="fileOperating"
                    @click="openBatchFileActionDialog('move')"
                  >
                    <el-icon><Rank /></el-icon>
                    <span>移动</span>
                  </el-button>
                  <el-button
                    size="small"
                    :disabled="downloading"
                    @click="downloadSelectedFiles"
                  >
                    <el-icon><Download /></el-icon>
                    <span>下载</span>
                  </el-button>
                  <el-button
                    type="danger"
                    size="small"
                    :disabled="deleting"
                    @click="removeSelectedFiles"
                  >
                    <el-icon><Delete /></el-icon>
                    <span>删除</span>
                  </el-button>
                </el-button-group>
              </template>
            </div>
            <el-radio-group v-model="viewMode" class="view-switch" aria-label="视图切换">
              <el-radio-button value="list" title="列表视图">
                <el-icon><List /></el-icon>
              </el-radio-button>
              <el-radio-button value="grid" title="图标视图">
                <el-icon><Grid /></el-icon>
              </el-radio-button>
            </el-radio-group>
          </div>

          <el-empty v-if="!isConnected" description="登录 OpenList 后开始浏览文件" />

          <div
            v-if="isConnected && viewMode === 'list'"
            v-loading="loading"
            class="file-list"
          >
            <div class="file-row file-head">
              <button class="sort-label" type="button">名称</button>
              <span>大小</span>
              <span>修改时间</span>
              <span>操作</span>
            </div>

            <button
              v-for="file in pagedFiles"
              :key="`${file.is_dir ? 'dir' : 'file'}-${file.name}`"
              class="file-row"
              :class="{ selected: isFileSelected(file), selecting: isMultiSelecting }"
              type="button"
              @dblclick="handleFileDoubleClick(file)"
              @click="handleFileClick(file)"
              @contextmenu="openContextMenu($event, file)"
            >
              <span class="name-cell">
                <el-checkbox
                  class="selection-check"
                  :model-value="isFileSelected(file)"
                  :aria-label="`选择 ${file.name}`"
                  @click.stop
                  @change="(checked) => setFileSelected(file, Boolean(checked))"
                />
                <span class="type-icon" :class="getFileKind(file)">
                  <el-icon v-if="file.is_dir"><Folder /></el-icon>
                  <span v-else>{{ getFileBadge(file) }}</span>
                </span>
                <span class="file-title">{{ file.name }}</span>
              </span>
              <span>{{ file.is_dir ? '-' : formatSize(file.size) }}</span>
              <span>{{ formatDate(file.modified) }}</span>
              <span v-if="!isMultiSelecting" class="row-actions" @click.stop>
                <button
                  v-if="!file.is_dir"
                  class="row-icon"
                  type="button"
                  title="查看信息"
                  @click="showFileDetail(file)"
                >
                  <el-icon><View /></el-icon>
                </button>
                <button
                  v-if="!file.is_dir"
                  class="row-icon"
                  type="button"
                  title="下载"
                  :disabled="downloading"
                  @click="downloadFile(file)"
                >
                  <el-icon><Download /></el-icon>
                </button>
                <button
                  v-if="file.is_dir"
                  class="row-icon"
                  type="button"
                  title="打开"
                  @click="openFolder(file)"
                >
                  <el-icon><Folder /></el-icon>
                </button>
                <button
                  v-if="file.is_dir"
                  class="row-icon"
                  type="button"
                  title="下载文件夹"
                  :disabled="downloading"
                  @click="downloadFolder(file)"
                >
                  <el-icon><Download /></el-icon>
                </button>
                <button
                  class="row-icon"
                  type="button"
                  title="分享"
                  :disabled="sharing"
                  @click="shareFile(file)"
                >
                  <el-icon><Share /></el-icon>
                </button>
                <button
                  class="row-icon danger"
                  type="button"
                  title="删除"
                  :disabled="deleting"
                  @click="removeFile(file)"
                >
                  <el-icon><Delete /></el-icon>
                </button>
              </span>
            </button>

            <el-empty
              v-if="visibleFiles.length === 0"
              class="grid-empty"
              description="当前目录没有匹配的文件"
            />
          </div>

          <div
            v-if="isConnected && viewMode === 'grid'"
            v-loading="loading"
            class="file-grid"
            :class="{ empty: visibleFiles.length === 0 }"
          >
            <button
              v-for="file in pagedFiles"
              :key="`${file.is_dir ? 'grid-dir' : 'grid-file'}-${file.name}`"
              class="grid-item"
              :class="{ selected: isFileSelected(file), selecting: isMultiSelecting }"
              type="button"
              @dblclick="handleFileDoubleClick(file)"
              @click="handleFileClick(file)"
              @contextmenu="openContextMenu($event, file)"
            >
              <el-checkbox
                class="selection-check grid-selection-check"
                :model-value="isFileSelected(file)"
                :aria-label="`选择 ${file.name}`"
                @click.stop
                @change="(checked) => setFileSelected(file, Boolean(checked))"
              />
              <span class="grid-icon" :class="getFileKind(file)">
                <el-icon v-if="file.is_dir"><Folder /></el-icon>
                <span v-else>{{ getFileBadge(file) }}</span>
              </span>
              <span class="grid-name">{{ file.name }}</span>
              <span class="grid-meta">{{ file.is_dir ? '文件夹' : formatSize(file.size) }}</span>
              <span v-if="!isMultiSelecting" class="grid-actions" @click.stop>
                <button
                  v-if="!file.is_dir"
                  class="row-icon"
                  type="button"
                  title="查看信息"
                  @click="showFileDetail(file)"
                >
                  <el-icon><View /></el-icon>
                </button>
                <button
                  class="row-icon"
                  type="button"
                  :title="file.is_dir ? '下载文件夹' : '下载'"
                  :disabled="downloading"
                  @click="file.is_dir ? downloadFolder(file) : downloadFile(file)"
                >
                  <el-icon><Download /></el-icon>
                </button>
                <button
                  class="row-icon"
                  type="button"
                  title="分享"
                  :disabled="sharing"
                  @click="shareFile(file)"
                >
                  <el-icon><Share /></el-icon>
                </button>
                <button
                  class="row-icon danger"
                  type="button"
                  title="删除"
                  :disabled="deleting"
                  @click="removeFile(file)"
                >
                  <el-icon><Delete /></el-icon>
                </button>
              </span>
            </button>

            <el-empty v-if="visibleFiles.length === 0" description="当前目录没有匹配的文件" />
          </div>

          <footer class="list-footer">
            <span>共 {{ visibleFiles.length }} 项，每页 10 项</span>
            <el-pagination
              v-if="visibleFiles.length > pageSize"
              v-model:current-page="currentPage"
              small
              background
              layout="prev, pager, next"
              :page-size="pageSize"
              :total="visibleFiles.length"
            />
          </footer>
        </section>
      </section>

      <footer class="app-footer">
        <span>安全传输</span>
        <span>|</span>
        <span>由 OpenListUI 提供支持</span>
      </footer>
    </section>

    <div
      v-if="contextMenu.visible && contextMenuFile"
      class="context-menu"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      @click.stop
      @contextmenu.prevent
    >
      <button type="button" @click="openContextDetail()">
        <el-icon><View /></el-icon>
        <span>查看详情</span>
      </button>
      <button type="button" @click="openRenameDialog()">
        <el-icon><Edit /></el-icon>
        <span>重命名</span>
      </button>
      <button type="button" @click="openFileActionDialog('copy')">
        <el-icon><CopyDocument /></el-icon>
        <span>复制</span>
      </button>
      <button type="button" @click="openFileActionDialog('move')">
        <el-icon><Rank /></el-icon>
        <span>移动</span>
      </button>
    </div>

    <el-dialog v-model="loginDialog" title="连接 OpenList" width="520px" :teleported="false">
      <div class="login-form">
        <el-input v-model="baseUrl" placeholder="https://openlist.example.com" clearable />
        <el-input v-model="username" placeholder="用户名" clearable />
        <el-input
          v-model="password"
          placeholder="密码"
          type="password"
          show-password
          @keydown.enter="connect"
        />
        <el-input v-model="token" placeholder="或粘贴 Token" type="password" show-password />
      </div>
      <template #footer>
        <el-button @click="loginDialog = false">取消</el-button>
        <el-button :disabled="!baseUrl || !token" @click="saveToken">保存 Token</el-button>
        <el-button type="primary" :loading="connecting" @click="connect">登录</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="renameDialog" title="重命名" width="420px" :teleported="false">
      <el-input
        v-model="renameName"
        placeholder="请输入新名称"
        clearable
        @keydown.enter="renameFile"
      >
        <template #prefix>
          <el-icon><Edit /></el-icon>
        </template>
      </el-input>
      <template #footer>
        <el-button :disabled="renaming" @click="renameDialog = false">取消</el-button>
        <el-button type="primary" :loading="renaming" @click="renameFile">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="fileActionDialog.visible"
      :title="fileActionTitle"
      width="460px"
      :teleported="false"
    >
      <div class="file-action-form">
        <span class="form-label">目标目录</span>
        <el-input
          v-model="targetDir"
          placeholder="/"
          clearable
          @keydown.enter="browseTargetDir(targetDir, true)"
        >
          <template #prefix>
            <el-icon><Folder /></el-icon>
          </template>
        </el-input>
        <div class="directory-toolbar">
          <el-button size="small" :disabled="normalizeRemoteDir(targetDir) === '/'" @click="goTargetParent">
            上级
          </el-button>
          <el-button size="small" @click="goTargetRoot">根目录</el-button>
          <el-button size="small" @click="goTargetCurrentPath">当前目录</el-button>
          <el-button size="small" :loading="directoryTreeLoading" @click="browseTargetDir(targetDir, true)">
            刷新
          </el-button>
        </div>
        <el-tree
          v-loading="directoryTreeLoading"
          class="directory-tree"
          :data="directoryTreeData"
          :props="directoryTreeProps"
          node-key="path"
          highlight-current
          default-expand-all
          :default-expanded-keys="directoryExpandedKeys"
          :current-node-key="normalizeRemoteDir(targetDir)"
          :expand-on-click-node="false"
          empty-text="没有可选目录"
          @node-click="selectTargetDir"
        >
          <template #default="{ data }">
            <span class="directory-tree-node" :title="data.path">
              <el-icon><Folder /></el-icon>
              <span>{{ data.label }}</span>
            </span>
          </template>
        </el-tree>
      </div>
      <template #footer>
        <el-button :disabled="fileOperating" @click="fileActionDialog.visible = false">
          取消
        </el-button>
        <el-button type="primary" :loading="fileOperating" @click="runFileAction">
          {{ fileActionConfirmText }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="mkdirDialog" title="新建文件夹" width="420px" :teleported="false">
      <el-input
        v-model="newFolderName"
        placeholder="请输入文件夹名称"
        clearable
        @keydown.enter="createFolder"
      >
        <template #prefix>
          <el-icon><FolderAdd /></el-icon>
        </template>
      </el-input>
      <template #footer>
        <el-button @click="mkdirDialog = false">取消</el-button>
        <el-button type="primary" :loading="creatingFolder" @click="createFolder">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="uploadDialog"
      title="上传文件"
      width="560px"
      :close-on-click-modal="!uploading"
      :close-on-press-escape="!uploading"
      :teleported="false"
    >
      <el-upload
        ref="uploadRef"
        class="upload-drop"
        drag
        multiple
        :auto-upload="false"
        :disabled="uploading"
        :on-change="syncUploadQueue"
        :on-remove="removeUploadFile"
      >
        <el-icon class="upload-drop-icon"><Upload /></el-icon>
        <div class="upload-drop-text">拖拽文件到这里，或点击选择文件</div>
        <template #tip>
          <div class="upload-tip">文件会上传到当前目录：{{ currentPath }}</div>
        </template>
      </el-upload>

      <div v-if="uploadQueue.length" class="upload-summary">
        <span>已选择 {{ uploadQueue.length }} 个文件</span>
        <span>{{ uploadTotalSize ? formatSize(uploadTotalSize) : '-' }}</span>
      </div>

      <template #footer>
        <el-button :disabled="uploading" @click="uploadDialog = false">取消</el-button>
        <el-button :disabled="uploading || uploadQueue.length === 0" @click="clearUploadQueue">
          清空
        </el-button>
        <el-button
          type="primary"
          :loading="uploading"
          :disabled="uploadQueue.length === 0"
          @click="uploadFiles"
        >
          开始上传
        </el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="detailDrawer" title="文件信息" size="380px" :teleported="false">
      <section v-loading="detailLoading" class="detail-panel">
        <template v-if="selectedFile">
          <div class="detail-icon" :class="getFileKind(selectedFile)">
            <el-icon v-if="selectedFile.is_dir"><Folder /></el-icon>
            <span v-else>{{ getFileBadge(selectedFile) }}</span>
          </div>
          <h2>{{ selectedFile.name }}</h2>
          <dl>
            <div>
              <dt>路径</dt>
              <dd>{{ selectedFilePath }}</dd>
            </div>
            <div>
              <dt>大小</dt>
              <dd>{{ formatSize(selectedFile.size) }}</dd>
            </div>
            <div>
              <dt>修改时间</dt>
              <dd>{{ formatDate(selectedFile.modified) }}</dd>
            </div>
            <div>
              <dt>类型</dt>
              <dd>{{ selectedFile.type ?? '-' }}</dd>
            </div>
            <div v-if="selectedFile.sign">
              <dt>签名</dt>
              <dd>{{ selectedFile.sign }}</dd>
            </div>
            <div v-if="selectedFile.raw_url">
              <dt>下载地址</dt>
              <dd class="raw-url">{{ selectedFile.raw_url }}</dd>
            </div>
          </dl>

          <div class="detail-actions">
            <el-button type="primary" :loading="downloading" @click="downloadFile(selectedFile)">
              {{ selectedFile.is_dir ? '下载文件夹' : '下载' }}
            </el-button>
          </div>
        </template>
      </section>
    </el-drawer>

    <OperationFeedback
      :confirm-dialog="confirmDialog"
      :transferring="uploading || downloading"
      :transfer-progress="transferProgress"
      :transfer-status="transferStatus"
      :transfer-indeterminate="transferIndeterminate"
      @confirm="resolveConfirm"
    />
  </main>
</template>

<style scoped>
.drive-shell {
  --app-bg: linear-gradient(135deg, #f8fbff 0%, #ffffff 48%, #f5f8ff 100%);
  --panel-bg: rgba(255, 255, 255, 0.78);
  --panel-solid: #ffffff;
  --sidebar-bg: rgba(245, 249, 255, 0.74);
  --card-hover: rgba(247, 250, 255, 0.9);
  --soft-bg: #f3f6fb;
  --line: #e8edf5;
  --strong: #172033;
  --text: #65738b;
  --muted: #7a879d;
  --brand: #3867f6;
  --danger: #dc2626;
  --selection-bg: rgba(56, 103, 246, 0.09);
  --selection-hover-bg: rgba(56, 103, 246, 0.13);
  --selection-border: rgba(56, 103, 246, 0.38);
  display: grid;
  grid-template-columns: clamp(220px, 21vw, 280px) minmax(0, 1fr);
  height: 100vh;
  min-height: 0;
  overflow: hidden;
  background: var(--app-bg);
  color: var(--strong);
}

.drive-shell.dark {
  --app-bg: linear-gradient(135deg, #10131a 0%, #151923 52%, #111827 100%);
  --panel-bg: rgba(25, 30, 42, 0.88);
  --panel-solid: #1b2230;
  --sidebar-bg: rgba(19, 24, 35, 0.92);
  --card-hover: rgba(37, 45, 62, 0.82);
  --soft-bg: #202838;
  --line: #2d3648;
  --strong: #e5e7eb;
  --text: #a8b3c7;
  --muted: #8c98ad;
  --brand: #7ea2ff;
  --danger: #f87171;
  --selection-bg: rgba(126, 162, 255, 0.16);
  --selection-hover-bg: rgba(126, 162, 255, 0.22);
  --selection-border: rgba(126, 162, 255, 0.55);
}

.sidebar {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: clamp(16px, 2.4vw, 24px) 16px;
  border-right: 1px solid var(--line);
  background: var(--sidebar-bg);
  box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.8);
}

.brand {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  color: var(--brand);
  font-size: 17px;
}

.brand div {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.brand strong {
  color: var(--strong);
  font-size: clamp(22px, 2vw, 25px);
  font-weight: 800;
  line-height: 1;
}

.brand span {
  font-size: 15px;
  line-height: 1.35;
}

.brand-logo {
  display: block;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border-radius: 8px;
  object-fit: cover;
  box-shadow: 0 8px 22px rgba(25, 104, 255, 0.22);
}

.brand-description {
  max-width: 200px;
  margin: 0;
  color: var(--text);
  font-size: 13px;
  line-height: 1.6;
}

.sidebar-label {
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}

.connection-card,
.project-links {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.connection-card {
  margin-top: auto;
}

.connection-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px;
  align-items: center;
  width: 100%;
  min-height: 38px;
  padding: 6px 6px 6px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-bg);
  text-align: left;
  cursor: pointer;
}

.connection-row:disabled {
  cursor: default;
}

.connection-text {
  min-width: 0;
  overflow: hidden;
  color: var(--strong);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reveal-button {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
}

.connection-row:hover .reveal-button,
.reveal-button:focus-visible {
  opacity: 1;
}

.reveal-button:hover {
  background: var(--soft-bg);
  color: var(--brand);
}

.project-links {
  padding-top: 2px;
}

.project-link {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  min-height: 36px;
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.42);
  color: var(--strong);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.project-link span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-link:hover {
  border-color: rgba(64, 109, 246, 0.25);
  background: var(--card-hover);
  color: var(--brand);
}

.repo-mark {
  display: inline-grid;
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 6px;
  background: #172033;
  color: #fff;
  font-size: 12px;
  font-weight: 900;
}

.repo-mark.openlist {
  background: #3867f6;
}

.drive-shell.dark .project-link {
  background: rgba(31, 39, 54, 0.68);
}

.workspace {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  min-height: 72px;
  padding: 12px clamp(16px, 2.4vw, 26px);
  border-bottom: 1px solid var(--line);
  background: var(--panel-bg);
}

.search-input {
  width: min(100%, 620px);
}

.mobile-search-inline {
  display: none;
}

.mobile-search-shell {
  display: none;
}

.search-input :deep(.el-input__wrapper) {
  height: 42px;
  border-radius: 8px;
  background: var(--soft-bg);
  box-shadow: none;
}

.top-actions,
.primary-actions,
.row-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.icon-button,
.row-icon,
.home-button,
.crumb-button {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.icon-button {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  color: var(--strong);
  font-size: 19px;
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
}

.mobile-search-button {
  display: none;
}

.content {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  overflow: auto;
  padding: clamp(16px, 2.4vw, 24px) clamp(16px, 2.4vw, 26px) 0;
}

.page-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.page-heading h1 {
  margin: 0 0 16px;
  color: var(--strong);
  font-size: 24px;
  font-weight: 800;
  line-height: 1.15;
}

.breadcrumb-line {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--muted);
  font-size: 13px;
}

.home-button {
  display: inline-flex;
  padding: 0;
  color: var(--muted);
  font-size: 15px;
}

.crumb-button {
  padding: 0;
  color: var(--text);
  font-size: 13px;
}

.primary-actions :deep(.el-button) {
  height: 34px;
  font-weight: 700;
}

.primary-actions :deep(.el-button > span) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.drive-shell.dark .primary-actions :deep(.el-button) {
  --el-button-bg-color: #202838;
  --el-button-border-color: #3a465c;
  --el-button-text-color: #d7def0;
  --el-button-hover-bg-color: #273148;
  --el-button-hover-border-color: #5f78bd;
  --el-button-hover-text-color: #ffffff;
  --el-button-active-bg-color: #2c3852;
  --el-button-active-border-color: var(--brand);
  --el-button-active-text-color: #ffffff;
  --el-button-disabled-bg-color: #1b2230;
  --el-button-disabled-border-color: #2d3648;
  --el-button-disabled-text-color: #667286;
}

.drive-shell.dark .primary-actions :deep(.el-button--primary) {
  --el-button-bg-color: #2f467d;
  --el-button-border-color: #5f78bd;
  --el-button-text-color: #ffffff;
  --el-button-hover-bg-color: #3b5798;
  --el-button-hover-border-color: var(--brand);
  --el-button-hover-text-color: #ffffff;
  --el-button-active-bg-color: #263c72;
  --el-button-active-border-color: var(--brand);
  --el-button-active-text-color: #ffffff;
}

.error-alert {
  margin-bottom: 14px;
  border-radius: 8px;
}

.file-card {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-height: 0;
  min-width: 0;
  height: 100%;
  padding-bottom: 22px;
}

.file-card-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
  margin-bottom: 12px;
}

.batch-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-right: auto;
  min-width: 0;
}

.batch-button-group :deep(.el-button > span),
.view-switch :deep(.el-radio-button__inner) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
}

.view-switch :deep(.el-radio-button__inner) {
  min-width: 42px;
  height: 34px;
  padding: 0 12px;
  font-size: 16px;
}

.selected-count {
  color: var(--muted);
  font-size: 13px;
  font-weight: 700;
}

.drive-shell.dark .selected-count {
  color: #d7def0;
}

.drive-shell.dark .batch-actions :deep(.el-button) {
  --el-button-bg-color: #202838;
  --el-button-border-color: #3a465c;
  --el-button-text-color: #d7def0;
  --el-button-hover-bg-color: #273148;
  --el-button-hover-border-color: #5f78bd;
  --el-button-hover-text-color: #ffffff;
  --el-button-active-bg-color: #2c3852;
  --el-button-active-border-color: var(--brand);
  --el-button-active-text-color: #ffffff;
  --el-button-disabled-bg-color: #1b2230;
  --el-button-disabled-border-color: #2d3648;
  --el-button-disabled-text-color: #667286;
  font-weight: 700;
}

.drive-shell.dark .batch-actions :deep(.el-button--danger) {
  --el-button-bg-color: rgba(248, 113, 113, 0.13);
  --el-button-border-color: rgba(248, 113, 113, 0.45);
  --el-button-text-color: #fca5a5;
  --el-button-hover-bg-color: rgba(248, 113, 113, 0.2);
  --el-button-hover-border-color: #f87171;
  --el-button-hover-text-color: #fee2e2;
  --el-button-active-bg-color: rgba(248, 113, 113, 0.24);
  --el-button-active-border-color: #f87171;
  --el-button-active-text-color: #ffffff;
}

.drive-shell.dark .view-switch :deep(.el-radio-button__inner) {
  border-color: #3a465c;
  background: #202838;
  color: #d7def0;
  font-weight: 700;
}

.drive-shell.dark .view-switch :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) {
  border-color: var(--brand);
  background: #2f467d;
  color: #ffffff;
  box-shadow: -1px 0 0 0 var(--brand);
}

.drive-shell.dark .selection-check :deep(.el-checkbox__inner) {
  border-color: #64748b;
  background: #202838;
}

.drive-shell.dark .selection-check :deep(.el-checkbox__input.is-checked .el-checkbox__inner),
.drive-shell.dark .selection-check :deep(.el-checkbox__input.is-indeterminate .el-checkbox__inner) {
  border-color: var(--brand);
  background: var(--brand);
}

.file-list {
  width: 100%;
  min-height: 0;
  overflow: auto;
}

.file-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(164px, 164px));
  grid-auto-rows: 176px;
  align-content: start;
  align-items: start;
  justify-content: start;
  gap: 12px;
  min-height: 0;
  overflow: auto;
}

.file-grid.empty {
  grid-template-columns: minmax(0, 1fr);
  grid-auto-rows: minmax(320px, 1fr);
  align-content: stretch;
  align-items: center;
  justify-content: stretch;
  justify-items: center;
}

.grid-empty {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
}

.grid-item {
  position: relative;
  display: grid;
  grid-template-rows: 46px 40px 18px 28px;
  gap: 7px;
  align-content: start;
  min-width: 0;
  width: 164px;
  height: 176px;
  overflow: hidden;
  padding: 14px 10px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-bg);
  color: var(--text);
  text-align: center;
  cursor: pointer;
}

.grid-item:hover {
  border-color: rgba(64, 109, 246, 0.28);
  background: var(--card-hover);
}

.grid-item.selected {
  border-color: var(--selection-border);
  background: var(--selection-bg);
}

.grid-item.selected:hover {
  background: var(--selection-hover-bg);
}

.selection-check {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  margin-right: 0;
  opacity: 0;
  transition: opacity 140ms ease;
}

.selection-check :deep(.el-checkbox__label) {
  display: none;
}

.file-row:hover .selection-check,
.file-row.selecting .selection-check,
.file-row.selected .selection-check,
.grid-item:hover .selection-check,
.grid-item.selecting .selection-check,
.grid-item.selected .selection-check {
  opacity: 1;
}

.grid-selection-check {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 1;
}

.grid-icon {
  display: inline-grid;
  width: 44px;
  height: 44px;
  place-items: center;
  justify-self: center;
  border-radius: 8px;
  color: #fff;
  font-size: 11px;
  font-weight: 800;
}

.grid-icon.folder {
  color: #f6b72b;
  font-size: 44px;
}

.grid-name {
  display: -webkit-box;
  min-height: 40px;
  overflow: hidden;
  color: var(--strong);
  font-size: 13px;
  font-weight: 700;
  line-height: 20px;
  text-overflow: ellipsis;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.grid-meta {
  color: var(--muted);
  font-size: 12px;
}

.grid-actions {
  display: flex;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  align-items: center;
  justify-content: center;
  gap: 3px;
}

.grid-actions .row-icon {
  width: 25px;
  height: 25px;
  border-radius: 7px;
  font-size: 15px;
}

.file-row {
  display: grid;
  grid-template-columns:
    minmax(140px, 1fr)
    78px
    132px
    144px;
  align-items: center;
  min-width: 540px;
  width: 100%;
  min-height: 52px;
  padding: 0 10px;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: transparent;
  color: var(--text);
  font-size: 13px;
  text-align: left;
}

button.file-row {
  cursor: pointer;
}

button.file-row:hover {
  background: var(--card-hover);
}

button.file-row.selected {
  background: var(--selection-bg);
}

button.file-row.selected:hover {
  background: var(--selection-hover-bg);
}

.file-head {
  min-height: 38px;
  color: var(--strong);
  font-size: 13px;
  font-weight: 700;
}

.sort-label {
  width: max-content;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
}

.name-cell {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}

.file-title {
  overflow: hidden;
  color: var(--strong);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.type-icon,
.detail-icon {
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  color: #fff;
  font-size: 10px;
  font-weight: 800;
}

.type-icon {
  width: 24px;
  height: 24px;
  border-radius: 4px;
}

.type-icon.folder {
  width: 30px;
  color: #f6b72b;
  font-size: 29px;
}

.type-icon.word,
.detail-icon.word,
.grid-icon.word {
  background: #4078f2;
}

.type-icon.pdf,
.detail-icon.pdf,
.grid-icon.pdf {
  background: #e5454f;
}

.type-icon.excel,
.detail-icon.excel,
.grid-icon.excel {
  background: #25a565;
}

.type-icon.video,
.detail-icon.video,
.grid-icon.video {
  background: #8b54e8;
}

.type-icon.archive,
.detail-icon.archive,
.grid-icon.archive,
.type-icon.file,
.detail-icon.file,
.grid-icon.file {
  background: #4b95f2;
}

.row-actions {
  justify-content: flex-end;
  min-width: 0;
  gap: 4px;
}

.row-icon {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 8px;
  color: var(--muted);
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
}

.row-icon:hover {
  background: var(--soft-bg);
  color: var(--brand);
}

.drive-shell.dark .row-icon {
  color: #b8c3d8;
}

.drive-shell.dark .row-icon:hover {
  background: #273148;
  color: #ffffff;
}

.drive-shell.dark .row-icon.danger:hover {
  color: #fecaca;
}

.row-icon:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.row-icon:disabled:hover {
  background: transparent;
  color: var(--muted);
}

.row-icon.danger:hover {
  color: var(--danger);
}

.list-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 18px 0 0;
  color: var(--text);
  font-size: 13px;
}

.list-footer :deep(.el-pagination) {
  --el-pagination-button-width: 28px;
  --el-pagination-button-height: 28px;
  flex: 0 0 auto;
}

.drive-shell.dark .list-footer :deep(.el-pager li),
.drive-shell.dark .list-footer :deep(.btn-prev),
.drive-shell.dark .list-footer :deep(.btn-next) {
  background: var(--soft-bg);
  color: var(--text);
}

.drive-shell.dark .list-footer :deep(.el-pager li.is-active) {
  background: var(--brand);
  color: #fff;
}

.app-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 22px;
  padding: 14px 26px 18px;
  color: var(--muted);
  font-size: 14px;
}

.login-form {
  display: grid;
  gap: 14px;
}

.context-menu {
  position: fixed;
  z-index: 3000;
  display: grid;
  width: 168px;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-solid);
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.16);
}

.context-menu button {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--strong);
  font-size: 13px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}

.context-menu button:hover {
  background: var(--soft-bg);
  color: var(--brand);
}

.file-action-form {
  display: grid;
  gap: 8px;
}

.directory-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.directory-toolbar :deep(.el-button) {
  margin-left: 0;
  border-radius: 6px;
}

.drive-shell.dark .directory-toolbar :deep(.el-button) {
  --el-button-bg-color: #202838;
  --el-button-border-color: #3a465c;
  --el-button-text-color: #d7def0;
  --el-button-hover-bg-color: #273148;
  --el-button-hover-border-color: #5f78bd;
  --el-button-hover-text-color: #ffffff;
  --el-button-active-bg-color: #2c3852;
  --el-button-active-border-color: var(--brand);
  --el-button-active-text-color: #ffffff;
  --el-button-disabled-bg-color: #1b2230;
  --el-button-disabled-border-color: #2d3648;
  --el-button-disabled-text-color: #667286;
  font-weight: 700;
}

.directory-tree {
  max-height: 260px;
  min-height: 180px;
  overflow: auto;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--soft-bg);
}

.directory-tree :deep(.el-tree-node__content) {
  height: 32px;
  border-radius: 6px;
}

.directory-tree :deep(.el-tree-node__content:hover),
.directory-tree :deep(.el-tree-node.is-current > .el-tree-node__content) {
  background: var(--panel-solid);
  color: var(--brand);
}

.directory-tree-node {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
}

.directory-tree-node span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drive-shell.dark .directory-tree {
  background: #171d29;
}

.drive-shell.dark .directory-tree :deep(.el-tree-node__content:hover),
.drive-shell.dark .directory-tree :deep(.el-tree-node.is-current > .el-tree-node__content) {
  background: #25314a;
  color: #ffffff;
}

.drive-shell.dark .directory-tree :deep(.el-tree-node.is-current > .el-tree-node__content) {
  box-shadow: inset 0 0 0 1px var(--selection-border);
}

.drive-shell.dark .directory-tree-node {
  color: #d7def0;
}

.form-label {
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}

.upload-drop {
  display: block;
}

.upload-drop :deep(.el-upload) {
  width: 100%;
}

.upload-drop :deep(.el-upload-dragger) {
  display: grid;
  place-items: center;
  min-height: 148px;
  padding: 24px 16px;
  border-radius: 8px;
  background: var(--soft-bg);
  border-color: var(--line);
}

.upload-drop :deep(.el-upload-list) {
  max-height: 180px;
  overflow: auto;
}

.upload-drop :deep(.el-upload-list__item) {
  min-width: 0;
}

.upload-drop :deep(.el-upload-list__item-info) {
  min-width: 0;
}

.upload-drop :deep(.el-upload-list__item-name) {
  display: flex;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

.upload-drop :deep(.el-upload-list__item-file-name) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upload-drop-icon {
  margin-bottom: 8px;
  color: var(--brand);
  font-size: 32px;
}

.upload-drop-text {
  color: var(--strong);
  font-size: 14px;
  font-weight: 700;
}

.upload-tip {
  margin-top: 10px;
  overflow: hidden;
  color: var(--muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upload-summary {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--text);
  font-size: 13px;
}

.upload-summary span {
  min-width: 0;
}

.upload-summary span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upload-summary span:last-child {
  flex: 0 0 auto;
}

.drive-shell.dark :deep(.el-input__wrapper),
.drive-shell.dark :deep(.el-dialog),
.drive-shell.dark :deep(.el-drawer),
.drive-shell.dark :deep(.el-upload-dragger) {
  background: #1b2230;
}

.drive-shell.dark :deep(.el-input__inner),
.drive-shell.dark :deep(.el-dialog__title),
.drive-shell.dark :deep(.el-drawer__title),
.drive-shell.dark :deep(.el-message-box__title),
.drive-shell.dark :deep(.el-message-box__content) {
  color: var(--strong);
}

.drive-shell.dark :deep(.el-dialog),
.drive-shell.dark :deep(.el-drawer),
.drive-shell.dark :deep(.el-message-box) {
  border: 1px solid var(--line);
  background: #1b2230;
}

.drive-shell.dark :deep(.el-dialog__body),
.drive-shell.dark :deep(.el-drawer__body),
.drive-shell.dark :deep(.el-upload-list__item-name),
.drive-shell.dark :deep(.el-upload__tip) {
  color: var(--text);
}

.drive-shell.dark :deep(.el-upload-list__item:hover) {
  background: var(--soft-bg);
}

.detail-panel {
  color: var(--strong);
}

.detail-icon {
  width: 58px;
  height: 58px;
  margin-bottom: 16px;
  border-radius: 10px;
  font-size: 13px;
}

.detail-icon.folder {
  color: #f6b72b;
  font-size: 54px;
}

.detail-panel h2 {
  margin: 0 0 18px;
  overflow-wrap: anywhere;
  font-size: 20px;
  line-height: 1.35;
}

.detail-panel dl {
  display: grid;
  gap: 12px;
  margin: 0;
}

.detail-panel dl > div {
  display: grid;
  gap: 4px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}

.detail-panel dt {
  color: var(--muted);
  font-size: 12px;
}

.detail-panel dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--strong);
  font-size: 14px;
  line-height: 1.45;
}

.raw-url {
  max-height: 120px;
  overflow: auto;
}

.detail-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 18px;
}

@media (max-width: 980px) {
  .drive-shell {
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-columns: 1fr;
  }

  .sidebar {
    display: grid;
    grid-template-columns: auto minmax(180px, 1fr);
    align-items: center;
    gap: 10px 14px;
    max-height: 148px;
    padding: 12px 16px;
    border-right: 0;
    border-bottom: 1px solid rgba(222, 229, 241, 0.9);
  }

  .brand-description {
    display: none;
  }

  .brand {
    align-items: center;
  }

  .brand strong {
    font-size: 21px;
  }

  .brand span {
    font-size: 13px;
  }

  .connection-card {
    justify-self: stretch;
    margin-top: 0;
  }

  .connection-card .sidebar-label {
    display: none;
  }

  .project-links {
    display: none;
  }

  .project-links .sidebar-label {
    display: none;
  }

  .project-link {
    min-height: 32px;
    padding: 5px 8px;
  }

  .topbar {
    min-height: auto;
    align-items: center;
    justify-content: space-between;
    flex-direction: row;
    flex-wrap: nowrap;
    gap: 10px;
  }

  .desktop-search-input {
    display: none;
  }

  .top-actions {
    order: 1;
    min-width: 0;
    width: 100%;
    justify-content: space-between;
    flex-wrap: nowrap;
  }

  .top-actions .icon-button:first-child {
    flex: 0 0 auto;
    margin-right: auto;
  }

  .mobile-search-shell {
    position: relative;
    display: block;
    flex: 0 0 auto;
    width: 36px;
    height: 36px;
    min-width: 0;
    overflow: hidden;
    transition: width 260ms cubic-bezier(0.22, 1, 0.36, 1);
    will-change: width;
  }

  .mobile-search-shell.open {
    width: clamp(128px, calc(100vw - 230px), 248px);
  }

  .mobile-search-button {
    position: absolute;
    inset: 0;
    display: grid;
    opacity: 1;
    transition: opacity 140ms ease, transform 180ms ease;
  }

  .mobile-search-shell.open .mobile-search-button {
    pointer-events: none;
    opacity: 0;
    transform: scale(0.92);
  }

  .mobile-search-inline {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    opacity: 0;
    transform: translateX(10px);
    pointer-events: none;
    transition: opacity 180ms ease 70ms, transform 220ms cubic-bezier(0.22, 1, 0.36, 1) 60ms;
  }

  .mobile-search-shell.open .mobile-search-inline {
    opacity: 1;
    transform: translateX(0);
    pointer-events: auto;
  }

  .mobile-search-inline :deep(.el-input__wrapper) {
    height: 36px;
    border-radius: 8px;
    background: var(--soft-bg);
    box-shadow: none;
  }

  .file-row {
    grid-template-columns: minmax(140px, 1fr) 78px 132px 144px;
  }

  .file-grid {
    grid-template-columns: repeat(auto-fill, minmax(164px, 164px));
  }
}

@media (max-width: 640px) {
  .sidebar {
    grid-template-columns: 1fr;
    max-height: 198px;
  }

  .brand-description {
    display: none;
  }

  .connection-card,
  .project-links {
    grid-column: auto;
    width: 100%;
  }

  .page-heading {
    gap: 18px;
  }

  .primary-actions {
    width: 100%;
    align-items: stretch;
    flex-direction: column;
  }

  .primary-actions :deep(.el-button-group) {
    display: flex;
    width: 100%;
  }

  .primary-actions :deep(.el-button) {
    width: 100%;
    margin-left: 0;
  }

  .file-grid {
    grid-template-columns: repeat(auto-fill, minmax(164px, 164px));
  }

  .list-footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .app-footer {
    justify-content: center;
    padding-inline: 20px;
  }
}
</style>

<style>
.el-message.openlist-message {
  z-index: 5000 !important;
  max-width: min(420px, calc(100vw - 32px));
  border-radius: 8px;
  box-shadow: 0 18px 46px rgba(15, 23, 42, 0.14);
}

.el-message.openlist-message .el-message__content {
  overflow-wrap: anywhere;
}

html.openlist-theme-dark .el-message.openlist-message {
  --el-message-bg-color: #1b2230;
  --el-message-border-color: #2d3648;
  --el-message-text-color: #e5e7eb;
  background: var(--el-message-bg-color);
  border-color: var(--el-message-border-color);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.36);
  color: var(--el-message-text-color);
}

html.openlist-theme-dark .el-message.openlist-message .el-message__content,
html.openlist-theme-dark .el-message.openlist-message .el-message__icon {
  color: var(--el-message-text-color);
}

html.openlist-theme-dark .el-message.openlist-message.el-message--success {
  --el-message-bg-color: #13261f;
  --el-message-border-color: #1f7a50;
  --el-message-text-color: #bbf7d0;
}

html.openlist-theme-dark .el-message.openlist-message.el-message--warning {
  --el-message-bg-color: #2a2112;
  --el-message-border-color: #b7791f;
  --el-message-text-color: #fde68a;
}

html.openlist-theme-dark .el-message.openlist-message.el-message--error {
  --el-message-bg-color: #2b171b;
  --el-message-border-color: #b91c1c;
  --el-message-text-color: #fecaca;
}

html.openlist-theme-dark .openlist-user-menu {
  --el-bg-color-overlay: #1b2230;
  --el-border-color-light: #2d3648;
  --el-text-color-regular: #d7def0;
  --el-dropdown-menuItem-hover-fill: #25314a;
  --el-dropdown-menuItem-hover-color: #ffffff;
  border-color: #2d3648 !important;
  background: #1b2230 !important;
}

html.openlist-theme-dark .openlist-user-menu .el-dropdown-menu {
  background: #1b2230;
}

html.openlist-theme-dark .openlist-user-menu .el-dropdown-menu__item {
  color: #d7def0;
  font-weight: 700;
}

.openlist-user-menu .el-dropdown-menu__item {
  gap: 8px;
}

html.openlist-theme-dark .openlist-user-menu .el-dropdown-menu__item:not(.is-disabled):focus,
html.openlist-theme-dark .openlist-user-menu .el-dropdown-menu__item:not(.is-disabled):hover {
  background: #25314a;
  color: #ffffff;
}

html.openlist-theme-dark .openlist-user-menu .el-dropdown-menu__item.is-disabled {
  color: #667286;
}

html.openlist-theme-dark .openlist-user-menu .el-popper__arrow::before {
  border-color: #2d3648 !important;
  background: #1b2230 !important;
}
</style>

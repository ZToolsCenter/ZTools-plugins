import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { DEFAULT_SERVER_PORT, WS_PORT_OFFSET } from '../utils/constants'
import { normalizeLanIPs } from '../utils/network'
import { useToast } from '../composables/useToast'

export const useFileShareStore = defineStore('fileShare', () => {
  // ========== State ==========
  const serverRunning = ref(false)
  const serverPort = ref(DEFAULT_SERVER_PORT)
  const lanIP = ref('')
  const lanIPs = ref<string[]>([])
  const selectedIP = ref('')
  const accessUrl = ref('')

  const sharedFiles = ref<FileNode[]>([])
  const fileTree = ref<FileNode[]>([])

  const matchKeyword = ref('')
  const matchResults = ref<FileNode[]>([])

  const loading = ref(false)
  const scanning = ref(false)

  const uploadDir = ref('')
  const uploadNotification = ref<{ name: string; size: number; path: string; count: number } | null>(null)

  const { showError, showSuccess, show: showToast } = useToast()

  let ws: WebSocket | null = null

  // ========== Computed ==========
  const fileCount = computed(() => {
    let count = 0
    function countFiles(files: FileNode[]) {
      for (const file of files) {
        if (file.type === 'file') count++
        if (file.children && file.children.length > 0) countFiles(file.children)
      }
    }
    countFiles(sharedFiles.value)
    return count
  })

  const serverStatus = computed(() => {
    return serverRunning.value ? '运行中' : '未启动'
  })

  const currentAccessUrl = computed(() => {
    if (!selectedIP.value || !serverPort.value) return ''
    return `http://${selectedIP.value}:${serverPort.value}`
  })

  // ========== Internal Helpers ==========

  /** 将服务器返回的 lanIP 信息更新到 store 状态 */
  function applyLanIPs(rawLanIP: string | string[]) {
    const { ips, primaryIP } = normalizeLanIPs(rawLanIP)
    lanIPs.value = ips
    lanIP.value = primaryIP
  }

  /** 如果服务器正在运行，重启以应用变更 */
  async function restartServerIfRunning() {
    if (serverRunning.value) {
      await startServer()
    }
  }

  /** 构造文件夹根节点 */
  function createFolderRootNode(folderPath: string, children: FileNode[]): FileNode {
    const folderName = folderPath.split(/[/\\]/).filter(Boolean).pop() || folderPath
    return {
      id: folderPath,
      name: folderName,
      path: folderPath,
      fullPath: folderPath,
      type: 'folder',
      size: 0,
      children,
      mtime: Date.now()
    }
  }

  /** 递归扫描子节点的子文件夹 */
  async function scanChildrenRecursive(node: FileNode) {
    if (!node.children || node.children.length === 0) return
    for (const child of node.children) {
      if (child.type === 'folder') {
        try {
          const children = await window.services.scanDirectory(child.fullPath || child.path)
          child.children = children
          await scanChildrenRecursive(child)
        } catch (err) {
          console.error('Failed to scan directory:', child.path, err)
        }
      }
    }
  }

  // ========== Actions ==========

  async function startServer() {
    try {
      loading.value = true

      const status = await window.services.startServer(
        serverPort.value,
        sharedFiles.value.map(f => f.fullPath || f.path)
      )

      serverRunning.value = status.running
      serverPort.value = status.port
      applyLanIPs(status.lanIP)

      if (!selectedIP.value || !lanIPs.value.includes(selectedIP.value)) {
        selectedIP.value = lanIPs.value[0] || ''
      }

      accessUrl.value = status.accessUrl
      connectWebSocket()
      return status
    } catch (err: any) {
      showError(err.message || '服务器启动失败')
      throw err
    } finally {
      loading.value = false
    }
  }

  async function stopServer() {
    try {
      await window.services.stopServer()
      serverRunning.value = false
      lanIP.value = ''
      accessUrl.value = ''
      disconnectWebSocket()
    } catch (err: any) {
      showError(err.message || '服务器停止失败')
      throw err
    }
  }

  /** 统一的路径选择方法 */
  async function selectPaths(type: 'file' | 'folder') {
    try {
      const isFolder = type === 'folder'
      const result = window.ztools.showOpenDialog({
        title: isFolder ? '选择要分享的文件夹' : '选择要分享的文件',
        properties: [isFolder ? 'openDirectory' : 'openFile', 'multiSelections']
      })

      if (result && result.length > 0) {
        for (const filePath of result) {
          await addFile(filePath)
        }
        await restartServerIfRunning()
      }
    } catch (err: any) {
      showError(err.message || (type === 'folder' ? '文件夹选择失败' : '文件选择失败'))
      throw err
    }
  }

  async function selectFiles() {
    return selectPaths('file')
  }

  async function selectFolder() {
    return selectPaths('folder')
  }

  async function addFile(filePath: string) {
    if (!filePath) {
      showError('文件路径不能为空')
      return
    }

    try {
      const existingIndex = sharedFiles.value.findIndex(f => f.fullPath === filePath || f.path === filePath)
      if (existingIndex > -1) {
        showToast('该文件已在列表中', 'info')
        return
      }

      const nodes = await window.services.scanDirectory(filePath)
      const isFile = nodes.length === 1 && nodes[0].type === 'file' && nodes[0].fullPath === filePath

      if (!isFile && nodes.length > 0) {
        const rootNode = createFolderRootNode(filePath, nodes)
        await scanChildrenRecursive(rootNode)
        sharedFiles.value.push(rootNode)
      } else {
        if (nodes.length === 1) {
          sharedFiles.value.push(nodes[0])
        } else {
          sharedFiles.value.push(...nodes)
        }
      }

      fileTree.value = [...sharedFiles.value]
    } catch (err: any) {
      showError(err.message || '文件添加失败')
      throw err
    }
  }

  async function scanFiles() {
    try {
      scanning.value = true

      const newTree: FileNode[] = []

      for (const file of sharedFiles.value) {
        if (file.type === 'folder') {
          try {
            const nodes = await window.services.scanDirectory(file.fullPath || file.path)
            const rootNode = createFolderRootNode(file.fullPath || file.path, nodes)
            rootNode.path = file.path
            rootNode.fullPath = file.fullPath
            await scanChildrenRecursive(rootNode)
            newTree.push(rootNode)
          } catch (err) {
            console.warn(`文件夹 ${file.fullPath || file.path} 已被移除或无法访问`)
          }
        } else {
          try {
            const nodes = await window.services.scanDirectory(file.fullPath || file.path)
            if (nodes.length > 0) {
              newTree.push(...nodes)
            }
          } catch (err) {
            console.warn(`文件 ${file.fullPath || file.path} 已被移除或无法访问`)
          }
        }
      }

      sharedFiles.value = newTree
      fileTree.value = [...newTree]
    } catch (err: any) {
      showError(err.message || '文件扫描失败')
      throw err
    } finally {
      scanning.value = false
    }
  }

  async function matchFiles(keyword: string) {
    try {
      matchKeyword.value = keyword

      if (!keyword.trim()) {
        matchResults.value = []
        return
      }

      loading.value = true
      matchResults.value = await window.services.matchFiles(keyword)
    } catch (err: any) {
      showError(err.message || '文件匹配失败')
      throw err
    } finally {
      loading.value = false
    }
  }

  function selectIP(ip: string) {
    if (lanIPs.value.includes(ip)) {
      selectedIP.value = ip
      window.services.setSelectedIP(ip)
      if (serverPort.value) {
        accessUrl.value = `http://${ip}:${serverPort.value}`
      }
    }
  }

  async function copyUrl(url: string) {
    try {
      window.ztools.copyText(url)
      showSuccess('复制成功')
    } catch (err: any) {
      showError(err.message || '复制失败')
      throw err
    }
  }

  async function clearFiles() {
    sharedFiles.value = []
    fileTree.value = []
    matchResults.value = []
    matchKeyword.value = ''
    await restartServerIfRunning()
  }

  async function removeFile(fileId: string) {
    // 先查找顶层
    const index = sharedFiles.value.findIndex(f => f.id === fileId)
    if (index !== -1) {
      sharedFiles.value.splice(index, 1)
      fileTree.value = [...sharedFiles.value]
      await restartServerIfRunning()
      return
    }

    // 递归查找嵌套节点
    function removeFromChildren(nodes: FileNode[]): boolean {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].id === fileId) {
          nodes.splice(i, 1)
          return true
        }
        if (nodes[i].children && removeFromChildren(nodes[i].children!)) {
          return true
        }
      }
      return false
    }

    if (removeFromChildren(sharedFiles.value)) {
      fileTree.value = [...sharedFiles.value]
      await restartServerIfRunning()
      return
    }

    showError('未找到要删除的文件')
  }

  async function loadChildren(node: FileNode) {
    if (node.type === 'folder' && !node.children) {
      try {
        const children = await window.services.scanDirectory(node.fullPath || node.path)
        node.children = children
      } catch (err: any) {
        showError(err.message || '子目录加载失败')
        throw err
      }
    }
    return node.children || []
  }

  function getFileDownloadUrl(file: FileNode): string {
    if (!currentAccessUrl.value) return ''
    return `${currentAccessUrl.value}/download/${file.path}`
  }

  function connectWebSocket() {
    if (ws) return

    const wsUrl = `ws://${lanIP.value}:${serverPort.value + WS_PORT_OFFSET}`
    ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      console.log('WebSocket connected')
    }

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)

        switch (message.type) {
          case 'server:status':
            serverRunning.value = message.data.running
            serverPort.value = message.data.port
            applyLanIPs(message.data.lanIP)
            accessUrl.value = message.data.accessUrl
            break
          case 'match:result':
            matchResults.value = message.data
            break
          case 'file:uploaded':
            showUploadNotification(message.data)
            break
        }
      } catch (err) {
        console.error('WebSocket message error:', err)
      }
    }

    ws.onerror = (err) => {
      console.error('WebSocket error:', err)
    }

    ws.onclose = () => {
      console.log('WebSocket disconnected')
      ws = null
    }
  }

  function disconnectWebSocket() {
    if (ws) {
      ws.close()
      ws = null
    }
  }

  async function refreshServerStatus() {
    try {
      const status = await window.services.getServerStatus()
      if (status) {
        serverRunning.value = status.running
        serverPort.value = status.port
        applyLanIPs(status.lanIP)

        if (!selectedIP.value && lanIPs.value.length > 0) {
          selectedIP.value = lanIPs.value[0]
        }

        accessUrl.value = status.accessUrl
      }
    } catch (err: any) {
      console.error('Failed to refresh server status:', err)
    }
  }

  async function init() {
    try {
      loadUploadDir()

      const ip = await window.services.getLanIP()
      const { ips, primaryIP } = normalizeLanIPs(ip)
      lanIPs.value = ips
      lanIP.value = primaryIP

      // 恢复上次选择的 IP，若不在列表中则清除记录并用排序后的首选
      const savedIP = window.services.getSelectedIP()
      if (savedIP && ips.includes(savedIP)) {
        selectedIP.value = savedIP
      } else {
        if (savedIP) {
          window.services.removeSelectedIP()
        }
        selectedIP.value = primaryIP
      }

      const status = await window.services.getServerStatus()
      if (status) {
        serverRunning.value = status.running
        serverPort.value = status.port
        accessUrl.value = status.accessUrl
        connectWebSocket()
      }
    } catch (err: any) {
      console.error('Failed to initialize:', err)
    }
  }

  function showUploadNotification(data: { name: string; size: number; path: string }) {
    if (uploadNotification.value) {
      uploadNotification.value = {
        ...data,
        count: uploadNotification.value.count + 1
      }
    } else {
      uploadNotification.value = { ...data, count: 1 }
    }
  }

  function dismissUploadNotification() {
    uploadNotification.value = null
  }

  function loadUploadDir() {
    try {
      uploadDir.value = window.services.getUploadDir()
    } catch (err) {
      console.error('Failed to load upload dir:', err)
    }
  }

  async function changeUploadDir() {
    try {
      const result = window.ztools.showOpenDialog({
        title: '选择上传保存目录',
        properties: ['openDirectory']
      })
      if (result && result.length > 0) {
        const dir = window.services.setUploadDir(result[0])
        uploadDir.value = dir
        showSuccess('上传目录已更新')
      }
    } catch (err: any) {
      showError(err.message || '目录选择失败')
    }
  }

  function openUploadDir() {
    try {
      window.services.openUploadDir()
    } catch (err: any) {
      showError(err.message || '打开目录失败')
    }
  }

  function cleanup() {
    disconnectWebSocket()
  }

  return {
    // State
    serverRunning,
    serverPort,
    lanIP,
    lanIPs,
    selectedIP,
    accessUrl,
    sharedFiles,
    fileTree,
    matchKeyword,
    matchResults,
    loading,
    scanning,
    uploadDir,
    uploadNotification,

    // Computed
    fileCount,
    serverStatus,
    currentAccessUrl,

    // Actions
    startServer,
    stopServer,
    selectFiles,
    selectFolder,
    addFile,
    scanFiles,
    matchFiles,
    copyUrl,
    selectIP,
    clearFiles,
    removeFile,
    loadChildren,
    getFileDownloadUrl,
    refreshServerStatus,
    init,
    cleanup,
    changeUploadDir,
    openUploadDir,
    dismissUploadNotification
  }
})

const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { Client: SshClient } = require('ssh2')
const { Client: FtpClient, FileType, FileInfo } = require('basic-ftp')
const iconv = require('iconv-lite')

let electronClipboard = null
try {
  electronClipboard = require('electron')?.clipboard || null
} catch {
  electronClipboard = null
}

const PROFILE_KEY = 'termdock.profiles.v1'
const FOLDERS_KEY = 'termdock.folders.v1'
const COMMAND_FOLDERS_KEY = 'termdock.commandFolders.v1'
const COMMAND_TEMPLATES_KEY = 'termdock.commandTemplates.v1'
const UI_PREFERENCES_KEY = 'termdock.uiPreferences.v1'
const FALLBACK_DATA_FILE = path.join(__dirname, 'termdock-data.json')
const TRANSCRIPT_LIMIT = 200000
const TRANSFER_CANCELED_CODE = 'TERMDOCK_TRANSFER_CANCELED'

function createBackend(options = {}) {
  return new TermdockBackend(options)
}

class TermdockBackend {
  constructor(options) {
    this.ztools = options.ztools
    this.events = new EventEmitter()
    this.profiles = this.readProfiles()
    this.folders = this.readArray(FOLDERS_KEY, [])
    this.commandFolders = this.readArray(COMMAND_FOLDERS_KEY, [])
    this.commandTemplates = this.readArray(COMMAND_TEMPLATES_KEY, [])
    this.uiPreferences = this.readValue(UI_PREFERENCES_KEY, { theme: 'system', locale: 'zhCN' })
    this.tabs = []
    this.activeTabId = null
    this.sessions = new Map()
    this.metricsPollers = new Map()
    this.metricsInFlight = new Set()
    this.transfers = []
    this.transferAborters = new Map()
  }

  on(eventName, listener) {
    this.events.on(eventName, listener)
    return () => this.events.off(eventName, listener)
  }

  emit(eventName, payload) {
    this.events.emit(eventName, payload)
  }

  async shutdown() {
    for (const tabId of this.metricsPollers.keys()) {
      this.stopMetricsPolling(tabId)
    }
    const sessions = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.allSettled(sessions.map((session) => session.disconnect()))
  }

  getProfiles() {
    return this.profiles
  }

  getUiPreferences() {
    return normalizeUiPreferences(this.uiPreferences)
  }

  setUiPreferences(input = {}) {
    this.uiPreferences = normalizeUiPreferences({ ...this.uiPreferences, ...input })
    this.writeValue(UI_PREFERENCES_KEY, this.uiPreferences)
    return this.uiPreferences
  }

  async saveProfile(input) {
    const profile = normalizeProfile(input)
    const index = this.profiles.findIndex((item) => item.id === profile.id)
    if (index >= 0) {
      this.profiles[index] = profile
    } else {
      this.profiles.unshift(profile)
    }
    this.writeProfiles()
    this.emitSnapshot()
    return profile
  }

  async createProfile(input) {
    await this.saveProfile(input)
    return this.getSnapshot()
  }

  async updateProfile(profileId, input) {
    await this.saveProfile({ ...input, id: profileId })
    return this.getSnapshot()
  }

  async deleteProfile(profileId) {
    this.profiles = this.profiles.filter((profile) => profile.id !== profileId)
    this.writeProfiles()
    this.emitSnapshot()
    return this.getSnapshot()
  }

  async createFolder(name, parentId) {
    this.folders.unshift({
      id: crypto.randomUUID(),
      type: 'folder',
      name: String(name || '').trim() || 'Folder',
      parentId,
      order: Date.now(),
      isExpanded: true
    })
    this.writeValue(FOLDERS_KEY, this.folders)
    this.emitSnapshot()
    return this.getSnapshot()
  }

  async updateFolder(folderId, updates = {}) {
    this.folders = this.folders.map((folder) => folder.id === folderId ? { ...folder, ...updates } : folder)
    this.writeValue(FOLDERS_KEY, this.folders)
    this.emitSnapshot()
    return this.getSnapshot()
  }

  async deleteFolder(folderId) {
    this.folders = this.folders.filter((folder) => folder.id !== folderId)
    this.profiles = this.profiles.map((profile) => profile.parentId === folderId ? { ...profile, parentId: undefined } : profile)
    this.writeValue(FOLDERS_KEY, this.folders)
    this.writeProfiles()
    this.emitSnapshot()
    return this.getSnapshot()
  }

  async updateEntityOrder(id, newParentId, newOrder) {
    this.profiles = this.profiles.map((profile) => profile.id === id ? { ...profile, parentId: newParentId, order: newOrder } : profile)
    this.folders = this.folders.map((folder) => folder.id === id ? { ...folder, parentId: newParentId, order: newOrder } : folder)
    this.writeProfiles()
    this.writeValue(FOLDERS_KEY, this.folders)
    this.emitSnapshot()
    return this.getSnapshot()
  }

  async createCommandFolder(name, parentId) {
    this.commandFolders.unshift({
      id: crypto.randomUUID(),
      type: 'command-folder',
      name: String(name || '').trim() || 'Folder',
      parentId,
      order: Date.now()
    })
    this.writeValue(COMMAND_FOLDERS_KEY, this.commandFolders)
    this.emitSnapshot()
    return this.getSnapshot()
  }

  async updateCommandFolder(folderId, updates = {}) {
    this.commandFolders = this.commandFolders.map((folder) => folder.id === folderId ? { ...folder, ...updates } : folder)
    this.writeValue(COMMAND_FOLDERS_KEY, this.commandFolders)
    this.emitSnapshot()
    return this.getSnapshot()
  }

  async deleteCommandFolder(folderId) {
    this.commandFolders = this.commandFolders.filter((folder) => folder.id !== folderId)
    this.commandTemplates = this.commandTemplates.map((command) => command.parentId === folderId ? { ...command, parentId: undefined } : command)
    this.writeValue(COMMAND_FOLDERS_KEY, this.commandFolders)
    this.writeValue(COMMAND_TEMPLATES_KEY, this.commandTemplates)
    this.emitSnapshot()
    return this.getSnapshot()
  }

  async updateCommandOrder(id, newParentId, newOrder) {
    this.commandFolders = this.commandFolders.map((folder) => folder.id === id ? { ...folder, parentId: newParentId, order: newOrder } : folder)
    this.commandTemplates = this.commandTemplates.map((command) => command.id === id ? { ...command, parentId: newParentId, order: newOrder } : command)
    this.writeValue(COMMAND_FOLDERS_KEY, this.commandFolders)
    this.writeValue(COMMAND_TEMPLATES_KEY, this.commandTemplates)
    this.emitSnapshot()
    return this.getSnapshot()
  }

  async createCommandTemplate(input) {
    this.commandTemplates.unshift(normalizeCommandTemplate({ ...input, id: crypto.randomUUID() }))
    this.writeValue(COMMAND_TEMPLATES_KEY, this.commandTemplates)
    this.emitSnapshot()
    return this.getSnapshot()
  }

  async updateCommandTemplate(commandId, input) {
    this.commandTemplates = this.commandTemplates.map((command) => (
      command.id === commandId ? normalizeCommandTemplate({ ...input, id: commandId }) : command
    ))
    this.writeValue(COMMAND_TEMPLATES_KEY, this.commandTemplates)
    this.emitSnapshot()
    return this.getSnapshot()
  }

  async deleteCommandTemplate(commandId) {
    this.commandTemplates = this.commandTemplates.filter((command) => command.id !== commandId)
    this.writeValue(COMMAND_TEMPLATES_KEY, this.commandTemplates)
    this.emitSnapshot()
    return this.getSnapshot()
  }

  async executeCommandTemplate(tabId, commandId, args = [], options = {}) {
    const command = this.commandTemplates.find((item) => item.id === commandId)
    if (!command) {
      throw new Error(`Command not found: ${commandId}`)
    }
    const renderedCommand = command.command.replace(/\[p#(\d+)\]/g, (_, rawIndex) => args[Number(rawIndex) - 1] ?? '')
    const appendCarriageReturn = options.appendCarriageReturn ?? command.appendCarriageReturn
    await this.writeTerminal(tabId, appendCarriageReturn ? `${renderedCommand}\r` : renderedCommand)
    return { renderedCommand }
  }

  async openProfile(profileId, options = {}) {
    const profile = this.profiles.find((item) => item.id === profileId)
    if (!profile) {
      throw new Error(`连接配置不存在: ${profileId}`)
    }
    const remotePath = String(options.remotePath || profile.remotePath || (profile.type === 'ftp' ? '/' : '.')).trim()
    const sessionProfile = {
      ...profile,
      remotePath
    }

    const tab = {
      id: crypto.randomUUID(),
      profileId: profile.id,
      title: profile.name || `${profile.host}:${profile.port}`,
      sessionType: profile.type,
      status: 'connecting',
      remotePath: sessionProfile.remotePath,
      remoteFiles: [],
      summary: '连接中...',
      transcript: ''
    }
    this.tabs.push(tab)
    this.activeTabId = tab.id
    this.emitSnapshot()

    const session = profile.type === 'ftp'
      ? new FtpSession(tab, sessionProfile, this)
      : new SshSession(tab, sessionProfile, this)
    this.sessions.set(tab.id, session)
    void this.connectSessionInBackground(tab.id, session, '连接主机')

    return this.getSnapshot()
  }

  async reconnectTab(tabId) {
    const tab = this.requireTab(tabId)
    const profile = this.profiles.find((item) => item.id === tab.profileId)
    if (!profile) {
      throw new Error(`连接配置不存在: ${tab.profileId}`)
    }

    await this.sessions.get(tabId)?.disconnect()
    this.sessions.delete(tabId)
    tab.status = 'connecting'
    tab.summary = '重新连接中...'
    tab.remoteFiles = []
    this.emitSnapshot()

    const session = profile.type === 'ftp'
      ? new FtpSession(tab, profile, this)
      : new SshSession(tab, profile, this, tab.transcript)
    this.sessions.set(tabId, session)
    this.activeTabId = tab.id
    this.emitSnapshot()
    void this.connectSessionInBackground(tab.id, session, '重新连接主机')
    return this.getSnapshot()
  }

  async disconnectTab(tabId) {
    const tab = this.requireTab(tabId)
    this.stopMetricsPolling(tabId)
    await this.sessions.get(tabId)?.disconnect()
    this.sessions.delete(tabId)
    tab.status = 'closed'
    tab.summary = '已断开'
    tab.remoteFiles = []
    this.emit('terminal:state', {
      tabId,
      summary: tab.summary,
      connected: false,
      transcript: tab.transcript || ''
    })
    this.emitSnapshot()
    return this.getSnapshot()
  }

  async closeTab(tabId) {
    this.stopMetricsPolling(tabId)
    await this.sessions.get(tabId)?.disconnect()
    this.sessions.delete(tabId)
    this.tabs = this.tabs.filter((tab) => tab.id !== tabId)
    if (this.activeTabId === tabId) {
      this.activeTabId = this.tabs[0]?.id ?? null
    }
    this.emitSnapshot()
    return this.getSnapshot()
  }

  async activateTab(tabId) {
    if (this.tabs.some((tab) => tab.id === tabId)) {
      this.activeTabId = tabId
    }
    this.emitSnapshot()
    return this.getSnapshot()
  }

  async openProfileFromManager(profileId, options = {}) {
    return this.openProfile(profileId, options)
  }

  getSnapshot() {
    const tabs = this.tabs.map((tab) => ({ ...tab, remoteFiles: [...(tab.remoteFiles || [])] }))
    return {
      profiles: this.profiles.map((profile) => ({ ...profile })),
      folders: this.folders.map((folder) => ({ ...folder })),
      commandFolders: this.commandFolders.map((folder) => ({ ...folder })),
      commandTemplates: this.commandTemplates.map((command) => ({ ...command })),
      tabs: tabs.map(toWorkspaceTab),
      activeTabId: this.activeTabId,
      transfers: this.transfers.map((transfer) => ({ ...transfer })),
      sessions: Object.fromEntries(tabs.map((tab) => [tab.id, toSessionSnapshot(tab)]))
    }
  }

  emitSnapshot() {
    this.emit('snapshot', this.getSnapshot())
  }

  async connectSessionInBackground(tabId, session, summaryScope) {
    const tab = this.tabs.find((item) => item.id === tabId)
    if (!tab || this.sessions.get(tabId) !== session) {
      return
    }

    try {
      await session.connect()
      if (this.sessions.get(tabId) !== session || !this.tabs.some((item) => item.id === tabId)) {
        return
      }
      this.markSessionConnected(tabId, session)
      tab.remoteFiles = await session.listRemoteFiles()
      if (session.refreshSystemMetrics && this.sessions.get(tabId) === session) {
        tab.systemMetrics = await session.refreshSystemMetrics()
        this.startMetricsPolling(tab.id, session)
      }
      this.emitSnapshot()
    } catch (error) {
      if (this.sessions.get(tabId) !== session || !this.tabs.some((item) => item.id === tabId)) {
        return
      }
      tab.status = 'error'
      tab.summary = errorMessage(error)
      this.emit('terminal:state', {
        tabId,
        summary: tab.summary,
        connected: false,
        transcript: tab.transcript || ''
      })
      this.emitSnapshot()
      console.error(`[TermDock] ${summaryScope}失败`, error)
    }
  }

  markSessionConnected(tabId, session, options = {}) {
    const tab = this.tabs.find((item) => item.id === tabId)
    if (!tab || this.sessions.get(tabId) !== session) {
      return false
    }

    tab.status = 'connected'
    tab.summary = session.getSummary()
    tab.remotePath = session.getRemotePath()
    if (options.transcript !== undefined) {
      tab.transcript = options.transcript
    }
    if (tab.sessionType === 'ssh') {
      this.emit('terminal:state', {
        tabId,
        summary: tab.summary,
        connected: true,
        transcript: tab.transcript || ''
      })
    }
    this.emitSnapshot()
    return true
  }

  startMetricsPolling(tabId, session) {
    this.stopMetricsPolling(tabId)
    const timer = setInterval(() => {
      void this.refreshMetricsForTab(tabId, session)
    }, 2000)
    this.metricsPollers.set(tabId, timer)
  }

  stopMetricsPolling(tabId) {
    const timer = this.metricsPollers.get(tabId)
    if (timer) {
      clearInterval(timer)
      this.metricsPollers.delete(tabId)
    }
    this.metricsInFlight.delete(tabId)
  }

  async refreshMetricsForTab(tabId, session) {
    if (this.metricsInFlight.has(tabId)) {
      return
    }
    const tab = this.tabs.find((item) => item.id === tabId)
    if (!tab || tab.status !== 'connected' || this.sessions.get(tabId) !== session || !session.refreshSystemMetrics) {
      this.stopMetricsPolling(tabId)
      return
    }

    this.metricsInFlight.add(tabId)
    try {
      const previous = tab.systemMetrics
      const next = await session.refreshSystemMetrics(previous)
      if (next) {
        tab.systemMetrics = mergeNetworkHistory(previous, next)
        this.emitSnapshot()
      }
    } catch {
      // Keep the last metrics snapshot. The next poll can recover.
    } finally {
      this.metricsInFlight.delete(tabId)
    }
  }

  async writeTerminal(tabId, data) {
    const session = this.sessions.get(tabId)
    if (session?.writeTerminal) {
      await session.writeTerminal(data)
    }
  }

  async resizeTerminal(tabId, cols, rows, width, height) {
    const session = this.sessions.get(tabId)
    if (session?.resizeTerminal) {
      await session.resizeTerminal(cols, rows, width, height)
    }
  }

  async openRemotePath(tabId, targetPath) {
    const tab = this.requireTab(tabId)
    const session = this.requireSession(tabId)
    tab.remoteFiles = await session.openRemotePath(targetPath)
    tab.remotePath = session.getRemotePath()
    this.emitSnapshot()
    return this.getSnapshot()
  }

  async readRemoteFile(tabId, targetPath, encoding = 'utf-8') {
    return this.requireSession(tabId).readRemoteFile(targetPath, encoding)
  }

  async writeRemoteFile(tabId, targetPath, content, encoding = 'utf-8') {
    await this.requireSession(tabId).writeRemoteFile(targetPath, content, encoding)
    await this.refreshRemoteFiles(tabId)
    return this.getSnapshot()
  }

  async createRemoteDirectory(tabId, parentPath, name) {
    const session = this.requireSession(tabId)
    await session.ensureRemoteDirectory(posixJoin(parentPath, name))
    await this.refreshRemoteFiles(tabId)
    return this.getSnapshot()
  }

  async createRemoteFile(tabId, parentPath, name) {
    const session = this.requireSession(tabId)
    await session.writeRemoteFile(posixJoin(parentPath, name), '')
    await this.refreshRemoteFiles(tabId)
    return this.getSnapshot()
  }

  async renameRemotePath(tabId, targetPath, newName) {
    const session = this.requireSession(tabId)
    await session.renameRemotePath(targetPath, posixJoin(path.posix.dirname(targetPath), newName))
    await this.refreshRemoteFiles(tabId)
    return this.getSnapshot()
  }

  async deleteRemotePath(tabId, targetPath, targetType) {
    const session = this.requireSession(tabId)
    await session.deleteRemotePath(targetPath, targetType)
    await this.refreshRemoteFiles(tabId)
    return this.getSnapshot()
  }

  async changeRemotePermissions(tabId, targetPath, mode) {
    const session = this.requireSession(tabId)
    const resolvedMode = typeof mode === 'string' ? mode : mode?.mode
    await session.changeRemotePermissions(targetPath, resolvedMode)
    await this.refreshRemoteFiles(tabId)
    return this.getSnapshot()
  }

  async copyRemotePath(tabId, targetPath, destinationPath, targetType) {
    const session = this.requireSession(tabId)
    await session.copyRemotePath(targetPath, destinationPath, targetType)
    await this.refreshRemoteFiles(tabId)
    return this.getSnapshot()
  }

  async moveRemotePath(tabId, targetPath, destinationPath) {
    const session = this.requireSession(tabId)
    await session.renameRemotePath(targetPath, destinationPath)
    await this.refreshRemoteFiles(tabId)
    return this.getSnapshot()
  }

  async setRemoteFileAccessMode() {
    return this.getSnapshot()
  }

  async uploadFile(tabId, localPath, remoteDirectory, options = {}) {
    const session = this.requireSession(tabId)
    const transfer = this.addTransfer('upload', path.basename(localPath))
    const targetName = options.targetName || path.basename(localPath)
    const abortController = new AbortController()
    this.transferAborters.set(transfer.id, () => {
      abortController.abort()
      return session.abortTransfer?.()
    })
    try {
      await session.uploadFile(localPath, posixJoin(remoteDirectory, targetName), (progress) => {
        if (abortController.signal.aborted || this.getTransfer(transfer.id)?.status === 'canceled') {
          return
        }
        this.updateTransfer(transfer.id, {
          status: 'running',
          progress: progress.percent,
          message: progress.message
        })
      }, abortController.signal)
      if (abortController.signal.aborted || this.getTransfer(transfer.id)?.status === 'canceled') {
        this.updateTransfer(transfer.id, { status: 'canceled', message: '传输已终止' })
        return this.getSnapshot()
      }
      this.updateTransfer(transfer.id, { status: 'done', progress: 100, message: '' })
      await this.refreshRemoteFiles(tabId)
    } catch (error) {
      if (abortController.signal.aborted || isTransferCanceledError(error)) {
        this.updateTransfer(transfer.id, { status: 'canceled', message: '传输已终止' })
        return this.getSnapshot()
      }
      this.updateTransfer(transfer.id, { status: 'failed', message: errorMessage(error) })
      throw error
    } finally {
      this.transferAborters.delete(transfer.id)
    }
    return this.getSnapshot()
  }

  async downloadFile(tabId, remotePath, localDirectory, options = {}) {
    const session = this.requireSession(tabId)
    const transfer = this.addTransfer('download', path.posix.basename(remotePath))
    const localPath = path.join(localDirectory, options.targetName || path.posix.basename(remotePath))
    const abortController = new AbortController()
    this.transferAborters.set(transfer.id, () => {
      abortController.abort()
      return session.abortTransfer?.()
    })
    try {
      await session.downloadFile(remotePath, localPath, (progress) => {
        if (abortController.signal.aborted || this.getTransfer(transfer.id)?.status === 'canceled') {
          return
        }
        this.updateTransfer(transfer.id, {
          status: 'running',
          progress: progress.percent,
          message: progress.message
        })
      }, abortController.signal)
      if (abortController.signal.aborted || this.getTransfer(transfer.id)?.status === 'canceled') {
        this.updateTransfer(transfer.id, { status: 'canceled', message: '传输已终止' })
        return this.getSnapshot()
      }
      this.updateTransfer(transfer.id, { status: 'done', progress: 100, message: localPath })
    } catch (error) {
      if (abortController.signal.aborted || isTransferCanceledError(error)) {
        this.updateTransfer(transfer.id, { status: 'canceled', message: '传输已终止' })
        return this.getSnapshot()
      }
      this.updateTransfer(transfer.id, { status: 'failed', message: errorMessage(error) })
      throw error
    } finally {
      this.transferAborters.delete(transfer.id)
    }
    return this.getSnapshot()
  }

  async downloadRemotePath(tabId, remotePath, targetType, localDirectory, options = {}) {
    if (targetType === 'file') {
      return this.downloadFile(tabId, remotePath, localDirectory, options)
    }
    throw new Error('ZTools 版当前暂不支持递归下载远程目录')
  }

  async queueUpload(fileNames) {
    for (const name of fileNames || []) {
      this.addTransfer('upload', name)
    }
    return this.getSnapshot()
  }

  async cancelTransfer(transferId) {
    const abortTransfer = this.transferAborters.get(transferId)
    this.updateTransfer(transferId, { status: 'canceled', message: '传输已终止' })
    try {
      await abortTransfer?.()
    } catch {}
    return this.getSnapshot()
  }

  async clearTransfers(transferIds) {
    const removable = new Set(transferIds || [])
    this.transfers = this.transfers.filter((transfer) => !removable.has(transfer.id))
    this.emitSnapshot()
    return this.getSnapshot()
  }

  addTransfer(direction, name) {
    const transfer = {
      id: crypto.randomUUID(),
      direction,
      name,
      progress: 0,
      status: 'queued',
      message: ''
    }
    this.transfers.unshift(transfer)
    this.emit('transfer', transfer)
    this.emitSnapshot()
    return transfer
  }

  updateTransfer(id, patch) {
    const transfer = this.transfers.find((item) => item.id === id)
    if (!transfer) {
      return
    }
    if (transfer.status === 'canceled' && (patch.status === 'running' || patch.status === 'done')) {
      return
    }
    Object.assign(transfer, patch)
    this.emit('transfer', transfer)
    this.emitSnapshot()
  }

  getTransfer(id) {
    return this.transfers.find((item) => item.id === id) || null
  }

  async refreshRemoteFiles(tabId) {
    const tab = this.requireTab(tabId)
    const session = this.requireSession(tabId)
    tab.remoteFiles = await session.listRemoteFiles()
    tab.remotePath = session.getRemotePath()
    this.emitSnapshot()
  }

  selectLocalFiles() {
    if (this.ztools?.showOpenDialog) {
      return this.ztools.showOpenDialog({
        properties: ['openFile', 'multiSelections']
      }) || []
    }
    return []
  }

  selectLocalDirectory() {
    if (this.ztools?.showOpenDialog) {
      const result = this.ztools.showOpenDialog({
        properties: ['openDirectory']
      }) || []
      return result[0] || null
    }
    return null
  }

  async readClipboardText() {
    const ztoolsText = await maybeCall(this.ztools?.clipboard?.readText)
    if (typeof ztoolsText === 'string') {
      return ztoolsText
    }
    const electronText = electronClipboard?.readText?.()
    if (typeof electronText === 'string') {
      return electronText
    }
    return ''
  }

  async writeClipboardText(text) {
    const value = String(text || '')
    if (this.ztools?.copyText) {
      this.ztools.copyText(value)
      return
    }
    if (electronClipboard?.writeText) {
      electronClipboard.writeText(value)
      return
    }
    if (this.ztools?.clipboard?.writeContent) {
      await this.ztools.clipboard.writeContent({ type: 'text', content: value }, false)
    }
  }

  async listLocalDirectory(dirPath = os.homedir()) {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true })
    const items = await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(dirPath, entry.name)
      const info = await fsp.stat(fullPath)
      return {
        path: fullPath,
        name: entry.name,
        type: entry.isDirectory() ? 'folder' : 'file',
        modified: formatLocalDate(info.mtime),
        size: entry.isDirectory() ? '-' : formatBytes(info.size),
        permission: formatPermissionBits(info.mode, entry.isDirectory()),
        ownerGroup: `${info.uid ?? ''}/${info.gid ?? ''}`
      }
    }))
    items.sort(sortFoldersFirst)
    return { path: dirPath, items }
  }

  async readLocalFile(filePath, encoding = 'utf-8') {
    return iconv.decode(await fsp.readFile(filePath), encoding)
  }

  async writeLocalFile(filePath, content, encoding = 'utf-8') {
    await fsp.writeFile(filePath, iconv.encode(String(content), encoding))
  }

  async createLocalDirectory(dirPath, name) {
    await fsp.mkdir(path.join(dirPath, name), { recursive: true })
  }

  async createLocalFile(dirPath, name) {
    await fsp.writeFile(path.join(dirPath, name), '', 'utf8')
  }

  async copyLocalPath(sourcePath, destinationPath) {
    await fsp.cp(sourcePath, destinationPath, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true })
  }

  async moveLocalPath(sourcePath, destinationPath) {
    try {
      await fsp.rename(sourcePath, destinationPath)
    } catch (error) {
      if (error?.code !== 'EXDEV') {
        throw error
      }
      await this.copyLocalPath(sourcePath, destinationPath)
      await fsp.rm(sourcePath, { recursive: true, force: true })
    }
  }

  async renameLocalPath(targetPath, newName) {
    await fsp.rename(targetPath, path.join(path.dirname(targetPath), newName))
  }

  async deleteLocalPath(targetPath) {
    await fsp.rm(targetPath, { recursive: true, force: true })
  }

  async changeLocalPermissions(targetPath, options) {
    const mode = Number.parseInt(String(options?.mode || options).trim(), 8)
    await fsp.chmod(targetPath, mode)
  }

  getDroppedFilePaths(files) {
    return Array.from(files || []).map((file) => file.path || '').filter(Boolean)
  }

  async resolveSshInteraction() {
    return undefined
  }

  async openConnectionManagerWindow() {}
  async openCommandManagerWindow() {}
  async openConnectionFormWindow() {}
  async openCommandFormWindow() {}
  async openFileEditorWindow() {}
  async closeCurrentWindow() {}

  requireTab(tabId) {
    const tab = this.tabs.find((item) => item.id === tabId)
    if (!tab) {
      throw new Error(`标签页不存在: ${tabId}`)
    }
    return tab
  }

  requireSession(tabId) {
    const session = this.sessions.get(tabId)
    if (!session) {
      throw new Error(`会话不存在或已断开: ${tabId}`)
    }
    return session
  }

  readProfiles() {
    const fromZTools = this.ztools?.dbStorage?.getItem?.(PROFILE_KEY)
    if (Array.isArray(fromZTools)) {
      return fromZTools.map(normalizeProfile)
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(FALLBACK_DATA_FILE, 'utf8'))
      return Array.isArray(parsed.profiles) ? parsed.profiles.map(normalizeProfile) : []
    } catch {
      return []
    }
  }

  writeProfiles() {
    if (this.ztools?.dbStorage?.setItem) {
      this.ztools.dbStorage.setItem(PROFILE_KEY, this.profiles)
      return
    }
    try {
      fs.writeFileSync(FALLBACK_DATA_FILE, JSON.stringify({ profiles: this.profiles }, null, 2), 'utf8')
    } catch {
      // Best-effort fallback storage.
    }
  }

  readArray(key, fallback) {
    const value = this.readValue(key, fallback)
    return Array.isArray(value) ? value : fallback
  }

  readValue(key, fallback) {
    const value = this.ztools?.dbStorage?.getItem?.(key)
    if (value !== undefined && value !== null) {
      return value
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(FALLBACK_DATA_FILE, 'utf8'))
      return parsed[key] ?? fallback
    } catch {
      return fallback
    }
  }

  writeValue(key, value) {
    if (this.ztools?.dbStorage?.setItem) {
      this.ztools.dbStorage.setItem(key, value)
      return
    }
    let parsed = {}
    try {
      parsed = JSON.parse(fs.readFileSync(FALLBACK_DATA_FILE, 'utf8'))
    } catch {}
    parsed[key] = value
    try {
      fs.writeFileSync(FALLBACK_DATA_FILE, JSON.stringify(parsed, null, 2), 'utf8')
    } catch {}
  }
}

class SshSession {
  constructor(tab, profile, backend, initialTranscript = '') {
    this.tab = tab
    this.profile = profile
    this.backend = backend
    this.ssh = new SshClient()
    this.shellStream = null
    this.sftp = null
    this.currentRemotePath = profile.remotePath || '.'
    this.transcript = initialTranscript || ''
    this.pendingResize = null
    this.appendSystemMessage('连接主机...\r\n')
  }

  async connect() {
    const auth = await resolveSshAuth(this.profile)
    const username = this.profile.username || os.userInfo().username

    await new Promise((resolve, reject) => {
      let settled = false
      this.ssh
        .on('ready', () => {
          this.appendSystemMessage('连接主机成功\r\n')
          this.backend.markSessionConnected(this.tab.id, this, { transcript: this.transcript })
          this.ssh.shell({
            term: 'xterm-256color',
            rows: this.pendingResize?.rows || 32,
            cols: this.pendingResize?.cols || 120
          }, (error, stream) => {
            if (error) {
              if (!settled) {
                settled = true
                reject(error)
              }
              return
            }

            this.shellStream = stream
            stream.on('data', (chunk) => {
              const text = chunk.toString('utf8')
              this.transcript = trimTranscript(this.transcript + text)
              this.tab.transcript = this.transcript
              this.backend.emit('terminal:data', { tabId: this.tab.id, chunk: text })
            })
            stream.on('close', () => {
              this.tab.status = 'closed'
              this.tab.summary = 'Shell closed'
              this.backend.emit('terminal:state', {
                tabId: this.tab.id,
                summary: this.tab.summary,
                connected: false,
                transcript: this.transcript
              })
              this.backend.emitSnapshot()
            })
            this.openSftp().then(() => {
              if (!settled) {
                settled = true
                resolve()
              }
            }).catch((sftpError) => {
              if (!settled) {
                settled = true
                reject(sftpError)
              }
            })
          })
        })
        .on('error', (error) => {
          if (!settled) {
            settled = true
            reject(error)
          }
        })
        .on('close', () => {
          this.tab.status = this.tab.status === 'error' ? 'error' : 'closed'
          this.backend.emitSnapshot()
        })
        .connect({
          host: this.profile.host,
          port: Number(this.profile.port) || 22,
          username,
          ...auth,
          readyTimeout: 15000,
          keepaliveInterval: 5000,
          keepaliveCountMax: 2,
          tryKeyboard: Boolean(this.profile.password),
          hostVerifier: (key, verify) => {
            const fingerprint = computeFingerprint(key)
            if (!this.profile.trustedHostFingerprint) {
              this.profile.trustedHostFingerprint = fingerprint
              this.backend.saveProfile(this.profile).catch(() => undefined)
              verify(true)
              return
            }
            verify(this.profile.trustedHostFingerprint === fingerprint)
          }
        })
    })

    this.backend.markSessionConnected(this.tab.id, this, { transcript: this.transcript })
  }

  appendSystemMessage(message) {
    this.transcript = trimTranscript(this.transcript + message)
    this.tab.transcript = this.transcript
    this.backend.emit('terminal:data', { tabId: this.tab.id, chunk: message })
  }

  async openSftp() {
    if (this.sftp) {
      return this.sftp
    }
    this.sftp = await new Promise((resolve, reject) => {
      this.ssh.sftp((error, sftp) => {
        if (error) {
          reject(error)
          return
        }
        resolve(sftp)
      })
    })
    return this.sftp
  }

  async disconnect() {
    await this.abortTransfer()
    try {
      this.shellStream?.end()
    } catch {}
    try {
      this.ssh.end()
    } catch {}
  }

  async abortTransfer() {
    const sftp = this.sftp
    this.sftp = null
    try {
      sftp?.end?.()
    } catch {}
    try {
      sftp?.destroy?.()
    } catch {}
  }

  getSummary() {
    return `Connected to ${this.profile.host}:${this.profile.port || 22}`
  }

  getRemotePath() {
    return this.currentRemotePath
  }

  async writeTerminal(data) {
    this.shellStream?.write(String(data))
  }

  async resizeTerminal(cols, rows, width, height) {
    this.pendingResize = { cols, rows, width, height }
    if (this.shellStream?.setWindow) {
      this.shellStream.setWindow(rows, cols, Math.floor(height || 0), Math.floor(width || 0))
    }
  }

  async listRemoteFiles() {
    const sftp = await this.openSftp()
    const entries = await readdirSftp(sftp, this.currentRemotePath)
    return formatRemoteRows(this.currentRemotePath, entries)
  }

  async openRemotePath(targetPath) {
    this.currentRemotePath = targetPath || '.'
    return this.listRemoteFiles()
  }

  async readRemoteFile(targetPath, encoding = 'utf-8') {
    const sftp = await this.openSftp()
    const buffer = await readSftpFile(sftp, targetPath)
    return iconv.decode(buffer, encoding)
  }

  async writeRemoteFile(targetPath, content, encoding = 'utf-8') {
    const sftp = await this.openSftp()
    await this.ensureRemoteDirectory(path.posix.dirname(targetPath))
    await writeSftpFile(sftp, targetPath, iconv.encode(String(content), encoding))
  }

  async ensureRemoteDirectory(targetPath) {
    if (!targetPath || targetPath === '.') {
      return
    }
    const sftp = await this.openSftp()
    const segments = targetPath.split('/').filter(Boolean)
    let current = targetPath.startsWith('/') ? '/' : ''
    for (const segment of segments) {
      current = current === '/' ? `/${segment}` : (current ? `${current}/${segment}` : segment)
      try {
        await statSftp(sftp, current)
      } catch {
        await mkdirSftp(sftp, current)
      }
    }
  }

  async renameRemotePath(targetPath, nextPath) {
    const sftp = await this.openSftp()
    await new Promise((resolve, reject) => {
      sftp.rename(targetPath, nextPath, (error) => error ? reject(error) : resolve())
    })
  }

  async copyRemotePath(targetPath, destinationPath, targetType) {
    if (targetType === 'folder') {
      await this.copyRemoteDirectory(targetPath, destinationPath)
      return
    }
    const content = await this.readRemoteFile(targetPath)
    await this.writeRemoteFile(destinationPath, content)
  }

  async copyRemoteDirectory(sourcePath, destinationPath) {
    const sftp = await this.openSftp()
    await this.ensureRemoteDirectory(destinationPath)
    const entries = await readdirSftp(sftp, sourcePath)
    for (const entry of entries) {
      const sourceChild = path.posix.join(sourcePath, entry.filename)
      const destinationChild = path.posix.join(destinationPath, entry.filename)
      if (entry.longname?.startsWith('d')) {
        await this.copyRemoteDirectory(sourceChild, destinationChild)
      } else {
        const buffer = await readSftpFile(sftp, sourceChild)
        await writeSftpFile(sftp, destinationChild, buffer)
      }
    }
  }

  async deleteRemotePath(targetPath, targetType) {
    const sftp = await this.openSftp()
    if (targetType === 'folder') {
      await rmdirSftpRecursive(sftp, targetPath)
      return
    }
    await new Promise((resolve, reject) => {
      sftp.unlink(targetPath, (error) => error ? reject(error) : resolve())
    })
  }

  async changeRemotePermissions(targetPath, mode) {
    if (!/^[0-7]{3,4}$/.test(String(mode || '').trim())) {
      throw new Error('权限值必须是 3 到 4 位八进制数字，例如 755')
    }
    const sftp = await this.openSftp()
    await new Promise((resolve, reject) => {
      sftp.chmod(targetPath, Number.parseInt(String(mode).trim(), 8), (error) => error ? reject(error) : resolve())
    })
  }

  async uploadFile(localPath, remotePath, onProgress, signal) {
    const sftp = await this.openSftp()
    const info = await fsp.stat(localPath)
    await this.ensureRemoteDirectory(path.posix.dirname(remotePath))
    throwIfTransferCanceled(signal)
    await new Promise((resolve, reject) => {
      let transferred = 0
      let settled = false
      const read = fs.createReadStream(localPath)
      const write = sftp.createWriteStream(remotePath)
      const finish = (callback, value) => {
        if (settled) {
          return
        }
        settled = true
        signal?.removeEventListener?.('abort', onAbort)
        callback(value)
      }
      const onAbort = () => {
        const error = createTransferCanceledError()
        read.destroy(error)
        write.destroy(error)
        finish(reject, error)
      }
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener?.('abort', onAbort, { once: true })
      read.on('data', (chunk) => {
        if (signal?.aborted) {
          return
        }
        transferred += chunk.length
        onProgress({
          percent: Math.min(99, Math.round((transferred / Math.max(info.size, 1)) * 100)),
          message: remotePath
        })
      })
      read.on('error', (error) => finish(reject, normalizeTransferStreamError(error, signal)))
      write.on('error', (error) => finish(reject, normalizeTransferStreamError(error, signal)))
      write.on('close', () => {
        if (signal?.aborted) {
          finish(reject, createTransferCanceledError())
          return
        }
        onProgress({ percent: 100, message: remotePath })
        finish(resolve)
      })
      read.pipe(write)
    })
  }

  async downloadFile(remotePath, localPath, onProgress, signal) {
    const sftp = await this.openSftp()
    await fsp.mkdir(path.dirname(localPath), { recursive: true })
    let total = 1
    try {
      const info = await statSftp(sftp, remotePath)
      total = Math.max(info.size || 1, 1)
    } catch {}
    throwIfTransferCanceled(signal)
    await new Promise((resolve, reject) => {
      let transferred = 0
      let settled = false
      const read = sftp.createReadStream(remotePath)
      const write = fs.createWriteStream(localPath)
      const finish = (callback, value) => {
        if (settled) {
          return
        }
        settled = true
        signal?.removeEventListener?.('abort', onAbort)
        callback(value)
      }
      const onAbort = () => {
        const error = createTransferCanceledError()
        read.destroy(error)
        write.destroy(error)
        finish(reject, error)
      }
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener?.('abort', onAbort, { once: true })
      read.on('data', (chunk) => {
        if (signal?.aborted) {
          return
        }
        transferred += chunk.length
        onProgress({
          percent: Math.min(99, Math.round((transferred / total) * 100)),
          message: localPath
        })
      })
      read.on('error', (error) => finish(reject, normalizeTransferStreamError(error, signal)))
      write.on('error', (error) => finish(reject, normalizeTransferStreamError(error, signal)))
      write.on('close', () => {
        if (signal?.aborted) {
          finish(reject, createTransferCanceledError())
          return
        }
        onProgress({ percent: 100, message: localPath })
        finish(resolve)
      })
      read.pipe(write)
    })
  }

  async execCommand(command) {
    return new Promise((resolve, reject) => {
      this.ssh.exec(command, (error, stream) => {
        if (error) {
          reject(error)
          return
        }
        const stdout = []
        const stderr = []
        stream.on('data', (chunk) => stdout.push(Buffer.from(chunk)))
        stream.stderr?.on('data', (chunk) => stderr.push(Buffer.from(chunk)))
        stream.on('close', () => {
          const output = Buffer.concat(stdout).toString('utf8')
          if (output.trim()) {
            resolve(output)
            return
          }
          const errText = Buffer.concat(stderr).toString('utf8')
          resolve(errText)
        })
        stream.on('error', reject)
      })
    })
  }

  async refreshSystemMetrics(previousMetrics) {
    try {
      const raw = await this.execCommand(buildMetricsCommand())
      return parseMetricsOutput(raw, previousMetrics)
    } catch {
      return previousMetrics
    }
  }
}

class FtpSession {
  constructor(tab, profile) {
    this.tab = tab
    this.profile = profile
    this.ftp = new FtpClient(20000)
    this.currentRemotePath = profile.remotePath || '/'
  }

  async connect() {
    await this.ftp.access({
      host: this.profile.host,
      port: Number(this.profile.port) || 21,
      user: this.profile.username,
      password: this.profile.password,
      secure: Boolean(this.profile.secure)
    })
    try {
      await this.ftp.cd(this.currentRemotePath)
      this.currentRemotePath = await this.ftp.pwd()
    } catch {
      this.currentRemotePath = '/'
    }
  }

  async disconnect() {
    this.ftp.close()
  }

  async abortTransfer() {
    this.ftp.close()
    this.ftp = new FtpClient(20000)
  }

  getSummary() {
    return `Connected to ${this.profile.host}:${this.profile.port || 21}`
  }

  getRemotePath() {
    return this.currentRemotePath
  }

  async listRemoteFiles() {
    const entries = await this.ftp.list(this.currentRemotePath)
    return formatFtpRows(this.currentRemotePath, entries)
  }

  async openRemotePath(targetPath) {
    await this.ftp.cd(targetPath)
    this.currentRemotePath = await this.ftp.pwd()
    return this.listRemoteFiles()
  }

  async readRemoteFile(targetPath, encoding = 'utf-8') {
    const localPath = tempFilePath(targetPath)
    try {
      await this.ftp.downloadTo(localPath, targetPath)
      return iconv.decode(await fsp.readFile(localPath), encoding)
    } finally {
      fsp.unlink(localPath).catch(() => undefined)
    }
  }

  async writeRemoteFile(targetPath, content, encoding = 'utf-8') {
    const localPath = tempFilePath(targetPath)
    try {
      await fsp.writeFile(localPath, iconv.encode(String(content), encoding))
      await this.ensureRemoteDirectory(path.posix.dirname(targetPath))
      await this.ftp.uploadFrom(localPath, targetPath)
    } finally {
      fsp.unlink(localPath).catch(() => undefined)
    }
  }

  async ensureRemoteDirectory(targetPath) {
    if (!targetPath || targetPath === '.') {
      return
    }
    const previous = await this.ftp.pwd()
    try {
      await this.ftp.ensureDir(targetPath)
    } finally {
      await this.ftp.cd(previous)
    }
  }

  async renameRemotePath(targetPath, nextPath) {
    await this.ftp.rename(targetPath, nextPath)
  }

  async copyRemotePath(targetPath, destinationPath, targetType) {
    if (targetType === 'folder') {
      throw new Error('FTP 暂不支持服务器内复制文件夹')
    }
    const content = await this.readRemoteFile(targetPath)
    await this.writeRemoteFile(destinationPath, content)
  }

  async deleteRemotePath(targetPath, targetType) {
    if (targetType === 'folder') {
      await this.ftp.removeDir(targetPath)
      return
    }
    await this.ftp.remove(targetPath)
  }

  async changeRemotePermissions(targetPath, mode) {
    if (!/^[0-7]{3,4}$/.test(String(mode || '').trim())) {
      throw new Error('权限值必须是 3 到 4 位八进制数字，例如 755')
    }
    await this.ftp.send(`SITE CHMOD ${String(mode).trim()} ${targetPath}`)
  }

  async uploadFile(localPath, remotePath, onProgress, signal) {
    const info = await fsp.stat(localPath)
    const total = Math.max(info.size, 1)
    throwIfTransferCanceled(signal)
    this.ftp.trackProgress((progress) => {
      if (signal?.aborted) {
        return
      }
      onProgress({
        percent: Math.min(99, Math.round((progress.bytes / total) * 100)),
        message: remotePath
      })
    })
    const onAbort = () => {
      try {
        this.ftp.close()
      } catch {}
    }
    try {
      signal?.addEventListener?.('abort', onAbort, { once: true })
      await this.ensureRemoteDirectory(path.posix.dirname(remotePath))
      throwIfTransferCanceled(signal)
      await this.ftp.uploadFrom(localPath, remotePath)
      throwIfTransferCanceled(signal)
      onProgress({ percent: 100, message: remotePath })
    } catch (error) {
      if (signal?.aborted) {
        throw createTransferCanceledError()
      }
      throw error
    } finally {
      signal?.removeEventListener?.('abort', onAbort)
      this.ftp.trackProgress()
    }
  }

  async downloadFile(remotePath, localPath, onProgress, signal) {
    const total = Math.max(await this.ftp.size(remotePath), 1)
    throwIfTransferCanceled(signal)
    this.ftp.trackProgress((progress) => {
      if (signal?.aborted) {
        return
      }
      onProgress({
        percent: Math.min(99, Math.round((progress.bytes / total) * 100)),
        message: localPath
      })
    })
    const onAbort = () => {
      try {
        this.ftp.close()
      } catch {}
    }
    try {
      signal?.addEventListener?.('abort', onAbort, { once: true })
      await fsp.mkdir(path.dirname(localPath), { recursive: true })
      throwIfTransferCanceled(signal)
      await this.ftp.downloadTo(localPath, remotePath)
      throwIfTransferCanceled(signal)
      onProgress({ percent: 100, message: localPath })
    } catch (error) {
      if (signal?.aborted) {
        throw createTransferCanceledError()
      }
      throw error
    } finally {
      signal?.removeEventListener?.('abort', onAbort)
      this.ftp.trackProgress()
    }
  }
}

function normalizeProfile(input) {
  const type = input?.type === 'ftp' ? 'ftp' : 'ssh'
  const profile = {
    id: input?.id || crypto.randomUUID(),
    type,
    name: String(input?.name || input?.host || '未命名连接').trim(),
    host: String(input?.host || '').trim(),
    port: Number(input?.port) || (type === 'ftp' ? 21 : 22),
    group: String(input?.group || '默认'),
    parentId: input?.parentId,
    order: input?.order,
    username: String(input?.username || '').trim(),
    password: typeof input?.password === 'string' ? input.password : '',
    remotePath: String(input?.remotePath || (type === 'ftp' ? '/' : '.')).trim(),
    note: String(input?.note || ''),
    trustedHostFingerprint: input?.trustedHostFingerprint
  }
  if (type === 'ssh') {
    profile.authType = input?.authType === 'privateKey' || input?.authType === 'system' ? input.authType : 'password'
    profile.privateKeyPath = String(input?.privateKeyPath || '')
    profile.passphrase = typeof input?.passphrase === 'string' ? input.passphrase : ''
    profile.sftpEnabled = input?.sftpEnabled !== false
    profile.encoding = input?.encoding
    profile.backspaceKey = input?.backspaceKey
    profile.deleteKey = input?.deleteKey
    profile.enableExecChannel = input?.enableExecChannel !== false
  } else {
    profile.secure = Boolean(input?.secure)
  }
  if (!profile.host) {
    throw new Error('Host 不能为空')
  }
  return profile
}

function normalizeCommandTemplate(input) {
  return {
    id: input.id || crypto.randomUUID(),
    type: 'command-template',
    name: String(input.name || '').trim() || 'Command',
    command: String(input.command || ''),
    description: input.description || '',
    parentId: input.parentId,
    order: input.order ?? Date.now(),
    appendCarriageReturn: input.appendCarriageReturn !== false
  }
}

function normalizeUiPreferences(input = {}) {
  const theme = input.theme === 'default-dark' || input.theme === 'default-light' ? input.theme : 'system'
  return {
    theme,
    locale: input.locale === 'enUS' ? 'enUS' : 'zhCN'
  }
}

async function maybeCall(fn, ...args) {
  if (typeof fn !== 'function') {
    return undefined
  }
  try {
    return await fn(...args)
  } catch {
    return undefined
  }
}

function buildMetricsCommand() {
  return `sh <<'TERMDOCK_METRICS'
sleep_interval=0.2
read_cpu() {
  awk '/^cpu / {print $2, $3, $4, $5, $6, $7, $8, $9; exit}' /proc/stat 2>/dev/null
}
set -- $(read_cpu)
u1=\${1:-0}; n1=\${2:-0}; s1=\${3:-0}; i1=\${4:-0}; w1=\${5:-0}; q1=\${6:-0}; f1=\${7:-0}; t1=\${8:-0}
total1=$((u1+n1+s1+i1+w1+q1+f1+t1)); idle1=$((i1+w1))
sleep "$sleep_interval" 2>/dev/null || sleep 1
set -- $(read_cpu)
u2=\${1:-0}; n2=\${2:-0}; s2=\${3:-0}; i2=\${4:-0}; w2=\${5:-0}; q2=\${6:-0}; f2=\${7:-0}; t2=\${8:-0}
total2=$((u2+n2+s2+i2+w2+q2+f2+t2)); idle2=$((i2+w2))
diff_total=$((total2-total1)); diff_idle=$((idle2-idle1))
cpu_pct=0
[ "$diff_total" -gt 0 ] && cpu_pct=$((100*(diff_total-diff_idle)/diff_total))
cpu_user=$(awk -v d="$diff_total" -v a="$u1" -v b="$u2" 'BEGIN{if(d>0)printf "%.1f",(b-a)*100/d;else print "0.0"}')
cpu_system=$(awk -v d="$diff_total" -v a="$s1" -v b="$s2" 'BEGIN{if(d>0)printf "%.1f",(b-a)*100/d;else print "0.0"}')
cpu_nice=$(awk -v d="$diff_total" -v a="$n1" -v b="$n2" 'BEGIN{if(d>0)printf "%.1f",(b-a)*100/d;else print "0.0"}')
cpu_idle=$(awk -v d="$diff_total" -v a="$idle1" -v b="$idle2" 'BEGIN{if(d>0)printf "%.1f",(b-a)*100/d;else print "0.0"}')
cpu_iowait=$(awk -v d="$diff_total" -v a="$w1" -v b="$w2" 'BEGIN{if(d>0)printf "%.1f",(b-a)*100/d;else print "0.0"}')
best_ip=$(ip route get 1 2>/dev/null | awk '{for(i=1;i<=NF;i++)if($i=="src"){print $(i+1);exit}}')
[ -z "$best_ip" ] && best_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
uptime_seconds=$(awk '{print int($1)}' /proc/uptime 2>/dev/null)
uptime_days=$(awk '{print int($1/86400) " 天"}' /proc/uptime 2>/dev/null)
load=$(awk '{printf "%s, %s, %s", $1, $2, $3}' /proc/loadavg 2>/dev/null)
identity=$( ( . /etc/os-release >/dev/null 2>&1 && printf "%s" "$PRETTY_NAME" ) 2>/dev/null )
[ -z "$identity" ] && identity=$(uname -s 2>/dev/null)
kernel_name=$(uname -s 2>/dev/null)
kernel_version=$(uname -r 2>/dev/null)
arch=$(uname -m 2>/dev/null)
hostname_value=$(hostname 2>/dev/null)
mem=$(awk 'BEGIN{total=available=free=buffers=cached=sreclaimable=shmem=slab=kernelstack=pagetables=0}
/^MemTotal:/ {total=int($2/1024)}
/^MemAvailable:/ {available=int($2/1024)}
/^MemFree:/ {free=int($2/1024)}
/^Buffers:/ {buffers=int($2/1024)}
/^Cached:/ {cached=int($2/1024)}
/^SReclaimable:/ {sreclaimable=int($2/1024)}
/^Shmem:/ {shmem=int($2/1024)}
/^Slab:/ {slab=int($2/1024)}
/^KernelStack:/ {kernelstack=int($2/1024)}
/^PageTables:/ {pagetables=int($2/1024)}
END{
 if(available==0) available=free+buffers+cached+sreclaimable-shmem
 if(available<0) available=0
 used=total-available; if(used<0)used=0
 pct=(total>0?int(used*100/total):0)
 cache_total=buffers+cached+sreclaimable-shmem; if(cache_total<0)cache_total=0
 kernel=slab-sreclaimable+kernelstack+pagetables; if(kernel<0)kernel=0
 if(kernel>used)kernel=used
 remaining=used-kernel
 cache=cache_total
 if(cache>remaining)cache=remaining
 if(cache<0)cache=0
 app=remaining-cache; if(app<0)app=0
 printf "%d|%d|%d|%d|%d|%d", used,total,pct,app,cache,kernel
}' /proc/meminfo 2>/dev/null)
swap=$(awk 'BEGIN{total=free=0}
/^SwapTotal:/ {total=int($2/1024)}
/^SwapFree:/ {free=int($2/1024)}
END{used=total-free;if(used<0)used=0;pct=(total>0?int(used*100/total):0);printf "%d|%d|%d",used,total,pct}' /proc/meminfo 2>/dev/null)
cpu_model=$(awk -F: '/^model name/ {gsub(/^[ \\t]+/,"",$2); print $2; exit}' /proc/cpuinfo 2>/dev/null)
cpu_cores=$(grep -c '^processor' /proc/cpuinfo 2>/dev/null)
[ -z "$cpu_model" ] && cpu_model=$(uname -m 2>/dev/null)
[ -z "$cpu_cores" ] && cpu_cores=0
echo "TD_IP=$best_ip"
echo "TD_UPTIME_SECONDS=$uptime_seconds"
echo "TD_UPTIME=$uptime_days"
echo "TD_LOAD=$load"
echo "TD_IDENTITY=$identity|$kernel_name|$kernel_version|$arch|$hostname_value"
echo "TD_CPU=$cpu_pct|$cpu_user|$cpu_system|$cpu_nice|$cpu_idle|$cpu_iowait|0|0|0"
echo "TD_CPU_INFO=$cpu_model|$cpu_cores|-|-|-"
echo "TD_MEM=$mem"
echo "TD_SWAP=$swap"
df -hP 2>/dev/null | awk 'NR>1 {print "TD_DISK="$6"|"$4"/"$2"|"$5"|"$3"|"$2}'
ps -eo rss=,pcpu=,etimes=,comm= 2>/dev/null | awk 'NF >= 4 {printf "TD_PROC=%.1fM|%s|%s|%s\\n", $1/1024, $2, $3, $4}'
ifaces=$(awk -F: 'NR>2 {name=$1; gsub(/[[:space:]]/,"",name); if (name != "lo") print name}' /proc/net/dev 2>/dev/null | paste -sd, -)
rx1=$(awk -F: 'NR>2 {name=$1; gsub(/[[:space:]]/,"",name); split($2, values, /[[:space:]]+/); if (name != "lo") sum += values[2]} END {printf "%.0f", sum+0}' /proc/net/dev 2>/dev/null)
tx1=$(awk -F: 'NR>2 {name=$1; gsub(/[[:space:]]/,"",name); split($2, values, /[[:space:]]+/); if (name != "lo") sum += values[10]} END {printf "%.0f", sum+0}' /proc/net/dev 2>/dev/null)
before_file="/tmp/termdock-if-before-$$"
after_file="/tmp/termdock-if-after-$$"
awk -F: 'NR>2 {name=$1; gsub(/[[:space:]]/,"",name); split($2, values, /[[:space:]]+/); if (name != "lo") printf "%s|%.0f|%.0f\\n", name, values[2], values[10]}' /proc/net/dev 2>/dev/null > "$before_file"
sleep "$sleep_interval" 2>/dev/null || sleep 1
rx2=$(awk -F: 'NR>2 {name=$1; gsub(/[[:space:]]/,"",name); split($2, values, /[[:space:]]+/); if (name != "lo") sum += values[2]} END {printf "%.0f", sum+0}' /proc/net/dev 2>/dev/null)
tx2=$(awk -F: 'NR>2 {name=$1; gsub(/[[:space:]]/,"",name); split($2, values, /[[:space:]]+/); if (name != "lo") sum += values[10]} END {printf "%.0f", sum+0}' /proc/net/dev 2>/dev/null)
awk -F: 'NR>2 {name=$1; gsub(/[[:space:]]/,"",name); split($2, values, /[[:space:]]+/); if (name != "lo") printf "%s|%.0f|%.0f\\n", name, values[2], values[10]}' /proc/net/dev 2>/dev/null > "$after_file"
sample_ms=$(awk -v interval="$sleep_interval" 'BEGIN { printf "%d", interval * 1000 }')
[ -z "$sample_ms" ] && sample_ms=1000
rx_rate=$(awk -v before="$rx1" -v after="$rx2" -v ms="$sample_ms" 'BEGIN { if (ms > 0) printf "%d", (after-before) * 1000 / ms; else print 0 }')
tx_rate=$(awk -v before="$tx1" -v after="$tx2" -v ms="$sample_ms" 'BEGIN { if (ms > 0) printf "%d", (after-before) * 1000 / ms; else print 0 }')
echo "TD_IFACES=$ifaces"
echo "TD_RATES=$rx_rate|$tx_rate"
awk -F'|' -v sample_ms="$sample_ms" '
  NR==FNR {rx[$1]=$2; tx[$1]=$3; next}
  NF >= 3 {
    prev_rx=rx[$1]
    prev_tx=tx[$1]
    curr_rx=$2
    curr_tx=$3
    rx_rate=(curr_rx-prev_rx) * 1000 / sample_ms
    tx_rate=(curr_tx-prev_tx) * 1000 / sample_ms
    printf "TD_NET=%s|%.0f|%.0f|%d|%d\\n", $1, curr_rx, curr_tx, rx_rate, tx_rate
  }
' "$before_file" "$after_file"
rm -f "$before_file" "$after_file"
TERMDOCK_METRICS`
}

function parseMetricsOutput(raw, previousMetrics) {
  const lines = String(raw || '').split(/\r?\n/)
  const disks = []
  const procs = []
  const netRows = []
  let data = {}

  for (const line of lines) {
    const index = line.indexOf('=')
    if (index === -1) continue
    const key = line.slice(0, index)
    const value = line.slice(index + 1)
    if (key === 'TD_DISK') disks.push(value)
    else if (key === 'TD_PROC') procs.push(value)
    else if (key === 'TD_NET') netRows.push(value)
    else data[key] = value
  }

  const [usedMem = 0, totalMem = 0, memPct = 0, appMem = 0, cacheMem = 0, kernelMem = 0] = splitNumbers(data.TD_MEM)
  const [usedSwap = 0, totalSwap = 0, swapPct = 0] = splitNumbers(data.TD_SWAP)
  const [cpuPct = 0, cpuUser = 0, cpuSystem = 0, cpuNice = 0, cpuIdle = 0, cpuIoWait = 0, cpuIrq = 0, cpuSoftIrq = 0, cpuSteal = 0] = splitNumbers(data.TD_CPU)
  const [osName = '-', kernelName = '-', kernelVersion = '-', architecture = '-', hostname = '-'] = splitText(data.TD_IDENTITY)
  const [cpuModel = '-', cpuCoresRaw = '0', cpuFrequency = '-', cpuCache = '-', bogomips = '-'] = splitText(data.TD_CPU_INFO)

  const interfaces = splitText(data.TD_IFACES).flatMap((entry) => entry.split(',')).filter(Boolean)
  const [rxRateRaw = '0', txRateRaw = '0'] = splitText(data.TD_RATES)
  const totalRxRate = Number(rxRateRaw) || 0
  const totalTxRate = Number(txRateRaw) || 0
  const netRatesByInterface = {
    all: {
      rx: formatNetworkRate(totalRxRate),
      tx: formatNetworkRate(totalTxRate)
    }
  }
  const netSamplesByInterface = {
    all: [
      ...(previousMetrics?.networkSamplesByInterface?.all || []),
      { rx: totalRxRate, tx: totalTxRate }
    ].slice(-60)
  }
  const networkInterfaceRows = netRows.map((row) => {
    const [name, rxRaw, txRaw, rxRateRaw, txRateRaw] = splitText(row)
    const rxTotal = Number(rxRaw) || 0
    const txTotal = Number(txRaw) || 0
    const rxRateBytes = Math.max(0, Math.round(Number(rxRateRaw) || 0))
    const txRateBytes = Math.max(0, Math.round(Number(txRateRaw) || 0))
    netRatesByInterface[name] = { rx: formatNetworkRate(rxRateBytes), tx: formatNetworkRate(txRateBytes) }
    const previousSamples = previousMetrics?.networkSamplesByInterface?.[name] || []
    netSamplesByInterface[name] = [...previousSamples, { rx: rxRateBytes, tx: txRateBytes }].slice(-60)
    return {
      name,
      rxTotal: formatBytes(rxTotal),
      txTotal: formatBytes(txTotal),
      rxRate: netRatesByInterface[name].rx,
      txRate: netRatesByInterface[name].tx
    }
  }).filter((row) => row.name)

  const activeRates = netRatesByInterface.all || { rx: '0B', tx: '0B' }
  const activeSamples = netSamplesByInterface.all || []

  const metrics = {
    ip: data.TD_IP || '-',
    uptime: data.TD_UPTIME || '-',
    uptimeSeconds: Number(data.TD_UPTIME_SECONDS) || undefined,
    load: data.TD_LOAD || '-',
    identity: { osName, kernelName, kernelVersion, architecture, hostname },
    cpuPercent: Number(cpuPct) || 0,
    cpuUsage: {
      user: Number(cpuUser) || 0,
      system: Number(cpuSystem) || 0,
      nice: Number(cpuNice) || 0,
      idle: Number(cpuIdle) || 0,
      ioWait: Number(cpuIoWait) || 0,
      irq: Number(cpuIrq) || 0,
      softIrq: Number(cpuSoftIrq) || 0,
      steal: Number(cpuSteal) || 0
    },
    cpuInfoRows: [{ model: cpuModel, cores: Number(cpuCoresRaw) || 0, frequencyMHz: cpuFrequency, cache: cpuCache, bogomips }],
    gpuInfoRows: [],
    memoryPercent: Number(memPct) || 0,
    memoryUsage: `${formatMiB(usedMem)} / ${formatMiB(totalMem)}`,
    memoryAppUsage: formatMiB(appMem),
    memoryCacheUsage: formatMiB(cacheMem),
    memoryKernelUsage: formatMiB(kernelMem),
    memoryBreakdown: {
      total: formatMiB(totalMem),
      used: formatMiB(usedMem),
      available: formatMiB(Math.max(0, totalMem - usedMem)),
      percent: Number(memPct) || 0
    },
    swapPercent: Number(swapPct) || 0,
    swapUsage: `${formatMiB(usedSwap)} / ${formatMiB(totalSwap)}`,
    swapBreakdown: {
      total: formatMiB(totalSwap),
      used: formatMiB(usedSwap),
      available: formatMiB(Math.max(0, totalSwap - usedSwap)),
      percent: Number(swapPct) || 0
    },
    diskRows: disks.map((row) => {
      const [pathName, usage] = splitText(row)
      return { path: pathName || '-', usage: usage || '-' }
    }),
    fileSystemRows: disks.map((row) => {
      const [mountPoint, availableSize, usagePercent, used, size] = splitText(row)
      return {
        name: mountPoint || '-',
        size: size || '-',
        used: used || '-',
        usagePercent: usagePercent || '-',
        available: availableSize || '-',
        mountPoint: mountPoint || '-'
      }
    }),
    networkInterfaces: ['all', ...interfaces],
    activeNetworkInterface: 'all',
    networkRates: activeRates,
    networkSamples: activeSamples,
    networkInterfaceRows,
    networkRatesByInterface: netRatesByInterface,
    networkSamplesByInterface: netSamplesByInterface,
    topProcesses: buildTopProcesses(procs)
  }
  return metrics
}

function buildTopProcesses(rows) {
  const transientCollectorCommands = new Set(['ps', 'awk', 'bash', 'sleep', 'sh'])
  const groupedProcesses = new Map()

  rows
    .map((row) => {
      const [memory = '0M', cpu = '0', elapsed = '0', command = ''] = splitText(row)
      return {
        memoryMb: Number(String(memory).replace(/M$/i, '')) || 0,
        cpuValue: Number(cpu) || 0,
        elapsedSeconds: Number(elapsed) || 0,
        command
      }
    })
    .filter((process) => process.command && !transientCollectorCommands.has(process.command))
    .forEach((process) => {
      const current = groupedProcesses.get(process.command) || {
        memoryMb: 0,
        cpu: 0,
        elapsedSeconds: 0
      }
      groupedProcesses.set(process.command, {
        memoryMb: current.memoryMb + process.memoryMb,
        cpu: current.cpu + process.cpuValue,
        elapsedSeconds: Math.max(current.elapsedSeconds, process.elapsedSeconds)
      })
    })

  return [...groupedProcesses.entries()]
    .map(([command, process]) => ({
      memory: formatProcessMegabytes(process.memoryMb),
      cpu: process.cpu.toFixed(1),
      command,
      elapsedSeconds: process.elapsedSeconds
    }))
    .sort((left, right) => parseFloat(right.memory) - parseFloat(left.memory))
}

function mergeNetworkHistory(previous, next) {
  if (!previous) return next
  return {
    ...next,
    networkSamples: next.networkSamples?.length ? next.networkSamples : previous.networkSamples,
    networkSamplesByInterface: {
      ...(previous.networkSamplesByInterface || {}),
      ...(next.networkSamplesByInterface || {})
    }
  }
}

function splitText(value) {
  return String(value || '').split('|')
}

function splitNumbers(value) {
  return splitText(value).map((entry) => Number(entry) || 0)
}

function formatMiB(value) {
  const number = Number(value) || 0
  if (number >= 1024) return `${(number / 1024).toFixed(number >= 10240 ? 0 : 1)} GB`
  return `${Math.round(number)} MB`
}

function toWorkspaceTab(tab) {
  return {
    id: tab.id,
    sessionType: tab.sessionType,
    profileId: tab.profileId,
    title: tab.title,
    layout: tab.sessionType === 'ssh' ? 'terminal-file' : 'file-only',
    status: tab.status
  }
}

function toSessionSnapshot(tab) {
  return {
    profileId: tab.profileId,
    accessHost: tab.accessHost,
    summary: tab.summary || '',
    terminalTranscript: tab.transcript || '',
    remotePath: tab.remotePath || '/',
    remoteFiles: tab.remoteFiles || [],
    fileAccessMode: tab.fileAccessMode || 'user',
    sudoUser: 'root',
    hasReusableSudoAuth: false,
    connected: tab.status === 'connected',
    systemMetrics: tab.systemMetrics
  }
}

async function resolveSshAuth(profile) {
  if (profile.authType === 'privateKey') {
    if (!profile.privateKeyPath) {
      throw new Error('私钥路径不能为空')
    }
    return {
      privateKey: await fsp.readFile(profile.privateKeyPath),
      passphrase: profile.passphrase || undefined
    }
  }
  if (profile.authType === 'system') {
    return {
      agent: process.env.SSH_AUTH_SOCK
    }
  }
  return {
    password: profile.password
  }
}

function computeFingerprint(key) {
  const buffer = Buffer.isBuffer(key) ? key : Buffer.from(key)
  return `SHA256:${crypto.createHash('sha256').update(buffer).digest('base64').replace(/=+$/, '')}`
}

function trimTranscript(value) {
  return value.length > TRANSCRIPT_LIMIT ? value.slice(value.length - TRANSCRIPT_LIMIT) : value
}

function createTransferCanceledError() {
  const error = new Error('传输已终止')
  error.code = TRANSFER_CANCELED_CODE
  return error
}

function isTransferCanceledError(error) {
  return error?.code === TRANSFER_CANCELED_CODE || error?.message === '传输已终止'
}

function throwIfTransferCanceled(signal) {
  if (signal?.aborted) {
    throw createTransferCanceledError()
  }
}

function normalizeTransferStreamError(error, signal) {
  return signal?.aborted ? createTransferCanceledError() : error
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function posixJoin(...parts) {
  const joined = path.posix.join(...parts.filter(Boolean))
  return joined || '/'
}

function tempFilePath(remotePath) {
  return path.join(os.tmpdir(), `termdock-${crypto.randomUUID()}-${path.posix.basename(remotePath) || 'remote-file'}`)
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return ''
  }
  const date = new Date(timestamp * 1000)
  return formatDate(date)
}

function formatDate(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatLocalDate(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatBytes(size = 0) {
  if (!size) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function formatNetworkRate(bytesPerSecond = 0) {
  const value = Number(bytesPerSecond) || 0
  if (value >= 1024 * 1024) {
    return `${Math.round(value / 1024 / 1024)}M`
  }
  if (value >= 1024) {
    return `${Math.round(value / 1024)}K`
  }
  return `${Math.round(value)}B`
}

function formatProcessMegabytes(value) {
  const number = Number(value) || 0
  if (number >= 1024) {
    return `${(number / 1024).toFixed(number >= 10 * 1024 ? 0 : 1)}G`
  }
  return `${number.toFixed(number >= 100 ? 0 : 1)}M`
}

function formatPermissionBits(mode, isDirectory) {
  const segments = [
    [0o400, 0o200, 0o100],
    [0o040, 0o020, 0o010],
    [0o004, 0o002, 0o001]
  ]
  return `${isDirectory ? 'd' : '-'}${segments.map(([read, write, execute]) => (
    `${mode & read ? 'r' : '-'}${mode & write ? 'w' : '-'}${mode & execute ? 'x' : '-'}`
  )).join('')}`
}

function parentRemotePath(currentPath) {
  const normalized = currentPath.endsWith('/') && currentPath !== '/' ? currentPath.slice(0, -1) : currentPath
  const parent = path.posix.dirname(normalized)
  return parent === '.' ? '/' : parent
}

async function readdirSftp(sftp, targetPath) {
  return new Promise((resolve, reject) => {
    sftp.readdir(targetPath, (error, list) => error ? reject(error) : resolve(list || []))
  })
}

async function statSftp(sftp, targetPath) {
  return new Promise((resolve, reject) => {
    sftp.stat(targetPath, (error, stats) => error ? reject(error) : resolve(stats))
  })
}

async function mkdirSftp(sftp, targetPath) {
  return new Promise((resolve, reject) => {
    sftp.mkdir(targetPath, (error) => error ? reject(error) : resolve())
  })
}

async function readSftpFile(sftp, targetPath) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const stream = sftp.createReadStream(targetPath)
    stream.on('data', (chunk) => chunks.push(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

async function writeSftpFile(sftp, targetPath, buffer) {
  return new Promise((resolve, reject) => {
    const stream = sftp.createWriteStream(targetPath)
    stream.on('error', reject)
    stream.on('close', resolve)
    stream.end(buffer)
  })
}

async function rmdirSftpRecursive(sftp, targetPath) {
  const entries = await readdirSftp(sftp, targetPath)
  for (const entry of entries) {
    const childPath = path.posix.join(targetPath, entry.filename)
    const isDirectory = entry.longname?.startsWith('d')
    if (isDirectory) {
      await rmdirSftpRecursive(sftp, childPath)
    } else {
      await new Promise((resolve, reject) => {
        sftp.unlink(childPath, (error) => error ? reject(error) : resolve())
      })
    }
  }
  await new Promise((resolve, reject) => {
    sftp.rmdir(targetPath, (error) => error ? reject(error) : resolve())
  })
}

function formatRemoteRows(basePath, entries) {
  const rows = entries
    .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
    .map((entry) => {
      const fullPath = path.posix.join(basePath, entry.filename)
      const isDirectory = entry.longname?.startsWith('d')
      return {
        path: fullPath,
        name: entry.filename,
        type: isDirectory ? 'folder' : 'file',
        modified: formatTimestamp(entry.attrs?.mtime),
        size: isDirectory ? '-' : formatBytes(entry.attrs?.size || 0),
        permission: entry.longname?.split(/\s+/)[0] || '',
        ownerGroup: `${entry.attrs?.uid ?? 0}/${entry.attrs?.gid ?? 0}`
      }
    })
    .sort(sortFoldersFirst)

  if (basePath !== '/' && basePath !== '.') {
    rows.unshift({
      path: parentRemotePath(basePath),
      name: '..',
      type: 'folder',
      modified: '',
      size: '-',
      permission: '',
      ownerGroup: ''
    })
  }
  return rows
}

function formatFtpRows(basePath, entries) {
  const rows = entries
    .filter((entry) => entry.name !== '.' && entry.name !== '..')
    .map((entry) => {
      const isDirectory = entry.type === FileType.Directory || entry.isDirectory
      return {
        path: path.posix.join(basePath, entry.name),
        name: entry.name,
        type: isDirectory ? 'folder' : 'file',
        modified: entry.modifiedAt ? formatDate(entry.modifiedAt) : entry.rawModifiedAt || '',
        size: isDirectory ? '-' : formatBytes(entry.size || 0),
        permission: formatFtpPermissions(entry),
        ownerGroup: [entry.user, entry.group].filter(Boolean).join('/') || ''
      }
    })
    .sort(sortFoldersFirst)

  if (basePath !== '/') {
    rows.unshift({
      path: parentRemotePath(basePath),
      name: '..',
      type: 'folder',
      modified: '',
      size: '-',
      permission: '',
      ownerGroup: ''
    })
  }
  return rows
}

function formatFtpPermissions(entry) {
  if (!entry.permissions) {
    return entry.type === FileType.Directory ? 'd---------' : '----------'
  }
  return `${entry.type === FileType.Directory ? 'd' : '-'}${formatPermissionGroup(entry.permissions.user)}${formatPermissionGroup(entry.permissions.group)}${formatPermissionGroup(entry.permissions.world)}`
}

function formatPermissionGroup(value = 0) {
  return `${value & FileInfo.UnixPermission.Read ? 'r' : '-'}${value & FileInfo.UnixPermission.Write ? 'w' : '-'}${value & FileInfo.UnixPermission.Execute ? 'x' : '-'}`
}

function sortFoldersFirst(left, right) {
  if (left.type !== right.type) {
    return left.type === 'folder' ? -1 : 1
  }
  return left.name.localeCompare(right.name)
}

module.exports = {
  createBackend
}

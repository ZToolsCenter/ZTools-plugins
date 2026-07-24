const { createBackend } = require('./backend/backend')

let electronWebUtils = null
try {
  electronWebUtils = require('electron')?.webUtils || null
} catch {
  electronWebUtils = null
}

const backend = createBackend({
  ztools: window.ztools
})

function getDroppedFilePath(file) {
  const electronPath = electronWebUtils?.getPathForFile?.(file)
  if (electronPath) {
    return electronPath
  }
  return file?.path || file?.webkitRelativePath || ''
}

function getDroppedFilePaths(files) {
  const paths = Array.from(files || [])
    .map(getDroppedFilePath)
    .filter(Boolean)

  return paths.length ? [...new Set(paths)] : backend.getDroppedFilePaths(files)
}

window.termdock = {
  platform: typeof process !== 'undefined' ? process.platform : 'unknown',
  appName: 'TermDock',
  isDesktop: true,
  isZToolsPlugin: true,

  readClipboardText: () => backend.readClipboardText(),
  writeClipboardText: (text) => backend.writeClipboardText(text),
  getUiPreferences: () => Promise.resolve(backend.getUiPreferences()),
  setUiPreferences: (input) => Promise.resolve(backend.setUiPreferences(input)),
  openConnectionManagerWindow: () => backend.openConnectionManagerWindow(),
  openCommandManagerWindow: () => backend.openCommandManagerWindow(),
  openConnectionFormWindow: (mode, profileId) => backend.openConnectionFormWindow(mode, profileId),
  openCommandFormWindow: (mode, commandId, folderId) => backend.openCommandFormWindow(mode, commandId, folderId),
  openFileEditorWindow: (input) => backend.openFileEditorWindow(input),
  closeCurrentWindow: () => backend.closeCurrentWindow(),

  getProfiles: () => Promise.resolve(backend.getProfiles()),
  saveProfile: (profile) => backend.saveProfile(profile),
  createProfile: (input) => backend.createProfile(input),
  updateProfile: (profileId, input) => backend.updateProfile(profileId, input),
  deleteProfile: (profileId) => backend.deleteProfile(profileId),
  createFolder: (name, parentId) => backend.createFolder(name, parentId),
  updateFolder: (folderId, updates) => backend.updateFolder(folderId, updates),
  deleteFolder: (folderId) => backend.deleteFolder(folderId),
  updateEntityOrder: (id, newParentId, newOrder) => backend.updateEntityOrder(id, newParentId, newOrder),
  createCommandFolder: (name, parentId) => backend.createCommandFolder(name, parentId),
  updateCommandFolder: (folderId, updates) => backend.updateCommandFolder(folderId, updates),
  deleteCommandFolder: (folderId) => backend.deleteCommandFolder(folderId),
  updateCommandOrder: (id, newParentId, newOrder) => backend.updateCommandOrder(id, newParentId, newOrder),
  createCommandTemplate: (input) => backend.createCommandTemplate(input),
  updateCommandTemplate: (commandId, input) => backend.updateCommandTemplate(commandId, input),
  deleteCommandTemplate: (commandId) => backend.deleteCommandTemplate(commandId),
  executeCommandTemplate: (tabId, commandId, args, options) =>
    backend.executeCommandTemplate(tabId, commandId, args, options),

  openProfile: (profileId, options) => backend.openProfile(profileId, options),
  openProfileFromManager: (profileId, options) => backend.openProfileFromManager(profileId, options),
  activateTab: (tabId) => backend.activateTab(tabId),
  reconnectTab: (tabId) => backend.reconnectTab(tabId),
  disconnectTab: (tabId) => backend.disconnectTab(tabId),
  closeTab: (tabId) => backend.closeTab(tabId),
  getSnapshot: () => Promise.resolve(backend.getSnapshot()),

  listLocalDirectory: (dirPath) => backend.listLocalDirectory(dirPath),
  readLocalFile: (filePath, encoding) => backend.readLocalFile(filePath, encoding),
  writeLocalFile: (filePath, content, encoding) => backend.writeLocalFile(filePath, content, encoding),
  createLocalDirectory: (dirPath, name) => backend.createLocalDirectory(dirPath, name),
  createLocalFile: (dirPath, name) => backend.createLocalFile(dirPath, name),
  copyLocalPath: (sourcePath, destinationPath) => backend.copyLocalPath(sourcePath, destinationPath),
  moveLocalPath: (sourcePath, destinationPath) => backend.moveLocalPath(sourcePath, destinationPath),
  renameLocalPath: (targetPath, newName) => backend.renameLocalPath(targetPath, newName),
  deleteLocalPath: (targetPath) => backend.deleteLocalPath(targetPath),
  changeLocalPermissions: (targetPath, options) => backend.changeLocalPermissions(targetPath, options),
  getDroppedFilePaths,

  writeTerminal: (tabId, data) => backend.writeTerminal(tabId, data),
  resizeTerminal: (tabId, cols, rows, width, height) =>
    backend.resizeTerminal(tabId, cols, rows, width, height),

  openRemotePath: (tabId, targetPath) => backend.openRemotePath(tabId, targetPath),
  readRemoteFile: (tabId, targetPath, encoding) =>
    backend.readRemoteFile(tabId, targetPath, encoding),
  writeRemoteFile: (tabId, targetPath, content, encoding) =>
    backend.writeRemoteFile(tabId, targetPath, content, encoding),
  createRemoteDirectory: (tabId, parentPath, name) =>
    backend.createRemoteDirectory(tabId, parentPath, name),
  createRemoteFile: (tabId, parentPath, name) =>
    backend.createRemoteFile(tabId, parentPath, name),
  copyRemotePath: (tabId, targetPath, destinationPath, targetType) =>
    backend.copyRemotePath(tabId, targetPath, destinationPath, targetType),
  moveRemotePath: (tabId, targetPath, destinationPath) =>
    backend.moveRemotePath(tabId, targetPath, destinationPath),
  renameRemotePath: (tabId, targetPath, newName) =>
    backend.renameRemotePath(tabId, targetPath, newName),
  deleteRemotePath: (tabId, targetPath, targetType) =>
    backend.deleteRemotePath(tabId, targetPath, targetType),
  changeRemotePermissions: (tabId, targetPath, mode) =>
    backend.changeRemotePermissions(tabId, targetPath, mode),
  setRemoteFileAccessMode: (tabId, mode, options) =>
    backend.setRemoteFileAccessMode(tabId, mode, options),

  selectLocalFiles: (defaultPath) => backend.selectLocalFiles(defaultPath),
  selectLocalDirectory: (defaultPath) => backend.selectLocalDirectory(defaultPath),
  queueUpload: (fileNames) => backend.queueUpload(fileNames),
  cancelTransfer: (transferId) => backend.cancelTransfer(transferId),
  clearTransfers: (transferIds) => backend.clearTransfers(transferIds),
  uploadFile: (tabId, localPath, remoteDirectory, options) =>
    backend.uploadFile(tabId, localPath, remoteDirectory, options),
  downloadFile: (tabId, remotePath, localDirectory, options) =>
    backend.downloadFile(tabId, remotePath, localDirectory, options),
  downloadRemotePath: (tabId, remotePath, targetType, localDirectory, options) =>
    backend.downloadRemotePath(tabId, remotePath, targetType, localDirectory, options),
  resolveSshInteraction: (requestId, response) => backend.resolveSshInteraction(requestId, response),

  onSnapshot: (listener) => backend.on('snapshot', listener),
  onWorkspaceSnapshot: (listener) => backend.on('snapshot', listener),
  onTerminalData: (listener) => backend.on('terminal:data', listener),
  onTerminalState: (listener) => backend.on('terminal:state', listener),
  onSshInteraction: (listener) => backend.on('ssh:interaction', listener),
  onTransfer: (listener) => backend.on('transfer', listener)
}

if (window.ztools?.onPluginOut) {
  window.ztools.onPluginOut(() => {
    backend.shutdown()
  })
}

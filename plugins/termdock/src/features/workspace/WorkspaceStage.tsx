import type {
  CommandExecutionOptions,
  CommandFolder,
  CommandTemplate,
  ConnectionFolder,
  ConnectionProfile,
  FileContentSnapshot,
  LocalFileItem,
  RemoteFileItem,
  SessionSnapshot,
  WorkspaceTab
} from '@termdock/core'
import type { DragEvent } from 'react'
import { SystemInfoWorkspace } from '../system/SystemInfoWorkspace'
import { FileEditorModal } from '../files/FileEditorModal'
import { HomeWorkspace } from './HomeWorkspace'
import { SessionWorkspace } from './SessionWorkspace'

type ActiveLocalTab =
  | { id: string; kind: 'home'; title: string }
  | { id: string; kind: 'system'; title: string; sessionTabId: string; sourceTabTitle: string }
  | { id: string; kind: 'file-editor'; title: string; file: FileContentSnapshot }
  | null

export function WorkspaceStage({
  activeLocalTab,
  activeProfile,
  activeSession,
  activeTab,
  tabs,
  commandFolders,
  commandTemplates,
  folders,
  isBusy,
  localItems,
  localPath,
  canPasteToLocal,
  canPasteToRemote,
  clipboardStatusText,
  localCutPaths,
  remoteCutPaths,
  fileEditorError,
  filePanelHeight,
  hasStoredFilePanelHeight,
  terminalFontSize,
  themeMode,
  onCloseFileEditorTab,
  onFilePanelHeightChange,
  onCopyItems,
  onCutItems,
  onClearCutState,
  onExecuteCommand,
  onOpenCommandManager,
  profiles,
  onChooseUploadFiles,
  onDownloadFiles,
  onDropUpload,
  onOpenLocalItem,
  onOpenLocalPath,
  onOpenProfile,
  onOpenRemoteItem,
  onOpenRemotePath,
  onPasteIntoPane,
  onReloadFileEditorTab,
  onRequestChangePermissions,
  onRequestDelete,
  onRequestNewFile,
  onRequestNewFolder,
  onRequestQuickDelete,
  onRequestRename,
  onToggleRemoteFileAccessMode,
  remoteFileAccessMode,
  onRefresh,
  onSaveFileEditorTab,
  onUploadFiles
}: {
  activeLocalTab: ActiveLocalTab
  activeProfile: ConnectionProfile | null
  activeSession: SessionSnapshot | null
  activeTab: WorkspaceTab | null
  tabs: WorkspaceTab[]
  commandFolders: CommandFolder[]
  commandTemplates: CommandTemplate[]
  folders: ConnectionFolder[]
  isBusy: boolean
  localItems: LocalFileItem[]
  localPath: string
  canPasteToLocal: boolean
  canPasteToRemote: boolean
  clipboardStatusText: string | null
  localCutPaths: string[]
  remoteCutPaths: string[]
  fileEditorError: string | null
  filePanelHeight: number
  hasStoredFilePanelHeight: boolean
  terminalFontSize: number
  themeMode: string
  onCloseFileEditorTab(tabId: string): void
  onFilePanelHeightChange(height: number, userAdjusted?: boolean): void
  onCopyItems(pane: 'local' | 'remote', items: Array<LocalFileItem | RemoteFileItem>): void
  onCutItems(pane: 'local' | 'remote', items: Array<LocalFileItem | RemoteFileItem>): void
  onClearCutState(): void
  onExecuteCommand(commandId: string, args: string[], options: CommandExecutionOptions, scope: 'current' | 'all-ssh'): void
  onOpenCommandManager(): void
  profiles: ConnectionProfile[]
  onChooseUploadFiles(): void
  onDownloadFiles(items: RemoteFileItem[], targetDirectory?: string): void
  onDropUpload(event: DragEvent<HTMLDivElement>): void
  onOpenLocalItem(item: LocalFileItem): void
  onOpenLocalPath(path: string): void
  onOpenProfile(profileId: string): void
  onOpenRemoteItem(item: RemoteFileItem): void
  onOpenRemotePath(path: string): void
  onPasteIntoPane(pane: 'local' | 'remote'): void
  onReloadFileEditorTab(tabId: string, encoding: string): void
  onRequestChangePermissions(pane: 'local' | 'remote', item: LocalFileItem | RemoteFileItem): void
  onRequestDelete(pane: 'local' | 'remote', items: Array<LocalFileItem | RemoteFileItem>): void
  onRequestNewFile(pane: 'local' | 'remote', directoryPath: string): void
  onRequestNewFolder(pane: 'local' | 'remote', directoryPath: string): void
  onRequestQuickDelete(pane: 'local' | 'remote', items: Array<LocalFileItem | RemoteFileItem>): void
  onRequestRename(pane: 'local' | 'remote', item: LocalFileItem | RemoteFileItem): void
  onToggleRemoteFileAccessMode(): void
  remoteFileAccessMode: 'user' | 'root'
  onRefresh(): void
  onSaveFileEditorTab(tabId: string, content: string, encoding: string): void
  onUploadFiles(items: LocalFileItem[]): void
}) {
  if (activeLocalTab?.kind === 'system') {
    return <SystemInfoWorkspace activeProfile={activeProfile} activeSession={activeSession} />
  }

  if (activeLocalTab?.kind === 'file-editor') {
    return (
      <FileEditorModal
        embedded
        errorMessage={fileEditorError}
        file={activeLocalTab.file}
        isBusy={isBusy}
        onClose={() => onCloseFileEditorTab(activeLocalTab.id)}
        onReloadWithEncoding={(encoding) => onReloadFileEditorTab(activeLocalTab.id, encoding)}
        onSave={(content, encoding) => onSaveFileEditorTab(activeLocalTab.id, content, encoding)}
        themeMode={themeMode}
      />
    )
  }

  if (activeTab && activeSession && !activeLocalTab) {
    return (
      <SessionWorkspace
        activeSession={activeSession}
        activeTab={activeTab}
        tabs={tabs}
        commandFolders={commandFolders}
        commandTemplates={commandTemplates}
        isBusy={isBusy}
        localItems={localItems}
        localPath={localPath}
        canPasteToLocal={canPasteToLocal}
        canPasteToRemote={canPasteToRemote}
        clipboardStatusText={clipboardStatusText}
        localCutPaths={localCutPaths}
        remoteCutPaths={remoteCutPaths}
        filePanelHeight={filePanelHeight}
        hasStoredFilePanelHeight={hasStoredFilePanelHeight}
        terminalFontSize={terminalFontSize}
        onFilePanelHeightChange={onFilePanelHeightChange}
        onCopyItems={onCopyItems}
        onCutItems={onCutItems}
        onClearCutState={onClearCutState}
        onExecuteCommand={onExecuteCommand}
        onOpenCommandManager={onOpenCommandManager}
        onChooseUploadFiles={onChooseUploadFiles}
        onDownloadFiles={onDownloadFiles}
        onDropUpload={onDropUpload}
        onOpenLocalItem={onOpenLocalItem}
        onOpenLocalPath={onOpenLocalPath}
        onOpenRemoteItem={onOpenRemoteItem}
        onOpenRemotePath={onOpenRemotePath}
        onPasteIntoPane={onPasteIntoPane}
        onRequestChangePermissions={onRequestChangePermissions}
        onRequestDelete={onRequestDelete}
        onRequestNewFile={onRequestNewFile}
        onRequestNewFolder={onRequestNewFolder}
        onRequestQuickDelete={onRequestQuickDelete}
        onRequestRename={onRequestRename}
        onToggleRemoteFileAccessMode={onToggleRemoteFileAccessMode}
        remoteFileAccessMode={remoteFileAccessMode}
        onRefresh={onRefresh}
        onUploadFiles={onUploadFiles}
      />
    )
  }

  return (
    <HomeWorkspace
      folders={folders}
      onOpen={onOpenProfile}
      profiles={profiles}
    />
  )
}

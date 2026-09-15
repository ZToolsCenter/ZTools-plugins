type WorkspaceIdentity = { id: string; name: string; version: 1; path: string }

type WorkspaceTreeEntry =
  | { kind: 'directory'; name: string; relativePath: string; children: WorkspaceTreeEntry[] }
  | { kind: 'note'; name: string; relativePath: string; modifiedAt: number; size: number }

type WorkspaceScan = { workspace: WorkspaceIdentity; entries: WorkspaceTreeEntry[] }
type TrashItem = { id: string; originalPath: string; deletedAt: string; kind: 'note' | 'directory' }
type WorkspaceSearchResult = { name: string; relativePath: string; snippet: string }
type UnusedAttachment = { relativePath: string; size: number }

interface Window {
  znotes: {
    apiVersion: number
		createWorkspace(rootPath: string, name: string): Promise<WorkspaceIdentity>
		renameWorkspace(rootPath: string, name: string): Promise<WorkspaceIdentity>
		relinkWorkspace(rootPath: string, expectedWorkspaceId: string): Promise<WorkspaceIdentity>
		discoverWorkspaces(parentPath: string): Promise<WorkspaceIdentity[]>
		migrateWorkspace(rootPath: string, targetPath: string): Promise<WorkspaceIdentity>
    readWorkspace(rootPath: string): Promise<WorkspaceIdentity>
    scanWorkspace(rootPath: string): Promise<WorkspaceScan>
    openDefaultWorkspace(documentsPath: string): Promise<WorkspaceScan>
    createNote(rootPath: string, parentRelativePath: string, name: string): Promise<string>
    createDirectory(rootPath: string, parentRelativePath: string, name: string): Promise<string>
    renameEntry(rootPath: string, relativePath: string, name: string): Promise<string>
    moveEntry(rootPath: string, relativePath: string, targetDirectoryPath: string): Promise<string>
    showEntryInFolder(rootPath: string, relativePath: string): Promise<void>
    moveEntryToTrash(rootPath: string, relativePath: string): Promise<{
      id: string
      originalPath: string
      deletedAt: string
      kind: 'note' | 'directory'
    }>
    listTrash(rootPath: string): Promise<TrashItem[]>
    restoreTrashItem(rootPath: string, id: string, targetRelativePath?: string): Promise<string>
    permanentlyDeleteTrashItem(rootPath: string, id: string): Promise<void>
    emptyTrash(rootPath: string): Promise<void>
    listExpiredTrash(rootPath: string, retentionDays: number): Promise<TrashItem[]>
    deleteExpiredTrashItems(rootPath: string, ids: string[], retentionDays: number): Promise<number>
    readNote(rootPath: string, relativePath: string): Promise<{ content: string; modifiedAt: number; size: number; baseUrl: string }>
    openWorkspaceLink(rootPath: string, noteRelativePath: string, href: string): Promise<
      { kind: 'note'; relativePath: string } | { kind: 'attachment' }
    >
    createNoteLink(rootPath: string, noteRelativePath: string, targetRelativePath: string): Promise<string>
    createCrossWorkspaceNoteLink(targetRootPath: string, expectedWorkspaceId: string, targetRelativePath: string): Promise<string>
    openCrossWorkspaceNoteLink(targetRootPath: string, href: string): Promise<{ workspace: WorkspaceIdentity; relativePath: string }>
    searchWorkspace(rootPath: string, query: string): Promise<WorkspaceSearchResult[]>
    saveNote(rootPath: string, relativePath: string, content: string, expectedModifiedAt: number | null): Promise<{ modifiedAt: number; size: number }>
    importAttachment(rootPath: string, noteRelativePath: string, originalName: string, data: Uint8Array): Promise<string>
    scanUnusedAttachments(rootPath: string): Promise<UnusedAttachment[]>
    deleteUnusedAttachments(rootPath: string, relativePaths: string[]): Promise<number>
  }
  ztools: {
    getNativeId(): string
    getPath(name: 'documents'): string
    showOpenDialog(options: { properties: string[] }): string[] | undefined
    onPluginEnter(callback: (action: { code: string; type: string; payload: unknown }) => void): void
    onPluginOut(callback: (isKill: boolean) => void): void
    getFeatures(codes?: string[]): Array<{ code: string; explain: string; cmds: unknown[] }>
    setFeature(feature: { code: string; explain: string; cmds: string[] }): boolean
    removeFeature(code: string): boolean
    setSubInput(onChange: (input: string | { text: string }) => void, placeholder: string, isFocus?: boolean): void
    setSubInputValue(text: string): void
    subInputSelect(): boolean
    subInputBlur(): boolean
    removeSubInput(): Promise<boolean>
    shellOpenExternal(url: string): boolean
    shellOpenPath(fullPath: string): boolean
    dbStorage: {
      getItem(key: string): unknown
      setItem(key: string, value: unknown): void
    }
  }
}

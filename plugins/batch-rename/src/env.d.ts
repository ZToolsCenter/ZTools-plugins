/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

interface Window {
  renameService: {
    platform: string
    readFileInfos: (paths: string[]) => Promise<import('./core/session').FileInfo[]>
    scanDirectory: (directory: string) => Promise<{ paths: string[]; errors: Array<{ path: string; message: string }> }>
    readMetadata: (path: string, kind: 'dimensions' | 'capturedAt') => Promise<import('./core/session').FileMetadata>
    validatePlan: (intents: RenameIntent[]) => Promise<RenameOutcome[]>
    executePlan: (intents: RenameIntent[]) => Promise<RenameBatchResult>
    undo: () => Promise<RenameBatchResult>
    resetTask: () => void
  }
}

type RenameIntent = { id: string; sourcePath: string; targetName: string }
type RenameOutcome = RenameIntent & {
  targetPath: string
  actualPath?: string
  status: 'ready' | 'unchanged' | 'error' | 'success'
  error?: string
}
type RenameBatchResult = { results: RenameOutcome[]; canUndo: boolean }

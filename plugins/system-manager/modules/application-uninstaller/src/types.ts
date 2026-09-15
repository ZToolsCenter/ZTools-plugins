export type Platform = 'darwin' | 'win32' | 'linux'
export type CandidateCategory = 'application' | 'cache' | 'config' | 'log' | 'state' | 'support' | 'shortcut'

export interface AppSummary {
  id: string
  platform: Platform
  name: string
  version: string | null
  publisher: string | null
  install: { kind: string; path: string | null; scope: 'user' | 'system' }
  uninstall: { mode: 'trash' | 'manual'; requiresElevation: boolean; supported: boolean }
  protected: boolean
}

export interface Candidate {
  id: string
  path: string
  category: CandidateCategory
  sizeBytes: number | null
  exists: boolean
  ownership: 'user' | 'system'
  confidence: 'exact' | 'strong' | 'weak'
  reason: string
  selectedByDefault: boolean
  deletable: boolean
}

export interface ScanResult { platform: Platform; scannedAt: string; apps: AppSummary[]; warnings: string[] }
export interface UninstallPlan { id: string; app: AppSummary; createdAt: string; expiresAt: string; candidates: Candidate[]; warnings: string[] }
export interface ExecutionResult { planId: string; completedAt: string; results: Array<{ candidateId: string; status: 'trashed' | 'launched-uninstaller' | 'skipped' | 'failed'; message?: string }> }

export interface ApplicationUninstallerBridge {
  scanApps(): Promise<ScanResult>
  inspectApp(appId: string): Promise<UninstallPlan>
  executePlan(request: { planId: string; selectedIds: string[]; confirmation: string }): Promise<ExecutionResult>
  revealPath(pathId: string): boolean
}

export type Platform = 'darwin' | 'win32' | 'linux'
export type Scope = 'user' | 'system'
export type ImpactLevel = 'low' | 'medium' | 'high' | 'unknown'
export type ItemKind = 'login-item' | 'launch-agent' | 'launch-daemon' | 'run-key' | 'startup-folder' | 'scheduled-task' | 'service' | 'desktop-autostart' | 'systemd-unit' | 'cron'

export interface StartupItem {
  id: string
  name: string
  icon?: string | null
  scope: Scope
  kind: ItemKind
  source: { label: string; location: string | null }
  trigger: string
  commandSummary: string | null
  enabled: boolean | null
  running: boolean | null
  status: string
  impact: { level: ImpactLevel; basis: 'heuristic'; reasons: string[] }
  action: { canToggle: boolean; requiresElevation: boolean; reason: string | null }
  metadata: Record<string, string>
}

export interface ScanResult {
  snapshotId: string
  platform: Platform
  generatedAt: string
  items: StartupItem[]
  warnings: string[]
}

export type BridgeResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

export interface StartupBridge {
  scan(): Promise<BridgeResult<ScanResult>>
  setEnabled(request: { snapshotId: string; itemId: string; enabled: boolean }): Promise<BridgeResult<{ changed: boolean; operationId: string | null; item: StartupItem }>>
  undo(request: { operationId: string }): Promise<BridgeResult<{ restored: true; item: StartupItem }>>
}

export type InterfaceScope = 'private' | 'shared' | 'other'
export type OnlineStatus = 'online' | 'recently-seen' | 'unknown'
export type ScanStatus = 'completed' | 'cancelled' | 'partial'

export interface LanInterface {
  id: string
  name: string
  address: string
  cidr: string
  prefixLength: number
  scope: InterfaceScope
  kind: 'physical' | 'virtual' | 'vpn'
  requiresConfirmation: boolean
  riskReason: string | null
}

export interface LanDevice {
  ip: string
  hostname: string | null
  vendor: string | null
  onlineStatus: OnlineStatus
  evidence: Array<'self' | 'icmp' | 'neighbor'>
  isSelf: boolean
}

export interface ScanIssue {
  code: string
  message: string
}

export interface ScanResult {
  scanId: string
  status: ScanStatus
  interface: LanInterface
  devices: LanDevice[]
  startedAt: string
  finishedAt: string
  durationMs: number
  scannedHostCount: number
  truncated: boolean
  warnings: string[]
  errors: ScanIssue[]
}

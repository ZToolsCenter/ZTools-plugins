export type DiagnosticStatus =
  | 'healthy'
  | 'warning'
  | 'error'
  | 'unavailable'
  | 'checking'
  | 'neutral'

export interface CollectOptions {
  /** Safe mode is the UI default: no usernames, serial numbers, addresses or paths. */
  privacy?: 'safe' | 'fingerprint-minimal'
}

export interface ReportNotice {
  code?: string
  message?: string
  detail?: string
  section?: string
  severity?: string
  [key: string]: unknown
}

/**
 * Collector output is intentionally permissive. Platform APIs do not always
 * expose the same fields and older preload versions may return partial data.
 */
export interface SystemReport {
  overview?: unknown
  os?: unknown
  device?: unknown
  cpu?: unknown
  memory?: unknown
  storage?: unknown
  graphics?: unknown
  displays?: unknown
  battery?: unknown
  runtime?: unknown
  performance?: unknown
  sources?: unknown
  warnings?: Array<ReportNotice | string> | unknown
  errors?: Array<ReportNotice | string> | unknown
  status?: string | Record<string, unknown>
  generatedAt?: string
  collectedAt?: string
  schemaVersion?: string | number
  [key: string]: unknown
}

export interface DiagnosticField {
  key: string
  label: string
  value: string
  status: DiagnosticStatus
  note?: string
  /** The raw value is retained for JSON export, never rendered as HTML. */
  rawValue?: unknown
}

export interface DiagnosticGroup {
  id: string
  title: string
  description: string
  status: DiagnosticStatus
  fields: DiagnosticField[]
}

export interface Recommendation {
  id: string
  title: string
  detail: string
  status: 'warning' | 'error' | 'neutral'
}

export interface NormalizedReport {
  generatedAt: string
  overallStatus: DiagnosticStatus
  groups: DiagnosticGroup[]
  recommendations: Recommendation[]
  warnings: string[]
  errors: string[]
  raw: SystemReport
}

export type CollectResult =
  | { ok: true; report: NormalizedReport }
  | { ok: false; error: string; stale: boolean }

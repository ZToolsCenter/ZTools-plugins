export interface NetworkInterface {
  name: string
  ip: string
  family: string
  internal: boolean
}

export interface SharedItem {
  id: string
  path: string
  name: string
  isDirectory: boolean
  enabled: boolean
  children?: SharedItem[]
  fileCount?: number
  origin?: { type: 'upload'; ip: string; time: string; local?: boolean }
  hash?: string
  hashSize?: number
  hashMtime?: number
}

export interface ServerConfig {
  port: number
  ip: string
  token: string
  running: boolean
}

export interface ScanResult {
  fileCount: number
  files: { path: string; name: string; isDirectory: boolean }[]
}

export interface DownloadLog {
  type?: 'download' | 'upload'
  ip: string
  filePath: string
  fileName: string
  size?: number
  timestamp: string
}

export interface StartServerResult {
  ok: boolean
  error?: string
}

export interface TextShareResult {
  id: string
  path: string
  name: string
  isDirectory: boolean
  enabled: boolean
}

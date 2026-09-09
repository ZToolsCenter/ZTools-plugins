/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

interface NetworkInterface {
  name: string
  ip: string
  family: string
  internal: boolean
}

interface SharedItem {
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

interface ServerConfig {
  port: number
  ip: string
  token: string
  running: boolean
}

interface ScanResult {
  fileCount: number
  files: { path: string; name: string; isDirectory: boolean }[]
}

interface DownloadLog {
  type?: 'download' | 'upload'
  ip: string
  filePath: string
  fileName: string
  size?: number
  timestamp: string
}

interface P2pSummary {
  pending: number
  active: number
  unreadTotal: number
}

interface P2pSession {
  id: string
  peerIp: string
  peerName: string
  requestMessage: string
  status: 'pending' | 'active' | 'rejected' | 'deleted'
  createdAt: number
  lastActiveAt: number
  unreadByHost: number
  deletedBy?: 'host' | 'peer'
  deletedAt?: number
  peerOnline: boolean
  lastMessage: string
}

interface P2pMessage {
  seq: number
  id: string
  from: 'host' | 'peer'
  kind: 'text' | 'files' | 'system'
  text?: string
  files?: {
    fileId: string
    name: string
    size: number
    mime: string
    direction: 'in' | 'out'
    storedPath?: string
    refPath?: string
  }[]
  createdAt: number
  status: string
}

interface P2pEvent {
  seq: number
  type: string
  data: any
  ts: number
  sessionId: string | null
}

interface Services {
  startServer: (port: number, ip: string) => Promise<{ ok: boolean; error?: string }>
  stopServer: () => void
  setPort: (port: number) => boolean
  getFreePort: (ip: string) => Promise<number>
  getServerStatus: () => ServerConfig
  shouldAutoStart: () => boolean
  regenerateToken: () => string
  addShares: (paths: string[]) => { added: SharedItem[]; skipped: string[] }
  removeShare: (id: string) => boolean
  toggleShare: (id: string, enabled: boolean) => boolean
  getShareList: () => SharedItem[]
  getNetworkInterfaces: () => NetworkInterface[]
  scanDirectory: (dirPath: string) => ScanResult
  getAccessToken: () => string
  getWebUiHtml: () => string
  getDownloadLogs: () => DownloadLog[]
  clearDownloadLogs: () => void
  getWhitelist: () => string[]
  addWhitelist: (ip: string) => boolean
  removeWhitelist: (ip: string) => boolean
  shareText: (text: string) => SharedItem | null
  readFile: (filePath: string) => { type: 'text' | 'base64' | 'too-large'; data: string; mime: string } | null
  getFileMimeType: (filePath: string) => string
  getP2pSummary: () => P2pSummary
  getP2pSessions: () => P2pSession[]
  getP2pMessages: (sessionId: string, after?: number) => P2pMessage[]
  getP2pEvents: (since: number) => { events: P2pEvent[]; since: number }
  respondP2p: (id: string, accept: boolean) => boolean
  sendP2pMessage: (sessionId: string, text: string) => boolean
  sendP2pFiles: (sessionId: string, filePaths: string[]) => boolean
  deleteP2pMessage: (sessionId: string, msgId: string) => boolean
  markP2pRead: (sessionId: string) => boolean
  deleteP2p: (sessionId: string) => boolean
  getP2pFileSavePath: (sessionId: string, fileId: string) => string
  saveP2pFileAs: (sessionId: string, fileId: string, destPath: string) => boolean
}

declare global {
  interface Window {
    services: Services
  }
}

export { }

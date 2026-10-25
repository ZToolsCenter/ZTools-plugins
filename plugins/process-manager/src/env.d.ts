/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

interface ProcessRaw {
  name: string
  pid: number
  path: string
}

interface PortEntry {
  port: number
  pid: number
  protocol: string
}

interface KillResult {
  success: boolean
  error?: string
}

interface FileHolder {
  pid: number
  name: string
  service?: string
  type?: number
  handleCount?: number
  handlePath?: string
  handlePaths?: string[]
}

interface WhoLocksOptions {
  mode?: 'files' | 'handles'
  recurse?: boolean
  all?: boolean
}

interface WhoLocksResult {
  success: boolean
  holders?: FileHolder[]
  error?: string
  mode?: 'files' | 'handles'
  kind?: 'file' | 'directory'
  scanned?: number
  truncated?: boolean
  admin?: boolean
  all?: boolean
  candidates?: number
}

interface PathInfoResult {
  success: boolean
  exists: boolean
  isFile: boolean
  isDirectory: boolean
  path: string
}

interface ProcessInfo {
  pid: number
  name: string
  path: string
  ports: number[]
}

interface Services {
  listProcesses: () => Promise<ProcessRaw[]>
  scanPorts: () => Promise<PortEntry[]>
  pathInfo: (filePath: string) => PathInfoResult
  whoLocks: (filePath: string, options?: WhoLocksOptions) => Promise<WhoLocksResult>
  killProcess: (pid: number) => Promise<KillResult>
}

interface Window {
  services: Services
}

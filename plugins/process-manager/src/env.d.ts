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
}

interface WhoLocksResult {
  success: boolean
  holders?: FileHolder[]
  error?: string
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
  whoLocks: (filePath: string) => Promise<WhoLocksResult>
  killProcess: (pid: number) => Promise<KillResult>
}

interface Window {
  services: Services
}

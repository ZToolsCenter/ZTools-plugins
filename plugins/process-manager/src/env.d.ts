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

interface ProcessInfo {
  pid: number
  name: string
  path: string
  ports: number[]
}

interface Services {
  listProcesses: () => Promise<ProcessRaw[]>
  scanPorts: () => Promise<PortEntry[]>
  killProcess: (pid: number) => Promise<KillResult>
}

interface Window {
  services: Services
}

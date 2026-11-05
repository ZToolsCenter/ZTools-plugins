// 领域类型与共享工具函数（薄封装，不放业务逻辑）

export interface ServiceInfo {
  Name: string
  DisplayName: string
  State: string
  StartMode: string
  PathName: string
  StartName: string
  Description: string
  ProcessId: number
  ExitCode: number
}

export interface CmdResult {
  exitCode: number
  message: string
  output: { op: string; code: number; output: string }[]
}

export interface NssmConfig {
  [key: string]: string | string[] | undefined
}

export interface NssmDetect {
  found: boolean
  path: string
  version: string
}

export type ServiceAction = 'start' | 'stop' | 'restart'

export const START_TYPES = [
  { value: 'auto', label: '自动' },
  { value: 'delayed', label: '自动(延迟启动)' },
  { value: 'manual', label: '手动' },
  { value: 'disabled', label: '禁用' }
]

// Win32_Service.StartMode → 中文
export function startModeText(mode: string): string {
  const m = { Auto: '自动', Manual: '手动', Disabled: '禁用' }[mode]
  return m || mode || '-'
}

// Win32_Service.State → 中文
export function stateText(state: string): string {
  const m: Record<string, string> = {
    Running: '运行中',
    Stopped: '已停止',
    Paused: '已暂停',
    'Start Pending': '启动中',
    'Stop Pending': '停止中',
    'Pause Pending': '暂停中',
    'Continue Pending': '恢复中'
  }
  return m[state] || state || '-'
}

// StartMode 是 Auto 时区分不了延迟启动，展示时以原文为准
export function stateTagType(state: string): 'success' | 'info' | 'warning' | 'danger' {
  if (state === 'Running') return 'success'
  if (state === 'Stopped') return 'info'
  if (state === 'Start Pending' || state === 'Stop Pending' || state === 'Paused') return 'warning'
  return 'danger'
}

// 拉取全量服务列表（preload 内部走 PowerShell CIM）
export async function fetchServices(): Promise<{ ok: boolean; services: ServiceInfo[]; error?: string }> {
  return window.services.listServices()
}

// 启停操作后的状态追踪：目标服务脱离 Pending 中间态（或被卸载/超时）为止。
// 每轮把最新列表回调给调用方，表格实时从「启动中/停止中」过渡到最终状态，无需手动再刷
export async function pollUntilSettled(
  name: string,
  onUpdate: (services: ServiceInfo[]) => void,
  maxSecs = 20
): Promise<void> {
  const deadline = Date.now() + maxSecs * 1000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000))
    const r = await fetchServices()
    if (!r.ok) return
    onUpdate(r.services)
    const s = r.services.find((x) => x.Name === name)
    if (!s || !/pending/i.test(s.State || '')) return
  }
}

// 系统文件/目录选择框（Electron dialog，同步返回；取消返回 ''）
export function pickPath(
  kind: 'file' | 'folder',
  title: string,
  filters?: { name: string; extensions: string[] }[]
): string {
  const properties: ('openFile' | 'openDirectory' | 'createDirectory')[] =
    kind === 'folder' ? ['openDirectory', 'createDirectory'] : ['openFile']
  const res = window.ztools.showOpenDialog({ title, properties, filters })
  return res && res.length ? res[0] : ''
}

// binPath 是否由 nssm 托管
export function isNssmService(s: ServiceInfo): boolean {
  return !!(s.PathName && /nssm\.exe/i.test(s.PathName))
}

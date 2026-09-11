import type { LanDevice, OnlineStatus, ScanStatus } from '../types/discovery'

const ipv4Number = (value: string): number => value.split('.').reduce((total, part) => total * 256 + Number(part), 0)

export function sortDevices(devices: LanDevice[]): LanDevice[] {
  return [...devices].sort((left, right) => ipv4Number(left.ip) - ipv4Number(right.ip))
}

export function statusLabel(status: OnlineStatus): string {
  if (status === 'online') return '在线'
  if (status === 'recently-seen') return '最近出现'
  return '状态未知'
}

export function scanStatusLabel(status: ScanStatus): string {
  if (status === 'completed') return '扫描完成'
  if (status === 'cancelled') return '已取消'
  return '部分完成'
}

export function evidenceLabel(device: LanDevice): string {
  const labels = device.evidence.map((value) => value === 'self' ? '本机' : value === 'icmp' ? 'ICMP 响应' : '邻居表')
  return labels.length ? labels.join(' · ') : '未确认'
}

export function safeUiError(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  if (code === 'SCAN_BUSY') return '另一个网卡正在扫描，请先等待或取消。'
  if (code === 'INVALID_INTERFACE') return '网卡已变化，请刷新后重新选择。'
  if (code === 'INTERFACE_CHANGED') return '所选网卡已发生变化，扫描未启动。请刷新后重试。'
  if (code === 'CONFIRMATION_REQUIRED') return '该网卡可能连接共享、VPN 或虚拟网络，请先完成二次确认。'
  return '操作失败，请检查网络状态后重试。'
}

import { computed, ref } from 'vue'
import type {
  CollectOptions,
  CollectResult,
  DiagnosticField,
  DiagnosticGroup,
  DiagnosticStatus,
  NormalizedReport,
  Recommendation,
  SystemReport,
} from '../types/report'

type UnknownRecord = Record<string, unknown>

const GROUPS = [
  ['overview', '诊断概览', '本次采集的范围、模式与总体状态'],
  ['os', '操作系统', '系统版本、内核与架构信息'],
  ['device', '设备', '设备类型与基础硬件标识'],
  ['cpu', '处理器', '处理器型号、核心与架构'],
  ['memory', '内存', '物理内存容量与当前使用情况'],
  ['storage', '存储', '本地卷容量与可用空间'],
  ['graphics', '图形', '图形处理器与渲染能力'],
  ['displays', '显示器', '当前连接的显示设备与缩放'],
  ['battery', '电池', '供电状态与电量信息'],
  ['runtime', '运行环境', 'ZTools、Electron 与运行时版本'],
  ['performance', '性能快照', '采集时的负载与资源使用快照'],
  ['sources', '信息来源', '各项信息的本地读取来源'],
] as const

const LABELS: Record<string, string> = {
  schemaVersion: '报告结构版本',
  durationMs: '采集耗时',
  status: '状态',
  summary: '结论',
  name: '名称',
  type: '类型',
  version: '版本',
  release: '发行版本',
  build: '构建版本',
  platform: '平台',
  distro: '系统名称',
  arch: '架构',
  architecture: '架构',
  kernel: '内核',
  codename: '系统代号',
  uefi: 'UEFI 启动',
  hostname: '设备名称',
  manufacturer: '制造商',
  model: '型号',
  virtual: '虚拟设备',
  vendor: '厂商',
  brand: '品牌',
  cores: '核心数',
  processors: '处理器数量',
  physicalCores: '物理核心',
  logicalCores: '逻辑核心',
  speed: '主频',
  speedGHz: '主频',
  socket: '封装',
  total: '总计',
  used: '已用',
  free: '可用',
  available: '可用',
  totalBytes: '总容量',
  usedBytes: '已使用',
  availableBytes: '可用容量',
  usedPercent: '使用率',
  swapTotalBytes: '交换空间',
  swapUsedBytes: '交换空间已用',
  swapUsedPercent: '交换空间使用率',
  usage: '使用率',
  usagePercent: '使用率',
  capacity: '容量',
  filesystem: '文件系统',
  devices: '系统卷',
  controllers: '图形控制器',
  mount: '挂载类型',
  sizeBytes: '总容量',
  readOnly: '只读',
  resolution: '分辨率',
  scaleFactor: '缩放比例',
  refreshRate: '刷新率',
  primary: '主显示器',
  charging: '正在充电',
  present: '电池',
  level: '电量',
  percent: '百分比',
  cycleCount: '循环次数',
  timeRemainingMinutes: '预计剩余时间',
  designedCapacity: '设计容量',
  currentCapacity: '当前容量',
  healthPercent: '健康度',
  uptime: '运行时间',
  locale: '语言地区',
  timezone: '时区',
  ztools: 'ZTools',
  electron: 'Electron',
  chromium: 'Chromium',
  node: 'Node.js',
  nodeVersion: 'Node.js',
  electronVersion: 'Electron',
  ztoolsVersion: 'ZTools',
  systemUptimeSeconds: '系统运行时间',
  source: '来源',
  collectedAt: '采集时间',
  generatedAt: '生成时间',
  privacy: '隐私模式',
  fingerprint: '指纹保护',
  loadAverage: '平均负载',
  cpuUsage: 'CPU 使用率',
  cpuLoadPercent: 'CPU 使用率',
  cpuUserPercent: '用户进程 CPU',
  cpuSystemPercent: '系统进程 CPU',
  collectionDurationMs: '采集耗时',
  memoryUsage: '内存使用率',
  memoryUsedPercent: '内存使用率',
  provider: '数据来源',
}

const STATUS_KEYS = new Set(['status', 'state', 'severity', 'available', 'supported'])
const SOURCE_LABELS: Record<string, string> = {
  os: '操作系统',
  device: '设备',
  cpu: '处理器',
  memory: '内存',
  storage: '存储',
  graphics: '图形',
  displays: '显示器',
  battery: '电池',
  runtime: '运行环境',
  performance: '性能快照',
}
const ERROR_LABELS: Record<string, string> = {
  COLLECTOR_TIMEOUT: '采集超时',
  SOURCE_UNAVAILABLE: '信息来源不可用',
  COLLECTOR_FAILED: '采集失败',
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sentence(value: string): string {
  return value.trim().replace(/[。.!！]+$/, '')
}

function labelFor(key: string): string {
  if (LABELS[key]) return LABELS[key]
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/^./, (character) => character.toUpperCase())
}

function statusOf(value: unknown, fallback: DiagnosticStatus = 'neutral'): DiagnosticStatus {
  if (typeof value === 'boolean') return fallback
  if (isRecord(value)) {
    return statusOf(value.status ?? value.state ?? value.severity, fallback)
  }
  if (typeof value !== 'string') return fallback
  const status = value.toLowerCase()
  if (/^(ok|pass|passed|good|healthy|success|complete|completed|normal|available)$/.test(status)) return 'healthy'
  if (/^(warn|warning|degraded|partial|attention|limited)$/.test(status)) return 'warning'
  if (/^(error|failed|failure|critical|fatal|unhealthy)$/.test(status)) return 'error'
  if (/^(unavailable|unsupported|unknown|n\/a|na|not_applicable|not-applicable|missing)$/.test(status)) return 'unavailable'
  if (/^(loading|checking|pending|collecting)$/.test(status)) return 'checking'
  return fallback
}

function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return String(bytes)
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** unit
  return `${value.toLocaleString('zh-CN', { maximumFractionDigits: unit > 2 ? 1 : 0 })} ${units[unit]}`
}

function humanDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return String(seconds)
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  if (days) return `${days} 天 ${hours} 小时`
  if (hours) return `${hours} 小时 ${minutes} 分钟`
  return `${minutes} 分钟`
}

function formatPrimitive(value: unknown, key = ''): string {
  if (value === null || value === undefined || value === '') return '未提供'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'number') {
    if (/(?:bytes|sizeBytes)$/i.test(key) && value >= 1024) return humanBytes(value)
    if (/durationMs$/i.test(key)) return `${Math.round(value)} ms`
    if (/uptimeSeconds$/i.test(key)) return humanDuration(value)
    if (/timeRemainingMinutes$/i.test(key)) return `${Math.round(value)} 分钟`
    if (/speedGHz$/i.test(key)) return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} GHz`
    if (/refreshRate/i.test(key)) return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} Hz`
    if (/percent|usage|level/i.test(key) && value >= 0 && value <= 1) return `${Math.round(value * 100)}%`
    if (/percent|usage|level/i.test(key)) return `${value}%`
    return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  }
  return String(value)
}

function compactObject(value: UnknownRecord): string {
  return Object.entries(value)
    .filter(([key]) => !STATUS_KEYS.has(key))
    .slice(0, 5)
    .map(([key, item]) => `${labelFor(key)} ${formatPrimitive(item, key)}`)
    .join(' · ')
}

function fieldFrom(key: string, value: unknown, index: number): DiagnosticField {
  if (isRecord(value)) {
    const displayValue = value.value ?? value.label ?? value.name ?? value.message
    return {
      key: `${key}-${index}`,
      label: labelFor(key),
      value: displayValue !== undefined ? formatPrimitive(displayValue, key) : compactObject(value) || '已采集',
      status: statusOf(value, displayValue === null ? 'unavailable' : 'neutral'),
      note: typeof value.detail === 'string' ? value.detail : typeof value.note === 'string' ? value.note : undefined,
      rawValue: value,
    }
  }
  return {
    key: `${key}-${index}`,
    label: labelFor(key),
    value: Array.isArray(value)
      ? value.length
        ? value.map((item) => (isRecord(item) ? compactObject(item) : formatPrimitive(item, key))).join('；')
        : '无'
      : formatPrimitive(value, key),
    status: value === null || value === undefined ? 'unavailable' : statusOf(value),
    rawValue: value,
  }
}

function fieldsFrom(value: unknown): DiagnosticField[] {
  if (value === null || value === undefined) {
    return [{ key: 'unavailable', label: '采集结果', value: '此设备未提供该项信息', status: 'unavailable' }]
  }
  if (Array.isArray(value)) {
    if (!value.length) return [{ key: 'empty', label: '采集结果', value: '不适用或未检测到', status: 'unavailable' }]
    return value.map((item, index) => {
      if (isRecord(item)) {
        const label = String(item.label ?? item.name ?? item.model ?? item.device ?? `项目 ${index + 1}`)
        const detail = item.value ?? item.summary ?? item.resolution ?? compactObject(item)
        return {
          key: `item-${index}`,
          label,
          value: formatPrimitive(detail),
          status: statusOf(item),
          note: typeof item.detail === 'string' ? item.detail : undefined,
          rawValue: item,
        }
      }
      return fieldFrom(`项目 ${index + 1}`, item, index)
    })
  }
  if (!isRecord(value)) return [fieldFrom('采集结果', value, 0)]

  const entries = Object.entries(value).filter(([key]) => !['status', 'state', 'severity', 'warnings', 'errors'].includes(key))
  if (!entries.length) {
    return [{ key: 'result', label: '采集结果', value: statusOf(value) === 'healthy' ? '正常' : '未提供', status: statusOf(value, 'unavailable') }]
  }
  return entries.map(([key, item], index) => fieldFrom(key, item, index))
}

function listMessages(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') return item
      if (!isRecord(item)) return ''
      const code = typeof item.code === 'string' ? item.code : ''
      const source = typeof item.source === 'string' ? item.source : ''
      const message = ERROR_LABELS[code] ?? String(item.message ?? item.detail ?? code)
      const sourceLabel = SOURCE_LABELS[source] ?? source
      return sourceLabel && message ? `${sourceLabel}：${message}` : message
    })
    .filter(Boolean)
}

function noticesIn(value: unknown, kind: 'warnings' | 'errors'): string[] {
  if (!isRecord(value) || !Array.isArray(value[kind])) return []
  return listMessages(value[kind])
}

function groupStatus(value: unknown, fields: DiagnosticField[]): DiagnosticStatus {
  const explicit = statusOf(value)
  if (explicit !== 'neutral') return explicit
  if (fields.some((field) => field.status === 'error')) return 'error'
  if (fields.some((field) => field.status === 'warning')) return 'warning'
  if (fields.every((field) => field.status === 'unavailable')) return 'unavailable'
  return 'healthy'
}

function recommendationsFrom(errors: string[], warnings: string[], groups: DiagnosticGroup[]): Recommendation[] {
  const recommendations: Recommendation[] = []
  errors.slice(0, 1).forEach((message, index) => {
    recommendations.push({
      id: `error-${index}`,
      title: '有信息未能完成采集',
      detail: `${sentence(message)}。可重新检查；若问题持续，请将安全报告交给技术支持。`,
      status: 'error',
    })
  })
  warnings.slice(0, 2).forEach((message, index) => {
    recommendations.push({
      id: `warning-${index}`,
      title: '建议关注一项诊断提示',
      detail: `${sentence(message)}。这不一定影响当前使用，但值得在排障时核对。`,
      status: 'warning',
    })
  })

  const unavailable = groups.filter((group) => group.status === 'unavailable')
  if (unavailable.length && recommendations.length < 3) {
    recommendations.push({
      id: 'unavailable',
      title: '部分项目在此设备上不适用',
      detail: `${unavailable.map((group) => group.title).slice(0, 3).join('、')}未返回数据，报告已保留“不适用”标记。`,
      status: 'neutral',
    })
  }
  if (!recommendations.length) {
    recommendations.push({
      id: 'all-clear',
      title: '未发现明显异常',
      detail: '当前软硬件信息采集完整，可直接复制或导出这份安全报告用于排障。',
      status: 'neutral',
    })
  }
  return recommendations.slice(0, 3)
}

export function normalizeReport(raw: SystemReport): NormalizedReport {
  const warnings = [...listMessages(raw.warnings), ...GROUPS.flatMap(([key]) => noticesIn(raw[key], 'warnings'))]
  const errors = [...listMessages(raw.errors), ...GROUPS.flatMap(([key]) => noticesIn(raw[key], 'errors'))]
  const groups = GROUPS.map(([id, title, description]) => {
    const value = raw[id]
    const fields = fieldsFrom(value)
    return { id, title, description, fields, status: groupStatus(value, fields) }
  })

  let overallStatus = statusOf(raw.status)
  if (overallStatus === 'neutral') {
    overallStatus = errors.length ? 'error' : warnings.length ? 'warning' : 'healthy'
  }

  const overview = isRecord(raw.overview) ? raw.overview : {}
  return {
    generatedAt: String(overview.generatedAt ?? raw.generatedAt ?? raw.collectedAt ?? new Date().toISOString()),
    overallStatus,
    groups,
    recommendations: recommendationsFrom(errors, warnings, groups),
    warnings,
    errors,
    raw,
  }
}

function mockReport(): SystemReport {
  const totalMemory = 16 * 1024 ** 3
  const usedMemory = 9.7 * 1024 ** 3
  return {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    status: 'warning',
    overview: { status: 'warning', privacy: 'safe', fingerprint: 'minimal', duration: '428 ms' },
    os: { name: 'macOS', version: '15.6', build: '24G84', arch: 'arm64', locale: 'zh-CN', timezone: 'Asia/Shanghai' },
    device: { type: null, manufacturer: null, model: null, hostname: null },
    cpu: { model: 'Apple M3 Pro', physicalCores: 6, logicalCores: 12, architecture: 'arm64' },
    memory: { totalBytes: totalMemory, usedBytes: usedMemory, availableBytes: totalMemory - usedMemory, usagePercent: 61 },
    storage: [
      { name: '系统卷', filesystem: 'APFS', sizeBytes: 494 * 1024 ** 3, availableBytes: 126 * 1024 ** 3, status: 'healthy' },
    ],
    graphics: [{ name: 'Apple M3 Pro', type: '集成图形处理器' }],
    displays: [{ name: '内建显示器', resolution: '3024 × 1964', scaleFactor: '2×', primary: true }],
    battery: { status: 'healthy', level: 82, charging: false, source: '电池供电' },
    runtime: { ztools: '5.2.1', electron: '34.3.0', chromium: '132.0.6834.210', node: '20.18.1' },
    performance: { status: 'warning', cpuUsage: 14, memoryUsage: 61, loadAverage: '2.1 / 1.9 / 1.7' },
    sources: { system: 'Node.js os', displays: 'ZTools API', runtime: 'Electron process.versions' },
    warnings: ['性能快照仅代表采集时刻，CPU 使用率短时偏高'],
    errors: [],
  }
}

export function useSystemReport() {
  const report = ref<NormalizedReport | null>(null)
  const loading = ref(false)
  const error = ref('')
  const stale = ref(false)
  const usedMock = ref(false)

  async function collect(options: CollectOptions = { privacy: 'safe' }): Promise<CollectResult> {
    loading.value = true
    error.value = ''
    try {
      let raw: SystemReport
      if (window.systemReport?.collect) {
        raw = await window.systemReport.collect(options)
      } else {
        usedMock.value = true
        await new Promise((resolve) => window.setTimeout(resolve, 560))
        raw = mockReport()
      }
      const normalized = normalizeReport(raw)
      report.value = normalized
      stale.value = false
      return { ok: true, report: normalized }
    } catch {
      error.value = '系统信息采集失败，请稍后重新检查。'
      stale.value = report.value !== null
      return { ok: false, error: error.value, stale: stale.value }
    } finally {
      loading.value = false
    }
  }

  return {
    report,
    loading,
    error,
    stale,
    usedMock,
    hasReport: computed(() => report.value !== null),
    collect,
  }
}

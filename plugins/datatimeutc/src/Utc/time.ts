// 时间校准模块：NTP 校准 + 真实时间获取
// 校准前/失败时 offset=0，getNow() 退化为本地系统时间（不阻塞显示）

const OFFSET_KEY = 'utc-ntp-offset'

let offset = 0
let synced = false

// 从 dbStorage 加载上次校准的 offset（悬浮窗等无 services 的进程用此路径）
function loadOffset() {
  try {
    const stored = window.ztools.dbStorage.getItem(OFFSET_KEY)
    if (typeof stored === 'number' && isFinite(stored)) offset = stored
  } catch (_e) {
    // ignore
  }
}

/** 获取真实时间戳（毫秒）= 本地 Date.now() + NTP offset */
export function getNow(): number {
  return Date.now() + offset
}

/** 获取当前 NTP 偏移量（毫秒），offset = 服务器时间 - 本地时间 */
export function getOffset(): number {
  return offset
}

/** 是否已成功 NTP 校准 */
export function isSynced(): boolean {
  return synced
}

export interface SyncResult {
  ok: boolean
  server?: string
  offset?: number
  rtt?: number
}

/**
 * 启动时调用：从 NTP 服务器校准时间
 * - 主插件窗口（有 services.syncNtpTime）：发 NTP 包校准，写 dbStorage
 * - 悬浮窗（无 services）：跳过校准，读 dbStorage 的 offset
 * 失败则保持 offset=0（用本地系统时间），不影响显示
 */
export async function syncTime(): Promise<SyncResult> {
  if (!window.services || typeof window.services.syncNtpTime !== 'function') {
    loadOffset()
    return { ok: false }
  }
  try {
    const result = await window.services.syncNtpTime()
    if (result && typeof result.offset === 'number') {
      offset = result.offset
      synced = true
      try { window.ztools.dbStorage.setItem(OFFSET_KEY, offset) } catch (_e) {}
      return { ok: true, server: result.server, offset: result.offset, rtt: result.rtt }
    }
  } catch (_e) {
    // ignore
  }
  loadOffset()
  return { ok: false }
}

// ===== 周期校准调度 =====
// 打开插件期间持续定时校准；界面可通过 onSyncTick 注册回调实时刷新 UI
type SyncTickCallback = (result: SyncResult) => void
const tickCallbacks = new Set<SyncTickCallback>()
let syncTimer: number | undefined
let syncing = false

/** 注册周期校准回调（每次校准完成触发，无论成败）。返回解绑函数 */
export function onSyncTick(cb: SyncTickCallback): () => void {
  tickCallbacks.add(cb)
  return () => tickCallbacks.delete(cb)
}

async function runSyncTick() {
  if (syncing) return
  syncing = true
  try {
    const result = await syncTime()
    tickCallbacks.forEach(cb => {
      try { cb(result) } catch (_e) { /* 单个回调异常不影响其他 */ }
    })
  } finally {
    syncing = false
  }
}

/**
 * 启动周期校准（主插件窗口调用；悬浮窗无 services 会自动退化为仅读存储）
 * @param intervalMs 校准间隔，默认 5 分钟
 */
export function startPeriodicSync(intervalMs = 5 * 60 * 1000): void {
  stopPeriodicSync()
  // 立即校准一次
  runSyncTick()
  syncTimer = window.setInterval(runSyncTick, intervalMs)
}

/** 停止周期校准 */
export function stopPeriodicSync(): void {
  if (syncTimer !== undefined) {
    window.clearInterval(syncTimer)
    syncTimer = undefined
  }
}

// 模块加载时尝试读 dbStorage 的 offset（快速恢复上次校准值）
loadOffset()

import type { PlaybackRequest, Source } from './types'

export interface HistoryEntry {
  /** 记录主键：剧集用 v，直链用 URL。 */
  key: string
  kind: PlaybackRequest['kind']
  title: string
  /** 剧集标识，仅 catalog 记录有。 */
  v?: string
  /** 看到第几集的剧集标识，仅 catalog 记录有。 */
  episodeV?: string
  episodeNumber?: number
  episodeLine?: number
  /** 直链记录保存原始地址，便于再次播放。 */
  source?: Source
  /** 播放位置，单位秒。 */
  position: number
  /** 视频总时长，单位秒。 */
  duration: number
  cover?: string | null
  /** 最近播放时间，Unix 毫秒。 */
  updatedAt: number
}

const STORAGE_KEY = 'playback-history'
const MAX_ENTRIES = 60
// 片头太靠前不记录，片尾余量内算作看完。
const MIN_POSITION = 5
const FINISH_MARGIN = 15

/**
 * 进程内的记录缓存。
 * 宿主的 dbStorage 走的是同步 IPC（sendSync），每次读都要阻塞等待主进程，
 * 进度上报时频繁读会明显卡顿，所以读到的结果缓存起来。
 */
let cache: HistoryEntry[] | null = null

/**
 * 读取本地播放记录。
 * 优先使用 ZTools 的键值存储；网页预览没有宿主，退回 localStorage。
 * @param force 为 true 时忽略缓存重新读取，用于跨窗口同步。
 * @returns 按最近播放时间倒序排列的记录。
 */
export function readHistory(force = false): HistoryEntry[] {
  if (!force && cache) return cache
  try {
    const raw = typeof ztools !== 'undefined'
      ? ztools.dbStorage.getItem<unknown>(STORAGE_KEY)
      : JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    cache = Array.isArray(raw) ? raw.filter(isEntry).sort((a, b) => b.updatedAt - a.updatedAt) : []
  } catch {
    cache = []
  }
  return cache
}

function isEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<HistoryEntry>
  return typeof entry.key === 'string' && typeof entry.title === 'string'
    && typeof entry.updatedAt === 'number' && (entry.kind === 'catalog' || entry.kind === 'direct')
}

function writeHistory(entries: HistoryEntry[]) {
  const sorted = entries.slice(0, MAX_ENTRIES)
  // 先更新缓存：即使落盘失败，本次会话里读到的也是最新进度。
  cache = sorted
  try {
    if (typeof ztools !== 'undefined') ztools.dbStorage.setItem(STORAGE_KEY, sorted)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted))
  } catch {
    // 存储不可用时不影响播放，只是这次进度不保留。
  }
}

/**
 * 记录一次播放。同一个剧集只保留一条，按最近观看重新排序。
 * @param request 本次播放请求。
 * @param position 当前播放位置（秒）。
 * @param duration 视频总时长（秒）。
 * @param extra 额外的展示信息，如封面和集号。
 */
export function saveHistory(
  request: PlaybackRequest,
  position: number,
  duration: number,
  extra: { cover?: string | null; episodeV?: string; episodeNumber?: number; episodeLine?: number } = {},
) {
  const key = request.kind === 'catalog' ? `catalog:${request.v}` : `direct:${request.source.url}`
  // 只读一次：这条记录旧值和其余记录都从同一份快照里取。
  const current = readHistory()
  const previous = current.find(entry => entry.key === key)
  const valid = Number.isFinite(position) && position >= MIN_POSITION
  // 片尾留白按比例收窄，避免短片刚开播就被判定为看完。
  const finished = duration > 0 && position >= duration - Math.min(FINISH_MARGIN, duration * 0.1)
  const entry: HistoryEntry = {
    key,
    kind: request.kind,
    title: request.title || previous?.title || '影视播放',
    v: request.kind === 'catalog' ? request.v : undefined,
    // 这里必须存单集的 v，而不是整部剧的 v，否则续播找不到对应集。
    episodeV: extra.episodeV ?? previous?.episodeV,
    episodeNumber: extra.episodeNumber ?? previous?.episodeNumber,
    episodeLine: extra.episodeLine ?? previous?.episodeLine,
    source: request.kind === 'direct' ? request.source : undefined,
    // 看完了就归零，下次从头播放。
    position: finished ? 0 : Math.max(0, Math.floor(valid ? position : previous?.position ?? 0)),
    duration: Number.isFinite(duration) ? Math.floor(duration) : previous?.duration ?? 0,
    cover: extra.cover ?? previous?.cover ?? null,
    updatedAt: Date.now(),
  }
  // 新记录一定是最新的，放在最前面即可，顺序已正确。
  writeHistory([entry, ...current.filter(item => item.key !== key)])
}

/**
 * 删除一条播放记录，用于用户主动清理。
 * @param key 记录主键。
 */
export function removeHistory(key: string) {
  writeHistory(readHistory().filter(entry => entry.key !== key))
}

/**
 * 清空全部播放记录。
 */
export function clearHistory() {
  writeHistory([])
}

/**
 * 把秒数格式化成播放器风格的时长。
 * @param seconds 秒数。
 * @returns 例如 12:34 或 1:02:03；无有效值时为 00:00。
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/**
 * 计算观看进度百分比，用于进度条和「继续观看」文案。
 * @param entry 播放记录。
 * @returns 0–100 的整数，未知时长时为 0。
 */
export function progressPercent(entry: HistoryEntry): number {
  if (!entry.duration || entry.position <= 0) return 0
  return Math.min(100, Math.round((entry.position / entry.duration) * 100))
}

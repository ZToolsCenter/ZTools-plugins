/**
 * UI 侧状态(store):订阅 preload 服务事件,聚合为响应式数据。
 * 刻意不引 Pinia —— 单页面、单数据源,reactive 足够且少一层构建依赖。
 *
 * v1.1:各设备状态升级为 ProgressAnchor(progress.ts,含接收时刻与断线墓碑字段),
 * 进度推算/降级判定在 App.vue 用纯函数完成;断线后保留最后一首歌的信息(标灰)。
 */
import { reactive, computed, ref, watch } from 'vue'
import type { LyricProvider, PickerCandidate } from './lyric/types'
import type { ProtocolStateMessage, ServerEvent, LanSnapshot } from './env.d'
import type { ProgressAnchor } from './progress'
import { parseLrc } from './lyric/parse-lrc'
import type { LyricsLine } from './lyric/types'
import { LyricsManager, type TrackForLyrics } from './lyric/lyrics-manager'
import type { LyricResult } from './lyric/types'
import { OffsetStore, type OffsetScope } from './lyric/offsets'
import { createMemoryStorage, type KVStorage } from './lyric/cache'
import { CoverManager, type CoverEntry } from './lyric/cover'
import { lrclibProvider } from './lyric/providers/lrclib'
import { neteaseProvider } from './lyric/providers/netease'
import { kugouProvider } from './lyric/providers/kugou'
import { lrcmuxProvider } from './lyric/providers/lrcmux'
import { betterLyricsProvider } from './lyric/providers/betterlyrics'
import { convertTextsIfTraditional } from './lyric/t2s'
import { loadSettings, settings } from './settings'

export interface ArtworkEntry {
  mime: string
  dataBase64: string
}

interface UiState {
  snapshot: LanSnapshot | null
  /** 各设备最近一次协议 state/snapshot 的锚点(进度插值 + 存活判定),见 progress.ts */
  anchorsByDevice: Record<string, ProgressAnchor>
  /** trackId → 封面 */
  artworks: Record<string, ArtworkEntry>
  /** trackId → API 兜底封面(手机未推送时经 CoverManager 拉取;展示优先级低于手机封面) */
  covers: Record<string, CoverEntry>
  serverError: string
  /** 桌面歌词悬浮窗创建失败原因(空 = 正常) */
  desktopError: string
  started: boolean
}

export const ui = reactive<UiState>({
  snapshot: null,
  anchorsByDevice: {},
  artworks: {},
  covers: {},
  serverError: '',
  desktopError: '',
  started: false
})

/** 活跃设备当前锚点(切设备/切歌自动跟随;断线宽限期内服务端仍保留该设备) */
export const activeAnchor = computed<ProgressAnchor | null>(() => {
  const id = ui.snapshot?.activeDeviceId
  return id ? ui.anchorsByDevice[id] ?? null : null
})

/**
 * 断线且宽限期结束(服务端清理墓碑,activeDeviceId 变空)后,继续展示最后一首歌。
 * 仅在 activeAnchor 为空时兜底,UI 据此标灰。
 */
export const lastActiveAnchor = ref<ProgressAnchor | null>(null)

/** 展示用锚点:活跃优先,断线兜底其次 */
export const displayAnchor = computed<ProgressAnchor | null>(
  () => activeAnchor.value ?? lastActiveAnchor.value
)

/** 活跃设备的 state 消息(歌词/元数据沿用) */
export const activeState = computed<ProtocolStateMessage | null>(() => activeAnchor.value?.state ?? null)

/** 活跃设备当前封面(按 trackId 关联;requestArtwork 可补拉) */
export const activeArtwork = computed<ArtworkEntry | null>(() => {
  const state = displayAnchor.value?.state
  const services = window.services
  if (!state) return null
  return (
    ui.artworks[state.track.id] ??
    (services ? services.lanLyrics.getArtwork(state.track.id) : null)
  )
})

/**
 * 展示用封面 URL:手机推送封面(data URL)优先,API 兜底封面其次,都没有为空串。
 * 断线宽限期沿用最后一首歌的封面(displayAnchor 语义与歌词一致)。
 */
export const activeCoverUrl = computed<string>(() => {
  const state = displayAnchor.value?.state
  if (!state) return ''
  const phone = activeArtwork.value
  if (phone) return `data:${phone.mime};base64,${phone.dataBase64}`
  return ui.covers[state.track.id]?.url ?? ''
})

// ==================== 歌词状态 ====================

/** 歌词展示状态;translationMap:timeMs → 翻译文本(与主歌词时间戳对齐) */
export const lyric = reactive({
  trackId: '',
  loading: false,
  source: '',
  lines: [] as LyricsLine[],
  translationMap: new Map<number, string>(),
  plain: '',
  notFound: false,
  /** 当前曲目是否被用户固定(userPinned,优先于自动匹配) */
  pinned: false
})

/** "换一个"候选面板状态(任务 3.1) */
export const candidatePicker = reactive({
  open: false,
  loading: false,
  items: [] as PickerCandidate[],
  error: '',
  /** 当前固定的候选(source+id,面板高亮"当前"用);null = 未固定或历史固定无候选标识 */
  current: null as { source: string; id: string } | null
})

/** 候选面板顶部的"正在播放"参考信息(标题/歌手/时长);无活跃设备返回 null */
export const nowPlayingInfo = computed(() => {
  const state = activeState.value
  if (!state?.track.title) return null
  return {
    title: state.track.title,
    artist: state.track.artist ?? '',
    durationMs: state.track.durationMs ?? 0
  }
})

/** 当前生效的手动偏移(毫秒):正值 = 歌词提前显示 */
export const userOffset = ref(0)

function storageAdapter(): KVStorage {
  try {
    if (window.ztools?.dbStorage) return window.ztools.dbStorage
  } catch (_) { /* 无 ztools 环境(纯浏览器调试)退化为内存 */ }
  return createMemoryStorage()
}

/** dev 浏览器预览(dev-mock.ts)注入的本地歌词源;ZTools 内不存在 */
const devProvider = (window as any)?.__devLyricProvider as LyricProvider | undefined

// 路由由 LyricsManager 内部完成(查询以 CJK 为主时网易云优先,否则保持此声明顺序)。
// 来源开关与并行模式接 settings,设置页可实时切换。
const lyricManager = new LyricsManager({
  storage: storageAdapter(),
  providers: devProvider
    ? [devProvider, lrclibProvider, neteaseProvider, kugouProvider, lrcmuxProvider, betterLyricsProvider]
    : [lrclibProvider, neteaseProvider, kugouProvider, lrcmuxProvider, betterLyricsProvider],
  parallel: () => settings.parallelProviders,
  isProviderEnabled: (name) => {
    if (name === lrclibProvider.name) return settings.providerLrclib
    if (name === neteaseProvider.name) return settings.providerNetease
    if (name === kugouProvider.name) return settings.providerKugou
    if (name === lrcmuxProvider.name) return settings.providerLrcmux
    if (name === betterLyricsProvider.name) return settings.providerBetterLyrics
    return true
  }
})
export const offsetStore = new OffsetStore(storageAdapter())

// ==================== 封面 API 兜底 ====================

/**
 * 封面兜底编排(与歌词链路相互独立):手机封面(artwork 事件/推送)永远优先,
 * 只在手机未推送时按曲目元数据从封面 API 取 URL。时序:
 * - 切歌后等 COVER_GRACE_MS 宽限期(封面在手机后台线程准备,推送紧随 state 到达),
 *   期间推送到达则取消兜底;手机明确 artwork.available=false 时立即取;
 * - 命中/负缓存均持久化(30d/24h),同一首歌换播放器不重复请求。
 */
const coverManager = new CoverManager({ storage: storageAdapter() })
const COVER_GRACE_MS = 3_000
let coverTimer: ReturnType<typeof setTimeout> | null = null

function hasPhoneArtwork(trackId: string): boolean {
  if (ui.artworks[trackId]) return true
  try {
    return !!window.services?.lanLyrics.getArtwork(trackId)
  } catch (_) {
    return false
  }
}

function cancelPendingCoverFetch(): void {
  if (coverTimer) {
    clearTimeout(coverTimer)
    coverTimer = null
  }
}

/** 切歌后调度封面兜底(宽限期防与手机推送重复);开关在真正发请求时判定 */
function scheduleCoverFetch(state: ProtocolStateMessage): void {
  cancelPendingCoverFetch()
  if (hasPhoneArtwork(state.track.id)) return
  const delay = state.artwork?.available === false ? 0 : COVER_GRACE_MS
  coverTimer = setTimeout(() => {
    coverTimer = null
    void fetchCoverFor(state)
  }, delay)
}

/** 拉取 API 兜底封面:期间手机封面到达则让位(结果丢弃,展示优先级由 activeCoverUrl 把关) */
async function fetchCoverFor(state: ProtocolStateMessage, opts: { ignoreNegative?: boolean } = {}): Promise<void> {
  if (!settings.coverFromApi) return
  const trackId = state.track.id
  if (hasPhoneArtwork(trackId)) return
  const entry = await coverManager.fetchForTrack(
    {
      title: state.track.title ?? '',
      artist: state.track.artist ?? '',
      album: state.track.album ?? ''
    },
    opts
  )
  if (!entry || hasPhoneArtwork(trackId)) return
  ui.covers[trackId] = entry
}

/** 手动重试封面(占位符点击):手机重发 + 立即走一次 API 兜底(绕过负缓存) */
export function retryCover(): void {
  const state = activeState.value
  if (!state) return
  cancelPendingCoverFetch()
  void fetchCoverFor(state, { ignoreNegative: true })
}

/** API 兜底封面展示时加载失败(探测时有效、展示时 404):逐出缓存,回到占位符 */
export function markCoverBroken(): void {
  const state = displayAnchor.value?.state
  if (!state) return
  const entry = ui.covers[state.track.id]
  if (!entry) return
  coverManager.markBroken(
    {
      title: state.track.title ?? '',
      artist: state.track.artist ?? '',
      album: state.track.album ?? ''
    },
    entry.url
  )
  delete ui.covers[state.track.id]
}

/** 当前偏移的记录维度与本曲/此应用的原始记录值(UI 展示与按钮作用目标) */
export const offsetUi = reactive({
  scope: 'track' as OffsetScope,
  trackValue: 0,
  appValue: 0
})

let fetchSeq = 0

/**
 * 拉取并解析一首歌的歌词;切歌并发时旧的在途结果按序号丢弃。
 */
async function fetchLyrics(state: ProtocolStateMessage) {
  const trackId = state.track.id
  const appPackage = state.app?.package ?? ''
  lyric.trackId = trackId
  lyric.loading = true
  lyric.lines = []
  lyric.translationMap = new Map()
  lyric.plain = ''
  lyric.source = ''
  lyric.notFound = false
  lyric.pinned = false

  // 封面兜底:手机未推送时按宽限期调度 API 取图(见 scheduleCoverFetch)
  scheduleCoverFetch(state)

  // 偏移:track 记录优先,否则 app 记录
  userOffset.value = offsetStore.effective(trackId, appPackage)
  offsetUi.trackValue = offsetStore.get('track', trackId)
  offsetUi.appValue = offsetStore.get('app', appPackage)
  offsetUi.scope = offsetUi.trackValue !== 0 ? 'track' : 'track'

  lyric.pinned = lyricManager.isPinned({ id: trackId, title: state.track.title ?? '', artist: state.track.artist ?? '', album: state.track.album ?? '', durationMs: state.track.durationMs ?? 0 })

  const seq = ++fetchSeq
  const result = await lyricManager.fetchForTrack(
    {
      id: trackId,
      title: state.track.title ?? '',
      artist: state.track.artist ?? '',
      album: state.track.album ?? '',
      durationMs: state.track.durationMs ?? 0
    },
    appPackage
  )
  if (seq !== fetchSeq) return // 期间已切歌
  if (!result) {
    lyric.loading = false
    lyric.notFound = true
    lastLyricResult = null // 未命中时清空原始结果,避免开关切换重绘出上一首歌词
    return
  }
  applyLyricResult(result)
}

/** 当前活跃 state → TrackForLyrics(面板动作与展示共用,避免字段散落) */
function trackForState(state: ProtocolStateMessage): TrackForLyrics {
  return {
    id: state.track.id,
    title: state.track.title ?? '',
    artist: state.track.artist ?? '',
    album: state.track.album ?? '',
    durationMs: state.track.durationMs ?? 0
  }
}

let pickerSeq = 0

/** 打开候选面板并拉取各来源候选(受 RequestSupervisor 管理,切歌自动取消) */
export function openCandidatePicker(): void {
  const state = activeState.value
  if (!state) return
  candidatePicker.open = true
  candidatePicker.loading = true
  candidatePicker.error = ''
  candidatePicker.items = []
  candidatePicker.current = lyricManager.pinnedCandidate(trackForState(state))
  const seq = ++pickerSeq
  lyricManager
    .fetchCandidates(trackForState(state))
    .then((items) => {
      if (seq !== pickerSeq || !candidatePicker.open) return
      candidatePicker.loading = false
      candidatePicker.items = items
      if (items.length === 0) candidatePicker.error = '没有找到候选,换个关键词试试'
    })
    .catch(() => {
      if (seq !== pickerSeq) return
      candidatePicker.loading = false
      candidatePicker.error = '候选获取失败'
    })
}

/** 关闭候选面板(取消在途候选请求) */
export function closeCandidatePicker(): void {
  candidatePicker.open = false
  pickerSeq++
  lyricManager.cancelAll()
}

/**
 * 固定用户选择的候选:立即切换展示 + 写缓存(userPinned)。
 * 失败时提示,不打断面板。
 */
export async function chooseCandidate(item: PickerCandidate): Promise<void> {
  const state = activeState.value
  if (!state) return
  candidatePicker.loading = true
  candidatePicker.error = ''
  const result = await lyricManager.pinLyrics(trackForState(state), item)
  candidatePicker.loading = false
  if (!result) {
    candidatePicker.error = '该候选获取歌词失败,换一个试试'
    return
  }
  candidatePicker.open = false
  applyLyricResult(result)
  lyric.pinned = true
  // 无 id 候选(LRCLIB 自带内容)无从按 id 标注,面板清空高亮
  candidatePicker.current = item.id ? { source: item.source, id: item.id } : null
}

/** 恢复自动匹配:清除固定并按自动路径重取(命中缓存则直接展示) */
export function unpinCurrent(): void {
  const state = activeState.value
  if (!state) return
  void lyricManager.unpinLyrics(trackForState(state))
  lyric.pinned = false
  candidatePicker.current = null
  void fetchLyrics(state)
}

/**
 * 最近一次成功写入展示状态的原始歌词结果(繁→简开关切换时直接重绘,不重新请求来源)。
 * 仅在命中歌词时更新;未命中/切歌中止不更新,防止开关切换复活上一首歌词。
 */
let lastLyricResult: LyricResult | null = null

/**
 * 把 LyricResult 写入展示状态(parse + 翻译映射)。
 * 开启繁→简转换时,主歌词/翻译/纯文本各自成批判定繁体并逐行替换为简体;
 * 判定非繁体的批次沿用原文。转换是同步查表,无需 loading/竞态防护。
 */
function applyLyricResult(result: LyricResult): void {
  lastLyricResult = result
  const t2s = settings.traditionalToSimplified
  lyric.loading = false
  lyric.source = result.source
  lyric.notFound = false
  lyric.lines = []
  lyric.plain = ''
  lyric.translationMap = new Map()
  if (result.synced) {
    lyric.lines = applyT2sToLines(parseLrc(result.synced).lines, t2s)
    if (result.translation) {
      const translationLines = parseLrc(result.translation).lines
      const converted = t2s ? convertTextsIfTraditional(translationLines.map((l) => l.text)) : null
      lyric.translationMap = new Map(
        translationLines.map((line, i) => [line.timeMs, converted ? converted[i] : line.text])
      )
    }
  } else if (result.plain) {
    const parts = result.plain.split('\n')
    const converted = t2s ? convertTextsIfTraditional(parts) : null
    lyric.plain = (converted ?? parts).join('\n')
  } else {
    lyric.notFound = true
  }
}

/**
 * 对歌词行应用繁→简显示转换(逐行替换文本,时间戳不变)。
 * @param lines 解析后的歌词行
 * @param enabled 是否启用转换(关闭时原样返回,不做整段繁体判定)
 */
function applyT2sToLines(lines: LyricsLine[], enabled: boolean): LyricsLine[] {
  if (!enabled || lines.length === 0) return lines
  const converted = convertTextsIfTraditional(lines.map((l) => l.text))
  if (!converted) return lines
  return lines.map((line, i) => ({ ...line, text: converted[i] }))
}

// 繁→简开关切换:用缓存的原始结果同步重绘,立即生效且不触发网络请求
watch(
  () => settings.traditionalToSimplified,
  () => {
    if (lastLyricResult) applyLyricResult(lastLyricResult)
  }
)

/**
 * 应用手动偏移:按 offsetUi.scope 写入本曲或此应用维度,并刷新当前生效值。
 * @param deltaMs 正值 = 歌词提前
 */
export function applyOffset(deltaMs: number) {
  const state = activeState.value
  if (!state) return
  const trackId = state.track.id
  const appPackage = state.app?.package ?? ''
  if (deltaMs === 0) {
    offsetStore.resetTrack(trackId)
  } else {
    offsetStore.add(offsetUi.scope, offsetUi.scope === 'track' ? trackId : appPackage, deltaMs)
  }
  userOffset.value = offsetStore.effective(trackId, appPackage)
  offsetUi.trackValue = offsetStore.get('track', trackId)
  offsetUi.appValue = offsetStore.get('app', appPackage)
}

function handleEvent(event: ServerEvent) {
  switch (event.kind) {
    case 'snapshot':
      ui.snapshot = window.services.lanLyrics.getSnapshot()
      break
    case 'state': {
      // 先刷新设备列表,再写锚点,保证 activeDeviceId 比对用的是新快照
      ui.snapshot = window.services.lanLyrics.getSnapshot()
      if (event.deviceId && event.state) {
        // 全量覆盖锚点(协议 §2.8);snapshot/state 载荷同构,断线标志一并复位
        ui.anchorsByDevice[event.deviceId] = {
          state: event.state,
          recvAt: event.meta?.recvAt ?? Date.now(),
          lastAppMessageAt: event.meta?.lastAppMessageAt ?? Date.now(),
          disconnectedAt: null
        }
        if (event.deviceId === ui.snapshot?.activeDeviceId) {
          lastActiveAnchor.value = ui.anchorsByDevice[event.deviceId]
        }
      }
      // 只有活跃设备的曲目变化才触发歌词拉取
      if (
        event.deviceId &&
        event.deviceId === ui.snapshot?.activeDeviceId &&
        event.state &&
        event.state.track.id !== lyric.trackId
      ) {
        void fetchLyrics(event.state)
      }
      break
    }
    case 'link':
      // 链路断开:保留锚点进入宽限期(progress.ts 按墙钟降级),不清空展示
      if (event.deviceId && ui.anchorsByDevice[event.deviceId]) {
        ui.anchorsByDevice[event.deviceId].disconnectedAt = event.disconnectedAt ?? Date.now()
      }
      ui.snapshot = window.services.lanLyrics.getSnapshot()
      break
    case 'artwork':
      if (event.trackId && event.artwork) {
        ui.artworks[event.trackId] = event.artwork
        // 手机封面已到:取消在等的 API 兜底(展示优先级由 activeCoverUrl 把关)
        cancelPendingCoverFetch()
      }
      break
    case 'server-error':
      ui.serverError = event.message || '服务启动失败'
      break
  }
}

/**
 * 初始化:订阅事件 + 读取持久化配置启动服务(无配置则生成 Token 后启动)。
 * @returns 清理函数(组件卸载时取消订阅)
 */
export async function initStore(): Promise<() => void> {
  const services = window.services
  const unsubscribe = services.lanLyrics.subscribe(handleEvent)
  const saved = services.lanLyrics.getSnapshot()
  if (!saved.token) {
    // 兜底:正常情况下 preload 已持久化过 Token
    services.lanLyrics.saveConfig({ token: services.lanLyrics.generateToken() })
  }
  const result = await services.lanLyrics.start()
  ui.started = result.ok
  ui.serverError = result.ok ? '' : result.error || '启动失败'
  ui.snapshot = services.lanLyrics.getSnapshot()
  loadSettings()
  // 插件后启动(ZTools 重启后服务先于 UI 就绪)时,UI 需要主动补一次歌词
  const state = activeState.value
  if (state && state.track.id !== lyric.trackId) void fetchLyrics(state)
  // UI 重载(重新进入插件)而手机已连接且暂停时,可能长时间没有新事件,
  // 主动请求一次全量快照补齐显示(旧版手机以 state 应答,同样有效)
  services.lanLyrics.requestState()
  return unsubscribe
}

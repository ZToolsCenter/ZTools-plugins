/**
 * 纯浏览器预览用的开发态 mock:DEV 且 window.services 不存在(脱离 ZTools 直开 dev 页)时
 * 注入一台"常连设备"与本地歌词源,让 UI 完整可看、歌词可滚。
 * ZTools 内(preload 已提供 services)与生产构建不受任何影响。
 */
import type { ProtocolStateMessage, ServerEvent } from './env.d'
import type { LyricProvider, ProviderOutcome } from './lyric/types'

const MOCK_LRC = [
  '[offset:0]',
  '[00:01.00]霓虹落进车窗 漫过指尖微凉',
  '[00:08.50]电台里那首歌 正唱到一半',
  '[00:16.00]你侧过脸说 城市的夜太亮',
  '[00:23.50]我们绕过环路 绕过人海茫茫',
  '[00:31.00]路灯连成一条 温柔的延长线',
  '[00:38.50]把你我的影子 拉得很长很长',
  '[00:46.00]如果时间可以 停在这一段',
  '[00:53.50]就让晚风替我 把心事收藏',
  '[00:61.00]♪',
  '[00:68.50]夜色温柔 岁月也宽广',
  '[00:76.00]下一站天亮 有你就不慌'
].join('\n')

const MOCK_TRANSLATION = [
  '[00:01.00]Neon spills through the window, cool against my fingertips',
  '[00:08.50]That song on the radio is halfway through',
  '[00:16.00]You turn and say the city night is far too bright',
  '[00:23.50]We loop past the ring road, past the drifting crowd',
  '[00:31.00]Streetlights string a tender, endless line',
  '[00:38.50]Stretching our shadows long, so long',
  '[00:46.00]If time could freeze on this stretch of road',
  '[00:53.50]Let the night wind keep my secrets safe',
  '[00:68.50]The night is gentle, the years are wide',
  '[00:76.00]Next stop, daybreak — with you I am not afraid'
].join('\n')

const DURATION_MS = 96_000
const DEVICE_ID = 'mock-phone'
/** ?empty=1:不推送任何播放状态,用于预览未配对空态 */
const EMPTY_MODE = typeof location !== 'undefined' && location.search.includes('empty')
/** ?noart=1:不推送封面,用于手动验证封面 API 兜底(等宽限期后应出现 API 拉取的封面) */
const NO_ART_MODE = typeof location !== 'undefined' && location.search.includes('noart')

const subscribers: Array<(event: ServerEvent) => void> = []
let seq = 0
let positionMs = 4_200
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

function emit(event: ServerEvent): void {
  for (const cb of [...subscribers]) {
    try { cb(event) } catch (_) { /* 单订阅者异常不影响其他 */ }
  }
}

function stateMessage(): ProtocolStateMessage {
  return {
    type: 'state',
    seq: ++seq,
    sentAt: Date.now(),
    reason: 'mock',
    app: { package: 'com.netease.cloudmusic', name: '网易云音乐' },
    playback: { state: 'playing', positionMs, positionKnown: true, speed: 1 },
    track: {
      id: 'mock-track-1',
      title: '夜色温柔 (Demo)',
      artist: '虚拟歌手 / 城市漫游计划',
      album: '城市漫游',
      albumArtist: '',
      durationMs: DURATION_MS
    },
    artwork: { available: true, hash: 'mock' }
  }
}

function emitState(): void {
  emit({
    kind: 'state',
    deviceId: DEVICE_ID,
    state: stateMessage(),
    meta: { recvAt: Date.now(), clockOffsetMs: 0, lastAppMessageAt: Date.now() }
  })
}

function snapshot() {
  return {
    listening: true,
    port: 18765,
    devices: [
      {
        deviceId: DEVICE_ID,
        deviceName: 'Mock Phone(dev 预览)',
        appVersion: '1.3.0',
        rttMs: 12,
        clockOffsetMs: 0,
        connectedAt: Date.now(),
        hasState: true,
        link: 'connected',
        lastAppMessageAt: Date.now(),
        disconnectedAt: null
      }
    ],
    activeDeviceId: DEVICE_ID,
    addresses: ['192.168.1.23'],
    token: 'dev-mock-token-0123456789'
  }
}

/** 运行时画一张渐变封面(带 canvas 的环境才有;给氛围背景/正在播放条用) */
function makeCoverBase64(): string | null {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const gradient = ctx.createLinearGradient(0, 0, 128, 128)
    gradient.addColorStop(0, '#31456e')
    gradient.addColorStop(0.55, '#7a5a9e')
    gradient.addColorStop(1, '#c98a6d')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 128, 128)
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.font = '64px serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('♪', 64, 66)
    return canvas.toDataURL('image/png').split(',')[1] ?? null
  } catch (_) {
    return null
  }
}

function emitArtwork(): void {
  const base64 = makeCoverBase64()
  if (base64) {
    emit({ kind: 'artwork', trackId: 'mock-track-1', artwork: { mime: 'image/png', dataBase64: base64 } })
  }
}

const mockProvider: LyricProvider = {
  name: 'dev-mock',
  async search(): Promise<ProviderOutcome> {
    return {
      status: 'found',
      result: { synced: MOCK_LRC, plain: null, translation: MOCK_TRANSLATION, source: 'dev-mock' }
    }
  }
}

/** @returns 是否真的注入了 mock(已存在 services 时返回 false) */
export function installDevMock(): boolean {  if (typeof window === 'undefined' || (window as any).services) return false

  ;(window as any).services = {
    localAddresses: () => ['192.168.1.23'],
    lanLyrics: {
      async start() {
        if (!heartbeatTimer) {
          heartbeatTimer = setInterval(() => {
            positionMs = (positionMs + 8_000) % DURATION_MS
            if (!EMPTY_MODE) emitState()
          }, 8_000)
        }
        emit({ kind: 'snapshot' })
        if (!EMPTY_MODE && !NO_ART_MODE) emitArtwork()
        return { ok: true }
      },
      stop() {
        if (heartbeatTimer) clearInterval(heartbeatTimer)
        heartbeatTimer = null
      },
      getSnapshot: () => snapshot(),
      setActiveDevice() { /* 单设备 */ },
      getPosition: () => null,
      getArtwork: () => null,
      requestArtwork: () => {
        if (!NO_ART_MODE) emitArtwork()
      },
      requestState: () => { if (!EMPTY_MODE) emitState() },
      subscribe(cb: (event: ServerEvent) => void) {
        subscribers.push(cb)
        return () => {
          const index = subscribers.indexOf(cb)
          if (index >= 0) subscribers.splice(index, 1)
        }
      },
      generateToken: () => 'dev-mock-token-0123456789',
      saveConfig: (config) => ({ port: config?.port ?? 18765, token: config?.token ?? snapshot().token })
    }
  }
  // store 据此把 dev 歌词源插到最前,避免预览时真的请求歌词接口
  ;(window as any).__devLyricProvider = mockProvider
  return true
}

// 模块导入即自装(必须早于 store.ts 的模块体求值,lyricManager 构造时才能拿到 dev 歌词源)
if (import.meta.env.DEV) installDevMock()

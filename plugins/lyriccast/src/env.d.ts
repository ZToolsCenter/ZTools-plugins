/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

/**
 * preload/server.js 注入到 window 的服务面。
 * 与 src-ztools/preload/server.js 保持一致,修改两侧要同步。
 */
export interface ArtworkData {
  mime: string
  dataBase64: string
}

export interface DeviceInfo {
  deviceId: string
  deviceName: string
  appVersion: string
  rttMs: number
  clockOffsetMs: number
  connectedAt: number
  hasState: boolean
  /** 链路展示状态:connected | stale(playing 超 24s 无应用消息) | lapsed(断线宽限期) */
  link?: string
  lastAppMessageAt?: number
  disconnectedAt?: number | null
}

export interface LanSnapshot {
  listening: boolean
  port: number
  devices: DeviceInfo[]
  activeDeviceId: string | null
  addresses: string[]
  token: string
}

/** state 事件附带的插值锚点元数据(PC 时钟) */
export interface StateMeta {
  recvAt: number
  clockOffsetMs: number
  lastAppMessageAt: number
}

export interface ServerEvent {
  kind: 'snapshot' | 'state' | 'artwork' | 'link' | 'server-error'
  message?: string
  deviceId?: string
  state?: ProtocolStateMessage
  /** state 事件的插值元数据;link 事件携带断开时刻 */
  meta?: StateMeta
  disconnectedAt?: number
  trackId?: string
  artwork?: ArtworkData
}

/** 推送协议 v1.1 的 state/snapshot 消息(仅 UI 关心的字段;载荷同构) */
export interface ProtocolStateMessage {
  type?: string
  seq: number
  sentAt: number
  reason: string
  app: { package: string; name: string }
  playback: { state: string; positionMs: number; positionKnown: boolean; speed: number }
  track: {
    id: string
    title: string
    artist: string
    album: string
    albumArtist: string
    durationMs: number
  }
  artwork: { available: boolean; hash: string }
}

interface LanLyricsApi {
  start(config?: { port?: number; token?: string }): Promise<{ ok: boolean; error?: string }>
  stop(): void
  getSnapshot(): LanSnapshot
  setActiveDevice(deviceId: string): void
  getPosition(deviceId?: string): {
    positionMs: number
    known: boolean
    state: string
    speed: number
    durationMs: number
    trackId: string
    title: string
    artist: string
  } | null
  getArtwork(trackId?: string): ArtworkData | null
  requestArtwork(): void
  requestState(): void
  subscribe(cb: (event: ServerEvent) => void): () => void
  generateToken(): string
  saveConfig(config: { port?: number; token?: string }): { port: number; token: string }
}

interface Services {
  localAddresses: () => string[]
  lanLyrics: LanLyricsApi
}

declare global {
  interface Window {
    services: Services
  }
}

export {}

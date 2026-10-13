/**
 * progress.ts 纯函数测试:
 * 进度推算(playing/paused/变速/seek 覆盖/未知位置)、stale/宽限/断开状态机、
 * 快照覆盖语义。
 */
import { describe, expect, it } from 'vitest'
import {
  displayLink,
  interpolatePosition,
  renderProgress,
  STALE_AFTER_MS,
  GRACE_MS,
  type ProgressAnchor
} from './progress'
import type { ProtocolStateMessage } from './env.d'

const BASE_TIME = 1_000_000

function state(overrides: Partial<ProtocolStateMessage['playback']> = {}): ProtocolStateMessage {
  return {
    seq: 1,
    sentAt: BASE_TIME,
    reason: 'heartbeat',
    app: { package: 'p', name: 'P' },
    playback: {
      state: 'playing',
      positionMs: 10_000,
      positionKnown: true,
      speed: 1,
      ...overrides
    },
    track: {
      id: 't1',
      title: 'Song',
      artist: 'Artist',
      album: '',
      albumArtist: '',
      durationMs: 200_000
    },
    artwork: { available: false, hash: '' }
  }
}

/** 锚点:收到 state 时 PC 钟 = BASE_TIME,应用消息同刻到达,在线 */
function anchor(overrides: {
  state?: ProtocolStateMessage
  recvAt?: number
  lastAppMessageAt?: number
  disconnectedAt?: number | null
} = {}): ProgressAnchor {
  return {
    state: overrides.state ?? state(),
    recvAt: overrides.recvAt ?? BASE_TIME,
    lastAppMessageAt: overrides.lastAppMessageAt ?? BASE_TIME,
    disconnectedAt: overrides.disconnectedAt ?? null
  }
}

describe('interpolatePosition', () => {
  it('advances with time while playing', () => {
    const a = anchor()
    expect(interpolatePosition(a, BASE_TIME + 5_000).positionMs).toBe(15_000)
  })

  it('freezes when paused regardless of elapsed time', () => {
    const a = anchor({ state: state({ state: 'paused', speed: 0 }) })
    expect(interpolatePosition(a, BASE_TIME + 60_000).positionMs).toBe(10_000)
  })

  it('respects playback speed', () => {
    const a = anchor({ state: state({ speed: 2 }) })
    expect(interpolatePosition(a, BASE_TIME + 5_000).positionMs).toBe(20_000)
  })

  it('a fresh anchor (seek/snapshot) replaces the base position', () => {
    const before = anchor()
    expect(interpolatePosition(before, BASE_TIME + 10_000).positionMs).toBe(20_000)
    // 拖动进度后手机发来新快照:store 直接覆盖锚点,进度立即跳到新基准
    const after = anchor({ state: state({ positionMs: 90_000 }) })
    expect(interpolatePosition(after, BASE_TIME + 1_000).positionMs).toBe(91_000)
  })

  it('clamps to duration and never goes negative', () => {
    const a = anchor({ state: state({ positionMs: 199_000, speed: 2 }) })
    expect(interpolatePosition(a, BASE_TIME + 5_000).positionMs).toBe(200_000)
    const rewinding = anchor({ state: state({ positionMs: 500, speed: -1 }) })
    expect(interpolatePosition(rewinding, BASE_TIME + 10_000).positionMs).toBe(0)
  })

  it('never fakes unknown position', () => {
    const a = anchor({ state: state({ positionMs: -1, positionKnown: false }) })
    const result = interpolatePosition(a, BASE_TIME + 5_000)
    expect(result.known).toBe(false)
    expect(result.positionMs).toBe(-1)
  })
})

describe('displayLink', () => {
  it('is connected when messages keep arriving', () => {
    expect(displayLink(anchor(), BASE_TIME + 10_000)).toBe('connected')
  })

  it('goes stale only while playing and past 24s without app messages', () => {
    const silent = BASE_TIME + STALE_AFTER_MS + 1
    expect(displayLink(anchor({ lastAppMessageAt: BASE_TIME }), silent)).toBe('stale')
    // paused 不做应用层超时判定(手机本就不发心跳)
    const paused = anchor({
      state: state({ state: 'paused', speed: 0 }),
      lastAppMessageAt: BASE_TIME
    })
    expect(displayLink(paused, silent)).toBe('connected')
  })

  it('grace period keeps status within 30s of disconnect, then disconnected', () => {
    const down = anchor({ disconnectedAt: BASE_TIME })
    expect(displayLink(down, BASE_TIME + GRACE_MS)).toBe('grace')
    expect(displayLink(down, BASE_TIME + GRACE_MS + 1)).toBe('disconnected')
  })
})

describe('renderProgress (snapshot overwrite + degradation)', () => {
  it('combines interpolation with link status', () => {
    const a = anchor({ disconnectedAt: BASE_TIME - 1000 })
    const rendered = renderProgress(a, BASE_TIME + 4_000)
    expect(rendered.status).toBe('grace')
    expect(rendered.known).toBe(true)
    // 宽限期内进度继续推算:recvAt=BASE_TIME 起 4s × 1
    expect(rendered.positionMs).toBe(14_000)
  })

  it('freezes progress after the grace period but keeps the track info', () => {
    const a = anchor({ disconnectedAt: BASE_TIME - GRACE_MS - 1 })
    const rendered = renderProgress(a, BASE_TIME + 999_999)
    expect(rendered.status).toBe('disconnected')
    // 冻结在锚点位置(不随墙钟漂移)
    expect(rendered.positionMs).toBe(10_000)
    expect(a.state.track.title).toBe('Song')
  })

  it('recovers to connected the moment a new snapshot overwrites the anchor', () => {
    const down = anchor({ disconnectedAt: BASE_TIME, lastAppMessageAt: BASE_TIME })
    expect(renderProgress(down, BASE_TIME + 20_000).status).toBe('grace')
    // 重连后 store 用新 state/snapshot 全量覆盖(disconnectedAt=null)
    const recoveredState = { ...state(), seq: 2 }
    const recovered = anchor({ state: recoveredState, recvAt: BASE_TIME + 21_000 })
    expect(renderProgress(recovered, BASE_TIME + 22_000).status).toBe('connected')
  })
})

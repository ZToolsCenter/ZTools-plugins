/**
 * PC 端插值计算测试:直接驱动 preload/lan-server-core.js(CommonJS),
 * 用 getPosition 的注入时钟做确定性断言(协议 §5)。
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { LanServerCore } = require(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src-ztools/preload/lan-server-core.js'
))

/** 不真正监听端口的实例:直接注入设备状态测试纯逻辑 */
function makeCore() {
  const core = new LanServerCore({ port: 0, token: 'x'.repeat(16), logger: { log() {}, error() {} } })
  const device = {
    ws: { readyState: 1 },
    peer: 'test',
    deviceId: 'd1',
    deviceName: 'Test Phone',
    appVersion: '1',
    authed: true,
    lastState: null,
    lastStateAt: 0,
    lastAppMessageAt: Date.now(),
    lastSeq: 0,
    awaitingPong: 0,
    lastPongAt: Date.now(),
    disconnectedAt: null,
    rttMs: -1,
    clockOffsetMs: 0,
    artwork: new Map()
  }
  core.devices.set('d1', device)
  core.activeDeviceId = 'd1'
  return { core, device }
}

const baseState = {
  type: 'state',
  v: 1,
  seq: 1,
  sentAt: 100_000,
  reason: 'track_change',
  app: { package: 'p', name: 'P' },
  playback: { state: 'playing', positionMs: 10_000, positionKnown: true, speed: 1 },
  track: { id: 't1', title: 'Song', artist: 'Artist', album: '', albumArtist: '', durationMs: 200_000 },
  artwork: { available: false }
}

describe('LanServerCore.getPosition', () => {
  beforeEach(() => {})

  it('interpolates from sentAt corrected by clock offset', () => {
    const { core, device } = makeCore()
    device.lastState = { ...baseState }
    // 手机钟比 PC 钟快 500ms:sentAt(手机钟)=100_000 对应 PC 钟 99_500
    device.clockOffsetMs = 500
    // PC 钟 100_500 时:位置 = 10_000 + (100_500 − 99_500) × 1 = 11_000
    expect(core.getPosition('d1', 100_500)?.positionMs).toBe(11_000)
  })

  it('respects playback speed', () => {
    const { core, device } = makeCore()
    device.lastState = { ...baseState, playback: { state: 'playing', positionMs: 10_000, positionKnown: true, speed: 2 } }
    expect(core.getPosition('d1', 101_000)?.positionMs).toBe(12_000)
  })

  it('freezes when paused and clamps to duration', () => {
    const { core, device } = makeCore()
    device.lastState = { ...baseState, playback: { state: 'paused', positionMs: 10_000, positionKnown: true, speed: 0 } }
    expect(core.getPosition('d1', 200_000)?.positionMs).toBe(10_000)

    device.lastState = { ...baseState, playback: { state: 'playing', positionMs: 199_000, positionKnown: true, speed: 2 } }
    expect(core.getPosition('d1', 200_000)?.positionMs).toBe(200_000)
  })

  it('never fakes unknown position', () => {
    const { core, device } = makeCore()
    device.lastState = { ...baseState, playback: { state: 'playing', positionMs: -1, positionKnown: false, speed: 1 } }
    const result = core.getPosition('d1', 200_000)
    expect(result?.known).toBe(false)
    expect(result?.positionMs).toBe(-1)
  })

  it('returns null without any state', () => {
    const { core } = makeCore()
    expect(core.getPosition('d1', 100_000)).toBeNull()
  })

  it('auto-selects a playing device over a paused one', () => {
    const { core, device } = makeCore()
    const pausedDevice = { ...device, deviceId: 'd2', lastStateAt: 999 }
    pausedDevice.lastState = { ...baseState, playback: { state: 'paused', positionMs: 1, positionKnown: true, speed: 0 } }
    device.lastState = { ...baseState, playback: { state: 'playing', positionMs: 1, positionKnown: true, speed: 1 } }
    device.lastStateAt = 1
    core.devices.set('d2', pausedDevice)
    const selected = (core as any)._autoSelect()
    expect(selected).toBe('d1')
  })
})

// ==================== v1.1:seq 乱序 / snapshot / 宽限期 / ws ping ====================

import { isAppStale, PONG_DEAD_MS, LAPSE_GRACE_MS } from '../../src-ztools/preload/lan-server-core.js'

/** 带 seq 的 state 消息工厂 */
function seqState(seq: number, positionMs = 10_000): typeof baseState {
  return { ...baseState, seq, playback: { ...baseState.playback, positionMs } }
}

describe('LanServerCore v1.1 (protocol §2.8/§2.9/§6)', () => {
  it('drops in-connection state messages with regressed seq', () => {
    const { core, device } = makeCore()
    ;(core as any)._handleMessage(device, seqState(5, 50_000))
    expect(device.lastSeq).toBe(5)
    ;(core as any)._handleMessage(device, seqState(3, 30_000)) // 回退,丢弃
    expect(device.lastState.playback.positionMs).toBe(50_000)
  })

  it('accepts snapshot unconditionally and resets the seq baseline', () => {
    const { core, device } = makeCore()
    ;(core as any)._handleMessage(device, seqState(5, 50_000))
    // 重连后 snapshot seq 从 1 重新计数,必须接受并覆盖
    const snapshot = { ...seqState(1, 99_000), type: 'snapshot', reason: 'reconnect' }
    ;(core as any)._handleMessage(device, snapshot)
    expect(device.lastSeq).toBe(1)
    // sentAt(手机钟)=100_000,now=100_500 ⇒ 99_000 + 500 × 1
    expect(core.getPosition('d1', 100_500)?.positionMs).toBe(99_500)
  })

  it('skips seq gating for messages without seq (v1 phone compat)', () => {
    const { core, device } = makeCore()
    ;(core as any)._handleMessage(device, seqState(5, 50_000))
    const legacy = { ...seqState(0, 70_000) } as any
    delete legacy.seq
    ;(core as any)._handleMessage(device, legacy)
    expect(device.lastState.playback.positionMs).toBe(70_000)
  })

  it('keeps a lapsed device interpolable during grace, purges after', () => {
    const { core, device } = makeCore()
    device.lastState = seqState(1, 10_000)
    const now = Date.now()
    // 模拟 close:转墓碑
    core.devices.delete('d1')
    device.disconnectedAt = now
    core.lapsed.set('d1', device)
    core.activeDeviceId = 'd1'

    // 宽限期内:getSnapshot 仍列出(标记 lapsed),getPosition 继续插值
    const snap = core.getSnapshot()
    expect(snap.devices.map((d: any) => d.link)).toContain('lapsed')
    expect(snap.activeDeviceId).toBe('d1')
    // sentAt=100_000,now=101_000 ⇒ 10_000 + 1_000 × 1
    expect(core.getPosition('d1', 101_000)?.positionMs).toBe(11_000)

    // 宽限期结束:清理,活跃设备回落到其余在线设备
    device.disconnectedAt = now - LAPSE_GRACE_MS - 1
    core.devices.set('d2', {
      ...device,
      deviceId: 'd2',
      ws: { readyState: 1, ping: () => {}, send: () => {} },
      disconnectedAt: null,
      awaitingPong: 0
    })
    core.activeDeviceId = 'd1'
    ;(core as any)._pingAll()
    expect(core.lapsed.has('d1')).toBe(false)
    expect(core.getSnapshot().activeDeviceId).toBe('d2')
  })

  it('pings healthy devices, terminates only after PONG_DEAD_MS without pong', () => {
    const { core, device } = makeCore()
    const calls: string[] = []
    device.ws = {
      readyState: 1,
      ping: () => calls.push('ping'),
      terminate: () => calls.push('terminate'),
      send: () => {}
    } as any
    // 刚连接(lastPongAt = 连接时刻):只 ping,不判死
    device.lastPongAt = Date.now()
    ;(core as any)._pingAll()
    expect(calls).toEqual(['ping'])
    expect(device.awaitingPong).toBe(1)
    // pong 迟到但距上次 < PONG_DEAD_MS:健康连接,继续 ping
    device.lastPongAt = Date.now() - PONG_DEAD_MS + 1_000
    ;(core as any)._pingAll()
    expect(calls).toEqual(['ping', 'ping'])
    // 静默超过 PONG_DEAD_MS:terminate 硬断,不再发 ping
    device.lastPongAt = Date.now() - PONG_DEAD_MS - 1_000
    ;(core as any)._pingAll()
    expect(calls).toEqual(['ping', 'ping', 'terminate'])
    void PONG_DEAD_MS
  })

  it('isAppStale only fires for playing states past the threshold', () => {
    const { device } = makeCore()
    device.lastState = seqState(1)
    device.lastAppMessageAt = 1_000
    expect(isAppStale(device, 1_000 + 24_000)).toBe(false)
    expect(isAppStale(device, 1_000 + 24_001)).toBe(true)
    device.lastState = { ...seqState(1), playback: { ...baseState.playback, state: 'paused', speed: 0 } }
    expect(isAppStale(device, 1_000 + 999_999)).toBe(false)
  })
})

// 回归:ad6b851 曾把周期定时器改名为调用不存在的 _tick,每 5s 抛 Uncaught TypeError
// (真实线上故障)。_startTimers 必须不抛错,且唯一周期回调是 _pingAll。
describe('_startTimers watchdog 回归', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('只挂 ping 定时器且不抛错', () => {
    vi.useFakeTimers()
    const core = new LanServerCore({ port: 0, token: 'token-token-token-1234' })
    const spy = vi.spyOn(core as any, '_pingAll').mockImplementation(() => {})
    expect(() => (core as any)._startTimers()).not.toThrow()
    // 旧 _tick 周期(5s)内不得触发任何回调
    vi.advanceTimersByTime(5_000)
    expect(spy).not.toHaveBeenCalled()
    // 10s(任务书 ping 周期)时 _pingAll 到点
    vi.advanceTimersByTime(5_000)
    expect(spy).toHaveBeenCalledTimes(1)
    ;(core as any)._timers.forEach(clearInterval)
    spy.mockRestore()
  })
})

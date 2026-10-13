/**
 * PC 端进度推算与存活状态(协议 §5 / §6.2 / §6.3)。
 *
 * 纯函数模块:不依赖 window / Vue / preload,可被 vitest 直接测试。
 * UI(App.vue)持有每台设备的 ProgressAnchor,按帧调用 renderProgress 得到
 * 显示进度与降级状态,不依赖数据持续到达。
 *
 * 进度公式(协议 §5):
 *   当前进度 = basePosition + (now − baseRecvAt) × speed,仅 state=playing 时推进
 * 其中 baseRecvAt 用"PC 收到消息的时刻"(协议允许的降级实现:局域网单程时延
 * 通常 < 5ms;服务端另有 sentAt − clockOffset 的补偿实现,见 getPosition)。
 */
import type { ProtocolStateMessage } from './env.d'

/** playing 时超过 3 × 心跳间隔(8s)无应用消息 → stale(协议 §6.2) */
export const STALE_AFTER_MS = 24_000

/** 断线宽限期:期间进度继续推算,超时冻结并显示"已断开"(协议 §6.3) */
export const GRACE_MS = 30_000

/** UI 侧的一台设备进度锚点:由 preload 的 state/link 事件维护 */
export interface ProgressAnchor {
  /** 最近一次 state/snapshot 消息(全量覆盖,协议 §2.8) */
  state: ProtocolStateMessage
  /** PC 收到该消息的时刻(PC 时钟 epoch ms) */
  recvAt: number
  /** 最近一次应用层消息到达时刻(stale 判定用) */
  lastAppMessageAt: number
  /** 链路断开时刻;null = 在线 */
  disconnectedAt: number | null
}

/** 连接展示状态:在线 / 数据延迟(playing 超时) / 宽限期(断线未超时) / 已断开 */
export type LinkStatus = 'connected' | 'stale' | 'grace' | 'disconnected'

export interface RenderedProgress {
  positionMs: number
  known: boolean
  status: LinkStatus
}

/**
 * 连接展示状态机(纯函数):
 * - 在线且 playing 超 24s 无应用消息 → stale;
 * - 断线后 30s 内 → grace(进度继续推算);
 * - 其余 → connected / disconnected。
 */
export function displayLink(anchor: ProgressAnchor, nowMs: number): LinkStatus {
  if (anchor.disconnectedAt !== null) {
    return nowMs - anchor.disconnectedAt <= GRACE_MS ? 'grace' : 'disconnected'
  }
  if (
    anchor.state.playback.state === 'playing' &&
    nowMs - anchor.lastAppMessageAt > STALE_AFTER_MS
  ) {
    return 'stale'
  }
  return 'connected'
}

/**
 * 进度推算(纯函数,协议 §5):
 * - 仅 playing 推进;paused/buffering/stopped/none 冻结在锚点位置;
 * - positionKnown=false 时返回 known=false,不得伪造 0;
 * - 结果夹到 [0, duration](duration > 0 时),与手机端发送语义一致。
 */
export function interpolatePosition(anchor: ProgressAnchor, nowMs: number): { positionMs: number; known: boolean } {
  const st = anchor.state.playback
  if (!st.positionKnown || st.positionMs < 0) return { positionMs: -1, known: false }
  let position = st.positionMs
  if (st.state === 'playing') {
    const elapsed = Math.max(0, nowMs - anchor.recvAt)
    position += elapsed * (st.speed || 0)
  }
  position = Math.max(0, position)
  const durationMs = anchor.state.track.durationMs
  if (durationMs > 0) position = Math.min(position, durationMs)
  return { positionMs: Math.round(position), known: true }
}

/** 一次渲染所需的全部输出:进度 + 降级状态。 */
export function renderProgress(anchor: ProgressAnchor, nowMs: number): RenderedProgress {
  const status = displayLink(anchor, nowMs)
  // 宽限期结束后冻结在锚点位置:长时间无新数据,继续外推只会越漂越远(协议 §6.3)
  if (status === 'disconnected') {
    const st = anchor.state.playback
    if (!st.positionKnown || st.positionMs < 0) return { positionMs: -1, known: false, status }
    let position = Math.max(0, st.positionMs)
    const durationMs = anchor.state.track.durationMs
    if (durationMs > 0) position = Math.min(position, durationMs)
    return { positionMs: Math.round(position), known: true, status }
  }
  const { positionMs, known } = interpolatePosition(anchor, nowMs)
  return { positionMs, known, status }
}

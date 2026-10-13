/**
 * 手动偏移管理:歌词与进度的手动校准(±100/±500ms)。
 * 按"本曲"或"来源 App"两个维度记忆,精确(trackId)优先于粗粒度(app)。
 */
import type { KVStorage } from './cache'

export type OffsetScope = 'track' | 'app'

const PREFIX = 'lyric.offset.'

export class OffsetStore {
  constructor(private storage: KVStorage) {}

  private key(scope: OffsetScope, id: string): string {
    return `${PREFIX}${scope}.${id}`
  }

  /** 读取偏移;无记录返回 0 */
  get(scope: OffsetScope, id: string): number {
    try {
      const value = this.storage.getItem(this.key(scope, id))
      return typeof value === 'number' && Number.isFinite(value) ? value : 0
    } catch (_) {
      return 0
    }
  }

  /** 生效偏移:本曲偏移存在则用它,否则用 App 偏移 */
  effective(trackId: string, appPackage: string): number {
    const trackOffset = this.get('track', trackId)
    if (trackOffset !== 0) return trackOffset
    return appPackage ? this.get('app', appPackage) : 0
  }

  /** 写偏移;delta=0 视为清除该维度记录 */
  add(scope: OffsetScope, id: string, deltaMs: number): number {
    const next = deltaMs === 0 ? 0 : this.get(scope, id) + deltaMs
    if (next === 0) {
      this.storage.removeItem(this.key(scope, id))
      return 0
    }
    this.storage.setItem(this.key(scope, id), next)
    return next
  }

  /** 清除本曲偏移(同时清 App 维度太激进,交给 UI 显式操作) */
  resetTrack(trackId: string): void {
    this.storage.removeItem(this.key('track', trackId))
  }
}

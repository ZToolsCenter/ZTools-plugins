/**
 * Provider 简单熔断(仅内存,不持久化):
 * 连续 N 次 error(默认 3)→ 打开,暂停该来源一段时间(默认 5 分钟);
 * 到期后半开:放行一次探测请求,成功则关闭,失败则重新打开并重置冷却。
 * not_found 不计入失败(那是正常业务结果);found 重置计数。
 * 打开期间 isAvailable=false,编排层视为"跳过"(参与负缓存判定,见任务 2.4)。
 */

export interface BreakerOptions {
  /** 连续失败多少次后打开(默认 3) */
  threshold?: number
  /** 打开状态持续时间(默认 5 分钟) */
  cooldownMs?: number
  /** 时间源,测试注入 */
  now?: () => number
}

interface BreakerState {
  consecutiveErrors: number
  openedAt: number | null
}

export class ProviderBreaker {
  private readonly threshold: number
  private readonly cooldownMs: number
  private readonly now: () => number
  private states = new Map<string, BreakerState>()

  constructor(options: BreakerOptions = {}) {
    this.threshold = options.threshold ?? 3
    this.cooldownMs = options.cooldownMs ?? 5 * 60 * 1000
    this.now = options.now ?? Date.now
  }

  /** 是否放行本次请求;冷却到期后进入半开状态(放行一次探测) */
  isAvailable(name: string): boolean {
    const state = this.states.get(name)
    if (!state || state.openedAt === null) return true
    if (this.now() - state.openedAt >= this.cooldownMs) return true // 半开
    return false
  }

  /** 是否处于打开状态(供 UI/诊断展示"已跳过") */
  isOpen(name: string): boolean {
    const state = this.states.get(name)
    return !!state && state.openedAt !== null && this.now() - state.openedAt < this.cooldownMs
  }

  recordSuccess(name: string): void {
    this.states.set(name, { consecutiveErrors: 0, openedAt: null })
  }

  recordNotFound(name: string): void {
    // 无结果是正常业务结果:清空连续失败但不重置打开状态(半开探测失败由 recordError 处理)
    const state = this.states.get(name)
    if (state && state.openedAt === null) state.consecutiveErrors = 0
  }

  recordError(name: string): void {
    const state = this.states.get(name) ?? { consecutiveErrors: 0, openedAt: null }
    if (state.openedAt !== null) {
      // 半开探测失败:已证明仍不可用,立即重开并重置冷却
      state.openedAt = this.now()
      state.consecutiveErrors = 0
      this.states.set(name, state)
      return
    }
    state.consecutiveErrors++
    if (state.consecutiveErrors >= this.threshold) {
      state.openedAt = this.now()
      state.consecutiveErrors = 0
    }
    this.states.set(name, state)
  }

  /** 手动复位(测试/用户重试入口) */
  reset(name: string): void {
    this.states.delete(name)
  }
}

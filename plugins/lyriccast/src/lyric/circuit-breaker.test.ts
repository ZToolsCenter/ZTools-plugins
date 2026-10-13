/** 熔断状态机测试(任务 2.4):连续 error 打开 → 冷却期跳过 → 半开放行 → 成功关闭/失败重开。 */
import { describe, expect, it } from 'vitest'
import { ProviderBreaker } from './circuit-breaker'

describe('ProviderBreaker', () => {
  it('默认放行,not_found 不计失败', () => {
    const breaker = new ProviderBreaker({ threshold: 3 })
    expect(breaker.isAvailable('a')).toBe(true)
    breaker.recordNotFound('a')
    expect(breaker.isAvailable('a')).toBe(true)
  })

  it('连续 error 达阈值后打开,冷却期内跳过', () => {
    let now = 0
    const breaker = new ProviderBreaker({ threshold: 3, cooldownMs: 5 * 60_000, now: () => now })
    breaker.recordError('a')
    breaker.recordError('a')
    expect(breaker.isOpen('a')).toBe(false)
    breaker.recordError('a')
    expect(breaker.isOpen('a')).toBe(true)
    expect(breaker.isAvailable('a')).toBe(false)
    now += 4 * 60_000
    expect(breaker.isAvailable('a')).toBe(false)
    now += 2 * 60_000
    expect(breaker.isAvailable('a')).toBe(true) // 半开
  })

  it('半开探测成功即关闭', () => {
    let now = 0
    const breaker = new ProviderBreaker({ threshold: 2, cooldownMs: 60_000, now: () => now })
    breaker.recordError('a')
    breaker.recordError('a')
    expect(breaker.isAvailable('a')).toBe(false)
    now += 61_000
    expect(breaker.isAvailable('a')).toBe(true)
    breaker.recordSuccess('a')
    expect(breaker.isOpen('a')).toBe(false)
    // 单次失败不再立即打开(计数已重置)
    breaker.recordError('a')
    expect(breaker.isOpen('a')).toBe(false)
  })

  it('半开探测失败重新打开并重置冷却', () => {
    let now = 0
    const breaker = new ProviderBreaker({ threshold: 2, cooldownMs: 60_000, now: () => now })
    breaker.recordError('a')
    breaker.recordError('a')
    now += 61_000
    expect(breaker.isAvailable('a')).toBe(true)
    breaker.recordError('a')
    expect(breaker.isOpen('a')).toBe(true)
    now += 30_000
    expect(breaker.isAvailable('a')).toBe(false)
  })

  it('各来源状态互相独立', () => {
    const breaker = new ProviderBreaker({ threshold: 1 })
    breaker.recordError('a')
    expect(breaker.isOpen('a')).toBe(true)
    expect(breaker.isOpen('b')).toBe(false)
  })
})

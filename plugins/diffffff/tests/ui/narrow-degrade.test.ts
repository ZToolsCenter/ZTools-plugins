/**
 * 小窗口降级状态机单元测试（roadmap 任务 UI-015）。
 *
 * 覆盖 `src/stores/view.ts` 的小窗口降级派生逻辑（App.vue 以 ResizeObserver
 * 写入 narrowWindow，本文件直接驱动该字段验证派生链）：
 * - autoUnified 派生：narrowWindow 且用户未坚持并排 → true；
 * - effectiveViewMode 接管：降级时恒为 'unified'，且【不改写 viewMode】
 *   （窗口变宽后自动回到用户原选视图 —— 用户选择与自动降级可区分的核心）；
 * - 用户坚持：窄窗内 keepSplitInNarrow = true → autoUnified 解除、
 *   effectiveViewMode 回到 'split'（用户在分段控件点回并排的语义）；
 * - episode 复位：窗口退出窄窗时 keepSplitInNarrow 自动复位（模块级 watch），
 *   下一episode重新自动降级；
 * - viewMode 为 'unified' 时窄窗不产生任何接管（effectiveViewMode 恒 unified）。
 *
 * 说明：viewStore 是模块级 reactive 单例，vitest 默认按文件隔离模块注册表，
 * 本文件内各用例按序驱动同一单例，每个用例开头显式布置前置状态，不依赖
 * 其他用例的遗留状态。
 */
import { describe, expect, it } from 'vitest'
import { viewStore } from '../../src/stores/view'

/** 布置前置状态：视图模式 / 窄窗 / 用户坚持全部回到已知值 */
function arrange(mode: 'split' | 'unified', narrow: boolean, keepSplit = false): void {
  viewStore.viewMode = mode
  viewStore.narrowWindow = narrow
  viewStore.keepSplitInNarrow = keepSplit
}

describe('viewStore 小窗口降级（UI-015）：autoUnified 派生', () => {
  it('宽窗下不降级：autoUnified = false，effectiveViewMode = 用户选择', () => {
    arrange('split', false)
    expect(viewStore.autoUnified).toBe(false)
    expect(viewStore.effectiveViewMode).toBe('split')

    arrange('unified', false)
    expect(viewStore.autoUnified).toBe(false)
    expect(viewStore.effectiveViewMode).toBe('unified')
  })

  it('窄窗 + 用户原选并排 → 自动降级：effectiveViewMode 接管为 unified，viewMode 不被改写', () => {
    arrange('split', false)
    viewStore.narrowWindow = true
    expect(viewStore.autoUnified).toBe(true)
    expect(viewStore.effectiveViewMode).toBe('unified')
    // 关键不变量：用户选择未被接管方改写，窗口变宽后自动还原
    expect(viewStore.viewMode).toBe('split')

    viewStore.narrowWindow = false
    expect(viewStore.autoUnified).toBe(false)
    expect(viewStore.effectiveViewMode).toBe('split')
  })

  it('窄窗 + 用户原选统一 → 无接管：effectiveViewMode 恒 unified', () => {
    arrange('unified', false)
    viewStore.narrowWindow = true
    expect(viewStore.autoUnified).toBe(true)
    expect(viewStore.effectiveViewMode).toBe('unified')
  })
})

describe('viewStore 小窗口降级（UI-015）：用户在窄窗坚持并排', () => {
  it('keepSplitInNarrow = true 解除自动降级：effectiveViewMode 回到 split', () => {
    arrange('split', false)
    viewStore.narrowWindow = true
    expect(viewStore.effectiveViewMode).toBe('unified') // 先自动降级

    // 用户在分段控件点回「并排」（App.setViewMode 的语义）
    viewStore.keepSplitInNarrow = true
    expect(viewStore.autoUnified).toBe(false)
    expect(viewStore.effectiveViewMode).toBe('split')
  })

  it('episode 复位：窗口退出窄窗时 keepSplitInNarrow 自动清零（模块级 watch）', () => {
    arrange('split', true, true)
    expect(viewStore.keepSplitInNarrow).toBe(true)

    viewStore.narrowWindow = false
    expect(viewStore.keepSplitInNarrow).toBe(false)
    expect(viewStore.autoUnified).toBe(false)
    expect(viewStore.effectiveViewMode).toBe('split')

    // 下一episode：再次变窄时重新自动降级（坚持标志不跨 episode 延续）
    viewStore.narrowWindow = true
    expect(viewStore.autoUnified).toBe(true)
    expect(viewStore.effectiveViewMode).toBe('unified')
  })
})

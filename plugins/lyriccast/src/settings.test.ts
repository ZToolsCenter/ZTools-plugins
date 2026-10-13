/**
 * 桌面歌词行几何与行间距配置的单元测试:
 * desktopRowMetrics 是悬浮窗渲染公式的同源副本,胶囊自动加高依赖它,公式改动须同步。
 */
import { describe, expect, it } from 'vitest'
import {
  DESKTOP_CUSTOM_CSS_MAX_LENGTH,
  DESKTOP_LINE_GAP_RANGE,
  desktopRowMetrics,
  settings,
  updateSettings
} from './settings'

describe('desktopRowMetrics', () => {
  it('行高 = 文本盒高 + 译文槽(开翻译时)+ 行间距', () => {
    const on = desktopRowMetrics(26, true, 0)
    expect(on.textHeight).toBe(32)
    expect(on.transHeight).toBe(17)
    expect(on.rowHeight).toBe(49)

    const off = desktopRowMetrics(26, false, 0)
    expect(off.transHeight).toBe(0)
    expect(off.rowHeight).toBe(32)
  })

  it('行间距为负收紧、为正放宽,直接计入行高', () => {
    expect(desktopRowMetrics(26, true, -4).rowHeight).toBe(45)
    expect(desktopRowMetrics(26, false, 8).rowHeight).toBe(40)
  })

  it('译文槽有 12px 字号下限,小字号时不塌缩', () => {
    expect(desktopRowMetrics(16, true, 0).transHeight).toBe(16)
  })
})

describe('desktopLineGap sanitize', () => {
  it('越界行间距裁剪到合法区间', () => {
    updateSettings({ desktopLineGap: 999 })
    expect(settings.desktopLineGap).toBe(DESKTOP_LINE_GAP_RANGE.max)
    updateSettings({ desktopLineGap: -99 })
    expect(settings.desktopLineGap).toBe(DESKTOP_LINE_GAP_RANGE.min)
    updateSettings({ desktopLineGap: 0 })
    expect(settings.desktopLineGap).toBe(0)
  })
})

describe('desktopLineOffset sanitize', () => {
  it('不设上下限:任意有限值取整保留,非法值回落 0', () => {
    updateSettings({ desktopLineOffset: 120 })
    expect(settings.desktopLineOffset).toBe(120)
    updateSettings({ desktopLineOffset: -80 })
    expect(settings.desktopLineOffset).toBe(-80)
    updateSettings({ desktopLineOffset: 1.6 })
    expect(settings.desktopLineOffset).toBe(2)
    updateSettings({ desktopLineOffset: Number.NaN })
    expect(settings.desktopLineOffset).toBe(0)
    updateSettings({ desktopLineOffset: '10' as unknown as number })
    expect(settings.desktopLineOffset).toBe(0)
  })
})

describe('desktopCustomCss sanitize', () => {
  it('字符串原样保留,超长截断到上限,非法类型回落空串', () => {
    updateSettings({ desktopCustomCss: '.pill { border-radius: 20px; }' })
    expect(settings.desktopCustomCss).toBe('.pill { border-radius: 20px; }')
    updateSettings({ desktopCustomCss: 'a'.repeat(DESKTOP_CUSTOM_CSS_MAX_LENGTH + 100) })
    expect(settings.desktopCustomCss.length).toBe(DESKTOP_CUSTOM_CSS_MAX_LENGTH)
    updateSettings({ desktopCustomCss: 42 as unknown as string })
    expect(settings.desktopCustomCss).toBe('')
  })
})

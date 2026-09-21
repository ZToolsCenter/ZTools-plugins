import { describe, expect, it } from 'vitest'
import {
  createUserPreferencesDefaults,
  normalizeUserPreferences
} from '../userPreferences'
import type { UserPreferences } from '../userPreferences'

describe('createUserPreferencesDefaults', () => {
  it('默认值与编辑器各 ref 的历史初始值一致', () => {
    expect(createUserPreferencesDefaults()).toEqual({
      pixelGridSize: 16,
      pixelPaintBrushSize: 1,
      leftPanelCollapsed: false,
      showRuler: true,
      snapToPixelGrid: false
    })
  })
})

describe('normalizeUserPreferences', () => {
  it('非对象输入回退全部默认值', () => {
    expect(normalizeUserPreferences(null)).toEqual(createUserPreferencesDefaults())
    expect(normalizeUserPreferences(undefined)).toEqual(createUserPreferencesDefaults())
    expect(normalizeUserPreferences('corrupted')).toEqual(createUserPreferencesDefaults())
    expect(normalizeUserPreferences(42)).toEqual(createUserPreferencesDefaults())
  })

  it('合法值原样保留并忽略额外字段（如 schemaVersion）', () => {
    const stored = {
      schemaVersion: 1,
      pixelGridSize: 32,
      pixelPaintBrushSize: 4,
      leftPanelCollapsed: true,
      showRuler: false,
      snapToPixelGrid: true
    }
    const expected: UserPreferences = {
      pixelGridSize: 32,
      pixelPaintBrushSize: 4,
      leftPanelCollapsed: true,
      showRuler: false,
      snapToPixelGrid: true
    }
    expect(normalizeUserPreferences(stored)).toEqual(expected)
  })

  it('数值越界时钳制回可用范围', () => {
    const normalized = normalizeUserPreferences({
      pixelGridSize: 9999,
      pixelPaintBrushSize: 0
    })
    expect(normalized.pixelGridSize).toBe(256)
    expect(normalized.pixelPaintBrushSize).toBe(1)
  })

  it('非法数值与非法布尔值逐字段回退默认值', () => {
    const normalized = normalizeUserPreferences({
      pixelGridSize: 'abc',
      pixelPaintBrushSize: null,
      leftPanelCollapsed: 'yes',
      showRuler: 0,
      snapToPixelGrid: void 0
    })
    expect(normalized.pixelGridSize).toBe(16)
    expect(normalized.pixelPaintBrushSize).toBe(1)
    expect(normalized.leftPanelCollapsed).toBe(false)
    expect(normalized.showRuler).toBe(true)
    expect(normalized.snapToPixelGrid).toBe(false)
  })

  it('部分字段缺失时仅缺失字段回退默认值', () => {
    const normalized = normalizeUserPreferences({ pixelGridSize: 8 })
    expect(normalized.pixelGridSize).toBe(8)
    expect(normalized.pixelPaintBrushSize).toBe(1)
    expect(normalized.leftPanelCollapsed).toBe(false)
    expect(normalized.showRuler).toBe(true)
    expect(normalized.snapToPixelGrid).toBe(false)
  })
})

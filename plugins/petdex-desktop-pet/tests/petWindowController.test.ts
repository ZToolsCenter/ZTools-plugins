import { afterEach, describe, expect, it, vi } from 'vitest'
import { constrainPetPosition, getPetWindowSize } from '../src/petWindowController'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getPetWindowSize', () => {
  it('按精灵帧尺寸计算窗口大小', () => {
    expect(getPetWindowSize(0.5)).toEqual({ width: 96, height: 104 })
    expect(getPetWindowSize(1)).toEqual({ width: 192, height: 208 })
  })
})

describe('constrainPetPosition', () => {
  it('把桌宠限制在当前显示器工作区内', () => {
    vi.stubGlobal('window', {
      ztools: {
        getDisplayNearestPoint: () => ({
          bounds: { x: 0, y: 0, width: 1440, height: 900 },
          workArea: { x: 0, y: 24, width: 1440, height: 850 }
        })
      }
    })

    expect(constrainPetPosition({ x: -200, y: 900 }, { width: 192, height: 208 })).toEqual({
      x: 12,
      y: 654
    })
  })

  it('支持带负坐标的副显示器工作区', () => {
    vi.stubGlobal('window', {
      ztools: {
        getDisplayNearestPoint: () => ({
          bounds: { x: -1280, y: 0, width: 1280, height: 800 },
          workArea: { x: -1280, y: 0, width: 1280, height: 760 }
        })
      }
    })

    expect(constrainPetPosition({ x: -40, y: -80 }, { width: 160, height: 180 })).toEqual({
      x: -172,
      y: 12
    })
  })
})

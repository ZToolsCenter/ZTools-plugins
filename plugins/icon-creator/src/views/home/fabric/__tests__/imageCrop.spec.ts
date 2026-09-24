import { describe, expect, it } from 'vitest'
import type { FabricObject } from 'fabric'
import {
  applyBitmapCropSourceRect,
  computeBitmapCropFromDisplayRect,
  getBitmapDisplayBox,
  MIN_BITMAP_CROP_SOURCE_SIZE,
  type BitmapCropRect
} from '../imageCrop'

/**
 * 位图裁剪换算的纯几何用例：
 * 以"中心原点 + 等比缩放"的位图替身模拟 fabric FabricImage 的几何接口
 * （getCenterPoint/getScaledWidth/calcTransformMatrix/set 等），
 * 不依赖 DOM 即可验证显示包围盒坐标 ↔ 源像素区域的双向换算与连续裁剪语义。
 */

/** 构造中心原点语义的位图替身：left/top 即画布中心，矩阵为 [scaleX,0,0,scaleY,left,top]。 */
function makeStubImage(options: {
  centerX: number
  centerY: number
  scaleX?: number
  scaleY?: number
  width: number
  height: number
  cropX?: number
  cropY?: number
}) {
  const state = {
    left: options.centerX,
    top: options.centerY,
    scaleX: options.scaleX ?? 1,
    scaleY: options.scaleY ?? 1,
    width: options.width,
    height: options.height,
    cropX: options.cropX ?? 0,
    cropY: options.cropY ?? 0
  }
  const stub = {
    get left() { return state.left },
    set left(value: number) { state.left = value },
    get top() { return state.top },
    set top(value: number) { state.top = value },
    scaleX: state.scaleX,
    scaleY: state.scaleY,
    get width() { return state.width },
    set width(value: number) { state.width = value },
    get height() { return state.height },
    set height(value: number) { state.height = value },
    get cropX() { return state.cropX },
    set cropX(value: number) { state.cropX = value },
    get cropY() { return state.cropY },
    set cropY(value: number) { state.cropY = value },
    getCenterPoint() {
      return { x: state.left, y: state.top }
    },
    getScaledWidth() {
      return state.width * Math.abs(state.scaleX)
    },
    getScaledHeight() {
      return state.height * Math.abs(state.scaleY)
    },
    calcTransformMatrix() {
      return [state.scaleX, 0, 0, state.scaleY, state.left, state.top]
    },
    set(patch: Record<string, number>) {
      Object.assign(stub, patch)
    },
    setCoords() {
      // 与 fabric 一致的坐标缓存刷新，在替身中无需处理
    },
    dirty: false
  }
  return stub as unknown as FabricObject & { cropX: number; cropY: number; dirty: boolean }
}

describe('getBitmapDisplayBox', () => {
  it('返回中心点减显示尺寸一半的包围盒（angle=0 语义，与 MCP 摘要同源）', () => {
    const image = makeStubImage({ centerX: 150, centerY: 150, scaleX: 0.5, scaleY: 0.5, width: 200, height: 200 })
    expect(getBitmapDisplayBox(image)).toEqual({ left: 100, top: 100, width: 100, height: 100 })
  })
})

describe('computeBitmapCropFromDisplayRect', () => {
  it('按显示比例换算为源像素区域（叠加既有 cropX/cropY 支持连续裁剪）', () => {
    // 200×200 源图缩放 0.5 显示为 100×100 @ (100,100)；取显示区 (120,110) 起 40×30
    const image = makeStubImage({ centerX: 150, centerY: 150, scaleX: 0.5, scaleY: 0.5, width: 200, height: 200 })
    const rect: BitmapCropRect = { left: 120, top: 110, width: 40, height: 30 }
    expect(computeBitmapCropFromDisplayRect(image, rect)).toEqual({ cropX: 40, cropY: 20, width: 80, height: 60 })
  })

  it('在已裁剪的图上再裁剪时基于当前显示区域叠加（连续裁剪）', () => {
    // 首次裁剪后源区域为 crop(40,20) 80×60，缩放 0.5，显示盒 (130,135) 起 40×30
    const image = makeStubImage({ centerX: 150, centerY: 150, scaleX: 0.5, scaleY: 0.5, width: 80, height: 60, cropX: 40, cropY: 20 })
    const rect: BitmapCropRect = { left: 135, top: 140, width: 20, height: 15 }
    expect(computeBitmapCropFromDisplayRect(image, rect)).toEqual({ cropX: 50, cropY: 30, width: 40, height: 30 })
  })

  it('矩形超出显示范围时抛可读错误', () => {
    const image = makeStubImage({ centerX: 150, centerY: 150, scaleX: 0.5, scaleY: 0.5, width: 200, height: 200 })
    expect(() =>
      computeBitmapCropFromDisplayRect(image, { left: 90, top: 100, width: 100, height: 100 })
    ).toThrowError(/超出图片显示范围/)
  })

  it('换算后源区域不足最小像素时报面积过小', () => {
    const image = makeStubImage({ centerX: 150, centerY: 150, scaleX: 0.5, scaleY: 0.5, width: 200, height: 200 })
    expect(() =>
      computeBitmapCropFromDisplayRect(image, { left: 100, top: 100, width: 0.4, height: 100 })
    ).toThrowError(/裁剪区域过小/)
  })

  it('宽高非正数直接抛错', () => {
    const image = makeStubImage({ centerX: 150, centerY: 150, width: 200, height: 200 })
    expect(() =>
      computeBitmapCropFromDisplayRect(image, { left: 100, top: 100, width: 0, height: 100 })
    ).toThrowError(/宽高必须大于 0/)
  })
})

describe('applyBitmapCropSourceRect', () => {
  it('更新 cropX/cropY/width/height 并补偿 left/top 使保留区域在画布上位置不变', () => {
    // 80×60 源图缩放 2 显示为 160×120 @ 中心 (200,180)；
    // 保留源区域 (40,20) 40×30 —— 其中心在旧本地坐标 (20,5)，对应旧画布位置 (240,190)。
    const image = makeStubImage({ centerX: 200, centerY: 180, scaleX: 2, scaleY: 2, width: 80, height: 60 })
    applyBitmapCropSourceRect(image, { cropX: 40, cropY: 20, width: 40, height: 30 })
    expect(image.cropX).toBe(40)
    expect(image.cropY).toBe(20)
    expect(image.width).toBe(40)
    expect(image.height).toBe(30)
    // 新中心 = 旧变换下保留区域的中心，即裁剪区域"原地"保留。
    expect(image.getCenterPoint().x).toBeCloseTo(240)
    expect(image.getCenterPoint().y).toBeCloseTo(190)
    expect(image.dirty).toBe(true)
  })

  it(`最小源区域阈值为 ${MIN_BITMAP_CROP_SOURCE_SIZE} 像素（常量契约）`, () => {
    expect(MIN_BITMAP_CROP_SOURCE_SIZE).toBe(1)
  })
})

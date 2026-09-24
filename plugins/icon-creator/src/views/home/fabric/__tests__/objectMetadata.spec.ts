import { describe, expect, it } from 'vitest'
import { Rect, Shadow } from 'fabric'
import {
  applyDefaultRotation3DMetadata,
  applyDefaultShadowEffectsMetadata,
  applyRotation3DTransformToObject,
  applyShadowEffectsToFabricObject,
  clearRotation3DMetadata,
  extractRotation3DBaseScalesFromObject
} from '../objectMetadata'

/**
 * applyShadowEffectsToFabricObject 序列化安全性回归：
 * shadow 若以普通对象直接赋值（绕过 fabric 的包装），对象 toObject 时会抛
 * "shadow.toObject is not a function"，并进而中断拖拽松手的 object:modified
 * 处理链，使 fabric 拖拽状态无法清理、元素持续跟随鼠标。
 */
describe('applyShadowEffectsToFabricObject', () => {
  it('应用的 shadow 必须是 fabric.Shadow 实例，保证 toObject 序列化可用', () => {
    const rect = new Rect({ width: 10, height: 10 })
    applyDefaultShadowEffectsMetadata(rect)

    // 无启用的投影效果时清除阴影
    applyShadowEffectsToFabricObject(rect)
    expect(rect.shadow).toBeNull()

    // 添加启用的投影后，shadow 必须是 Shadow 实例
    ;(rect as any).shadowEffects = [
      { id: 's1', enabled: true, type: 'drop', offsetX: 2, offsetY: 4, blur: 8, spread: 0, color: 'rgba(0, 0, 0, 0.25)' }
    ]
    applyShadowEffectsToFabricObject(rect)
    expect(rect.shadow).toBeInstanceOf(Shadow)
    expect(rect.shadow?.offsetX).toBe(2)
    expect(rect.shadow?.offsetY).toBe(4)
    expect(() => rect.toObject()).not.toThrow()
    expect(rect.toObject().shadow).toMatchObject({ offsetX: 2, offsetY: 4 })

    // 效果被禁用后恢复无阴影状态
    ;(rect as any).shadowEffects[0].enabled = false
    applyShadowEffectsToFabricObject(rect)
    expect(rect.shadow).toBeNull()
  })
})

/**
 * 手动翻转保留回归：object:modified / object:scaling 等手势松手时会执行
 * extractRotation3DBaseScalesFromObject → applyRotation3DTransformToObject 的
 * 重算循环。旧实现用投影分解结果整体覆盖原生 flipX/flipY（无 3D 旋转时恒 false），
 * 用户点翻转按钮后一拖动就"翻转失效变回去"。
 */
describe('手动翻转与 3D 旋转投影重算', () => {
  // 模拟一次手势松手：fabric 改了原生变换 → extract 反解 → apply 重算覆盖
  function simulateGestureRelease(obj: Rect) {
    extractRotation3DBaseScalesFromObject(obj)
    applyRotation3DTransformToObject(obj)
  }

  it('无 3D 旋转时，拖动/缩放松手后手动翻转保持不丢', () => {
    const rect = new Rect({ width: 10, height: 10 })
    applyDefaultRotation3DMetadata(rect)
    // 模拟用户点击水平翻转按钮（写意图位 + 重算物理变换）
    ;(rect as any).rotation3dFlipX = true
    applyRotation3DTransformToObject(rect)
    expect(rect.flipX).toBe(true)

    // 模拟拖动后松手（object:modified 触发的 extract → apply 重算循环）
    simulateGestureRelease(rect)
    expect(rect.flipX).toBe(true)
    expect((rect as any).rotation3dFlipX).toBe(true)

    // 再来一次缩放松手也不丢
    rect.scale(1.5)
    simulateGestureRelease(rect)
    expect(rect.flipX).toBe(true)
  })

  it('再次点击翻转（意图取反）后，松手重算保持取消状态', () => {
    const rect = new Rect({ width: 10, height: 10 })
    applyDefaultRotation3DMetadata(rect)
    ;(rect as any).rotation3dFlipX = true
    applyRotation3DTransformToObject(rect)
    // 二次点击取消翻转
    ;(rect as any).rotation3dFlipX = false
    applyRotation3DTransformToObject(rect)
    expect(rect.flipX).toBe(false)

    simulateGestureRelease(rect)
    expect(rect.flipX).toBe(false)
  })

  it('与 3D 旋转叠加时：意图翻转 + 投影镜像 XOR 共存，松手重算均保留', () => {
    const rect = new Rect({ width: 10, height: 10 })
    // 绕 Y 轴转 180° 的投影自身会产生镜像（投影 flipY=true）
    ;(rect as any).rotateX = 180
    applyDefaultRotation3DMetadata(rect)
    ;(rect as any).rotation3dFlipY = true
    applyRotation3DTransformToObject(rect)

    // 物理翻转 = 投影翻转 XOR 意图翻转
    const physicalFlipYBefore = rect.flipY
    simulateGestureRelease(rect)
    expect(rect.flipY).toBe(physicalFlipYBefore)
    expect((rect as any).rotation3dFlipY).toBe(true)
  })

  it('鼠标旋转手势的角度在松手重算后保留（rotateZ 从原生 angle 回写）', () => {
    const rect = new Rect({ width: 10, height: 10 })
    applyDefaultRotation3DMetadata(rect)
    // 模拟鼠标旋转 30°（只改原生 angle，不经过 rotateZ）
    rect.rotate(30)
    expect(rect.angle).toBeCloseTo(30, 5)

    // 松手：extract 应把 30° 收进 rotateZ，apply 重算后 angle 保持 30°
    simulateGestureRelease(rect)
    expect(rect.angle).toBeCloseTo(30, 5)
  })

  it('翻转意图随 SERIALIZED_OBJECT_PROPS 白名单 round-trip 不丢', () => {
    const rect = new Rect({ width: 10, height: 10 })
    applyDefaultRotation3DMetadata(rect)
    ;(rect as any).rotation3dFlipX = true
    applyRotation3DTransformToObject(rect)
    expect(rect.flipX).toBe(true)

    // 序列化白名单必须带出意图位（撤销/重做/保存工程全走这条链）
    const serialized = (rect as any).toObject(['rotation3dFlipX', 'rotation3dFlipY', 'rotateZ', 'flipX'])
    expect(serialized.rotation3dFlipX).toBe(true)
  })

  it('从未初始化意图元的对象（旧工程/外部导入）从原生 flip 收编意图', () => {
    const rect = new Rect({ width: 10, height: 10 })
    // 旧工程载入：原生 flipX=true 但没有意图元数据
    rect.set('flipX', true)
    expect((rect as any).rotation3dFlipX).toBeUndefined()

    applyDefaultRotation3DMetadata(rect)
    expect((rect as any).rotation3dFlipX).toBe(true)

    // 收编后松手重算不再把翻转冲掉
    simulateGestureRelease(rect)
    expect(rect.flipX).toBe(true)
  })

  it('clearRotation3DMetadata 同时清除翻转意图，重置变换后按钮回到未激活', () => {
    const rect = new Rect({ width: 10, height: 10 })
    applyDefaultRotation3DMetadata(rect)
    ;(rect as any).rotation3dFlipX = true
    applyRotation3DTransformToObject(rect)

    clearRotation3DMetadata(rect)
    applyRotation3DTransformToObject(rect)
    expect(rect.flipX).toBe(false)
    expect((rect as any).rotation3dFlipX).toBe(false)
  })
})

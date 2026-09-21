import { describe, expect, it, vi } from 'vitest'
import { dispatchMcpOperation, listOperationNames } from '../mcpOperations'
import { createMockGateway } from './mockGateway'
import type { McpObjectSummary } from '../mcpGatewayTypes'

/** addShape 的参数类型（与网关接口一致），显式声明以便对 mock 调用参数做精确断言。 */
type AddShapeOptions = { x?: number; y?: number; width?: number; height?: number }

describe('dispatchMcpOperation', () => {
  it('缺少 operation 参数时返回 ok=false 的可读错误', async () => {
    const response = await dispatchMcpOperation(() => createMockGateway(), {})
    expect(response.ok).toBe(false)
    expect(response.message).toContain('缺少 operation')

    // 仅传嵌套 args 而无 operation 同样视为缺失
    const nestedOnly = await dispatchMcpOperation(() => createMockGateway(), { args: { shape: 'circle' } })
    expect(nestedOnly.ok).toBe(false)
    expect(nestedOnly.message).toContain('缺少 operation')
  })

  it('未知操作返回 ok=false 并列出可用操作', async () => {
    const response = await dispatchMcpOperation(() => createMockGateway(), { operation: 'no_such_op' })
    expect(response.ok).toBe(false)
    expect(response.message).toContain('未知操作')
    expect(response.message).toContain('no_such_op')
    // 错误信息中列出全部可用操作名
    expect(response.message).toContain('get_overview')
    expect(response.message).toContain('add_shape')
  })

  it('编辑器未就绪（provider 返回 null）时返回 ok=false', async () => {
    const response = await dispatchMcpOperation(() => null, { operation: 'get_overview' })
    expect(response.ok).toBe(false)
    expect(response.message).toContain('尚未就绪')
  })

  it('嵌套 args 展开后路由到网关方法并回传结果', async () => {
    const addShape = vi.fn((_shape: string, _options?: AddShapeOptions) => 'obj-1')
    const response = await dispatchMcpOperation(() => createMockGateway({ addShape }), {
      operation: 'add_shape',
      args: { shape: 'circle' }
    })

    expect(addShape).toHaveBeenCalledTimes(1)
    expect(addShape.mock.calls[0][0]).toBe('circle')
    // 未提供坐标/尺寸时 handler 以全 undefined 的 options 调用（toEqual 等价比较）
    expect(addShape.mock.calls[0][1]).toEqual({ x: undefined, y: undefined, width: undefined, height: undefined })
    expect(response.ok).toBe(true)
    expect(response.data).toEqual({ objectId: 'obj-1' })
  })

  it('顶层平铺传参同样可路由到网关方法', async () => {
    const addShape = vi.fn((_shape: string, _options?: AddShapeOptions) => 'obj-2')
    const response = await dispatchMcpOperation(() => createMockGateway({ addShape }), {
      operation: 'add_shape',
      shape: 'square'
    })

    expect(addShape).toHaveBeenCalledTimes(1)
    expect(addShape.mock.calls[0][0]).toBe('square')
    expect(response.ok).toBe(true)
    expect(response.data).toEqual({ objectId: 'obj-2' })
  })

  it('嵌套 args 与顶层同名字段冲突时嵌套优先', async () => {
    const addShape = vi.fn((_shape: string, _options?: AddShapeOptions) => 'obj-3')
    // 顶层 operation 非法、shape 为 square；嵌套 args 的合法字段应覆盖两者
    const response = await dispatchMcpOperation(() => createMockGateway({ addShape }), {
      operation: 'no_such_op',
      shape: 'square',
      args: { operation: 'add_shape', shape: 'circle' }
    })

    expect(response.ok).toBe(true)
    expect(addShape).toHaveBeenCalledTimes(1)
    expect(addShape.mock.calls[0][0]).toBe('circle')
    expect(response.data).toEqual({ objectId: 'obj-3' })
  })

  it('网关方法抛错时返回 ok=false 且不向外抛异常', async () => {
    const getOverview = vi.fn(() => {
      throw new Error('画布未初始化')
    })
    const response = await dispatchMcpOperation(() => createMockGateway({ getOverview }), {
      operation: 'get_overview'
    })

    expect(response.ok).toBe(false)
    expect(response.message).toContain('操作 get_overview 失败')
    expect(response.message).toContain('画布未初始化')
  })
})

describe('listOperationNames', () => {
  it('返回的操作清单与 OPERATIONS 同步且每项携带描述', () => {
    const operations = listOperationNames()
    const names = operations.map((item) => item.name)
    expect(names).toContain('get_overview')
    expect(names).toContain('add_shape')
    for (const item of operations) {
      expect(item.description.length).toBeGreaterThan(0)
    }
  })
})

describe('对齐参考线与颜色替换参数解析', () => {
  it('set_guides 逐条校验 orientation/position 后按数组透传给网关', async () => {
    const setGuides = vi.fn(() => ({ guides: [{ id: 'guide-1', orientation: 'horizontal' as const, position: 10 }] }))
    const response = await dispatchMcpOperation(() => createMockGateway({ setGuides }), {
      operation: 'set_guides',
      args: { guides: [{ orientation: 'horizontal', position: 10 }, { orientation: 'vertical', position: 20.5 }] }
    })

    expect(response.ok).toBe(true)
    expect(setGuides).toHaveBeenCalledWith([
      { orientation: 'horizontal', position: 10 },
      { orientation: 'vertical', position: 20.5 }
    ])
  })

  it('set_guides 传空数组表示清空（合法的整体替换），缺失才报错', async () => {
    const setGuides = vi.fn(() => ({ guides: [] }))
    const empty = await dispatchMcpOperation(() => createMockGateway({ setGuides }), {
      operation: 'set_guides',
      args: { guides: [] }
    })
    expect(empty.ok).toBe(true)
    expect(setGuides).toHaveBeenCalledWith([])

    const missing = await dispatchMcpOperation(() => createMockGateway({ setGuides }), {
      operation: 'set_guides',
      args: {}
    })
    expect(missing.ok).toBe(false)
    expect(missing.message).toContain('缺少 guides 参数')
    expect(setGuides).toHaveBeenCalledTimes(1)
  })

  it('replace_color 支持 transparent 关键字并原样透传颜色写法', async () => {
    const replaceColor = vi.fn(() => ({ replacedObjects: 0, replacedSlots: 0, from: 'transparent', to: '#000000' }))
    const response = await dispatchMcpOperation(() => createMockGateway({ replaceColor }), {
      operation: 'replace_color',
      args: { from: 'Transparent', to: '#000' }
    })

    expect(response.ok).toBe(true)
    // transparent 关键字归一化为小写后透传（hex 等合法写法原样透传，归一化在网关/实现侧完成）
    expect(replaceColor).toHaveBeenCalledWith('transparent', '#000')
  })

  it('replace_color 的 from/to 非法时在调度层报中文错误，不触达网关', async () => {
    const replaceColor = vi.fn()
    for (const args of [
      { from: 'red', to: '#00ff00' },
      { from: '#f00', to: 'none' },
      { from: 'rgb(1,2)', to: '#00ff00' }
    ]) {
      const response = await dispatchMcpOperation(() => createMockGateway({ replaceColor }), {
        operation: 'replace_color',
        args
      })
      expect(response.ok).toBe(false)
      expect(response.message).toContain('非法')
    }
    expect(replaceColor).not.toHaveBeenCalled()
  })
})

describe('apply_image_filter 参数归一化', () => {
  it('越界参数自动收敛到合法区间，enabled 缺省补 true', async () => {
    const applyImageFilter = vi.fn((): Promise<McpObjectSummary> => Promise.resolve({ id: 'img-1' } as McpObjectSummary))
    const response = await dispatchMcpOperation(() => createMockGateway({ applyImageFilter }), {
      operation: 'apply_image_filter',
      args: {
        objectId: 'img-1',
        filters: [
          { type: 'blur', strength: 5 },
          { type: 'saturation', saturation: -3 },
          { type: 'brightness', enabled: false }
        ]
      }
    })

    expect(response.ok).toBe(true)
    // strength 收敛到 1、saturation 收敛到 -1；brightness 无参数时补默认值 0 且 enabled=false 保留
    expect(applyImageFilter).toHaveBeenCalledWith('img-1', [
      { type: 'blur', enabled: true, strength: 1 },
      { type: 'saturation', enabled: true, saturation: -1 },
      { type: 'brightness', enabled: false, brightness: 0 }
    ], undefined)
  })

  it('省略 filters 只设混合模式时以 undefined 透传（保留现有滤镜）', async () => {
    const applyImageFilter = vi.fn((): Promise<McpObjectSummary> => Promise.resolve({ id: 'img-1' } as McpObjectSummary))
    const response = await dispatchMcpOperation(() => createMockGateway({ applyImageFilter }), {
      operation: 'apply_image_filter',
      args: { objectId: 'img-1', blendMode: 'normal' }
    })

    expect(response.ok).toBe(true)
    expect(applyImageFilter).toHaveBeenCalledWith('img-1', undefined, 'normal')
  })

  it('filters 传空数组表示清除全部滤镜（合法的整体替换）', async () => {
    const applyImageFilter = vi.fn((): Promise<McpObjectSummary> => Promise.resolve({ id: 'img-1' } as McpObjectSummary))
    const response = await dispatchMcpOperation(() => createMockGateway({ applyImageFilter }), {
      operation: 'apply_image_filter',
      args: { objectId: 'img-1', filters: [] }
    })

    expect(response.ok).toBe(true)
    expect(applyImageFilter).toHaveBeenCalledWith('img-1', [], undefined)
  })
})

describe('crop_image 与 set_pattern_fill 参数解析', () => {
  it('crop_image 的 left/top/width/height 原样透传给网关裁剪方法', async () => {
    const cropImage = vi.fn((): Promise<McpObjectSummary> => Promise.resolve({ id: 'img-1' } as McpObjectSummary))
    const response = await dispatchMcpOperation(() => createMockGateway({ cropImage }), {
      operation: 'crop_image',
      args: { objectId: 'img-1', left: 12, top: 8, width: 64, height: 48 }
    })

    expect(response.ok).toBe(true)
    expect(cropImage).toHaveBeenCalledWith('img-1', { left: 12, top: 8, width: 64, height: 48 })
  })

  it('set_pattern_fill 传 source=null 表示清除图案（repeat/scale 缺省为 undefined）', async () => {
    const setPatternFill = vi.fn((): Promise<McpObjectSummary> => Promise.resolve({ id: 'obj-1' } as McpObjectSummary))
    const response = await dispatchMcpOperation(() => createMockGateway({ setPatternFill }), {
      operation: 'set_pattern_fill',
      args: { objectId: 'obj-1', source: null }
    })

    expect(response.ok).toBe(true)
    expect(setPatternFill).toHaveBeenCalledWith('obj-1', { source: null, repeat: undefined, scale: undefined })
  })

  it('set_pattern_fill 省略 repeat/scale 时按缺省语义透传（repeat=repeat、scale=1 由运行时补齐）', async () => {
    const setPatternFill = vi.fn((): Promise<McpObjectSummary> => Promise.resolve({ id: 'obj-1' } as McpObjectSummary))
    const response = await dispatchMcpOperation(() => createMockGateway({ setPatternFill }), {
      operation: 'set_pattern_fill',
      args: { objectId: 'obj-1', source: 'https://example.com/tile.png' }
    })

    expect(response.ok).toBe(true)
    expect(setPatternFill).toHaveBeenCalledWith('obj-1', { source: 'https://example.com/tile.png', repeat: undefined, scale: undefined })
  })
})

describe('update_text 参数解析', () => {
  /** update_text 的网关方法 mock：默认返回对象摘要，供逐用例覆盖。 */
  function makeUpdateTextMock() {
    return vi.fn((): Promise<McpObjectSummary> => Promise.resolve({ id: 'obj-text' } as McpObjectSummary))
  }

  it('部分字段更新时未提供键保持 undefined（fontWeight 数字原样透传）', async () => {
    const updateText = makeUpdateTextMock()
    const response = await dispatchMcpOperation(() => createMockGateway({ updateText }), {
      operation: 'update_text',
      args: { objectId: 'obj-text', text: '新文案', fontWeight: 700, underline: true }
    })

    expect(response.ok).toBe(true)
    expect(updateText).toHaveBeenCalledWith('obj-text', {
      text: '新文案',
      fontWeight: 700,
      underline: true
    })
  })

  it('fontWeight 传字符串 normal/bold 时按枚举透传', async () => {
    const updateText = makeUpdateTextMock()
    const response = await dispatchMcpOperation(() => createMockGateway({ updateText }), {
      operation: 'update_text',
      args: { objectId: 'obj-text', fontWeight: 'normal', fontStyle: 'italic', textAlign: 'justify' }
    })

    expect(response.ok).toBe(true)
    expect(updateText).toHaveBeenCalledWith('obj-text', { fontWeight: 'normal', fontStyle: 'italic', textAlign: 'justify' })
  })

  it('数值字段在合法边界值上透传（fontSize=6/500、charSpacing=-200/800、lineHeight=0.5/3）', async () => {
    const updateText = makeUpdateTextMock()
    for (const [key, value] of [['fontSize', 6], ['fontSize', 500], ['charSpacing', -200], ['charSpacing', 800], ['lineHeight', 0.5], ['lineHeight', 3]] as const) {
      const response = await dispatchMcpOperation(() => createMockGateway({ updateText }), {
        operation: 'update_text',
        args: { objectId: 'obj-text', [key]: value }
      })
      expect(response.ok).toBe(true)
      expect(updateText).toHaveBeenCalledWith('obj-text', { [key]: value })
    }
  })

  it('非法对象类型与非文本字段值返回中文错误', async () => {
    const updateText = makeUpdateTextMock()
    for (const args of [
      { objectId: 'obj-text', text: 123 },
      { objectId: 'obj-text', fontSize: 3 },
      { objectId: 'obj-text', fontSize: 999 },
      { objectId: 'obj-text', charSpacing: -500 },
      { objectId: 'obj-text', lineHeight: 9 },
      { objectId: 'obj-text', fontWeight: 'heavy' },
      { objectId: 'obj-text', fontStyle: 'oblique' },
      { objectId: 'obj-text', textAlign: 'top' }
    ]) {
      const response = await dispatchMcpOperation(() => createMockGateway({ updateText }), {
        operation: 'update_text',
        args
      })
      expect(response.ok).toBe(false)
      expect(response.message).toContain('操作 update_text 失败')
    }
    // 网关未收到任何一次调用（全部在调度层被拦截）
    expect(updateText).not.toHaveBeenCalled()
  })

  it('只传 objectId（无任何更新字段）报“至少提供”错误', async () => {
    const updateText = makeUpdateTextMock()
    const response = await dispatchMcpOperation(() => createMockGateway({ updateText }), {
      operation: 'update_text',
      args: { objectId: 'obj-text' }
    })

    expect(response.ok).toBe(false)
    expect(response.message).toContain('至少提供 text/fontSize')
    expect(updateText).not.toHaveBeenCalled()
  })
})

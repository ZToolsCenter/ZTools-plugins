import { describe, expect, it } from 'vitest'
import {
  MAX_PROJECT_SYMBOLS,
  MAX_SYMBOL_OBJECTS,
  computeSymbolInstanceScale,
  createSymbolId,
  createSymbolInstanceMetadata,
  findProjectSymbolById,
  normalizeProjectSymbols,
  normalizeSymbolName,
  normalizeSymbolObjects,
  normalizeSymbolObjectsToBounds,
  readSymbolInstanceMetadata,
  removeProjectSymbolById,
  stripSymbolInstanceMetadata,
  upsertProjectSymbol,
  type ProjectSymbol
} from '../symbols'
import { parseProjectFileValue } from '../projectFile'

/** 构造一个最小可用的符号定义，供列表操作用例复用。 */
function makeSymbol(id: string, name = id): ProjectSymbol {
  return {
    id,
    name,
    createdAt: 1700000000000,
    objects: [{ type: 'Rect', left: 0, top: 0, width: 10, height: 10 }]
  }
}

describe('symbols 定义归一化', () => {
  it('normalizeSymbolObjects 仅保留普通对象条目并深拷贝', () => {
    const source = [
      { type: 'Rect', left: 1 },
      null,
      'not-an-object',
      42,
      { type: 'Circle', left: 2 }
    ]
    const result = normalizeSymbolObjects(source)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ type: 'Rect', left: 1 })
    // 深拷贝：修改结果不影响原始数据
    result[0].left = 99
    expect((source[0] as { left: number }).left).toBe(1)
  })

  it('normalizeSymbolObjects 非数组输入降级为空数组', () => {
    expect(normalizeSymbolObjects(undefined)).toEqual([])
    expect(normalizeSymbolObjects('x')).toEqual([])
    expect(normalizeSymbolObjects({ type: 'Rect' })).toEqual([])
  })

  it('normalizeSymbolObjects 超出单符号对象上限时截断', () => {
    const many = Array.from({ length: MAX_SYMBOL_OBJECTS + 10 }, () => ({ type: 'Rect' }))
    expect(normalizeSymbolObjects(many)).toHaveLength(MAX_SYMBOL_OBJECTS)
  })

  it('normalizeSymbolObjectsToBounds 平移 left/top 使包围盒左上角归零', () => {
    const objects = [
      { type: 'Rect', left: 30, top: 40 },
      { type: 'Circle', left: 10, top: 20 }
    ]
    const result = normalizeSymbolObjectsToBounds(objects, { left: 10, top: 20 })
    expect(result[0]).toEqual({ type: 'Rect', left: 20, top: 20 })
    expect(result[1]).toEqual({ type: 'Circle', left: 0, top: 0 })
    // 原数组不被修改
    expect((objects[0] as { left: number }).left).toBe(30)
  })

  it('normalizeProjectSymbols 过滤非法条目并补全缺省字段', () => {
    const valid = makeSymbol('symbol-1')
    const result = normalizeProjectSymbols([
      valid,
      null,
      { id: 'symbol-2' }, // 缺 name / objects
      { id: 'symbol-3', name: 'broken', objects: 'nope' },
      { name: '缺 id 自动补', objects: [{ type: 'Rect' }] },
      { id: 'symbol-1', name: '重复 id 丢弃', objects: [{ type: 'Rect' }] }
    ])
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('symbol-1')
    expect(result[0].createdAt).toBe(1700000000000)
    expect(result[1].name).toBe('缺 id 自动补')
    expect(result[1].id).not.toBe('symbol-1')
    expect(result[1].createdAt).toBeGreaterThan(0)
  })

  it('normalizeProjectSymbols 非数组输入与超限输入安全降级', () => {
    expect(normalizeProjectSymbols('x')).toEqual([])
    const many = Array.from({ length: MAX_PROJECT_SYMBOLS + 5 }, (_, index) => makeSymbol(`symbol-${index}`))
    expect(normalizeProjectSymbols(many)).toHaveLength(MAX_PROJECT_SYMBOLS)
  })

  it('normalizeSymbolName 去空白并回退默认名', () => {
    expect(normalizeSymbolName('  图标  ')).toBe('图标')
    expect(normalizeSymbolName('')).toBe('符号')
    expect(normalizeSymbolName(undefined, '默认')).toBe('默认')
  })
})

describe('symbols 实例元数据', () => {
  it('createSymbolInstanceMetadata 生成含 symbolId 与唯一 instanceId 的元数据', () => {
    const first = createSymbolInstanceMetadata('symbol-1')
    const second = createSymbolInstanceMetadata('symbol-1')
    expect(first.symbolId).toBe('symbol-1')
    expect(first.symbolInstanceId).toBeTruthy()
    expect(first.symbolInstanceId).not.toBe(second.symbolInstanceId)
  })

  it('readSymbolInstanceMetadata 仅在两个字段均为非空字符串时命中', () => {
    const metadata = createSymbolInstanceMetadata('symbol-1')
    expect(readSymbolInstanceMetadata({ ...metadata })).toEqual(metadata)
    expect(readSymbolInstanceMetadata({ symbolId: 'symbol-1' })).toBeNull()
    expect(readSymbolInstanceMetadata({ symbolId: ' ', symbolInstanceId: 'x' })).toBeNull()
    expect(readSymbolInstanceMetadata({})).toBeNull()
    expect(readSymbolInstanceMetadata(null)).toBeNull()
    expect(readSymbolInstanceMetadata('text')).toBeNull()
  })

  it('stripSymbolInstanceMetadata 返回去掉符号键的浅拷贝且不改原对象', () => {
    const record = { symbolId: 'symbol-1', symbolInstanceId: 'inst-1', fill: '#ff0000' }
    const result = stripSymbolInstanceMetadata(record)
    expect(result).toEqual({ fill: '#ff0000' })
    expect(record).toEqual({ symbolId: 'symbol-1', symbolInstanceId: 'inst-1', fill: '#ff0000' })
  })
})

describe('symbols 实例几何映射', () => {
  it('同尺寸映射缩放为 1', () => {
    expect(computeSymbolInstanceScale({ width: 100, height: 50 }, { width: 100, height: 50 })).toEqual({
      scaleX: 1,
      scaleY: 1
    })
  })

  it('新定义尺寸变化时按各方向独立映射，保持实例显示尺寸不变', () => {
    // 旧实例显示 200×100，新定义自然尺寸 100×200 → 内容放大 2 倍 / 缩小 0.5 倍
    expect(computeSymbolInstanceScale({ width: 200, height: 100 }, { width: 100, height: 200 })).toEqual({
      scaleX: 2,
      scaleY: 0.5
    })
  })

  it('非法尺寸回退为 1，避免实例被缩成不可见', () => {
    expect(computeSymbolInstanceScale({ width: 0, height: 100 }, { width: 100, height: 100 })).toEqual({
      scaleX: 1,
      scaleY: 1
    })
    expect(computeSymbolInstanceScale({ width: 100, height: 100 }, { width: Number.NaN, height: -5 })).toEqual({
      scaleX: 1,
      scaleY: 1
    })
  })
})

describe('symbols 列表操作', () => {
  it('upsertProjectSymbol 同 id 覆盖、新 id 追加且不改原数组', () => {
    const base = [makeSymbol('symbol-1')]
    const updated = upsertProjectSymbol(base, makeSymbol('symbol-1', '新名字'))
    expect(updated).toHaveLength(1)
    expect(updated[0].name).toBe('新名字')
    expect(base[0].name).toBe('symbol-1')
    const appended = upsertProjectSymbol(base, makeSymbol('symbol-2'))
    expect(appended).toHaveLength(2)
  })

  it('removeProjectSymbolById 删除目标并保留其余', () => {
    const base = [makeSymbol('symbol-1'), makeSymbol('symbol-2')]
    expect(removeProjectSymbolById(base, 'symbol-1')).toHaveLength(1)
    // 不存在时返回浅拷贝
    const same = removeProjectSymbolById(base, 'nope')
    expect(same).not.toBe(base)
    expect(same).toHaveLength(2)
  })

  it('findProjectSymbolById 命中与未命中', () => {
    const base = [makeSymbol('symbol-1')]
    expect(findProjectSymbolById(base, 'symbol-1')?.name).toBe('symbol-1')
    expect(findProjectSymbolById(base, 'nope')).toBeNull()
  })

  it('createSymbolId 生成的 id 不重复', () => {
    const ids = new Set(Array.from({ length: 20 }, () => createSymbolId()))
    expect(ids.size).toBe(20)
  })
})

describe('symbols 工程文件 round-trip', () => {
  it('parseProjectFileValue 保留合法 symbols 字段', () => {
    const project = {
      app: 'icon-creator',
      schemaVersion: 1,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      canvas: { width: 512, height: 512, background: '#ffffff' },
      fabric: { objects: [] },
      layerOrder: [],
      symbols: [
        makeSymbol('symbol-1', '箭头'),
        { id: 'bad', name: '', objects: [] }
      ]
    }
    const parsed = parseProjectFileValue(project)
    expect(parsed.project.symbols).toHaveLength(1)
    expect(parsed.project.symbols?.[0].id).toBe('symbol-1')
    expect(parsed.project.symbols?.[0].name).toBe('箭头')
  })

  it('parseProjectFileValue 无 symbols 或非法 symbols 时不写出该字段', () => {
    const base = {
      app: 'icon-creator',
      schemaVersion: 1,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      canvas: { width: 512, height: 512, background: '#ffffff' },
      fabric: { objects: [] },
      layerOrder: []
    }
    expect(parseProjectFileValue(base).project.symbols).toBeUndefined()
    expect(parseProjectFileValue({ ...base, symbols: 'broken' }).project.symbols).toBeUndefined()
  })
})

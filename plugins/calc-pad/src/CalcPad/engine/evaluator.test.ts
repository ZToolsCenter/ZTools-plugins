import { describe, it, expect } from 'vitest'
import { evaluatePage, upstreamRowIds, formatNumber } from './evaluator'

const row = (id: string, seq: number, expr: string) => ({ id, seq, expr })

describe('evaluatePage', () => {
  it('四则与优先级', () => {
    const { results } = evaluatePage([row('a', 1, '1 + 2 * 3')])
    expect(results.get('a')).toEqual({ status: 'ok', value: 7 })
  })

  it('解析 #ref 并求值', () => {
    const { results } = evaluatePage([
      row('a', 1, '10'),
      row('b', 2, '#1 * 2 + 1')
    ])
    expect(results.get('b')).toEqual({ status: 'ok', value: 21 })
  })

  it('引用顺序与拓扑无关（后行先引用不依赖书写顺序以外的环）', () => {
    const { results } = evaluatePage([
      row('a', 1, '#2 + 1'),
      row('b', 2, '5')
    ])
    expect(results.get('a')).toEqual({ status: 'ok', value: 6 })
  })

  it('缺失 ref → 未找到', () => {
    const { results } = evaluatePage([row('a', 1, '#9 + 1')])
    expect(results.get('a')).toEqual({ status: 'error', message: '未找到 #9' })
  })

  it('除零 → 除以零', () => {
    const { results } = evaluatePage([row('a', 1, '1 / 0')])
    expect(results.get('a')).toEqual({ status: 'error', message: '除以零' })
  })

  it('循环引用 → 整组标错且不挂起', () => {
    const { results } = evaluatePage([
      row('a', 1, '#2 + 1'),
      row('b', 2, '#1 + 1')
    ])
    expect(results.get('a')).toEqual({ status: 'error', message: '循环引用' })
    expect(results.get('b')).toEqual({ status: 'error', message: '循环引用' })
  })

  it('自引用 → 循环引用', () => {
    const { results } = evaluatePage([row('a', 1, '#1 + 1')])
    expect(results.get('a')).toEqual({ status: 'error', message: '循环引用' })
  })

  it('编辑中游行后仅下游受影响（模拟改 expr 重新 evaluatePage）', () => {
    const before = evaluatePage([
      row('a', 1, '2'),
      row('b', 2, '#1 * 10'),
      row('c', 3, '100')
    ])
    expect(before.results.get('b')).toEqual({ status: 'ok', value: 20 })
    const after = evaluatePage([
      row('a', 1, '3'),
      row('b', 2, '#1 * 10'),
      row('c', 3, '100')
    ])
    expect(after.results.get('b')).toEqual({ status: 'ok', value: 30 })
    expect(after.results.get('c')).toEqual({ status: 'ok', value: 100 })
  })

  it('函数与常量', () => {
    const { results } = evaluatePage([
      row('a', 1, 'sqrt(9)'),
      row('b', 2, 'abs(-4)'),
      row('c', 3, 'max(1, 7, 3)'),
      row('d', 4, 'round(2.6)'),
      row('e', 5, 'pi')
    ])
    expect(results.get('a')).toEqual({ status: 'ok', value: 3 })
    expect(results.get('b')).toEqual({ status: 'ok', value: 4 })
    expect(results.get('c')).toEqual({ status: 'ok', value: 7 })
    expect(results.get('d')).toEqual({ status: 'ok', value: 3 })
    expect((results.get('e') as any).value).toBeCloseTo(Math.PI)
  })

  it('^ 右结合', () => {
    const { results } = evaluatePage([row('a', 1, '2 ^ 3 ^ 2')])
    expect(results.get('a')).toEqual({ status: 'ok', value: 512 })
  })

  it('空表达式 → empty 而非错误', () => {
    const { results } = evaluatePage([row('a', 1, '   ')])
    expect(results.get('a')).toEqual({ status: 'empty' })
  })

  it('语法错误 → 行内 error', () => {
    const { results } = evaluatePage([row('a', 1, '1 +')])
    expect(results.get('a')!.status).toBe('error')
  })

  it('无关行不受错误行影响', () => {
    const { results } = evaluatePage([
      row('a', 1, '1 +'),
      row('b', 2, '2 + 2')
    ])
    expect(results.get('a')!.status).toBe('error')
    expect(results.get('b')).toEqual({ status: 'ok', value: 4 })
  })

  it('上游 error 时下游传播消息', () => {
    const { results } = evaluatePage([
      row('a', 1, '1 / 0'),
      row('b', 2, '#1 + 1')
    ])
    expect(results.get('b')).toEqual({ status: 'error', message: '除以零' })
  })

  it('directDeps 记录上游行 id', () => {
    const { directDeps } = evaluatePage([
      row('a', 1, '1'),
      row('b', 2, '#1 + 1')
    ])
    expect(directDeps.get('b')).toEqual(['a'])
    expect(directDeps.get('a')).toEqual([])
  })
})

describe('upstreamRowIds', () => {
  it('计算传递上游', () => {
    const deps = new Map([
      ['a', []],
      ['b', ['a']],
      ['c', ['b']],
      ['d', []]
    ])
    expect(upstreamRowIds(deps, 'c')).toEqual(new Set(['a', 'b']))
    expect(upstreamRowIds(deps, 'a')).toEqual(new Set())
  })

  it('环状依赖不死循环', () => {
    const deps = new Map([
      ['a', ['b']],
      ['b', ['a']]
    ])
    expect(upstreamRowIds(deps, 'a')).toEqual(new Set(['b']))
  })
})

describe('formatNumber', () => {
  it('消除 0.1+0.2 浮点噪声', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3')
  })

  it('整数不带小数点', () => {
    expect(formatNumber(7)).toBe('7')
  })

  it('保留有效小数', () => {
    expect(formatNumber(1 / 3)).toBe('0.333333333333')
  })
})

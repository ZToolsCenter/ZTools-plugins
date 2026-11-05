import { describe, it, expect } from 'vitest'
import { parseExpression, tokenizeForDisplay } from './parser'
import jsep from 'jsep'

describe('parseExpression', () => {
  it('返回空 refs（纯算术）', () => {
    expect(parseExpression('1 + 2 * 3').refs).toEqual([])
  })

  it('提取 #ref 的 seq', () => {
    expect(parseExpression('#1 + #12 * 2').refs).toEqual([1, 12])
  })

  it('同一 ref 重复出现只记录一次', () => {
    expect(parseExpression('#3 + #3').refs).toEqual([3])
  })

  it('语法错误时 throw', () => {
    expect(() => parseExpression('1 +')).toThrow()
    expect(() => parseExpression('sqrt(')).toThrow()
  })

  it('支持函数与常量', () => {
    expect(() => parseExpression('sqrt(4) + pi * e')).not.toThrow()
  })

  it('支持 ^ 与 % 以及括号', () => {
    expect(() => parseExpression('(2 + 3) ^ 2 % 7')).not.toThrow()
  })
})

describe('运算符优先级回归（jsep 高数字=高优先级）', () => {
  it('运算符优先级：^ 高于 +（回归：jsep 高数字=高优先级）', () => {
    const { refs } = parseExpression('2 + 3 ^ 2')
    expect(refs).toEqual([])
  })

  it('2 + 3 ^ 2 结构为 2 + (3 ^ 2)', () => {
    const ast: any = jsep('2 + 3 ^ 2')
    expect(ast.operator).toBe('+')
    expect(ast.right.operator).toBe('^')
  })

  it('2 ^ 3 ^ 2 右结合', () => {
    const ast: any = jsep('2 ^ 3 ^ 2')
    expect(ast.operator).toBe('^')
    expect(ast.right.operator).toBe('^')
  })

  it('5 % 3 * 2 中 % 与 * 同级左结合', () => {
    const ast: any = jsep('5 % 3 * 2')
    expect(ast.operator).toBe('*')
    expect(ast.left.operator).toBe('%')
  })
})

describe('tokenizeForDisplay', () => {
  it('拆分 ref/数字/标识符/其他', () => {
    expect(tokenizeForDisplay('#1+2.5*sqrt')).toEqual([
      { type: 'ref', text: '#1', seq: 1 },
      { type: 'other', text: '+' },
      { type: 'number', text: '2.5' },
      { type: 'other', text: '*' },
      { type: 'ident', text: 'sqrt' }
    ])
  })

  it('保留空白为 other', () => {
    expect(tokenizeForDisplay('1 + 2')).toEqual([
      { type: 'number', text: '1' },
      { type: 'other', text: ' ' },
      { type: 'other', text: '+' },
      { type: 'other', text: ' ' },
      { type: 'number', text: '2' }
    ])
  })
})

import { describe, expect, it } from 'vitest'
import {
  extractJsonFromAction,
  formatJson,
  formatJsonPath,
  parseJson,
  replaceValueAtPath,
  sortObjectKeys
} from '../src/json-utils.js'

describe('parseJson', () => {
  it('parses strict JSON first', () => {
    expect(parseJson('{"ok":true}')).toEqual({ value: { ok: true }, mode: 'json' })
  })

  it('supports JSON5 syntax when enabled', () => {
    expect(parseJson('{name:"ztools", trailing:true,}')).toEqual({
      value: { name: 'ztools', trailing: true },
      mode: 'json5'
    })
  })

  it('rejects JSON5 when compatibility is disabled', () => {
    expect(() => parseJson('{name:1}', { allowJson5: false })).toThrow('JSON 格式错误')
  })

  it('reports line information for invalid input', () => {
    expect(() => parseJson('{\n  "a": 1,\n  "b": @\n}')).toThrow(/第 3 行/)
  })
})

describe('formatJson', () => {
  it('always formats with two-space indentation', () => {
    const text = formatJson('{"a":{"b":1}}').text
    expect(text).toContain('\n    "b"')
    expect(text).not.toContain('\n        "b"')
  })

  it('sorts nested object keys without reordering arrays', () => {
    const value = sortObjectKeys({ z: { b: 1, a: 2 }, a: [{ y: 1, x: 2 }] })
    expect(Object.keys(value)).toEqual(['a', 'z'])
    expect(Object.keys(value.a[0])).toEqual(['x', 'y'])
  })
})

describe('tree helpers', () => {
  it('formats safe and unsafe path segments', () => {
    expect(formatJsonPath(['user', 0, 'display-name'])).toBe('$.user[0]["display-name"]')
  })

  it('replaces a nested value without mutating the original', () => {
    const original = { a: [{ b: 1 }] }
    const next = replaceValueAtPath(original, ['a', 0, 'b'], 2)
    expect(next).toEqual({ a: [{ b: 2 }] })
    expect(original.a[0].b).toBe(1)
  })
})

describe('ZTools action extraction', () => {
  it('extracts regex payload text', () => {
    expect(extractJsonFromAction({ type: 'regex', payload: { text: ' {"a":1} ' } })).toBe('{"a":1}')
  })
})

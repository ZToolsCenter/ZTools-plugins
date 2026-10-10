import { describe, expect, it } from 'vitest'
import {
  createJsonPreview,
  createNodeEditor,
  extractJsonFromAction,
  formatJson,
  formatJsonPath,
  parseJson,
  replaceValueAtPath,
  sortObjectKeys,
  valueToClipboardText
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

describe('JSON string previews', () => {
  it('shows embedded JSON without escapes while preserving the formatted source', () => {
    const value = { data: '{"name":"张三","age":18}' }
    const result = formatJson(JSON.stringify(value))
    const preview = createJsonPreview(result.text)
    expect(preview.text).toBe('{\n  "data": "{"name":"张三","age":18}"\n}')
    expect(preview.getSourceText()).toBe(result.text)
    expect(JSON.parse(preview.getSourceText())).toEqual(value)
    expect(result.value.data).toBe(value.data)
  })

  it('handles root strings, arrays and multiple strings with literal backslashes', () => {
    const values = ['{"a":1}', ['{"a":1}', 'C:\\temp', { nested: '{"b":2}' }]]
    for (const value of values) {
      const source = JSON.stringify(value, null, 2)
      const preview = createJsonPreview(source)
      expect(preview.text).not.toContain('\\"')
      expect(preview.getSourceText()).toBe(source)
      expect(JSON.parse(preview.getSourceText())).toEqual(value)
    }
    expect(createJsonPreview(JSON.stringify('C:\\temp')).text).toBe('"C:\\temp"')
  })

  it('preserves keys and control-character escapes', () => {
    const source = JSON.stringify({ 'quoted"key': '{"line":"first\\nsecond"}', control: '\n\r\t\u0000' }, null, 2)
    const preview = createJsonPreview(source)
    expect(preview.text).toContain('"quoted\\"key": "{"line":"first\\nsecond"}"')
    expect(preview.text).toContain('"control": "\\n\\r\\t\\u0000"')
    expect(preview.getSourceText()).toBe(source)
  })

  it('maps selected values back to escaped source across multiple preview strings', () => {
    const value = { first: '{"a":1}', second: '{"b":"张三"}', last: true }
    const preview = createJsonPreview(JSON.stringify(value, null, 2))
    for (const text of [value.first, value.second]) {
      const start = preview.text.indexOf(`"${text}"`)
      const selection = preview.getSourceText(start, start + text.length + 2)
      expect(JSON.parse(selection)).toBe(text)
    }
    const keyStart = preview.text.indexOf('"second":')
    const keyEnd = preview.text.indexOf('"last":')
    expect(preview.getSourceText(keyStart, keyEnd)).toBe(`"second": ${JSON.stringify(value.second)},\n  `)
    const quoteStart = preview.text.indexOf('"a"')
    expect(preview.getSourceText(quoteStart, quoteStart + 1)).toBe('\\"')
  })

  it('leaves data without escaped string values unchanged', () => {
    for (const value of [null, 42, true, { list: [false, null, 'plain'] }]) {
      const source = JSON.stringify(value, null, 2)
      const preview = createJsonPreview(source)
      expect(preview.text).toBe(source)
      expect(preview.getSourceText()).toBe(source)
    }
    expect(createJsonPreview('').getSourceText()).toBe('')
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

describe('node value editor', () => {
  it('shows embedded JSON without escapes and preserves string type when applying', () => {
    const value = '{"name":"张三","age":18}'
    const editor = createNodeEditor(value)
    expect(editor.text).toBe('"{"name":"张三","age":18}"')
    expect(editor.parse(editor.text)).toBe(value)
    const changed = editor.parse('"{"name":"李四","age":20}"')
    expect(changed).toBe('{"name":"李四","age":20}')
    const updated = replaceValueAtPath({ data: value }, ['data'], changed)
    expect(JSON.parse(JSON.stringify(updated))).toEqual({ data: '{"name":"李四","age":20}' })
  })

  it('preserves literal quotes, backslashes and control characters in edited strings', () => {
    const editor = createNodeEditor('C:\\temp\n"quoted"')
    expect(editor.parse(editor.text)).toBe('C:\\temp\n"quoted"')
    expect(editor.parse(editor.text.replace('temp', 'logs'))).toBe('C:\\logs\n"quoted"')
    const windowsLines = createNodeEditor('first\r\nsecond\rlast')
    expect(windowsLines.text).toBe('"first\nsecond\nlast"')
    expect(windowsLines.parse(windowsLines.text)).toBe('first\r\nsecond\rlast')
    expect(JSON.parse(windowsLines.getSourceText(windowsLines.text, 0, windowsLines.text.length))).toBe('first\r\nsecond\rlast')
  })

  it('copies full and partial selections with the necessary JSON escapes', () => {
    const value = '{"name":"张三","age":18}'
    const editor = createNodeEditor(value)
    expect(editor.getSourceText(editor.text, 0, editor.text.length)).toBe(JSON.stringify(value))
    const start = editor.text.indexOf('"name"')
    expect(editor.getSourceText(editor.text, start, start + 6)).toBe('\\"name\\"')
    const changed = editor.text.replace('张三', '李四')
    expect(JSON.parse(editor.getSourceText(changed, 0, changed.length))).toBe(value.replace('张三', '李四'))
  })

  it('still allows changing a string node to a different JSON type', () => {
    const editor = createNodeEditor('{"a":1}')
    expect(editor.parse('{"a":2}')).toEqual({ a: 2 })
    expect(editor.parse('42')).toBe(42)
    expect(editor.parse('null')).toBeNull()
    expect(() => editor.parse('{broken')).toThrow('JSON 格式错误')
  })

  it('keeps non-string nodes editable as JSON and respects JSON5 settings', () => {
    const editor = createNodeEditor({ data: '{"a":1}' })
    expect(editor.text).toBe('{\n  "data": "{"a":1}"\n}')
    expect(editor.parse(editor.text)).toEqual({ data: '{"a":1}' })
    expect(editor.parse('{value:2,}', { allowJson5: true })).toEqual({ value: 2 })
    expect(() => editor.parse('{value:2,}', { allowJson5: false })).toThrow('JSON 格式错误')
  })

  it('unescapes nested strings in root objects and arrays without changing their values', () => {
    const value = { data: '{"name":"张三","age":19}', nested: [{ text: '{"ok":true}' }] }
    for (const root of [value, [value]]) {
      const editor = createNodeEditor(root)
      expect(editor.text).not.toContain('\\"')
      expect(editor.parse(editor.text)).toEqual(root)
      const copied = editor.getSourceText(editor.text, 0, editor.text.length)
      expect(copied).toBe(JSON.stringify(root, null, 2))
      expect(JSON.parse(copied)).toEqual(root)
    }
  })

  it('saves changes made inside an unescaped string from the root editor', () => {
    const value = { data: '{"name":"张三","age":19}', count: 1 }
    const editor = createNodeEditor(value)
    let edited = editor.text.replace('张三', '李四').replace('19', '20')
    editor.update(edited)
    edited = edited.replace('"count": 1', '"count": 2')
    editor.update(edited)
    const nextValue = editor.parse(edited)
    expect(nextValue).toEqual({ data: '{"name":"李四","age":20}', count: 2 })
    expect(JSON.parse(editor.getSourceText(edited, 0, edited.length))).toEqual(nextValue)
  })

  it('preserves literal backslashes and encodes newly inserted quotes in root string fields', () => {
    const editor = createNodeEditor({ path: 'C:\\temp', plain: 'hello' })
    let edited = editor.text.replace('temp', 'logs')
    editor.update(edited)
    edited = edited.replace('hello', 'say "hello"')
    editor.update(edited)
    expect(editor.parse(edited)).toEqual({ path: 'C:\\logs', plain: 'say "hello"' })
  })
})

describe('node value clipboard rules', () => {
  it('preserves JSON escapes and types when copying root nodes', () => {
    for (const value of [{ data: '{"name":"张三","age":19}' }, '{"ok":true}', ['{"a":1}']]) {
      const copied = valueToClipboardText(value, { isRoot: true })
      expect(copied).toContain('\\"')
      expect(JSON.parse(copied)).toEqual(value)
    }
  })

  it('copies child strings as their raw values and unescapes strings inside child containers', () => {
    const text = '{"name":"张三","age":19}'
    expect(valueToClipboardText(text)).toBe(text)
    expect(valueToClipboardText({ data: text })).toBe('{\n  "data": "{"name":"张三","age":19}"\n}')
    expect(valueToClipboardText([text])).toBe('[\n  "{"name":"张三","age":19}"\n]')
    expect(valueToClipboardText(null)).toBe('null')
    expect(valueToClipboardText(42)).toBe('42')
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

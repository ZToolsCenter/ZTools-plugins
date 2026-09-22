import { describe, expect, it } from 'vitest'
import { format, minify } from './text-utils'

describe('json', () => {
  it('formats with default indent 2', () => {
    const r = format({ input: '{"a":1,"b":2}' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toContain('\n')
      expect(r.data).toContain('  ')
    }
  })

  it('formats with custom indent', () => {
    const r = format({ input: '{"a":1}', indent: 4 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toContain('    "a"')
  })

  it('minifies JSON', () => {
    const r = minify({ input: '{\n  "a": 1,\n  "b": 2\n}' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).not.toContain('\n')
      expect(r.data).toBe('{"a":1,"b":2}')
    }
  })

  it('rejects invalid JSON on format', () => {
    const r = format({ input: '{invalid}' })
    expect(r.ok).toBe(false)
  })
})

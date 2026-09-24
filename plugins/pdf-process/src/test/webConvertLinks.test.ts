import { describe, it, expect } from 'vitest'
import {
  DEFAULT_WEB_CONVERT_LINKS,
  resolveWebConvertLinks,
} from '../config/webConvertLinks'

describe('resolveWebConvertLinks', () => {
  it('returns defaults when unset', () => {
    expect(resolveWebConvertLinks(null)).toEqual(DEFAULT_WEB_CONVERT_LINKS)
    expect(resolveWebConvertLinks(undefined)).toEqual(DEFAULT_WEB_CONVERT_LINKS)
  })

  it('respects empty arrays for a format', () => {
    const resolved = resolveWebConvertLinks({
      word: [],
      excel: DEFAULT_WEB_CONVERT_LINKS.excel,
    })
    expect(resolved.word).toEqual([])
    expect(resolved.excel).toEqual(DEFAULT_WEB_CONVERT_LINKS.excel)
    expect(resolved.ppt).toEqual(DEFAULT_WEB_CONVERT_LINKS.ppt)
  })

  it('filters invalid entries', () => {
    const resolved = resolveWebConvertLinks({
      word: [
        { name: 'ok', url: 'https://example.com' },
        { name: '', url: 'https://bad.com' } as any,
        { name: 'no-url', url: '' } as any,
      ],
    })
    expect(resolved.word).toEqual([{ name: 'ok', url: 'https://example.com' }])
  })

  it('filters non-https URLs', () => {
    const resolved = resolveWebConvertLinks({
      word: [
        { name: 'ok', url: 'https://example.com' },
        { name: 'http', url: 'http://example.com' },
        { name: 'file', url: 'file:///C:/Windows/notepad.exe' },
      ],
    })
    expect(resolved.word).toEqual([{ name: 'ok', url: 'https://example.com' }])
  })
})

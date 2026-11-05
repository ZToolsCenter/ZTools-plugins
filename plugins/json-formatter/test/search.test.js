import { describe, expect, it } from 'vitest'
import { findMatches } from '../src/search.js'

describe('literal text search', () => {
  it('matches literal special characters, supports case sensitivity and empty queries', () => {
    expect(findMatches('a.b A.B axb', 'a.b')).toEqual([{ start: 0, end: 3 }, { start: 4, end: 7 }])
    expect(findMatches('a.b A.B', 'a.b', true)).toEqual([{ start: 0, end: 3 }])
    expect(findMatches('abc', '')).toEqual([])
    expect(findMatches('aaa', 'aa')).toEqual([{ start: 0, end: 2 }])
  })

  it('preserves offsets for Chinese, emoji and Unicode case folding', () => {
    expect(findMatches('😀张三 张三', '张三')).toEqual([{ start: 2, end: 4 }, { start: 5, end: 7 }])
    expect(findMatches('İX x', 'x')).toEqual([{ start: 1, end: 2 }, { start: 3, end: 4 }])
  })
})


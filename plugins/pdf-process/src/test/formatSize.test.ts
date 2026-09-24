import { describe, it, expect } from 'vitest'
import { formatFileSize } from '../utils/formatSize'

describe('formatFileSize', () => {
  it('formats bytes', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(1024)).toBe('1.00 KB')
    expect(formatFileSize(59.38 * 1024 * 1024)).toMatch(/MB/)
  })
})

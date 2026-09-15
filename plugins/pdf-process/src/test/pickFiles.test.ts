import { describe, it, expect, vi, beforeEach } from 'vitest'
import { coerceOpenDialogPaths, pickPdfFiles } from '../utils/pickFiles'

describe('coerceOpenDialogPaths', () => {
  it('accepts string arrays', () => {
    expect(coerceOpenDialogPaths(['a.pdf', 'b.pdf'])).toEqual(['a.pdf', 'b.pdf'])
  })

  it('filters empty and trims', () => {
    expect(coerceOpenDialogPaths(['', ' a.pdf '])).toEqual(['a.pdf'])
  })

  it('handles electron async shape', () => {
    expect(
      coerceOpenDialogPaths({ canceled: false, filePaths: ['x.pdf'] }),
    ).toEqual(['x.pdf'])
    expect(coerceOpenDialogPaths({ canceled: true, filePaths: ['x.pdf'] })).toEqual([])
  })

  it('handles file:// URLs and quoted paths', () => {
    expect(coerceOpenDialogPaths('file:///C:/Users/a/x.pdf')).toEqual([
      'C:\\Users\\a\\x.pdf',
    ])
    expect(coerceOpenDialogPaths(['"C:\\a\\b.pdf"'])).toEqual(['C:\\a\\b.pdf'])
  })

  it('handles single path string', () => {
    expect(coerceOpenDialogPaths('C:\\docs\\a.pdf')).toEqual(['C:\\docs\\a.pdf'])
  })
})

describe('pickPdfFiles', () => {
  beforeEach(() => {
    vi.mocked(window.ztools.showOpenDialog).mockReset()
  })

  it('awaits promise results', async () => {
    vi.mocked(window.ztools.showOpenDialog).mockReturnValue(
      Promise.resolve(['/tmp/a.pdf']) as any,
    )
    await expect(pickPdfFiles()).resolves.toEqual(['/tmp/a.pdf'])
  })

  it('handles sync arrays', async () => {
    vi.mocked(window.ztools.showOpenDialog).mockReturnValue(['/tmp/b.pdf'] as any)
    await expect(pickPdfFiles({ multiple: false })).resolves.toEqual(['/tmp/b.pdf'])
  })

  it('handles { filePaths } promise', async () => {
    vi.mocked(window.ztools.showOpenDialog).mockReturnValue(
      Promise.resolve({ canceled: false, filePaths: ['/c.pdf'] }) as any,
    )
    await expect(pickPdfFiles()).resolves.toEqual(['/c.pdf'])
  })
})

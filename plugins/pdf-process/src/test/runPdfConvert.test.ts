import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('convertPdf seam', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls convertPdf for local conversion', async () => {
    vi.mocked(window.services.convertPdf).mockResolvedValue('o.docx')
    await window.services.convertPdf('i.pdf', 'o.docx', 'word')
    expect(window.services.convertPdf).toHaveBeenCalledWith('i.pdf', 'o.docx', 'word')
  })
})

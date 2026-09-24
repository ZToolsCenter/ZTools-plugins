import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '../App'
import React from 'react'

vi.mock('../utils/pdfThumb', () => ({
  renderPdfFirstPageThumb: vi.fn(async () => ({
    thumbUrl: 'data:image/jpeg;base64,xx',
    pageCount: 3,
  })),
  renderPdfAllPageThumbs: vi.fn(async (_src: unknown, opts?: { onPage?: Function }) => {
    const pageCount = 3
    const thumbs = Array.from({ length: pageCount }, (_, i) => 'data:image/jpeg;base64,p' + i)
    thumbs.forEach((url, i) => opts?.onPage?.(i + 1, url, pageCount))
    return { pageCount, thumbs }
  }),
}))

function makePdfFile(name: string, size = 2048) {
  return new File([new Uint8Array(size)], name, { type: 'application/pdf' })
}

describe('shared files across routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(window.ztools.onPluginEnter).mockImplementation(() => {})
    vi.mocked(window.ztools.onPluginOut).mockImplementation(() => {})
    vi.mocked(window.ztools.getPathForFile).mockImplementation((f: File) => '/mock/' + f.name)
  })

  it('keeps files when switching sidebar tabs', async () => {
    const { container } = render(<App />)
    expect(container.querySelector('.feature-title')?.textContent).toBe('PDF 压缩')

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toBeTruthy()
    fireEvent.change(input, { target: { files: [makePdfFile('demo.pdf', 4096)] } })

    await waitFor(() => {
      expect(screen.getByText('demo.pdf')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('PDF 合并'))
    await waitFor(() => {
      expect(container.querySelector('.feature-title')?.textContent).toBe('PDF 合并')
      expect(screen.getByText('demo.pdf')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('PDF 拆分'))
    await waitFor(() => {
      expect(container.querySelector('.feature-title')?.textContent).toBe('PDF 拆分')
      // Split shows page grid; filename may be truncated (demo.pdf → demo)
      expect(container.querySelector('.split-card-name')?.textContent).toMatch(/demo/)
    })

    await waitFor(() => {
      // 3 page thumbs from mock
      expect(container.querySelectorAll('.split-cell').length).toBe(3)
      // Default mode is extract — no pages selected yet
      expect(screen.getByText(/尚未选择页码|将提取/)).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: '提取指定页' })).toBeInTheDocument()
    })

    // Typing 2-3 should plan an extract of those pages
    const spec = container.querySelector('#split-spec-input') as HTMLInputElement
    expect(spec).toBeTruthy()
    fireEvent.focus(spec)
    fireEvent.change(spec, { target: { value: '2-3' } })
    fireEvent.blur(spec)
    await waitFor(() => {
      expect(screen.getByText(/将提取为 1 个文件/)).toBeInTheDocument()
      expect(container.querySelectorAll('.split-plan-chip').length).toBeGreaterThan(0)
    })
  })
})

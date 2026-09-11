import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import App from '../App'
import React from 'react'

vi.mock('../utils/pdfThumb', () => ({
  renderPdfFirstPageThumb: vi.fn(async () => ({ thumbUrl: 'data:image/jpeg;base64,x', pageCount: 1 })),
  renderPdfAllPageThumbs: vi.fn(async () => ({ pageCount: 1, thumbs: ['data:image/jpeg;base64,x'] })),
}))

describe('App.tsx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(window.ztools.onPluginEnter).mockImplementation(() => {})
    vi.mocked(window.ztools.onPluginOut).mockImplementation(() => {})
  })

  it('opens settings modal when sidebar settings is clicked', () => {
    render(<App />)
    fireEvent.click(screen.getByText('设置'))
    expect(screen.getByRole('heading', { level: 2, name: '设置' })).toBeInTheDocument()
  })

  it('renders without crashing', () => {
    expect(() => render(<App />)).not.toThrow()
  })

  it('renders sidebar with menu items', () => {
    render(<App />)
    expect(screen.getByText('PDF 操作')).toBeInTheDocument()
    expect(screen.getByText('PDF 格式转换')).toBeInTheDocument()
  })

  it('defaults to compress feature', () => {
    const { container } = render(<App />)
    expect(container.querySelector('.feature-title')?.textContent).toBe('PDF 压缩')
  })

  it('routes to merge feature via plugin enter', async () => {
    let onEnterCallback: (action: any) => void = () => {}
    vi.mocked(window.ztools.onPluginEnter).mockImplementation((cb: any) => {
      onEnterCallback = cb
    })
    const { container } = render(<App />)
    await act(async () => {
      onEnterCallback({ code: 'merge', type: 'text', payload: 'pdf merge' })
    })
    expect(container.querySelector('.feature-title')?.textContent).toBe('PDF 合并')
  })

  it('routes via sidebar click', () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByText('PDF 合并'))
    expect(container.querySelector('.feature-title')?.textContent).toBe('PDF 合并')
  })
})

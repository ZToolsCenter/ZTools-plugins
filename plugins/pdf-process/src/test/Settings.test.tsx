import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Settings from '../components/Settings'
import React from 'react'

describe('Settings component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Save functionality', () => {
    it('calls saveSettings when save button clicked', async () => {
      vi.mocked(window.services.getSettings).mockResolvedValue(null)
      vi.mocked(window.services.saveSettings).mockResolvedValue()

      render(<Settings onClose={() => {}} />)

      const saveBtn = await screen.findByText('保存')
      fireEvent.click(saveBtn)

      await waitFor(() => {
        expect(window.services.saveSettings).toHaveBeenCalled()
      })
    })
  })

  describe('Settings modal', () => {
    it('calls onClose when cancel is clicked', async () => {
      vi.mocked(window.services.getSettings).mockResolvedValue(null)

      const onClose = vi.fn()
      render(<Settings onClose={onClose} />)

      const cancelBtn = await screen.findByText('取消')
      fireEvent.click(cancelBtn)
      expect(onClose).toHaveBeenCalled()
    })

    it('does not show general settings section', async () => {
      vi.mocked(window.services.getSettings).mockResolvedValue(null)
      render(<Settings onClose={() => {}} />)
      await waitFor(() => {
        expect(screen.getByText('推荐网站')).toBeInTheDocument()
      })
      expect(screen.queryByText('通用设置')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('默认压缩质量')).not.toBeInTheDocument()
    })
  })

  describe('Web convert links', () => {
    it('shows default recommend links and can restore defaults', async () => {
      vi.mocked(window.services.getSettings).mockResolvedValue(null)

      render(<Settings onClose={() => {}} />)

      await waitFor(() => {
        expect(screen.getByText('推荐网站')).toBeInTheDocument()
      })
      expect(screen.getAllByDisplayValue('pdf.io').length).toBeGreaterThan(0)
      expect(screen.getByText('恢复默认')).toBeInTheDocument()
    })

    it('saves customized web convert links', async () => {
      vi.mocked(window.services.getSettings).mockResolvedValue({
        webConvertLinks: {
          word: [{ name: 'Custom', url: 'https://example.com/word' }],
          excel: [],
          ppt: [],
        },
      })
      vi.mocked(window.services.saveSettings).mockResolvedValue()

      render(<Settings onClose={() => {}} />)

      await waitFor(() => {
        expect(screen.getByDisplayValue('Custom')).toBeInTheDocument()
      })

      const saveBtn = await screen.findByText('保存')
      fireEvent.click(saveBtn)

      await waitFor(() => {
        expect(window.services.saveSettings).toHaveBeenCalled()
        const arg = vi.mocked(window.services.saveSettings).mock.calls[0][0] as any
        expect(arg.webConvertLinks.word[0].name).toBe('Custom')
      })
    })
  })
})

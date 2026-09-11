import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import React from 'react'
import { SharedFilesProvider, useSharedFiles } from '../context/SharedFilesContext'

vi.mock('../utils/pdfThumb', () => ({
  renderPdfFirstPageThumb: vi.fn(async () => ({
    thumbUrl: 'data:image/jpeg;base64,thumb',
    pageCount: 2,
  })),
  renderPdfAllPageThumbs: vi.fn(async () => ({ pageCount: 2, thumbs: [] })),
}))

function Probe({ onReady }: { onReady: (api: ReturnType<typeof useSharedFiles>) => void }) {
  const api = useSharedFiles()
  React.useEffect(() => {
    onReady(api)
  }, [api, onReady])
  return (
    <div>
      <span data-testid="count">{api.files.length}</span>
      <span data-testid="selected">{api.selectedIds.length}</span>
      <span data-testid="has-raw">{api.files[0]?.rawFile ? 'yes' : 'no'}</span>
      <span data-testid="thumb">{api.files[0]?.thumbStatus || ''}</span>
      <span data-testid="size">{api.files[0]?.size ?? -1}</span>
    </div>
  )
}

describe('SharedFiles addPaths hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(window.services.statFile!).mockReturnValue({ size: 12345 })
    vi.mocked(window.services.readFileBase64!).mockReturnValue(
      // minimal not-a-real-pdf; thumb mock doesn't parse it
      btoa('fake-pdf-bytes'),
    )
  })

  it('hydrates path-only files with size, rawFile and starts thumb', async () => {
    let api: ReturnType<typeof useSharedFiles> | null = null
    const { getByTestId } = render(
      <SharedFilesProvider>
        <Probe onReady={(a) => { api = a }} />
      </SharedFilesProvider>,
    )

    await waitFor(() => expect(api).toBeTruthy())

    await act(async () => {
      api!.addPaths(['C:\\\\docs\\\\report.pdf'])
    })

    await waitFor(() => {
      expect(getByTestId('count').textContent).toBe('1')
      expect(getByTestId('selected').textContent).toBe('1')
      expect(getByTestId('has-raw').textContent).toBe('yes')
      expect(Number(getByTestId('size').textContent)).toBeGreaterThan(0)
    })

    await waitFor(() => {
      expect(['loading', 'ready', 'idle']).toContain(getByTestId('thumb').textContent)
    })

    expect(window.services.readFileBase64).toHaveBeenCalled()
    expect(window.services.statFile).toHaveBeenCalled()
  })

  it('selects newly added files so convert targets them', async () => {
    let api: ReturnType<typeof useSharedFiles> | null = null
    const { getByTestId } = render(
      <SharedFilesProvider>
        <Probe onReady={(a) => { api = a }} />
      </SharedFilesProvider>,
    )
    await waitFor(() => expect(api).toBeTruthy())

    await act(async () => {
      api!.addPaths(['C:\\\\a.pdf', 'C:\\\\b.pdf'])
    })

    await waitFor(() => {
      expect(getByTestId('count').textContent).toBe('2')
      expect(getByTestId('selected').textContent).toBe('2')
    })
  })
})

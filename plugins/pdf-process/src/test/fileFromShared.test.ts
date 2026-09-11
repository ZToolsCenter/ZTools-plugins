import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  materializeInputPath,
  resolveInputPath,
  withInputPath,
  withInputPaths,
} from '../utils/fileFromShared'
import type { SharedFile } from '../context/SharedFilesContext'

function makeFile(overrides: Partial<SharedFile> = {}): SharedFile {
  return {
    id: '1',
    path: 'C:\\docs\\a.pdf',
    name: 'a.pdf',
    size: 10,
    thumbStatus: 'idle',
    ...overrides,
  }
}

describe('resolveInputPath', () => {
  beforeEach(() => vi.clearAllMocks())

  it('prefers a real path from the browser File', () => {
    vi.mocked(window.ztools.getPathForFile!).mockReturnValue('C:\\docs\\real.pdf')
    const file = makeFile({ rawFile: new File(['x'], 'a.pdf') })
    expect(resolveInputPath(file)).toBe('C:\\docs\\real.pdf')
  })

  it('returns empty when the browser File has no disk path', () => {
    vi.mocked(window.ztools.getPathForFile!).mockReturnValue('')
    const file = makeFile({ rawFile: new File(['x'], 'a.pdf') })
    expect(resolveInputPath(file)).toBe('')
  })

  it('uses the path for path-only entries', () => {
    expect(resolveInputPath(makeFile())).toBe('C:\\docs\\a.pdf')
  })
})

describe('withInputPath', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the direct path without materializing', async () => {
    vi.mocked(window.ztools.getPathForFile!).mockReturnValue('C:\\docs\\real.pdf')
    const result = await withInputPath(
      makeFile({ rawFile: new File(['x'], 'a.pdf') }),
      async (inputPath) => {
        expect(inputPath).toBe('C:\\docs\\real.pdf')
        return 'ok'
      },
    )
    expect(result).toBe('ok')
    expect(window.services.writeFileBase64).not.toHaveBeenCalled()
  })

  it('materializes browser-only bytes under pdf-tmp and deletes them', async () => {
    vi.mocked(window.ztools.getPathForFile!).mockReturnValue('')
    vi.mocked(window.services.deleteFile!).mockReturnValue(true)
    let seen = ''
    const result = await withInputPath(
      makeFile({ rawFile: new File(['pdf-bytes'], 'a.pdf') }),
      async (inputPath) => {
        seen = inputPath
        expect(inputPath).toContain('pdf-tmp')
        expect(inputPath.endsWith('a.pdf')).toBe(true)
        return 'ok'
      },
    )
    expect(result).toBe('ok')
    expect(window.services.writeFileBase64).toHaveBeenCalledTimes(1)
    expect(window.services.deleteFile).toHaveBeenCalledWith(seen)
  })

  it('uses the stored path for path-only entries', async () => {
    const result = await withInputPath(makeFile(), async (inputPath) => {
      expect(inputPath).toBe('C:\\docs\\a.pdf')
      return 'ok'
    })
    expect(result).toBe('ok')
  })
})

describe('withInputPaths', () => {
  beforeEach(() => vi.clearAllMocks())

  it('preserves order and cleans only materialized temps', async () => {
    vi.mocked(window.ztools.getPathForFile!).mockReturnValue('')
    vi.mocked(window.services.deleteFile!).mockReturnValue(true)
    const first = makeFile({ id: '1', name: 'a.pdf', rawFile: new File(['a'], 'a.pdf') })
    const second = makeFile({ id: '2', path: 'C:\\docs\\b.pdf' })
    const third = makeFile({ id: '3', name: 'c.pdf', rawFile: new File(['c'], 'c.pdf') })

    await withInputPaths([first, second, third], async (inputPaths) => {
      expect(inputPaths[0]).toContain('pdf-tmp')
      expect(inputPaths[1]).toBe('C:\\docs\\b.pdf')
      expect(inputPaths[2]).toContain('pdf-tmp')
      return 'ok'
    })

    expect(window.services.writeFileBase64).toHaveBeenCalledTimes(2)
    expect(window.services.deleteFile).toHaveBeenCalledTimes(2)
  })
})

describe('materializeInputPath', () => {
  it('returns the path written by writeFileBase64', async () => {
    vi.mocked(window.services.writeFileBase64!).mockImplementation(
      (_base64: string, outputPath: string) => outputPath,
    )
    const file = makeFile({ name: '合同 1.pdf', rawFile: new File(['x'], '合同 1.pdf') })
    const saved = await materializeInputPath(file)
    expect(saved).toContain('pdf-tmp')
    expect(saved.endsWith('合同 1.pdf')).toBe(true)
  })
})

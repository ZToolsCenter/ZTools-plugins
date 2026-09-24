import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFileQueue } from './useFileQueue'
import type { FileStats } from '@/core/types'

const stats = (isDirectory: boolean, size: number): FileStats => ({
  isFile: !isDirectory,
  isDirectory,
  size,
  mtimeMs: 100,
  ctimeMs: 90,
  birthtimeMs: 80
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('file queue directory browsing', () => {
  it('keeps imported directories as root nodes and loads children on demand', async () => {
    vi.stubGlobal('window', {
      services: {
        getStats: vi.fn(async (targetPath: string) => stats(targetPath.endsWith('Photos'), 4096)),
        readDirectory: vi.fn(async () => [
          { name: 'Vacation', path: 'C:\\Work\\Photos\\Vacation', ...stats(true, 4096) },
          { name: 'beach.jpg', path: 'C:\\Work\\Photos\\beach.jpg', ...stats(false, 2048) }
        ])
      }
    })

    const queue = useFileQueue()
    const result = await queue.importPaths(['C:\\Work\\Alpha.txt', 'C:\\Work\\Photos'])

    expect(result).toEqual({ imported: 2, skipped: 0, duplicates: 0 })
    expect(queue.rootItems.value.map((item) => [item.originalName, item.isDirectory]))
      .toEqual([['Alpha.txt', false], ['Photos', true]])

    const opened = await queue.openDirectory(queue.rootItems.value[1])
    expect(opened).toBe(true)
    expect(queue.breadcrumbs.value).toEqual([{ name: 'Photos', path: 'C:\\Work\\Photos' }])
    expect(queue.visibleItems.value.map((item) => item.originalName)).toEqual(['Vacation', 'beach.jpg'])

    await queue.navigateToBreadcrumb(-1)
    expect(queue.visibleItems.value.map((item) => item.originalName)).toEqual(['Alpha.txt', 'Photos'])
  })

  it('does not add duplicate Windows paths with different casing', async () => {
    vi.stubGlobal('window', {
      services: {
        getStats: vi.fn(async () => stats(false, 128)),
        readDirectory: vi.fn(async () => [])
      }
    })

    const queue = useFileQueue()
    await queue.importPaths(['C:\\Work\\Alpha.txt'])
    const result = await queue.importPaths(['c:\\work\\alpha.txt'])

    expect(result).toEqual({ imported: 0, skipped: 0, duplicates: 1 })
    expect(queue.rootItems.value).toHaveLength(1)
  })
})

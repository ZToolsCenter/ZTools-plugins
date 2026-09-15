import { describe, expect, it } from 'vitest'
import {
  createFileItem,
  formatClipboardItems,
  getExtension,
  getNameFromPath,
  isAbsoluteFilePath,
  uniquePaths
} from './file-items'
import type { FileItem, FileStats } from './types'

const fileStats: FileStats = {
  isFile: true,
  isDirectory: false,
  size: 128,
  mtimeMs: 100,
  ctimeMs: 90,
  birthtimeMs: 80
}

describe('file item paths', () => {
  it('recognizes desktop absolute path formats', () => {
    expect(isAbsoluteFilePath('C:\\Users\\demo\\file.txt')).toBe(true)
    expect(isAbsoluteFilePath('\\\\server\\share\\file.txt')).toBe(true)
    expect(isAbsoluteFilePath('/home/demo/file.txt')).toBe(true)
    expect(isAbsoluteFilePath('folder/file.txt')).toBe(false)
  })

  it('gets names from files and directories with trailing separators', () => {
    expect(getNameFromPath('C:\\Users\\demo\\file.txt')).toBe('file.txt')
    expect(getNameFromPath('/home/demo/folder/')).toBe('folder')
    expect(getExtension('.gitignore')).toBe('')
  })

  it('deduplicates Windows paths case-insensitively without changing order', () => {
    expect(uniquePaths([
      ' C:\\Work\\Report.pdf ',
      'c:\\work\\report.pdf',
      '/tmp/report.pdf',
      'relative.txt'
    ])).toEqual(['C:\\Work\\Report.pdf', '/tmp/report.pdf'])
  })
})

describe('directory nodes', () => {
  it('preserves a directory as one item instead of expanding it', () => {
    const directory = createFileItem('C:\\Work\\Photos', {
      ...fileStats,
      isFile: false,
      isDirectory: true,
      size: 4096
    })

    expect(directory).toMatchObject({
      originalName: 'Photos',
      path: 'C:\\Work\\Photos',
      isDirectory: true,
      extension: '',
      size: 4096
    })
  })
})

describe('clipboard formats', () => {
  const items = [
    { originalName: 'A.txt', path: 'C:\\Work\\A.txt' },
    { originalName: 'Folder', path: 'C:\\Work\\Folder' }
  ] as FileItem[]

  it('formats paths as newline-delimited text', () => {
    expect(formatClipboardItems(items, { field: 'path', format: 'text' }))
      .toBe('C:\\Work\\A.txt\nC:\\Work\\Folder')
  })

  it('formats names as newline-delimited text', () => {
    expect(formatClipboardItems(items, { field: 'name', format: 'text' }))
      .toBe('A.txt\nFolder')
  })

  it('formats paths as a JSON string array', () => {
    expect(formatClipboardItems(items, { field: 'path', format: 'json' }))
      .toBe('[\n  "C:\\\\Work\\\\A.txt",\n  "C:\\\\Work\\\\Folder"\n]')
  })

  it('formats names as a JSON string array', () => {
    expect(formatClipboardItems(items, { field: 'name', format: 'json' }))
      .toBe('[\n  "A.txt",\n  "Folder"\n]')
  })
})

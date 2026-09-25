import { describe, expect, it } from 'vitest'
import { sortFiles } from './sort'
import type { FileItem, SortMode } from './session'

function item(id: string, currentName: string, values: Partial<FileItem> = {}): FileItem {
  return {
    id, sourcePath: `C:\\files\\${currentName}`, directory: 'C:\\files', currentName,
    baseName: currentName, extension: '', ...values
  }
}

const modes: SortMode[] = [
  'name-asc', 'name-desc', 'size-asc', 'size-desc',
  'modified-asc', 'modified-desc', 'created-asc', 'created-desc'
]

describe('sortFiles', () => {
  it.each(modes)('sorts with %s', (mode) => {
    const files = [
      item('b', 'file10', { size: 10, modifiedAt: 10, createdAt: 10 }),
      item('a', 'file2', { size: 2, modifiedAt: 2, createdAt: 2 })
    ]
    const result = sortFiles(files, mode)
    const ascending = mode.endsWith('-asc')
    expect(result.map((file) => file.id)).toEqual(ascending ? ['a', 'b'] : ['b', 'a'])
    expect(files.map((file) => file.id)).toEqual(['b', 'a'])
  })

  it('keeps original order for equal and missing numeric values', () => {
    const files = [
      item('first', 'a', { size: 2 }),
      item('missing', 'b'),
      item('second', 'c', { size: 2 })
    ]
    expect(sortFiles(files, 'size-asc').map((file) => file.id)).toEqual(['first', 'second', 'missing'])
    expect(sortFiles(files, 'size-desc').map((file) => file.id)).toEqual(['first', 'second', 'missing'])
  })

  it('uses natural name order and keeps ties stable', () => {
    const files = [item('ten', 'file10'), item('two-a', 'file2'), item('two-b', 'file2')]
    expect(sortFiles(files, 'name-asc').map((file) => file.id)).toEqual(['two-a', 'two-b', 'ten'])
    expect(sortFiles(files, 'name-desc').map((file) => file.id)).toEqual(['ten', 'two-a', 'two-b'])
  })
})

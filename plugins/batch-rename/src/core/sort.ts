import type { FileItem, SortMode } from './session'

const nameCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

function compareOptionalNumber(left?: number, right?: number): number {
  if (left === undefined || !Number.isFinite(left)) return right === undefined || !Number.isFinite(right) ? 0 : 1
  if (right === undefined || !Number.isFinite(right)) return -1
  return left - right
}

export function sortFiles(files: FileItem[], mode: SortMode): FileItem[] {
  const descending = mode.endsWith('-desc')
  const field = mode.slice(0, mode.lastIndexOf('-'))
  const numericKey = field === 'size' ? 'size' : field === 'modified' ? 'modifiedAt' : 'createdAt'

  return files
    .map((file, index) => ({ file, index }))
    .sort((left, right) => {
      let result: number
      if (field === 'name') {
        result = nameCollator.compare(left.file.currentName, right.file.currentName)
      } else {
        result = compareOptionalNumber(left.file[numericKey], right.file[numericKey])
      }
      if (result !== 0) {
        if (field !== 'name' && (left.file[numericKey] === undefined || !Number.isFinite(left.file[numericKey]) ||
          right.file[numericKey] === undefined || !Number.isFinite(right.file[numericKey]))) {
          return result
        }
        return descending ? -result : result
      }
      return left.index - right.index
    })
    .map(({ file }) => file)
}

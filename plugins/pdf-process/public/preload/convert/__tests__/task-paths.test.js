import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { resolveTaskCoords } = require('../../lib/task-paths.js')

const downloads = path.resolve('/users/me/Downloads')

describe('resolveTaskCoords', () => {
  it('builds dir and file under pdf-*', () => {
    const r = resolveTaskCoords(downloads, {
      feature: 'compress',
      taskId: 'task-20260730-1-doc',
      filename: 'out.pdf',
    })
    expect(r.dir).toBe(path.join(downloads, 'pdf-compress', 'task-20260730-1-doc'))
    expect(r.filePath).toBe(path.join(downloads, 'pdf-compress', 'task-20260730-1-doc', 'out.pdf'))
  })

  it('rejects path escape in filename', () => {
    expect(() =>
      resolveTaskCoords(downloads, {
        feature: 'split',
        taskId: 't1',
        filename: '..\\..\\secret.txt',
      }),
    ).toThrow()
  })

  it('dir-only when filename omitted', () => {
    const r = resolveTaskCoords(downloads, { feature: 'word', taskId: 't1' })
    expect(r.filePath).toBeUndefined()
    expect(r.dir).toContain('pdf-word')
  })
})

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  isPathInside,
  assertSafeOutputPath,
  assertSafeInputFile,
  safePathLabel,
  assertSafeExternalUrl,
  isSafeExternalUrl,
} = require('../../path-guard.js')

const downloads = path.resolve('/users/me/Downloads')

describe('isPathInside', () => {
  it('accepts nested paths', () => {
    expect(isPathInside(downloads, path.join(downloads, 'pdf-compress', 'a.pdf'))).toBe(true)
    expect(isPathInside(downloads, downloads)).toBe(true)
  })

  it('rejects escape via ..', () => {
    expect(isPathInside(downloads, path.join(downloads, '..', 'Secrets', 'a.pdf'))).toBe(false)
  })
})

describe('assertSafeOutputPath', () => {
  it('allows downloads/pdf-* paths', () => {
    const p = path.join(downloads, 'pdf-compress', 'task-1', 'out.pdf')
    expect(assertSafeOutputPath(p, downloads)).toBe(path.resolve(p))
  })

  it('rejects paths outside downloads', () => {
    expect(() =>
      assertSafeOutputPath(path.resolve('/tmp/evil.pdf'), downloads),
    ).toThrow(/下载目录/)
  })

  it('rejects downloads root files not under pdf-*', () => {
    expect(() =>
      assertSafeOutputPath(path.join(downloads, 'secret.txt'), downloads),
    ).toThrow(/pdf-\*/)
  })

  it('rejects null bytes', () => {
    expect(() =>
      assertSafeOutputPath(path.join(downloads, 'pdf-x', 'a\0.pdf'), downloads),
    ).toThrow()
  })
})

describe('assertSafeInputFile', () => {
  it('requires an existing file', () => {
    const fakeFs = {
      statSync() {
        const err = new Error('nope')
        err.code = 'ENOENT'
        throw err
      },
    }
    expect(() => assertSafeInputFile('/no/such.pdf', fakeFs)).toThrow(/不存在/)
  })

  it('rejects directories', () => {
    const fakeFs = {
      statSync() {
        return { isFile: () => false }
      },
    }
    expect(() => assertSafeInputFile('/some/dir', fakeFs)).toThrow(/不是文件/)
  })

  it('accepts real files', () => {
    const target = path.resolve('/docs/a.pdf')
    const fakeFs = {
      statSync(p) {
        expect(p).toBe(target)
        return { isFile: () => true }
      },
    }
    expect(assertSafeInputFile(target, fakeFs)).toBe(target)
  })
})

describe('safePathLabel', () => {
  it('returns basename only', () => {
    expect(safePathLabel(path.join('C:\\Users\\a', 'contract.pdf'))).toBe('contract.pdf')
  })
})

describe('assertSafeExternalUrl', () => {
  it('allows https', () => {
    expect(assertSafeExternalUrl('https://example.com/x')).toBe('https://example.com/x')
  })

  it('rejects http, file, javascript', () => {
    expect(() => assertSafeExternalUrl('http://example.com')).toThrow(/https/)
    expect(() => assertSafeExternalUrl('file:///C:/Windows/notepad.exe')).toThrow(/https/)
    expect(() => assertSafeExternalUrl('javascript:alert(1)')).toThrow()
  })

  it('isSafeExternalUrl mirrors assert', () => {
    expect(isSafeExternalUrl('https://a.com')).toBe(true)
    expect(isSafeExternalUrl('http://a.com')).toBe(false)
  })
})

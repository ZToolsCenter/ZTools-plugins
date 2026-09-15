import { describe, it, expect } from 'vitest'
import {
  extractPathsFromPayload,
  resolveEnterRoute,
} from '../components/PluginEnterBridge'

describe('extractPathsFromPayload', () => {
  it('accepts single path string', () => {
    expect(extractPathsFromPayload('C:\\\\a\\\\b.pdf')).toEqual(['C:\\\\a\\\\b.pdf'])
  })

  it('accepts path array', () => {
    expect(extractPathsFromPayload(['/a.pdf', '/b.pdf'])).toEqual(['/a.pdf', '/b.pdf'])
  })

  it('accepts object array with path fields', () => {
    expect(
      extractPathsFromPayload([{ path: 'D:\\\\x.pdf' }, { filePath: 'E:\\\\y.pdf' }]),
    ).toEqual(['D:\\\\x.pdf', 'E:\\\\y.pdf'])
  })

  it('accepts wrapped { files }', () => {
    expect(extractPathsFromPayload({ files: ['/a.pdf'] })).toEqual(['/a.pdf'])
  })
})

describe('resolveEnterRoute', () => {
  it('maps feature codes', () => {
    expect(resolveEnterRoute({ code: 'compress' })).toBe('compress')
    expect(resolveEnterRoute({ code: 'pdfToWord' })).toBe('pdfToWord')
    expect(resolveEnterRoute({ code: 'extractImages' })).toBe('pdfToImage')
  })

  it('maps super-panel pdf_open to compress', () => {
    expect(resolveEnterRoute({ code: 'pdf_open', type: 'files' })).toBe('compress')
  })

  it('files type without code defaults to compress', () => {
    expect(resolveEnterRoute({ type: 'files', from: 'panel' })).toBe('compress')
  })
})

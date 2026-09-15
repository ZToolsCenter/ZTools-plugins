// globals: true in vitest.preload.config.js — do not require('vitest') (Vitest 4 CJS ban)
const { normalizeDocument } = require('../schema.js')

describe('normalizeDocument', () => {
  it('accepts minimal valid document', () => {
    const doc = normalizeDocument({
      pages: [{ blocks: [{ type: 'paragraph', text: 'hello' }] }],
    })
    expect(doc.pages).toHaveLength(1)
    expect(doc.pages[0].blocks[0].text).toBe('hello')
  })

  it('rejects missing pages', () => {
    expect(() => normalizeDocument({})).toThrow(/pages/)
  })

  it('drops unknown block types', () => {
    const doc = normalizeDocument({
      pages: [{ blocks: [{ type: 'paragraph', text: 'a' }, { type: 'magic', text: 'x' }] }],
    })
    expect(doc.pages[0].blocks).toHaveLength(1)
  })

  it('normalizes table cells to strings', () => {
    const doc = normalizeDocument({
      pages: [{ blocks: [{ type: 'table', rows: [[1, null], ['x']] }] }],
    })
    expect(doc.pages[0].blocks[0].rows[0]).toEqual(['1', ''])
  })
})

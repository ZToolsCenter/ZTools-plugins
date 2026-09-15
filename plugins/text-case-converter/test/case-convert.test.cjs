const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
  smartConvert,
  toUpper,
  toLower,
  invertCase,
  hasEnglishLetter,
  convertByCode,
} = require('../dist/case-convert.js')

describe('case-convert', () => {
  it('smartConvert', () => {
    assert.equal(smartConvert('Hello'), 'HELLO')
    assert.equal(smartConvert('HELLO'), 'hello')
    assert.equal(smartConvert('HeLl'), 'HELL')
  })

  it('upper lower invert', () => {
    assert.equal(toUpper('textCase'), 'TEXTCASE')
    assert.equal(toLower('TextCase'), 'textcase')
    assert.equal(invertCase('TextCase'), 'tEXTcASE')
  })

  it('hasEnglishLetter', () => {
    assert.equal(hasEnglishLetter('你好Hi'), true)
    assert.equal(hasEnglishLetter('你好'), false)
  })

  it('convertByCode dispatches naming', () => {
    assert.equal(convertByCode('camel', 'Text Case Converter'), 'textCaseConverter')
    assert.equal(convertByCode('snake', 'textCaseConverter'), 'text_case_converter')
    assert.equal(convertByCode('unknown', 'x'), null)
  })

  it('preserves edge whitespace via convertByCode', () => {
    assert.equal(convertByCode('upper', '  ab\n'), '  AB\n')
    assert.equal(convertByCode('lower', '\tAB  '), '\tab  ')
    assert.equal(convertByCode('invert', '  Ab '), '  aB ')
    assert.equal(convertByCode('smart', '\nHello\n'), '\nHELLO\n')
  })
})

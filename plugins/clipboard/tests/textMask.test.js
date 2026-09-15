import test from 'node:test'
import assert from 'node:assert/strict'
import { maskTextContent } from '../src/utils/textMask.js'

test('keeps three visible characters at both ends of longer content', () => {
  assert.equal(maskTextContent('P@ssw0rd-178452'), `P@s${'•'.repeat(9)}452`)
})

test('keeps one visible character at both ends of short content', () => {
  assert.equal(maskTextContent('178452'), '1••••2')
  assert.equal(maskTextContent('国际化'), '国•化')
})

test('preserves whitespace layout while counting only visible characters', () => {
  assert.equal(maskTextContent('abc def\nxyz'), 'abc •••\nxyz')
})

test('masks very short content completely and handles Unicode code points', () => {
  assert.equal(maskTextContent('🔐🙂'), '••')
  assert.equal(maskTextContent('A'), '•')
})

test('handles empty values without exposing content', () => {
  assert.equal(maskTextContent(''), '')
  assert.equal(maskTextContent(null), '')
  assert.equal(maskTextContent(undefined), '')
})

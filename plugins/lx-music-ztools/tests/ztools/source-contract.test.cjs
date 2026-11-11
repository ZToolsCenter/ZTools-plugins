const { test } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeSources, validateRequest, normalizeResult } = require('../../src-ztools/preload/runtime/source/protocol.cjs')
const { parseInfo } = require('../../src-ztools/preload/runtime/source/manager.cjs')

test('source capability filtering rejects unsupported actions and qualities', () => {
  const sources = normalizeSources({ kw: { type: 'music', actions: ['musicUrl', 'fileRead'], qualitys: ['128k', 'unknown'] } })
  assert.deepEqual(sources, { kw: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } })
  assert.throws(() => validateRequest(sources, { source: 'kw', action: 'fileRead' }))
  assert.throws(() => validateRequest(sources, { source: 'kw', action: 'musicUrl', info: { type: 'flac' } }))
})

test('source results reject file URLs and oversize lyrics before reaching player', () => {
  const input = { source: 'kw', action: 'musicUrl', info: { type: '128k' } }
  assert.throws(() => normalizeResult(input, 'file:///C:/Windows/win.ini'))
  assert.deepEqual(normalizeResult(input, 'https://example.com/audio.mp3'), { source: 'kw', action: 'musicUrl', data: { type: '128k', url: 'https://example.com/audio.mp3' } })
  assert.throws(() => normalizeResult({ source: 'local', action: 'lyric' }, { lyric: 'a'.repeat(51201) }))
})

test('source metadata imports require an LX header and enforce size limit', () => {
  assert.throws(() => parseInfo('alert(1)'), /无效/)
  assert.throws(() => parseInfo('a'.repeat(9_000_001)), /9_000_000/)
  assert.equal(parseInfo('/**\n * @name Test source\n * @version 1.0\n */').name, 'Test source')
})

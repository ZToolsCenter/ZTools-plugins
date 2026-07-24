const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  createListFeature,
  decodeHistory,
  getHistoryCandidates,
  getTyporaLaunch,
  normalizeDate,
  parseHistory,
  toListResults
} = require('./preload')

const fixture = {
  recentFolder: [{ name: 'folder', path: '/tmp/folder', date: '1970-01-01T00:00:00.020Z' }],
  recentDocument: [{ name: 'file.md', path: '/tmp/file.md', date: 30 }]
}
const json = JSON.stringify(fixture)

assert.strictEqual(decodeHistory(Buffer.from(json).toString('hex')), json)
assert.strictEqual(decodeHistory(Buffer.from(json).toString('base64')), json)
assert.strictEqual(decodeHistory(json), json)

const parsed = parseHistory(Buffer.from(json).toString('hex'))
assert.deepStrictEqual(parsed.map((item) => item.name), ['file.md', 'folder'])
assert.strictEqual(parsed[1].date, 20)

for (const invalidJsonValue of ['null', '[]', '"invalid"', '-1']) {
  assert.throws(
    () => parseHistory(invalidJsonValue),
    { message: 'history.data 解析结果不是有效的 JSON 对象' }
  )
}

const roots = parseHistory(JSON.stringify({
  recentFolder: [{ path: '/' }, { path: 'C:\\' }]
}))
assert.deepStrictEqual(roots.map((item) => item.name), ['/', 'C:\\'])
const crossPlatformPaths = parseHistory(JSON.stringify({
  recentDocument: [
    { path: 'C:\\Users\\test\\notes\\windows.md' },
    { path: '/home/test/notes/posix.md' }
  ]
}))
assert.deepStrictEqual(crossPlatformPaths.map((item) => item.name), ['windows.md', 'posix.md'])
const duplicatedCaseItems = parseHistory(JSON.stringify({
  recentDocument: [
    { path: '/tmp/Notes.md', date: 2 },
    { path: '/tmp/notes.md', date: 1 }
  ]
}))
if (process.platform === 'win32' || process.platform === 'darwin') {
  assert.deepStrictEqual(duplicatedCaseItems.map((item) => item.path), ['/tmp/Notes.md'])
} else {
  assert.deepStrictEqual(duplicatedCaseItems.map((item) => item.path), ['/tmp/Notes.md', '/tmp/notes.md'])
}

assert.strictEqual(normalizeDate('2026-07-07T05:45:41.246Z'), 1783403141246)
assert.strictEqual(toListResults(parsed)[0].description, '/tmp/file.md')
assert.strictEqual(toListResults(parsed)[0].icon, 'markdown-icon.png')
assert.strictEqual(toListResults(parsed)[1].icon, 'folder-icon.png')
assert.deepStrictEqual(toListResults(parsed, 'folder').map((item) => item.title), ['folder'])
assert.strictEqual(toListResults(parsed, null).length, 2)

assert.ok(getHistoryCandidates('win32', { APPDATA: 'C:\\Data' }, 'C:\\Users\\test')[0].endsWith('Typora\\history.data'))
assert.ok(getHistoryCandidates('linux', {}, '/home/test')[0].endsWith('.config/Typora/history.data'))
assert.ok(getHistoryCandidates('darwin', {}, '/Users/test')[0].includes('abnerworks.Typora'))
assert.deepStrictEqual(getTyporaLaunch('/notes', 'linux', {}), { command: 'typora', args: ['/notes'] })
assert.deepStrictEqual(getTyporaLaunch('/notes', 'darwin', {}), { command: 'open', args: ['-a', 'Typora', '/notes'] })
assert.deepStrictEqual(getTyporaLaunch('C:\\notes', 'win32', { TYPORA_EXECUTABLE: 'D:\\Typora.exe' }), {
  command: 'D:\\Typora.exe',
  args: ['C:\\notes']
})

const feature = createListFeature({})
assert.strictEqual(feature.mode, 'list')
assert.strictEqual(typeof feature.args.enter, 'function')
assert.strictEqual(typeof feature.args.search, 'function')
assert.strictEqual(typeof feature.args.select, 'function')

const originalHistoryPath = process.env.TYPORA_HISTORY_PATH
const cacheTestDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'recent-typora-'))
const cacheTestHistory = path.join(cacheTestDirectory, 'history.data')
try {
  process.env.TYPORA_HISTORY_PATH = cacheTestHistory
  fs.writeFileSync(cacheTestHistory, JSON.stringify({
    recentDocument: [{ name: 'before.md', path: '/tmp/before.md', date: 1 }]
  }))

  const cachedFeature = createListFeature({})
  let cacheTestResults
  cachedFeature.args.enter(null, (items) => { cacheTestResults = items })
  assert.deepStrictEqual(cacheTestResults.map((item) => item.title), ['before.md'])

  fs.writeFileSync(cacheTestHistory, JSON.stringify({
    recentDocument: [{ name: 'after.md', path: '/tmp/after.md', date: 2 }]
  }))
  cachedFeature.args.search(null, 'before', (items) => { cacheTestResults = items })
  assert.deepStrictEqual(cacheTestResults.map((item) => item.title), ['before.md'])

  cachedFeature.args.enter(null, (items) => { cacheTestResults = items })
  assert.deepStrictEqual(cacheTestResults.map((item) => item.title), ['after.md'])
} finally {
  if (originalHistoryPath === undefined) delete process.env.TYPORA_HISTORY_PATH
  else process.env.TYPORA_HISTORY_PATH = originalHistoryPath
  fs.rmSync(cacheTestDirectory, { recursive: true, force: true })
}

for (const asset of ['logo.png', 'folder-icon.png', 'markdown-icon.png']) {
  assert.ok(fs.existsSync(asset), `缺少资源文件：${asset}`)
}


console.log('All tests passed.')

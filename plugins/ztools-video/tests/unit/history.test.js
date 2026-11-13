import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * 创建内存版 ZTools 存储，并注入成全局宿主。
 * @returns {{store: Map<string, unknown>}} 可供断言是否写入了数据。
 */
function useMemoryStorage() {
  const store = new Map()
  globalThis.ztools = {
    dbStorage: {
      setItem: (key, value) => { store.set(key, value) },
      getItem: (key) => store.get(key),
      removeItem: (key) => { store.delete(key) },
    },
  }
  return { store }
}

const { store } = useMemoryStorage()
const history = await import('../../src/history.ts')

const catalogRequest = { kind: 'catalog', v: 'ch1kdq9lr', title: '三国' }
const directRequest = {
  kind: 'direct',
  title: '直链样片',
  source: { url: 'https://example.org/sample.mp4', format: 'mp4', quality: '1080p' },
}

test('时长与进度格式化成播放器常见样式', () => {
  assert.equal(history.formatDuration(0), '00:00')
  assert.equal(history.formatDuration(Number.NaN), '00:00')
  assert.equal(history.formatDuration(59), '00:59')
  assert.equal(history.formatDuration(754), '12:34')
  assert.equal(history.formatDuration(3723), '1:02:03')
  const entry = { position: 300, duration: 1200 }
  assert.equal(history.progressPercent(entry), 25)
  assert.equal(history.progressPercent({ position: 5000, duration: 1200 }), 100)
  assert.equal(history.progressPercent({ position: 0, duration: 0 }), 0)
})

test('记录剧集进度，并带上集号，同剧只保留一条', () => {
  history.clearHistory()
  history.saveHistory(catalogRequest, 120, 2700, { episodeV: 'e3', episodeNumber: 3, episodeLine: 1 })
  history.saveHistory(catalogRequest, 480, 2700, { episodeV: 'e4', episodeNumber: 4, episodeLine: 1 })
  const entries = history.readHistory()
  assert.equal(entries.length, 1)
  assert.equal(entries[0].key, 'catalog:ch1kdq9lr')
  assert.equal(entries[0].position, 480)
  assert.equal(entries[0].episodeNumber, 4)
  assert.equal(entries[0].duration, 2700)
})

test('单集标识独立保存，不会被整部剧的标识覆盖', () => {
  history.clearHistory()
  history.saveHistory(catalogRequest, 300, 2700, { episodeV: 'episode-42', episodeNumber: 42, episodeLine: 2 })
  const entry = history.readHistory()[0]
  assert.equal(entry.episodeV, 'episode-42')
  assert.notEqual(entry.episodeV, catalogRequest.v)
  assert.equal(entry.episodeLine, 2)
})

test('刚开头的播放位置不覆盖已有进度', () => {
  history.clearHistory()
  history.saveHistory(catalogRequest, 600, 2700, { episodeNumber: 5 })
  history.saveHistory(catalogRequest, 1, 2700, { episodeNumber: 5 })
  assert.equal(history.readHistory()[0].position, 600)
})

test('临近结尾算作看完，进度归零', () => {
  history.clearHistory()
  history.saveHistory(catalogRequest, 2690, 2700, { episodeNumber: 9 })
  const entry = history.readHistory()[0]
  assert.equal(entry.position, 0)
  assert.equal(entry.duration, 2700)
})

test('直链记录保存原始地址，可再次播放', () => {
  history.clearHistory()
  history.saveHistory(directRequest, 90, 360)
  const entry = history.readHistory()[0]
  assert.equal(entry.key, 'direct:https://example.org/sample.mp4')
  assert.deepEqual(entry.source, directRequest.source)
  assert.equal(entry.position, 90)
})

test('最近播放的记录排在最前，并可单独删除', () => {
  history.clearHistory()
  history.saveHistory(catalogRequest, 100, 2700, {})
  history.saveHistory(directRequest, 60, 360)
  const entries = history.readHistory()
  assert.deepEqual(entries.map(entry => entry.kind), ['direct', 'catalog'])
  history.removeHistory('catalog:ch1kdq9lr')
  assert.deepEqual(history.readHistory().map(entry => entry.kind), ['direct'])
})

test('损坏的数据不会让读取抛出异常', () => {
  store.set('playback-history', [{ bad: true }, null, 'x'])
  assert.deepEqual(history.readHistory(true), [])
  store.delete('playback-history')
})

test('记录有进程内缓存，强制读取才会回源', () => {
  history.clearHistory()
  history.saveHistory(catalogRequest, 100, 2700, { episodeNumber: 1 })
  // 模拟另一个窗口进程改写了存储，本进程缓存本应看不到。
  store.set('playback-history', [{ key: 'catalog:other', kind: 'catalog', title: '别的剧', position: 0, duration: 0, updatedAt: Date.now() }])
  assert.equal(history.readHistory()[0].title, '三国')
  assert.equal(history.readHistory(true)[0].title, '别的剧')
})

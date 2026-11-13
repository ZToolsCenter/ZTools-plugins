import assert from 'node:assert/strict'
import test from 'node:test'
import catalog from '../../preload-src/catalog.cjs'
import playback from '../../src-ztools/preload/provider.js'

test('仅将站内播放卡片加入搜索结果，并正确读取标题与封面', () => {
  const html = '<a href="https://example.com/play/ch1kdq9lr" data-vod="x"><h3>无效</h3></a>' +
    '<a href="/play/ch1kdq9lr" data-vod="video"><img data-src="https://example.org/poster?q=a&amp;x=b" alt="替代标题"><div class="absolute top-2">2010</div><h3>三国: 第1季</h3></a>' +
    '<a href="/play/ch1kdq9lr" data-vod="duplicate"><h3>重复</h3></a>'
  assert.deepEqual(catalog.searchResults(html), [{
    v: 'ch1kdq9lr', title: '三国: 第1季', cover: 'https://example.org/poster?q=a&x=b', year: '2010',
  }])
})

test('频道按原站顺序分组，过滤无效链接，保留各分组的封面与集数', () => {
  const card = `<article class="movie-card"><a href="/play/ch1kdq9lr" data-vod="video">
    <img src="/static/images/numbers/1.svg"><img data-src="https://example.org/poster.jpg"><h3>测试剧</h3>
    </a><span>2026</span><span class="text-green-500 font-bold">8.5</span><span>更新至 8 集</span></article>`
  const html = `<main><h2>最近更新</h2>${card}${card}
    <h2>空白组</h2><article class="movie-card"><a href="https://example.org/play/wrong" data-vod="bad"><h3>无效</h3></a></article>
    <section><h2>本月热播剧</h2></section><div>${card}</div></main>`
  const item = { v: 'ch1kdq9lr', title: '测试剧', cover: 'https://example.org/poster.jpg', year: '2026', progress: '更新至 8 集', rating: '8.5' }
  assert.deepEqual(catalog.browseSections(html), [
    { title: '最近更新', items: [item] }, { title: '本月热播剧', items: [item] },
  ])
})

test('频道接口仅接收三个已知分类', async () => {
  await assert.rejects(playback.provider.channel('https://example.org'), /频道不存在/)
})

test('从对应页面选出正确的播放 ID、集数与线路', () => {
  const html = '<meta property="og:title" content="三国: 第1季 - 第2集">' +
    '<a href="/play/ch1kdq9m7" dataid="18360" data-episode="2" data-line="1">2</a>' +
    '<a href="/play/ch1kdq9lr" dataid="18359" data-episode="1" data-line="1">1</a>' +
    '<a href="/play/ch1kdq9xx" dataid="18400" data-episode="1" data-line="2">1</a>'
  const page = catalog.playPage(html, 'ch1kdq9m7')
  assert.equal(page.p, '18360')
  assert.equal(page.catalog.title, '三国: 第1季')
  assert.deepEqual(page.catalog.episodes.map(e => [e.line, e.number]), [[1, 1], [1, 2], [2, 1]])
  assert.equal(page.catalog.selected.v, 'ch1kdq9m7')
  assert.throws(() => catalog.playPage(html, 'not-found'), /没有找到/)
})

test('请求参数与既有 WebAssembly 抓包样例一致', () => {
  const got = playback.buildParams({
    p: '18359', v: 'ch1kdq9lr', stamp: 1794296127953, loadedAt: 7000, now: 8000, visitor: '0',
  })
  assert.deepEqual(got, {
    p: '18359', v: 'ch1kdq9lr', q: '1080',
    s: '1d524bb10021e7a4dea3b7db0948e487', t: '1794296128953', k: '0',
  })
})

test('播放源保留完整签名、识别两种格式并跳过锁定线路', () => {
  const signed = 'https://example.com/movie.mp4?Signature=abc%2Bxyz&Expires=1794307412'
  const response = { code: 200, data: { play_id: 123, current_quality: 1, quality_urls: [
    { mtype: 'mp4', url: signed, title: '1080p' },
    { mtype: 'm3u8', url: 'https://example.com/playlist', title: '720p' },
    { locked: true, mtype: 'mp4', url: 'https://example.com/locked.mp4' },
    { mtype: 'mp4', url: 'file:///private/test.mp4' },
  ] } }
  assert.deepEqual(playback.sourcesFrom(response, '123'), [
    { url: 'https://example.com/playlist', format: 'hls', quality: '720p' },
    { url: signed, format: 'mp4', quality: '1080p' },
  ])
  assert.throws(() => playback.sourcesFrom(response, '999'), /不一致/)
})

test('打包后的 catalog 自包含，不依赖 node_modules', async () => {
  const built = await import('../../src-ztools/preload/catalog.js')
  const html = '<a href="/play/ch1kdq9lr" data-vod="video"><h3>测试剧</h3></a>'
  assert.deepEqual(built.searchResults(html), [
    { v: 'ch1kdq9lr', title: '测试剧', cover: null, year: null },
  ])
  const fs = await import('node:fs')
  const source = fs.readFileSync('src-ztools/preload/catalog.js', 'utf8')
  assert.equal(/require\(['"](?!\.\/)/.test(source), false, '产物里不应再有外部 require')
})

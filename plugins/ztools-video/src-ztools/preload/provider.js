const https = require('node:https')
const { createHmac } = require('node:crypto')
const { ORIGIN, SLUG, searchResults, browseSections, playPage, httpsUrl } = require('./catalog')
const PLAYER_VERSION = '/static/wasm/nbmovie_wasm_bg.d5d51939.wasm'
const MASK = Buffer.from('nbmovie2024secretkey')

function siteGet(url, signal, { referer, json = false } = {}) {
  if (url.origin !== ORIGIN) throw new Error('播放源地址无效。')
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      signal,
      headers: {
        Accept: json ? 'application/json' : 'text/html',
        'Accept-Encoding': 'identity',
        'User-Agent': 'Mozilla/5.0',
        ...(referer ? { Referer: referer } : {}),
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        const retry = res.headers['retry-after']
        res.resume()
        if (res.statusCode === 429) return reject(new Error(retry && /^\d+$/.test(retry) ? `站点请求过多，请等 ${retry} 秒再试。` : '站点请求过多，请稍后再试。'))
        if (res.statusCode === 404) return reject(new Error('站点找不到这个播放页。'))
        return reject(new Error(`站点请求失败（HTTP ${res.statusCode}）。`))
      }
      const max = json ? 1024 * 1024 : 6 * 1024 * 1024
      let size = 0
      const chunks = []
      res.on('data', (chunk) => {
        size += chunk.length
        if (size > max) {
          res.destroy(new Error('站点返回的内容超出大小限制。'))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      res.on('error', reject)
    })
    const timeout = setTimeout(() => req.destroy(new Error('连接站点超时，请重试。')), 15000)
    req.on('close', () => clearTimeout(timeout))
    req.on('error', (error) => reject(error.code === 'ABORT_ERR' ? error :
      new Error(error.message === '连接站点超时，请重试。' ? error.message : '无法连接 4K 影视，请检查网络后重试。')))
  })
}

function buildParams({ p, v, stamp, loadedAt, visitor, now = Date.now() }) {
  const t = String(Math.trunc(Number.isFinite(stamp) ? stamp + now - loadedAt : now))
  const s = createHmac('sha256', v).update(`${p}:${t}:${v}`).digest('hex').slice(0, 32)
  const k = !visitor || visitor === '0' ? '0' : Buffer.from(visitor)
    .map((byte, index) => byte ^ MASK[index % MASK.length]).toString('base64').replaceAll('+', '-').replaceAll('/', '_')
  return { p, v, q: '1080', s, t, k }
}

function sourcesFrom(value, p) {
  if (Number(value?.code) !== 200 || !Array.isArray(value?.data?.quality_urls)) {
    const message = typeof value?.message === 'string' ? value.message.trim().slice(0, 100) : ''
    throw new Error(message ? `站点：${message}` : '站点未返回可播放的线路。')
  }
  if (String(value.data.play_id) !== p) throw new Error('播放接口返回的资源与当前选集不一致。')
  const sources = []
  let locked = false
  const seen = new Set()
  for (const item of value.data.quality_urls) {
    if (item?.locked) { locked = true; continue }
    const url = httpsUrl(item?.url)
    if (!url || seen.has(item.url)) continue
    const kind = String(item.mtype || '').toLowerCase()
    const format = ['m3u8', 'hls'].includes(kind) || /\.m3u8$/i.test(url.pathname) ? 'hls'
      : kind === 'mp4' || /\.mp4$/i.test(url.pathname) ? 'mp4' : null
    if (!format) continue
    seen.add(item.url)
    sources.push({ url: item.url, format, quality: String(item.title || item.description || '').slice(0, 60), current: value.data.quality_urls[value.data.current_quality] === item })
    if (sources.length >= 12) break
  }
  if (!sources.length) throw new Error(locked ? '没有可用的访客播放线路。' : '该线路没有 MP4 或 HLS 视频。')
  return sources.sort((a, b) => Number(b.current) - Number(a.current)).map(({ current, ...source }) => source)
}

async function getPlayPage(v, signal) {
  if (typeof v !== 'string' || !SLUG.test(v)) throw new Error('播放页标识无效。')
  const url = new URL(`/play/${v}`, ORIGIN)
  const html = await siteGet(url, signal)
  const loadedAt = Date.now()
  return { ...playPage(html, v), url, loadedAt }
}

const provider = Object.freeze({
  async channel(value, signal) {
    if (!['movie', 'tv', 'anime'].includes(value)) throw new Error('该频道不存在。')
    return browseSections(await siteGet(new URL(`/${value}`, ORIGIN), signal))
  },
  async search(query, signal) {
    const text = typeof query === 'string' ? query.trim() : ''
    if (text.length < 1 || text.length > 100) throw new Error('请输入 1–100 个字符的片名。')
    const url = new URL('/search', ORIGIN)
    url.searchParams.set('q', text)
    return searchResults(await siteGet(url, signal))
  },
  async catalog(v, signal) {
    return (await getPlayPage(v, signal)).catalog
  },
  async resolve(v, signal) {
    const page = await getPlayPage(v, signal)
    if (page.version !== PLAYER_VERSION) throw new Error('站点更新了播放器，当前版本无法确认播放参数。')
    const url = new URL('/video/play', ORIGIN)
    url.search = new URLSearchParams(buildParams({ ...page, v })).toString()
    const raw = await siteGet(url, signal, { referer: page.url.href, json: true })
    let result
    try { result = JSON.parse(raw) } catch { throw new Error('站点未返回有效的播放数据。') }
    return sourcesFrom(result, page.p)
  },
})

module.exports = { provider, buildParams, sourcesFrom }

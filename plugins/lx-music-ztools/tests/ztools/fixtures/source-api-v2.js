/**
 * @name Controlled LX API test
 * @description Local fixture; not a real music source
 * @version 1.0.0
 * @author ZTools port tests
 */
const { EVENT_NAMES, request, utils } = globalThis.lx
lx.on(EVENT_NAMES.request, ({ source, action, info }) => new Promise((resolve, reject) => {
  if (action === 'lyric') return resolve({ lyric: '[00:00.00]测试歌词' })
  request('__BASE_URL__/resolve?id=' + encodeURIComponent(info.musicInfo.id), {
    method: 'get', headers: { 'X-LX-Hash': utils.crypto.md5('abc') }, timeout: 3000,
  }, (error, response, body) => {
    if (error) return reject(error)
    if (response.statusCode !== 200 || typeof body.url !== 'string') return reject(new Error('bad fixture response'))
    resolve(body.url)
  })
}))
lx.send(EVENT_NAMES.inited, { sources: {
  kw: { type: 'music', actions: ['musicUrl'], qualitys: ['128k', '320k'] },
  local: { type: 'music', actions: ['lyric'], qualitys: [] },
} })

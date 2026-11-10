const http = require('node:http')
function createWav() {
  const rate = 22050, seconds = 12, bytes = rate * seconds * 2
  const file = Buffer.alloc(44 + bytes)
  file.write('RIFF', 0); file.writeUInt32LE(36 + bytes, 4); file.write('WAVEfmt ', 8)
  file.writeUInt32LE(16, 16); file.writeUInt16LE(1, 20); file.writeUInt16LE(1, 22)
  file.writeUInt32LE(rate, 24); file.writeUInt32LE(rate * 2, 28); file.writeUInt16LE(2, 32); file.writeUInt16LE(16, 34)
  file.write('data', 36); file.writeUInt32LE(bytes, 40)
  for (let index = 0; index < rate * seconds; index++) file.writeInt16LE(Math.round(2048 * Math.sin(2 * Math.PI * 440 * index / rate)), 44 + index * 2)
  return file
}
async function startAudioServer(scriptTemplate) {
  const audio = createWav(), requests = []
  let base
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    requests.push({ path: url.pathname, range: req.headers.range })
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (url.pathname === '/source.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(scriptTemplate.replaceAll('__BASE_URL__', base)); return }
    if (url.pathname === '/resolve') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ url: base + '/audio.wav?id=' + url.searchParams.get('id') })); return }
    if (url.pathname === '/audio.wav') {
      res.setHeader('Content-Type', 'audio/wav'); res.setHeader('Accept-Ranges', 'bytes')
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '')
      if (range) {
        const start = Number(range[1]), end = Math.min(Number(range[2]) || audio.length - 1, audio.length - 1)
        if (start >= audio.length || start > end) { res.writeHead(416); res.end(); return }
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${audio.length}`, 'Content-Length': end - start + 1 }); res.end(audio.subarray(start, end + 1))
      } else { res.setHeader('Content-Length', audio.length); res.end(audio) }
      return
    }
    res.writeHead(404); res.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
  return { base, audio, requests, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }) }
}
module.exports = { startAudioServer }

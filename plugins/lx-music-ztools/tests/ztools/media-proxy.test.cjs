const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const net = require('node:net')
const { once } = require('node:events')
const { createMediaProxy } = require('../../src-ztools/preload/runtime/media-proxy.cjs')
async function bounded(promise, name, timeout = 2500) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('media fixture deadline: ' + name)), timeout) })]) }
  finally { clearTimeout(timer) }
}
const fetchMedia = (url, options = {}) => fetch(url, { signal: AbortSignal.timeout(2500), ...options })

async function fixture(t, { timeout = 1000 } = {}) {
  const requests = [], sockets = new Set(), targetSockets = new Set(), body = Buffer.from('0123456789abcdef')
  let closing = false
  let releaseSlow
  const slowClosed = new Promise(resolve => { releaseSlow = resolve })
  const target = http.createServer((req, res) => {
    requests.push({ url: req.url, range: req.headers.range, ifRange: req.headers['if-range'], method: req.method })
    if (req.url === '/redirect') { res.writeHead(302, { location: '/audio' }); res.end(); return }
    if (req.url === '/cycle') { res.writeHead(302, { location: '/cycle' }); res.end(); return }
    if (req.url === '/error') { res.writeHead(503); res.end('unavailable'); return }
    if (req.url === '/slow') {
      res.writeHead(200, { 'content-type': 'audio/mpeg' }); res.write('first')
      const timer = setInterval(() => res.write('more'), 10)
      res.on('close', () => { clearInterval(timer); releaseSlow() }); return
    }
    const headers = { 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes', etag: '"audio-one"' }
    if (req.headers.range) { res.writeHead(206, { ...headers, 'content-range': 'bytes 4-8/16', 'content-length': '5' }); res.end(body.subarray(4, 9)) }
    else { res.writeHead(200, { ...headers, 'content-length': String(body.length) }); res.end(req.method === 'HEAD' ? undefined : body) }
  })
  target.on('connection', socket => {
    targetSockets.add(socket); socket.once('close', () => targetSockets.delete(socket))
    if (closing) socket.destroy()
  })
  target.listen(0, '127.0.0.1'); await once(target, 'listening')
  let targetPort = target.address().port
  let tunnels = 0, blocked = false, finishBlocked
  const blockedClosed = new Promise(resolve => { finishBlocked = resolve })
  const proxy = http.createServer()
  proxy.on('connect', (_req, socket, head) => {
    if (closing) { socket.destroy(); return }
    tunnels++
    if (blocked) { sockets.add(socket); socket.once('close', () => { sockets.delete(socket); finishBlocked() }); socket.on('error', () => socket.destroy()); socket.on('end', () => socket.end()); socket.resume(); return }
    const upstream = net.connect(targetPort, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head)
      socket.pipe(upstream); upstream.pipe(socket)
    })
    const closeTunnel = () => { socket.destroy(); upstream.destroy() }
    for (const stream of [socket, upstream]) {
      sockets.add(stream)
      stream.once('close', () => { sockets.delete(stream); closeTunnel() })
      stream.once('end', closeTunnel); stream.on('error', closeTunnel)
    }
  })
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening')
  let configured = { host: '127.0.0.1', port: proxy.address().port }
  const media = createMediaProxy({ getProxy: () => configured, timeout })
  t.after(async () => {
    closing = true
    // Stop accepting first. A one-time socket sweep before listener.close can
    // miss a late CONNECT or target connection created during asynchronous disposal.
    const listenersClosed = Promise.all([new Promise(resolve => target.close(resolve)), new Promise(resolve => proxy.close(resolve))])
    for (const socket of [...sockets, ...targetSockets]) socket.destroy()
    await bounded(Promise.all([media.dispose(), listenersClosed]), 'fixture disposal')
  })
  return { media, requests, body, slowClosed, blockedClosed, proxyPort: proxy.address().port, routeTarget: port => { targetPort = port }, blockProxy: () => { blocked = true }, tunnels: () => tunnels, configure: value => { configured = value } }
}

test('registered playback uses the configured CONNECT proxy with redirect, Range and media CORS', async t => {
  const x = await fixture(t)
  const local = await x.media.resource('http://audio.invalid/redirect')
  assert.match(local, /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]+$/)
  assert.equal(local.includes('audio.invalid'), false)
  const response = await fetchMedia(local, { headers: { Range: 'bytes=4-8', 'If-Range': '"audio-one"' } })
  assert.equal(response.status, 206)
  assert.equal(await response.text(), '45678')
  assert.equal(response.headers.get('content-range'), 'bytes 4-8/16')
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  assert.equal(x.tunnels(), 2)
  assert.equal(x.requests.at(-1).range, 'bytes=4-8')
  assert.equal(x.requests.at(-1).ifRange, '"audio-one"')
  const head = await fetchMedia(local, { method: 'HEAD' })
  assert.equal(head.status, 200); assert.equal(await head.text(), '')
  assert.equal(x.requests.at(-1).method, 'HEAD')
})

test('disabled playback returns the original resource and registered resources use the current proxy', async t => {
  const x = await fixture(t)
  const local = await x.media.resource('http://audio.invalid/audio')
  x.configure(null)
  assert.equal(await x.media.resource('https://example.test/audio'), 'https://example.test/audio')
  assert.equal(await x.media.resource('file:///C:/Music/local.mp3'), 'file:///C:/Music/local.mp3')
  // The name is deliberately unresolvable: using the old proxy would succeed.
  assert.equal((await fetchMedia(local)).status, 502)
  assert.equal(x.tunnels(), 0)
})

test('relay rejects unknown tokens and URL queries and keeps upstream failures bounded', async t => {
  const x = await fixture(t)
  const local = await x.media.resource('http://audio.invalid/error')
  assert.equal((await fetchMedia(local)).status, 503)
  const base = new URL(local).origin
  assert.equal((await fetchMedia(base + '/unknown?url=http://audio.invalid/audio')).status, 404)
  assert.equal((await fetchMedia(local + '?url=http://audio.invalid/audio')).status, 404)
  assert.equal(x.requests.length, 1)
  const cycling = await x.media.resource('http://audio.invalid/cycle')
  assert.equal((await fetchMedia(cycling)).status, 502)
  assert.ok(x.requests.length < 10)
})

test('closing playback cancels its upstream stream and dispose releases the loopback listener', async t => {
  const x = await fixture(t)
  const local = await x.media.resource('http://audio.invalid/slow')
  const request = http.get(local)
  const [response] = await once(request, 'response', { signal: AbortSignal.timeout(2500) })
  await once(response, 'data', { signal: AbortSignal.timeout(2500) }); response.destroy(); request.destroy()
  await bounded(x.slowClosed, 'cancelled upstream stream')
  await bounded(x.media.dispose(), 'cancelled stream disposal')
  await assert.rejects(fetchMedia(local))
  await assert.rejects(x.media.resource('http://audio.invalid/audio'), /终止|关闭/)
})

test('a proxy that never acknowledges CONNECT times out and closes its connecting socket', { timeout: 4000 }, async t => {
  const x = await fixture(t, { timeout: 80 }); x.blockProxy()
  const local = await x.media.resource('http://audio.invalid/audio')
  const response = await fetchMedia(local, { signal: AbortSignal.timeout(2000) })
  assert.equal(response.status, 502)
  await bounded(x.blockedClosed, 'CONNECT socket closure')
})

test('dispose aborts an active media response before releasing its listener', async t => {
  const x = await fixture(t)
  const local = await x.media.resource('http://audio.invalid/slow')
  const request = http.get(local)
  request.on('error', () => {})
  const [response] = await once(request, 'response', { signal: AbortSignal.timeout(2500) })
  response.on('error', () => {})
  await once(response, 'data', { signal: AbortSignal.timeout(2500) })
  const responseClosed = new Promise(resolve => response.once('close', resolve))
  await bounded(x.media.dispose(), 'active media disposal')
  await bounded(responseClosed, 'disposed browser response')
  await bounded(x.slowClosed, 'disposed target response')
  await assert.rejects(fetchMedia(local))
})

test('the CONNECT fixture closes its target stream when a client half-closes the tunnel', { timeout: 3000 }, async t => {
  const x = await fixture(t)
  // A legal HTTP stream may keep writing its response after request-side EOF.
  // Use a real TCP peer to force that half-open state instead of relying on the
  // HTTP server's usual automatic EOF cleanup to rescue the CONNECT fixture.
  const targetSockets = new Set()
  let finish
  const targetClosed = new Promise(resolve => { finish = resolve })
  const halfOpenTarget = net.createServer({ allowHalfOpen: true }, socket => {
    targetSockets.add(socket)
    let timer
    socket.once('data', () => {
      socket.write('HTTP/1.1 200 OK\r\nContent-Type: audio/mpeg\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nfirst\r\n')
      timer = setInterval(() => socket.write('1\r\na\r\n'), 10)
    })
    socket.on('error', () => socket.destroy())
    socket.on('close', () => { clearInterval(timer); targetSockets.delete(socket); finish() })
  })
  halfOpenTarget.listen(0, '127.0.0.1'); await once(halfOpenTarget, 'listening')
  t.after(async () => { for (const socket of targetSockets) socket.destroy(); await bounded(new Promise(resolve => halfOpenTarget.close(resolve)), 'half-open fixture listener') })
  x.routeTarget(halfOpenTarget.address().port)
  const client = net.connect(x.proxyPort, '127.0.0.1')
  t.after(() => client.destroy())
  await once(client, 'connect', { signal: AbortSignal.timeout(1000) })
  const established = once(client, 'data', { signal: AbortSignal.timeout(1000) })
  client.write('CONNECT audio.invalid:80 HTTP/1.1\r\nHost: audio.invalid:80\r\n\r\n')
  assert.match(String((await established)[0]), /200 Connection Established/)
  const audio = once(client, 'data', { signal: AbortSignal.timeout(1000) })
  client.write('GET /slow HTTP/1.1\r\nHost: audio.invalid\r\n\r\n')
  await audio
  client.end()
  await bounded(targetClosed, 'half-closed CONNECT target response', 1000)
})

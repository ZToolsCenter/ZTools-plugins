const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { createNetwork } = require('../../src-ztools/preload/runtime/network.cjs')

test('LX transport preserves JSON/form/headers and cancels pending requests', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/wait') return
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ method: req.method, body, tag: req.headers['x-tag'] })) })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const network = createNetwork()
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const [a, b] = await Promise.all([
      network.request({ url: base, headers: { 'x-tag': 'a' } }).result,
      network.request({ url: base, method: 'post', form: { message: 'hello world' }, headers: { 'x-tag': 'b' } }).result,
    ])
    assert.equal(a.body.tag, 'a'); assert.equal(b.body.tag, 'b')
    assert.equal(b.body.method, 'POST'); assert.equal(b.body.body, 'message=hello%20world')
    const pending = network.request({ url: base + '/wait' })
    pending.cancel()
    await assert.rejects(pending.result, /取消|cancel/i)
    await assert.rejects(network.request({ url: 'file:///C:/Windows/win.ini' }).result, /HTTP/)
  } finally { network.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})

test('standard source HTTP retains the configured trusted proxy without inheriting catalogue JSON headers', async t => {
  const net = require('node:net'), context = require('../../src-ztools/preload/runtime/context.cjs')
  const previous = context.lx, sockets = new Set()
  const target = http.createServer((req, res) => res.end(JSON.stringify({ accept: req.headers.accept })))
  const proxy = http.createServer()
  let tunnels = 0
  proxy.on('connect', (req, socket, head) => {
    tunnels++
    const upstream = net.connect(target.address().port, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head)
      socket.pipe(upstream); upstream.pipe(socket)
    })
    for (const stream of [socket, upstream]) { sockets.add(stream); stream.on('close', () => sockets.delete(stream)); stream.on('error', () => stream.destroy()) }
  })
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve))
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
  context.lx = { appSetting: { 'network.proxy.enable': true, 'network.proxy.host': '127.0.0.1', 'network.proxy.port': proxy.address().port } }
  const network = createNetwork()
  t.after(async () => { context.lx = previous; network.dispose(); for (const socket of sockets) socket.destroy(); proxy.closeAllConnections(); target.closeAllConnections(); await Promise.all([new Promise(resolve => proxy.close(resolve)), new Promise(resolve => target.close(resolve))]) })
  const response = await network.requestSource({ url: `http://127.0.0.1:${target.address().port}` }).result
  assert.equal(tunnels, 1)
  assert.equal(response.body.accept, '*/*')
})

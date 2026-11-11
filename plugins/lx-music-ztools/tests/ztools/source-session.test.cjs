const { test } = require('node:test')
const assert = require('node:assert/strict')
const { SourceSession } = require('../../src-ztools/preload/runtime/source/session.cjs')
const http = require('node:http')
const needle = require('needle')
const { createNetwork } = require('../../src-ztools/preload/runtime/network.cjs')
const { collectRequestBuffers } = require('../../src-ztools/preload/runtime/source/protocol.cjs')

function readySession() {
  const fatal = [], cancelled = []
  const session = new SourceSession({ info: {}, network: { cancel: id => cancelled.push(id) }, onFatal: error => fatal.push(error.message) })
  session.sources = { kw: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } }
  session.origin = 'http://127.0.0.1'
  session.server = { token: 'test', close: async () => {} }
  session.frame = { contentWindow: { postMessage() {} }, remove() {} }
  return { session, fatal, cancelled }
}
const input = { requestKey: 'pending', data: { source: 'kw', action: 'musicUrl', info: { type: '128k', musicInfo: { id: 'test' } } } }

test('fatal Worker errors close the source and cancel its HTTP/pending work', async t => {
  const { session, fatal, cancelled } = readySession()
  t.after(() => session.close())
  session.http.add('test:http')
  const pending = session.request(input)
  const rejected = assert.rejects(pending, /崩溃|取消|切换/)
  session.handle({ type: 'error', error: '音源崩溃' })
  assert.equal(session.closed, true)
  await rejected
  assert.deepEqual(fatal, ['音源崩溃'])
  assert.deepEqual(cancelled, ['test:http'])
})

test('an unresponsive source is terminated at the request deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { session, fatal } = readySession()
  t.after(() => session.close())
  const rejected = assert.rejects(session.request(input), /超时/)
  t.mock.timers.tick(30001)
  await rejected
  assert.equal(session.closed, true)
  assert.match(fatal[0], /超时/)
})

test('standard source HTTP crosses the cloned session boundary with original needle defaults', async t => {
  const server = http.createServer((req, res) => {
    if (req.url === '/pending') return
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => { res.writeHead(207, 'Source echo', { 'Content-Type': 'text/plain', 'x-echo': 'source' }); res.end(JSON.stringify({ bytes: [...Buffer.concat(chunks)], type: req.headers['content-type'], accept: req.headers.accept })) })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const network = createNetwork(), url = `http://127.0.0.1:${server.address().port}`
  const session = new SourceSession({ network })
  session.server = { token: 'contract', close: async () => {} }
  const replies = new Map()
  session.send = message => replies.get(message.id)?.(structuredClone(message))
  t.after(async () => { await session.close(); network.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  let id = 0
  const optionsList = [
    { body: { message: 'hello world' } },
    { body: 'message=hello%20world' },
    { body: { message: 'hello world' }, headers: { 'Content-Type': 'application/json' } },
    { form: { message: 'hello world' }, headers: { 'Content-Type': 'application/json' } },
    { formData: { message: 'hello world' } },
    { body: Buffer.from([0, 255, 1, 128]) },
    { body: new Uint8Array([0, 255, 1, 128]).subarray(1, 3), headers: { 'Content-Type': 'application/json' } },
    { formData: { binary: Buffer.from([65, 66]), typed: new Uint8Array([65, 66]) } },
    { body: { nested: Buffer.from([65, 66]) }, headers: { 'Content-Type': 'application/json' } },
    { body: { constructor: Buffer.from([65, 66]), prototype: Buffer.from([67]) }, headers: { 'Content-Type': 'application/json' } },
    { body: { selected: 'body' }, form: { selected: 'form' }, formData: { selected: 'formData' }, headers: { 'Content-Type': 'application/json' } },
  ]
  for (const input of optionsList) {
    const options = { method: 'post', ...input }, data = options.body || options.form || options.formData
    const expected = await new Promise((resolve, reject) => needle.request('post', url, data, { headers: options.headers, ...(!options.body && (options.form || options.formData) ? { json: false } : {}), response_timeout: 60000 }, (error, response) => error ? reject(error) : resolve(response)))
    const requestId = String(++id)
    const response = new Promise(resolve => replies.set(requestId, resolve))
    session.handle(structuredClone({ type: 'http', id: requestId, url, options, bufferPaths: collectRequestBuffers(options, Buffer.isBuffer) }))
    const actual = await response
    assert.equal(actual.error, undefined)
    assert.equal(actual.response.statusCode, 207)
    assert.equal(actual.response.statusMessage, 'Source echo')
    assert.deepEqual(actual.response.body, JSON.parse(expected.raw.toString()), JSON.stringify(input))
    assert.equal(Buffer.from(actual.response.raw).toString(), expected.raw.toString())
    assert.equal(actual.response.headers['x-echo'], 'source')
    assert.equal(actual.response.bytes, expected.bytes)
  }
  // Original needle rejects a bare typed array without an explicit JSON header.
  const typedFailure = new Promise(resolve => replies.set('typed-error', resolve))
  session.handle(structuredClone({ type: 'http', id: 'typed-error', url, options: { method: 'post', body: new Uint8Array([65, 66]) } }))
  assert.match((await typedFailure).error, /Cannot build a querystring/)
  const catalogue = await network.request({ url, method: 'post', body: { message: 'hello world' } }).result
  assert.equal(catalogue.body.type, 'application/json; charset=utf-8')
  assert.equal(Buffer.from(catalogue.body.bytes).toString(), '{"message":"hello world"}')
  const cancellation = new Promise(resolve => replies.set('cancel', resolve))
  session.handle({ type: 'http', id: 'cancel', url: url + '/pending' })
  session.handle({ type: 'http-cancel', id: 'cancel' })
  assert.match((await cancellation).error, /取消|cancel/i)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(network.inspect().pending, 0)
  assert.equal(session.http.size, 0)
})

test('source formData file/path fields remain inert form values and never enter needle multipart file reads', async t => {
  const fs = require('node:fs'), { join } = require('node:path'), { tmpdir } = require('node:os')
  const file = join(fs.mkdtempSync(join(tmpdir(), 'lx-source-no-file-')), 'protected.txt')
  const secret = 'PRIVATE_LOCAL_CONTENT_' + require('node:crypto').randomUUID()
  fs.writeFileSync(file, secret)
  const multipart = require('needle/lib/multipart')
  const build = t.mock.method(multipart, 'build')
  let received
  const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => { received = Buffer.concat(chunks).toString(); res.end('{}') })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const network = createNetwork(), session = new SourceSession({ network })
  session.server = { token: 'protected', close: async () => {} }
  t.after(async () => { await session.close(); network.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const response = new Promise(resolve => { session.send = resolve })
  session.handle(structuredClone({ type: 'http', id: 'file', url: `http://127.0.0.1:${server.address().port}`, options: { method: 'post', formData: { upload: { file, path: file, content_type: 'text/plain' } }, multipart: true } }))
  assert.equal((await response).error, undefined)
  assert.equal(build.mock.callCount(), 0, 'no multipart dispatch means no needle fs.readFile path is reachable')
  assert.match(received, /upload\[file\]=/)
  assert.equal(received.includes(secret), false)
  assert.equal(fs.readFileSync(file, 'utf8'), secret)
})

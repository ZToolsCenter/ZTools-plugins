import { startHost } from './host-fixture.mjs'
import http from 'node:http'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const needle = createRequire(import.meta.url)('needle')
const contractOnly = process.argv.includes('--http-contract-only')
const protectedFile = join(mkdtempSync(join(tmpdir(), 'lx-source-protected-')), 'private.txt')
const protectedContent = 'NEVER_UPLOAD_LOCAL_FILE_' + Math.random().toString(36)
writeFileSync(protectedFile, protectedContent)
mkdirSync('artifacts/source', { recursive: true })
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (url.pathname === '/contract-drop') { req.socket.destroy(); return }
  if (url.pathname === '/contract-pending') return
  if (url.pathname === '/contract' || url.pathname === '/contract-delayed') {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const send = () => { res.writeHead(207, 'Source echo', { 'Content-Type': 'text/plain', 'x-echo': 'source' }); res.end(JSON.stringify({ hex: Buffer.concat(chunks).toString('hex'), type: req.headers['content-type'], accept: req.headers.accept })) }
      if (url.pathname === '/contract-delayed') setTimeout(send, 150)
      else send()
    })
    return
  }
  if (url.pathname !== '/resolve') { res.writeHead(404); res.end(); return }
  assert.equal(req.headers['x-lx-hash'], '900150983cd24fb0d6963f7d28e17f72')
  const send = () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ url: base + '/audio.wav?id=' + url.searchParams.get('id') })) }
  if (url.searchParams.get('id') === 'slow') setTimeout(send, 1000)
  else send()
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
let host
const record = { evidence: 'Actual isolated ZTools; controlled local source and server only' }
async function verifyHTTPContract(invoke) {
  const cases = [
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
    { formData: { file: protectedFile, content_type: 'text/plain', path: protectedFile }, multipart: true },
  ]
  const script = `/**\n * @name Standard HTTP contract fixture\n */
    const base=${JSON.stringify(base)};
    const from=lx.utils.buffer.from;
    const cases=[
      {body:{message:'hello world'}}, {body:'message=hello%20world'},
      {body:{message:'hello world'},headers:{'Content-Type':'application/json'}},
      {form:{message:'hello world'},headers:{'Content-Type':'application/json'}},
      {formData:{message:'hello world'}}, {body:from([0,255,1,128])},
      {body:new Uint8Array([0,255,1,128]).subarray(1,3),headers:{'Content-Type':'application/json'}},
      {formData:{binary:from([65,66]),typed:new Uint8Array([65,66])}},
      {body:{nested:from([65,66])},headers:{'Content-Type':'application/json'}},
      {body:{constructor:from([65,66]),prototype:from([67])},headers:{'Content-Type':'application/json'}},
      {body:{selected:'body'},form:{selected:'form'},formData:{selected:'formData'},headers:{'Content-Type':'application/json'}},
      {formData:{file:${JSON.stringify(protectedFile)},content_type:'text/plain',path:${JSON.stringify(protectedFile)}},multipart:true}
    ];
    const request=(path,options)=>new Promise(resolve=>lx.request(base+path,{method:'post',...options},function(error,response,body){
      resolve(error ? {error:error.message,response,body,receiver:this===lx} : {statusCode:response.statusCode,statusMessage:response.statusMessage,headers:response.headers,bytes:response.bytes,raw:lx.utils.buffer.bufToString(response.raw,'hex'),body,sameBody:body===response.body,receiver:this===lx});
    }));
    lx.on(lx.EVENT_NAMES.request,async()=>{
      const responses=[]; for(const options of cases) responses.push(await request('/contract',options));
      const typedError=await request('/contract',{body:new Uint8Array([65,66])});
      const arrayError=await request('/contract',{body:new ArrayBuffer(2)});
      const networkError=await request('/contract-drop',{});
      let cancelledCalls=0; const cancel=lx.request(base+'/contract-delayed',{method:'post',body:'a=b'},()=>cancelledCalls++); cancel();cancel();
      await new Promise(resolve=>setTimeout(resolve,250));
      return {lyric:JSON.stringify({responses,typedError,arrayError,networkError,cancelledCalls,isolated:typeof require==='undefined'&&typeof ztools==='undefined'})};
    });
    lx.send(lx.EVENT_NAMES.inited,{sources:{local:{type:'music',actions:['lyric'],qualitys:[]}}});`
  const imported = await invoke('winMain_import_user_api', script)
  await invoke('winMain_set_user_api', imported.apiInfo.id)
  const result = await invoke('winMain_request_user_api', { requestKey: 'http-contract', data: { source: 'local', action: 'lyric', info: {} } })
  const actual = JSON.parse(result.data.lyric)
  assert.equal(actual.responses.length, cases.length)
  for (let i = 0; i < cases.length; i++) {
    const options = cases[i], data = options.body || options.form || options.formData
    const expected = await new Promise((resolve, reject) => needle.request('post', base + '/contract', data, { headers: options.headers, ...(!options.body && (options.form || options.formData) ? { json: false } : {}), response_timeout: 60000 }, (error, response) => error ? reject(error) : resolve(response)))
    const response = actual.responses[i]
    assert.equal(response.error, undefined, `case ${i}`)
    assert.equal(response.statusCode, 207); assert.equal(response.statusMessage, 'Source echo')
    assert.equal(response.headers['x-echo'], 'source'); assert.equal(response.bytes, expected.bytes)
    assert.deepEqual(response.body, JSON.parse(expected.raw.toString()), `original needle case ${i}`)
    assert.equal(response.raw, expected.raw.toString('hex')); assert.equal(response.sameBody, true); assert.equal(response.receiver, true)
    assert.equal(Buffer.from(response.body.hex, 'hex').includes(Buffer.from(protectedContent)), false)
  }
  for (const error of [actual.typedError, actual.arrayError]) assert.match(error.error, /Cannot build a querystring/)
  assert.ok(actual.networkError.error); assert.equal(actual.networkError.response, null); assert.equal(actual.networkError.body, null); assert.equal(actual.networkError.receiver, true)
  assert.equal(actual.cancelledCalls, 0); assert.equal(actual.isolated, true)
  const catalogue = await invoke('network:fetch', { url: base + '/contract', method: 'post', body: { message: 'hello world' } })
  assert.equal(catalogue.body.type, 'application/json; charset=utf-8')
  assert.equal(Buffer.from(catalogue.body.hex, 'hex').toString(), '{"message":"hello world"}')
  await invoke('winMain_set_user_api', 'temp')
  await invoke('winMain_remove_user_api', [imported.apiInfo.id])
  return { cases: cases.length, callback: true, cancellation: true, protectedFileContentNotSent: true, explicitTypedArraySemantics: true, catalogueJSON: true }
}
try {
  host = await startHost()
  const invoke = (channel, params) => host.evaluate(`lxHost.invoke(${JSON.stringify(channel)},${JSON.stringify(params)})`)
  record.httpContract = await verifyHTTPContract(invoke)
  console.log('PASS real CSP Worker/SourceSession HTTP: original needle defaults, Buffer versus typed arrays, callbacks/cancel, file locators inert, catalogue JSON')
  if (!contractOnly) {
  const script = readFileSync('tests/ztools/fixtures/source-api-v2.js', 'utf8').replaceAll('__BASE_URL__', base)
  const imported = await invoke('winMain_import_user_api', script)
  assert.equal(imported.apiList.length, 1)
  await invoke('winMain_set_user_api', imported.apiInfo.id)
  const status = await invoke('winMain_get_user_api_status')
  assert.equal(status.status, true)
  assert.deepEqual(status.apiInfo.sources.kw.qualitys, ['128k', '320k'])
  const input = (id, key = 'one') => ({ requestKey: key, data: { source: 'kw', action: 'musicUrl', info: { type: '128k', musicInfo: { id } } } })
  const response = await invoke('winMain_request_user_api', input('ok'))
  assert.equal(response.data.url, base + '/audio.wav?id=ok')
  await assert.rejects(invoke('winMain_request_user_api', { ...input('bad'), data: { ...input('bad').data, info: { type: 'unknown', musicInfo: { id: 'bad' } } } }), /音质|quality/)
  const slow = invoke('winMain_request_user_api', input('slow', 'slow'))
  const cancelled = assert.rejects(slow, /取消|切换|cancel|changed/i)
  await new Promise(resolve => setTimeout(resolve, 100))
  await invoke('winMain_set_user_api', 'temp')
  await cancelled
  await invoke('winMain_set_user_api', imported.apiInfo.id)
  assert.equal((await invoke('winMain_request_user_api', input('again', 'again'))).data.url, base + '/audio.wav?id=again')
  await assert.rejects(invoke('winMain_import_user_api', 'not a valid script'), /无效|invalid/)
  const busy = await invoke('winMain_import_user_api', '/**\n * @name Initialization deadline fixture\n */\nwhile(true){}')
  await assert.rejects(invoke('winMain_set_user_api', busy.apiInfo.id), /超时/)
  assert.equal(await host.evaluate('services.diagnose().runtime.source.sessions'), 0)
  await invoke('winMain_set_user_api', imported.apiInfo.id)
  assert.equal((await invoke('winMain_request_user_api', input('after-init-hang', 'after-init-hang'))).data.url, base + '/audio.wav?id=after-init-hang')
  const hung = await invoke('winMain_import_user_api', '/**\n * @name Request deadline fixture\n */\nlx.on(lx.EVENT_NAMES.request,()=>{while(true){}});lx.send(lx.EVENT_NAMES.inited,{sources:{kw:{type:"music",actions:["musicUrl"],qualitys:["128k"]}}});')
  await invoke('winMain_set_user_api', hung.apiInfo.id)
  await assert.rejects(invoke('winMain_request_user_api', input('hang', 'hang')), /超时/)
  assert.equal(await host.evaluate('services.diagnose().runtime.source.sessions'), 0)
  assert.equal((await invoke('winMain_get_user_api_status')).status, false)
  await invoke('winMain_set_user_api', imported.apiInfo.id)
  assert.equal((await invoke('winMain_request_user_api', input('after-request-hang', 'after-request-hang'))).data.url, base + '/audio.wav?id=after-request-hang')
  record.deadlines = 'Actual busy Workers terminated after init/request deadlines; next source succeeds; UI/host remain responsive'
  record.status = 'PASS'; record.source = { status, response }; record.data = host.data
  console.log('PASS source import/init/crypto/HTTP/quality/switch; busy init and request Workers terminate with recovery')
  }
  record.status = 'PASS'; record.data = host.data
} catch (error) { record.status = 'FAIL'; record.error = String(error.stack || error); record.logs = await host?.logs(); process.exitCode = 1 }
finally { writeFileSync(contractOnly ? 'artifacts/source/http-contract-report.json' : 'artifacts/source/report.json', JSON.stringify(record, null, 2)); await host?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }

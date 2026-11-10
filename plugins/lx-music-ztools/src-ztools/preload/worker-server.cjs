const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

/** Serve only the trusted browser Worker with an enforced network-denying CSP. */
async function startWorkerServer(scriptName = 'source-worker.js') {
  const token = randomUUID()
  if (!['source-worker.js', 'probe-worker.js'].includes(scriptName)) throw new Error('Unknown Worker entry')
  const script = fs.readFileSync(path.join(__dirname, '../dist', scriptName))
  let requests = 0
  const server = http.createServer((req, res) => {
    requests++
    if (req.method !== 'GET') { res.writeHead(404); res.end(); return }
    const base = `/${token}`
    const isWorker = req.url === `${base}/worker.js`
    const isFrame = req.url === `${base}/index.html`
    const isBootstrap = req.url === `${base}/frame.js`
    if (!isWorker && !isFrame && !isBootstrap) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'Content-Type': isFrame ? 'text/html; charset=utf-8' : 'application/javascript',
      'Content-Security-Policy': isWorker ? "default-src 'none'; script-src 'unsafe-eval'; connect-src 'none'; worker-src 'none'; object-src 'none'" : "default-src 'none'; script-src 'self'; worker-src 'self'; frame-src 'none'",
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*',
    })
    if (isWorker) res.end(script)
    else if (isFrame) res.end(`<script src="frame.js"></script>`)
    else res.end(`const worker=new Worker('worker.js');worker.onmessage=e=>parent.postMessage({...e.data,channel:${JSON.stringify(token)}},'*');worker.onerror=e=>parent.postMessage({channel:${JSON.stringify(token)},type:'error',error:e.message},'*');addEventListener('message',e=>{if(e.source!==parent||e.data.channel!==${JSON.stringify(token)})return;if(e.data.type==='dispose'){worker.terminate();parent.postMessage({channel:${JSON.stringify(token)},type:'stopped'},'*')}else worker.postMessage(e.data)});parent.postMessage({channel:${JSON.stringify(token)},type:'ready'},'*');`)
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { token, url: `http://127.0.0.1:${server.address().port}/${token}/index.html`,
    getRequests: () => requests, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }) }
}
module.exports = { startWorkerServer }

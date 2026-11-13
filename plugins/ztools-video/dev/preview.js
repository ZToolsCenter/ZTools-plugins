import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { provider } = require('../src-ztools/preload/provider.js')
const operations = new Set(['channel', 'search', 'catalog', 'resolve'])

export function videoPreview(origin) {
  return {
    name: 'video-preview',
    configureServer(server) {
      server.middlewares.use('/__video', async (req, res) => {
        const send = (status, body) => {
          if (res.destroyed) return
          res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify(body))
        }
        const operation = req.url?.match(/^\/([a-z]+)$/)?.[1]
        if (req.method !== 'POST' || !operations.has(operation)) return send(404, { error: '未找到预览接口。' })
        if (req.headers.origin !== origin || req.headers.host !== new URL(origin).host) return send(403, { error: '请从本地开发页面发起查询。' })
        const controller = new AbortController()
        res.once('close', () => { if (!res.writableEnded) controller.abort() })
        try {
          let raw = ''
          for await (const chunk of req) {
            raw += chunk
            if (raw.length > 1024) return send(413, { error: '查询内容过长。' })
          }
          const value = JSON.parse(raw)?.value
          send(200, await provider[operation](value, controller.signal))
        } catch (err) {
          send(400, { error: err instanceof Error ? err.message : '预览请求失败。' })
        }
      })
    },
  }
}

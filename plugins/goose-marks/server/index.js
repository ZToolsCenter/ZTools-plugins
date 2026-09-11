import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import fastifyRateLimit from '@fastify/rate-limit'
import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'
import { initDatabase } from './db.js'
import { pushItems, pullItems } from './syncService.js'
import { fetchSiteIcon } from './iconService.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 兼容本地和容器环境的路径查找
const potentialDistPaths = [
  path.join(__dirname, '..', 'dist'), // 本地/默认
  path.join(__dirname, 'dist'),        // 容器内可能平级
  path.join(process.cwd(), 'dist'),    // 运行目录下
  path.join(process.cwd(), '..', 'dist'),
  '/app/dist',                         // Docker 常见挂载点
  '/app/server/dist'
]

const DIST_DIR = potentialDistPaths.find(p => fs.existsSync(p))

if (DIST_DIR) {
  console.log('>>> Found frontend dist at:', DIST_DIR)
} else {
  console.error('>>> CRITICAL: Frontend dist directory not found in any of these paths:', potentialDistPaths)
}

const fastify = Fastify({
  logger: true,
  bodyLimit: 5 * 1024 * 1024 // 5MB limit for JSON body
})

// Enable CORS
await fastify.register(cors, {
  origin: true
})

// Rate Limiting
await fastify.register(fastifyRateLimit, {
  global: true,
  max: 300,            // Global limit: 300 requests
  timeWindow: '1 minute', // per 1 minute
  errorResponseBuilder: (request, context) => {
    return { 
      error: 'Too Many Requests', 
      message: `You have exceeded the rate limit. Please try again in ${context.after}.` 
    }
  }
})

// Serve static files from frontend dist
if (DIST_DIR) {
  await fastify.register(fastifyStatic, {
    root: DIST_DIR,
    prefix: '/',
    wildcard: false // 禁用通配符以防干扰 API
  })
  
}

// API Routes

// --- Sync API ---

// 增量 Push
fastify.post('/api/sync/:shareId/push', {
  config: {
    rateLimit: {
      max: 60,
      timeWindow: '1 minute'
    }
  }
}, async (request, reply) => {
  try {
    const { shareId } = request.params
    const { items } = request.body
    
    if (!shareId || !items || !Array.isArray(items)) {
      return reply.code(400).send({ error: 'Invalid payload' })
    }

    const result = await pushItems(shareId, items)
    return result
  } catch (err) {
    request.log.error(err)
    return reply.code(500).send({ error: 'Sync Push Failed' })
  }
})

// 增量 Pull
fastify.get('/api/sync/:shareId/pull', async (request, reply) => {
  try {
    const { shareId } = request.params
    const { since, sinceId } = request.query

    // sinceId 参数缺失 → 旧客户端，传 null 走原 updated_at > since 语义；
    // 显式携带（含空串）→ 新客户端，走复合游标
    const sinceTs = parseInt(since) || 0
    const result = await pullItems(shareId, sinceTs, typeof sinceId === 'string' ? sinceId : null)
    return result
  } catch (err) {
    request.log.error(err)
    return reply.code(500).send({ error: 'Sync Pull Failed' })
  }
})

// 图标代理接口
fastify.get('/api/icon', {
  config: {
    rateLimit: {
      max: 100,
      timeWindow: '1 minute'
    }
  }
}, async (request, reply) => {
  try {
    const { url } = request.query

    if (!url) {
      return reply.code(400).send({ error: 'invalid_url' })
    }

    // URL 格式验证
    try {
      const validatedUrl = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`)
      if (validatedUrl.protocol !== 'http:' && validatedUrl.protocol !== 'https:') {
        return reply.code(400).send({ error: 'invalid_url' })
      }
    } catch {
      return reply.code(400).send({ error: 'invalid_url' })
    }

    const result = await fetchSiteIcon(url)

    if (!result) {
      return reply.code(404).send({ error: 'icon_not_found' })
    }

    return result
  } catch (err) {
    request.log.error(err)
    return reply.code(500).send({ error: 'Internal Server Error' })
  }
})

// 分享页面路由 - 返回 index.html 让前端处理
fastify.get('/s/:shareId', async (req, reply) => {
  if (DIST_DIR && fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    return reply.sendFile('index.html')
  }
  return reply.code(404).send({ error: 'Not Found' })
})

// Fallback for SPA routing
fastify.setNotFoundHandler((req, reply) => {
  if (req.raw.url.startsWith('/api')) {
    return reply.code(404).send({ error: 'API Not Found' })
  }
  if (DIST_DIR && fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    return reply.sendFile('index.html')
  }
  return reply.code(404).send({ error: 'Not Found' })
})

// Start server
const start = async () => {
  try {
    // Initialize Database (Non-blocking)
    initDatabase().catch(err => {
      console.warn('⚠️  Database initialization failed, share features might not work:', err.message)
    })
    
    const port = process.env.PORT || 3001
    await fastify.listen({ port, host: '0.0.0.0' })
    console.log(`Server listening on port ${port}`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()

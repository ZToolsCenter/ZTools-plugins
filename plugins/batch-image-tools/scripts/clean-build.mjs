import fs from 'node:fs'
import path from 'node:path'

const target = path.resolve('dist')

if (fs.existsSync(target)) {
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  console.log('Cleaned dist/')
}

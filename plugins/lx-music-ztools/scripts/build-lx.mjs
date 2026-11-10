import webpack from 'webpack'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const config = require('../build-config/ztools/webpack.config.cjs')
const compiler = webpack(config)
await new Promise((resolve, reject) => compiler.run((error, stats) => {
  console.log(stats?.toString(config.stats) || '')
  compiler.close(() => {})
  if (error || stats?.hasErrors()) reject(error || new Error('LX renderer build failed'))
  else resolve()
}))

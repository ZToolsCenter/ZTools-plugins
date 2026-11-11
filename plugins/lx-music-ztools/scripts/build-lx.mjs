import webpack from 'webpack'
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
const require = createRequire(import.meta.url)
const config = require('../build-config/ztools/webpack.config.cjs')
const compiler = webpack(config)
await new Promise((resolve, reject) => compiler.run((error, stats) => {
  console.log(stats?.toString(config.stats) || '')
  compiler.close(() => {})
  if (error || stats?.hasErrors()) reject(error || new Error('LX renderer build failed'))
  else { writeFileSync(join(config.output.path, 'lx-assets.json'), JSON.stringify(Object.keys(stats.compilation.assets).sort(), null, 2)); resolve() }
}))

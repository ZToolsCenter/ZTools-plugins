const esbuild = require('esbuild')
const path = require('path')

const root = path.resolve(__dirname, '..')
const src = path.join(root, 'public/preload/services.js')
const preloadDir = path.join(root, 'dist/preload')

// 确保目录存在
const fs = require('fs')
fs.mkdirSync(preloadDir, { recursive: true })

// 用 esbuild 打包 services.js，sql.js 作为外部依赖（Vite closeBundle 会拷贝 vendor 到 dist/preload/vendor/）
esbuild.build({
  entryPoints: [src],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: path.join(preloadDir, 'services.js'),
  format: 'cjs',
  external: ['sql.js'],
  sourcemap: false,
  minify: false,
}).then(() => {
  console.log('[build-preload] services.js bundled -> dist/preload/services.js')
}).catch(() => process.exit(1))

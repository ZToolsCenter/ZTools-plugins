/**
 * 组装 dist/ 为可安装的插件根目录。CI 打包时会打包 dist/ 目录。
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const distDir = path.join(root, 'dist')
const publicSrc = path.join(root, 'public')
const publicDest = path.join(distDir, 'public')

if (!fs.existsSync(distDir)) {
  console.error('dist/ missing — run tsc first')
  process.exit(1)
}

const requiredJs = ['preload.js', 'case-convert.js', 'naming.js']
for (const file of requiredJs) {
  if (!fs.existsSync(path.join(distDir, file))) {
    console.error(`Missing dist/${file} — run tsc first`)
    process.exit(1)
  }
}

const plugin = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'))
// Editor-only hint; not needed in the install package
delete plugin.$schema

if (plugin.preload !== 'preload.js') {
  console.warn(`Warning: plugin.json preload is "${plugin.preload}", expected "preload.js" for dist packaging`)
}

fs.writeFileSync(path.join(distDir, 'plugin.json'), JSON.stringify(plugin, null, 2) + '\n')

if (!fs.existsSync(publicSrc)) {
  console.error('public/ missing — run icons first')
  process.exit(1)
}

fs.mkdirSync(publicDest, { recursive: true })
const pngs = fs.readdirSync(publicSrc).filter((f) => f.endsWith('.png'))
if (pngs.length === 0) {
  console.error('No PNG icons in public/ — run icons first')
  process.exit(1)
}
for (const file of pngs) {
  fs.copyFileSync(path.join(publicSrc, file), path.join(publicDest, file))
}

console.log('Assembled dist/ plugin package:')
console.log('  plugin.json')
for (const file of requiredJs) console.log(`  ${file}`)
for (const file of pngs.sort()) console.log(`  public/${file}`)

import fs from 'node:fs/promises'

const dist = new URL('../dist/', import.meta.url)
const manifest = JSON.parse(await fs.readFile(new URL('plugin.json', dist), 'utf8'))

if (manifest.main !== 'index.html') throw new Error('生产清单入口必须是 index.html')
if (/^https?:\/\//i.test(manifest.main)) throw new Error('生产清单不能使用网络入口')
if (manifest.development) throw new Error('生产清单不能保留开发服务器入口')

const requiredFiles = [
  manifest.main,
  manifest.logo,
  manifest.preload,
  'preload/package.json',
  'vditor/dist/js/i18n/zh_CN.js',
  'vditor/dist/js/lute/lute.min.js',
  'vditor/dist/js/icons/ant.js',
  'vditor/dist/css/content-theme/light.css',
  'vditor/dist/css/content-theme/dark.css',
]

for (const relativePath of requiredFiles) {
  if (typeof relativePath !== 'string' || !relativePath) throw new Error('生产清单包含无效文件路径')
  await fs.access(new URL(relativePath, dist))
}

const html = await fs.readFile(new URL(manifest.main, dist), 'utf8')
if (html.includes('localhost:5173')) throw new Error('生产页面仍包含开发服务器地址')
for (const match of html.matchAll(/(?:src|href)="(\.\/[^"?#]+)["?#]/g)) {
  await fs.access(new URL(match[1], dist))
}

console.log('生产包校验通过')

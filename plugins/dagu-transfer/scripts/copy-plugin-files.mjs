import { copyFileSync, cpSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const distDir = fileURLToPath(new URL('../dist/', import.meta.url))

mkdirSync(distDir, { recursive: true })

for (const file of ['plugin.json', 'preload.cjs', 'dagu-transfer-shared.cjs', 'icon.png', 'download.png', 'LICENSE', 'CHANGELOG.md', 'README.md']) {
  copyFileSync(`${pluginRoot}${file}`, `${distDir}${file}`)
}

// 随 README 一起发布的界面截图
mkdirSync(`${distDir}docs/screenshots/`, { recursive: true })
for (const file of ['share-list.png', 'setup.png']) {
  copyFileSync(`${pluginRoot}docs/screenshots/${file}`, `${distDir}docs/screenshots/${file}`)
}

// Node 侧能力不经过 Vite，原样复制。
cpSync(`${pluginRoot}node/`, `${distDir}node/`, { recursive: true })

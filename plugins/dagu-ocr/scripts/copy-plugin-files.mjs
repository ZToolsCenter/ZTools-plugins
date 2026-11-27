import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const distDir = fileURLToPath(new URL('../dist/', import.meta.url))

mkdirSync(distDir, { recursive: true })

for (const file of ['plugin.json', 'preload.cjs', 'dagu-transfer-shared.cjs', 'icon.png', 'LICENSE', 'CHANGELOG.md', 'README.md']) {
  copyFileSync(`${pluginRoot}${file}`, `${distDir}${file}`)
}

// 随 README 一起发布的界面截图
mkdirSync(`${distDir}docs/screenshots/`, { recursive: true })
for (const file of ['editor.png', 'main-ocr.png', 'translation.png', 'pin-context-menu.png', 'overlay-toolbar.png']) {
  copyFileSync(`${pluginRoot}docs/screenshots/${file}`, `${distDir}docs/screenshots/${file}`)
}

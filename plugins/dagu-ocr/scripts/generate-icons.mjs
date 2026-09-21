// 从 lucide-static 生成 plugin/src/capture/icons.js，保证图标始终来自 Lucide 官方资源。
// 用法：npm --prefix plugin run icons
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const lucideDir = path.join(pluginRoot, 'node_modules', 'lucide-static', 'icons')
const targetFile = path.join(pluginRoot, 'src', 'capture', 'icons.js')

const ICONS = {
  select: 'mouse-pointer-2',
  shape: 'square',
  rectangle: 'rectangle-horizontal',
  line: 'move-up-right',
  pen: 'pen-line',
  marker: 'highlighter',
  mosaic: 'grid-2x2',
  text: 'type',
  eraser: 'eraser',
  undo: 'undo-2',
  redo: 'redo-2',
  close: 'x',
  pin: 'pin',
  save: 'save',
  copy: 'copy',
  clear: 'trash-2',
  download: 'download',
  chevronDown: 'chevron-down',
  chevronUp: 'chevron-up',
  upload: 'upload',
  history: 'history',
  settings: 'settings',
  swap: 'arrow-left-right',
  clipboardCopy: 'clipboard-copy',
  refresh: 'refresh-cw',
  languages: 'languages',
  check: 'check'
}

function readIconBody(name) {
  const source = readFileSync(path.join(lucideDir, `${name}.svg`), 'utf8')
  const body = source.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
  return body.replace(/\s*\n\s*/g, '').trim()
}

const entries = Object.entries(ICONS)
  .map(([key, name]) => `  ${key}: '${readIconBody(name)}'`)
  .join(',\n')

const content = `// 工具条图标取自 Lucide (https://lucide.dev)，ISC 许可证；由 scripts/generate-icons.mjs 生成，请勿手改。
// 使用图标：${Object.values(ICONS).join(', ')}

export const ICON_PATHS = {
${entries}
};
`

writeFileSync(targetFile, content, 'utf8')
console.log(`已生成 ${path.relative(pluginRoot, targetFile)}（${Object.keys(ICONS).length} 个图标）`)

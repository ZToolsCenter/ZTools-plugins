// 从 lucide-static 生成 src/ui/icons.js，保证图标始终来自 Lucide 官方资源。
// 用法：npm --prefix transfer run icons   （图标目录不在常规位置时用 LUCIDE_ICONS_DIR 指定）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const targetFile = path.join(pluginRoot, 'src', 'ui', 'icons.js')

const ICONS = {
  settings: 'settings',
  plus: 'plus',
  edit: 'pencil',
  folder: 'folder',
  server: 'server',
  up: 'chevron-up',
  down: 'chevron-down',
  trash: 'trash-2',
  check: 'check',
  close: 'x',
  eye: 'eye',
  eyeOff: 'eye-off'
}

const lucideDir = [
  process.env.LUCIDE_ICONS_DIR,
  path.join(pluginRoot, 'node_modules', 'lucide-static', 'icons'),
  path.join(pluginRoot, '..', 'plugin', 'node_modules', 'lucide-static', 'icons'),
  path.join(pluginRoot, '..', 'node_modules', 'lucide-static', 'icons')
].find((candidate) => candidate && existsSync(path.join(candidate, `${Object.values(ICONS)[0]}.svg`)))

if (!lucideDir) {
  console.error('未找到 lucide-static，请先安装依赖或用 LUCIDE_ICONS_DIR 指定图标目录')
  process.exit(1)
}

function readIconBody(name) {
  const source = readFileSync(path.join(lucideDir, `${name}.svg`), 'utf8')
  const body = source.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
  return body.replace(/\s*\n\s*/g, '').trim()
}

const entries = Object.entries(ICONS)
  .map(([key, name]) => `  ${key}: '${readIconBody(name)}'`)
  .join(',\n')

mkdirSync(path.dirname(targetFile), { recursive: true })
writeFileSync(targetFile, `// 界面图标取自 Lucide (https://lucide.dev)，ISC 许可证；由 scripts/generate-icons.mjs 生成，请勿手改。
// 使用图标：${Object.values(ICONS).join(', ')}

export const ICON_PATHS = {
${entries}
};

export function iconMarkup(name) {
  const body = ICON_PATHS[name];
  if (!body) return '';
  return \`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">\${body}</svg>\`;
}
`, 'utf8')
console.log(`已生成 ${path.relative(pluginRoot, targetFile)}（${Object.keys(ICONS).length} 个图标）`)

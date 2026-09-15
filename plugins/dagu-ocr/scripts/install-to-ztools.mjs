import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const distDir = path.join(pluginRoot, 'dist')

const pluginJson = JSON.parse(
  await import('node:fs').then(fs => fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf-8'))
)

if (!existsSync(path.join(distDir, 'plugin.json'))) {
  console.error('未找到构建产物 plugin/dist/plugin.json，请先执行 npm run build')
  process.exit(1)
}

const targetDir = process.env.ZTOOLS_PLUGINS_DIR
  ? path.join(process.env.ZTOOLS_PLUGINS_DIR, pluginJson.name)
  : path.join(os.homedir(), '.ztools', 'plugins', pluginJson.name)

console.log(`安装 ${pluginJson.title} v${pluginJson.version}`)
console.log(`  源: ${distDir}`)
console.log(`  目标: ${targetDir}`)

rmSync(targetDir, { recursive: true, force: true })
mkdirSync(targetDir, { recursive: true })
cpSync(distDir, targetDir, { recursive: true })

console.log(`✓ 已安装到 ${targetDir}`)
console.log('提示：重启 ZTools 客户端后生效。')

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPackage, extractFile } from '@electron/asar'

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

function installedAsarPath() {
  const pluginsDir = path.dirname(targetDir)
  if (!existsSync(pluginsDir)) return null

  const candidates = readdirSync(pluginsDir)
    .filter((name) => name.endsWith('.asar'))
    .map((name) => {
      const filePath = path.join(pluginsDir, name)
      try {
        const metadata = JSON.parse(extractFile(filePath, 'plugin.json').toString('utf8'))
        return { filePath, name, metadata, mtime: statSync(filePath).mtimeMs }
      } catch {
        return null
      }
    })
    .filter((candidate) => candidate?.metadata?.name === pluginJson.name)
    .sort((a, b) => b.mtime - a.mtime)

  return candidates[0]?.filePath || null
}

console.log(`安装 ${pluginJson.title} v${pluginJson.version}`)
console.log(`  源: ${distDir}`)
console.log(`  目标: ${targetDir}`)

rmSync(targetDir, { recursive: true, force: true })
mkdirSync(targetDir, { recursive: true })
cpSync(distDir, targetDir, { recursive: true })

console.log(`✓ 已安装到 ${targetDir}`)

const activeAsar = installedAsarPath()
if (activeAsar) {
  const temporaryAsar = path.join(os.tmpdir(), `dagu-ocr-install-${Date.now()}.asar`)
  await createPackage(distDir, temporaryAsar)
  try {
    copyFileSync(temporaryAsar, activeAsar)
    console.log(`✓ 已更新 ZTools 实际加载的插件包: ${activeAsar}`)
  } finally {
    rmSync(temporaryAsar, { force: true })
  }
} else {
  console.log('未发现已安装的同名 ASAR，仅保留目录安装')
}

console.log('提示：重启 ZTools 客户端后生效。')

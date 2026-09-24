import * as asar from '@electron/asar'
import AdmZip from 'adm-zip'
import { createBrotliDecompress } from 'node:zlib'
import { createReadStream, createWriteStream } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const zpxPath = path.join(root, 'release', 'sql-formatter-1.0.0.zpx')
const zipPath = path.join(root, 'release', 'sql-formatter-1.0.0.zip')
const tempAsar = path.join(root, 'release', '.verify.asar')
const requiredFiles = ['plugin.json', 'index.html', 'preload.cjs', 'logo.png']

/**
 * 校验 plugin.json 和入口资源是否满足 ZTools 安装条件。
 * @param {Record<string, unknown>} config 插件配置。
 * @param {string[]} files 安装包内的规范路径。
 * @returns {void} 无返回值。
 * @throws {Error} 配置字段或入口资源缺失时抛出。
 */
function validateConfig(config, files) {
  for (const field of ['name', 'version', 'main', 'preload', 'logo']) {
    if (!config[field]) throw new Error(`plugin.json 缺少 ${field}`)
  }
  if (!Array.isArray(config.features) || config.features.length === 0) {
    throw new Error('plugin.json 缺少 features')
  }
  for (const requiredFile of requiredFiles) {
    if (!files.includes(requiredFile)) throw new Error(`安装包缺少 ${requiredFile}`)
  }
}

try {
  // 按 ZTools 3.1.0 的当前格式，将 Brotli ZPX 还原为 ASAR 后检查。
  await pipeline(createReadStream(zpxPath), createBrotliDecompress(), createWriteStream(tempAsar))
  const zpxFiles = asar
    .listPackage(tempAsar, { isPack: false })
    .map((file) => file.replace(/^[/\\]+/, '').replace(/\\/g, '/'))
  const zpxConfig = JSON.parse(asar.extractFile(tempAsar, 'plugin.json').toString('utf8'))
  validateConfig(zpxConfig, zpxFiles)

  // ZIP 根目录必须直接包含 plugin.json，不能额外包一层目录。
  const zip = new AdmZip(zipPath)
  const zipFiles = zip.getEntries().filter((entry) => !entry.isDirectory).map((entry) => entry.entryName)
  const zipConfig = JSON.parse(zip.readAsText('plugin.json'))
  validateConfig(zipConfig, zipFiles)

  // 确认生产 HTML 使用相对路径，保证 file:// 与 ASAR 加载正常。
  const builtHtml = await readFile(path.join(root, 'dist', 'index.html'), 'utf8')
  if (/\b(?:src|href)="\/(?!\/)/.test(builtHtml)) {
    throw new Error('index.html 仍包含绝对资源路径')
  }

  console.log(
    JSON.stringify(
      {
        plugin: `${zpxConfig.title} ${zpxConfig.version}`,
        zpxFiles: zpxFiles.length,
        zipFiles: zipFiles.length,
        requiredFiles
      },
      null,
      2
    )
  )
} finally {
  asar.uncache(tempAsar)
  await rm(tempAsar, { force: true })
}

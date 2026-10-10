import * as asar from '@electron/asar'
import AdmZip from 'adm-zip'
import { createBrotliDecompress } from 'node:zlib'
import { createReadStream, createWriteStream } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { name, version } = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'))
const zpxPath = path.join(root, 'release', `${name}-${version}.zpx`)
const zipPath = path.join(root, 'release', `${name}-${version}.zip`)
const tempAsar = path.join(root, 'release', '.verify.asar')
const requiredFiles = ['plugin.json', 'index.html', 'preload.cjs', 'logo.png']

function validateConfig(config, files) {
  if (config.name !== name || config.version !== version) throw new Error('安装包的插件名称或版本与项目配置不一致')
  for (const field of ['name', 'version', 'main', 'preload', 'logo']) {
    if (!config[field]) throw new Error(`plugin.json 缺少 ${field}`)
  }
  if (!Array.isArray(config.features) || config.features.length === 0) throw new Error('plugin.json 缺少 features')
  for (const file of requiredFiles) if (!files.includes(file)) throw new Error(`安装包缺少 ${file}`)
}

try {
  await pipeline(createReadStream(zpxPath), createBrotliDecompress(), createWriteStream(tempAsar))
  const zpxFiles = asar.listPackage(tempAsar, { isPack: false })
    .map((file) => file.replace(/^[/\\]+/, '').replace(/\\/g, '/'))
  const zpxConfig = JSON.parse(asar.extractFile(tempAsar, 'plugin.json').toString('utf8'))
  validateConfig(zpxConfig, zpxFiles)

  const zip = new AdmZip(zipPath)
  const zipFiles = zip.getEntries().filter((entry) => !entry.isDirectory).map((entry) => entry.entryName)
  const zipConfig = JSON.parse(zip.readAsText('plugin.json'))
  validateConfig(zipConfig, zipFiles)

  const builtHtml = await readFile(path.join(root, 'dist', 'index.html'), 'utf8')
  if (/\b(?:src|href)="\/(?!\/)/.test(builtHtml)) throw new Error('index.html 仍包含绝对资源路径')

  console.log(JSON.stringify({
    plugin: `${zpxConfig.title} ${zpxConfig.version}`,
    zpxFiles: zpxFiles.length,
    zipFiles: zipFiles.length,
    requiredFiles
  }, null, 2))
} finally {
  asar.uncache(tempAsar)
  await rm(tempAsar, { force: true })
}

// 将 logo.svg 渲染为插件清单引用的 src-ztools/logo.png。
// 仅在需要重新生成图标时运行：node scripts/build-logo.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import sharp from 'sharp'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(projectRoot, 'logo.svg')
const targetPath = path.join(projectRoot, 'src-ztools', 'logo.png')

const svg = await readFile(sourcePath)
const png = await sharp(svg, { density: 384 })
  .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ compressionLevel: 9 })
  .toBuffer()

await writeFile(targetPath, png)
console.log(`已生成 ${targetPath}（${png.length} 字节）`)

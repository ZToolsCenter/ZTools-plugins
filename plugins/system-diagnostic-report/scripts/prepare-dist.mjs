import { access, copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distRoot = path.join(pluginRoot, 'dist')

await copyFile(path.join(pluginRoot, 'README.md'), path.join(distRoot, 'README.md'))

const screenshot = path.join(pluginRoot, 'screenshots', 'main.png')
try {
  await access(screenshot)
  await mkdir(path.join(distRoot, 'screenshots'), { recursive: true })
  await copyFile(screenshot, path.join(distRoot, 'screenshots', 'main.png'))
} catch {
  // Screenshot is documentation-only and does not block a clean source build.
}

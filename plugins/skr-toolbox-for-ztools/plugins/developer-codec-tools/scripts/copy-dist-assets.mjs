import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')

await mkdir(dist, { recursive: true })

const pluginJson = JSON.parse(await readFile(resolve(root, 'plugin.json'), 'utf-8'))
delete pluginJson.development

await writeFile(resolve(dist, 'plugin.json'), `${JSON.stringify(pluginJson, null, 2)}\n`, 'utf-8')
await copyFile(resolve(root, 'logo.svg'), resolve(dist, 'logo.svg'))

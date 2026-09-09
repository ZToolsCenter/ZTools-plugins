import fs from 'node:fs/promises'

const manifestPath = new URL('../dist/plugin.json', import.meta.url)
const vditorSource = new URL('../node_modules/vditor/dist/', import.meta.url)
const vditorTarget = new URL('../dist/vditor/dist/', import.meta.url)
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
manifest.main = 'index.html'
delete manifest.development
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
await fs.cp(vditorSource, vditorTarget, { recursive: true })

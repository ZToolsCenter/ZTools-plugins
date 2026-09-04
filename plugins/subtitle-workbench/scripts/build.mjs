import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const dist = path.join(root, 'dist')
await rm(dist, { recursive: true, force: true }); await mkdir(dist, { recursive: true })
for (const file of ['index.html', 'logo.svg', 'README.md', 'plugin.json']) await cp(path.join(root, file), path.join(dist, file))
await cp(path.join(root, 'preload'), path.join(dist, 'preload'), { recursive: true })
const manifest = JSON.parse(await readFile(path.join(dist, 'plugin.json'), 'utf8')); delete manifest.development; await writeFile(path.join(dist, 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`)

import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertDistSize, MAX_DIST_BYTES, measureDirectoryBytes } from './dist-size.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const manifest = JSON.parse(await readFile(path.join(dist, 'plugin.json'), 'utf8'))
if (manifest.development) throw new Error('dist manifest must not contain development')
const sourceManifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'))
delete sourceManifest.development
if (JSON.stringify(sourceManifest) !== JSON.stringify(manifest)) throw new Error('dist manifest is stale')
for (const file of [manifest.main, manifest.logo, manifest.preload, 'preload/subtitle-core.cjs']) await access(path.join(dist, file))
await access(path.join(dist, 'preload/whisper-runner.cjs')).then(() => { throw new Error('v0.1 must not package whisper runner') }, () => {})
const declared = Object.keys(manifest.tools || {}).sort()
if (JSON.stringify(declared) !== JSON.stringify(['analyze', 'analyze_approved_file', 'transform'])) throw new Error('dist MCP tool declarations are incomplete')
const preload = await readFile(path.join(dist, manifest.preload), 'utf8')
for (const name of declared) if (!preload.includes(`'${name}'`)) throw new Error(`dist preload does not register ${name}`)
for (const file of ['README.md', 'preload/services.cjs', 'preload/subtitle-core.cjs']) {
  if (await readFile(path.join(root, file), 'utf8') !== await readFile(path.join(dist, file), 'utf8')) throw new Error(`dist ${file} is stale`)
}
const distBytes = await measureDirectoryBytes(dist)
console.log(`subtitle-workbench dist size: ${distBytes} bytes (limit ${MAX_DIST_BYTES} bytes)`)
assertDistSize(distBytes, 'subtitle-workbench dist')
console.log('Verified subtitle-workbench dist')

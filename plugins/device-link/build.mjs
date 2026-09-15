import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))

execFileSync(process.execPath, [path.join(root, 'node_modules', 'vue-tsc', 'bin', 'vue-tsc.js'), '--noEmit'], { cwd: root, stdio: 'inherit' })
execFileSync(path.join(root, 'node_modules', 'esbuild', 'bin', 'esbuild'), [
  path.join(root, 'mobile', 'crypto-fallback.js'),
  '--bundle',
  '--minify',
  '--format=iife',
  '--target=es2020',
  `--outfile=${path.join(root, 'public', 'web', 'crypto-fallback.js')}`,
], { cwd: root, stdio: 'inherit' })
execFileSync(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: root, stdio: 'inherit' })

// ZTools' developer loader gives development.main precedence even when the
// selected directory is dist/. Keep the Vite URL in the source manifest for
// development, but never ship it in an installable build.
const distManifestPath = path.join(root, 'dist', 'plugin.json')
const distManifest = JSON.parse(fs.readFileSync(distManifestPath, 'utf8'))
delete distManifest.development
fs.writeFileSync(distManifestPath, `${JSON.stringify(distManifest, null, 2)}\n`)

const targetModules = path.join(root, 'dist', 'preload', 'node_modules')
const queue = ['ws', 'qrcode']
const copied = new Map()

function collect(name, parent = root) {
  if (copied.has(name)) return
  const requireFromParent = createRequire(path.join(parent, 'package.json'))
  const source = path.dirname(requireFromParent.resolve(`${name}/package.json`))
  copied.set(name, source)
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'))
  for (const dependency of Object.keys(manifest.dependencies || {})) collect(dependency, source)
}

for (const dependency of queue) collect(dependency)
for (const [dependency, source] of copied) {
  const destination = path.join(targetModules, ...dependency.split('/'))
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.cpSync(source, destination, { recursive: true, dereference: true })
}

console.log(`Device Link build complete. Copied ${copied.size} preload packages.`)

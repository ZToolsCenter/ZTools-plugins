import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function toPackagedManifest(manifest) {
  const { development: _development, ...packagedManifest } = manifest
  return packagedManifest
}

export function preparePackage(rootDir = process.cwd()) {
  const distDir = resolve(rootDir, 'dist')
  const manifest = JSON.parse(readFileSync(resolve(rootDir, 'plugin.json'), 'utf8'))
  const packagedManifest = toPackagedManifest(manifest)

  writeFileSync(
    resolve(distDir, 'plugin.json'),
    `${JSON.stringify(packagedManifest, null, 2)}\n`,
    'utf8'
  )
  copyFileSync(resolve(rootDir, 'preload.js'), resolve(distDir, 'preload.js'))
  rmSync(resolve(distDir, 'preload'), { recursive: true, force: true })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  preparePackage()
}

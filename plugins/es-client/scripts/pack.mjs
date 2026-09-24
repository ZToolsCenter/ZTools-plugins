import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const src = path.join(root, 'src-ztools')
const zipPath = path.join(root, 'es-client-plugin.zip')

const required = [
  path.join(src, 'plugin.json'),
  path.join(src, 'logo.png'),
  path.join(src, 'dist', 'index.html'),
  path.join(src, 'preload', 'services.js'),
  path.join(src, 'preload', 'package.json'),
]

for (const f of required) {
  if (!existsSync(f)) {
    console.error(`Missing ${path.relative(root, f)} — run npm run build first`)
    process.exit(1)
  }
}

const ps = `
$ErrorActionPreference = 'Stop'
$zip = '${zipPath.replace(/\\/g, '\\\\')}'
$src = '${src.replace(/\\/g, '\\\\')}'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $src '*') -DestinationPath $zip -Force
Write-Output "Packed: $zip ($((Get-Item $zip).Length) bytes)"
`
const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' })
process.exit(r.status ?? 1)

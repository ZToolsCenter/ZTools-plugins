import { mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { check } from './check.mjs'
const manifest = check()
mkdirSync('../output/lx-music-ztools', { recursive: true })
const output = resolve('../output/lx-music-ztools', `${manifest.name}-${manifest.version}.zip`)
// 包根目录直接包含 plugin.json，供 ZTools 本地安装。
execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Compress-Archive -Path (Join-Path $env:LX_PACKAGE_SOURCE "*") -DestinationPath $env:LX_PACKAGE_OUTPUT -Force'], {
  env: { ...process.env, LX_PACKAGE_SOURCE: resolve('src-ztools'), LX_PACKAGE_OUTPUT: output }, stdio: 'inherit'
})
console.log(output)

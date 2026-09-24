import { rename, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

await rm('dist', { recursive: true, force: true })

const build = spawnSync('bun', ['x', 'vite', 'build', '--config', 'vite.sites.config.ts'], {
  stdio: 'inherit'
})
if (build.status !== 0) process.exit(build.status ?? 1)

await rm('dist/server', { recursive: true, force: true })
await rename('dist/utools_bookmarks', 'dist/server')

import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertDistSize, MAX_DIST_BYTES, measureDirectoryBytes } from './dist-size.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const manifest = JSON.parse(await readFile(path.join(dist, 'plugin.json'), 'utf8'))
if (manifest.development) throw new Error('dist manifest must not contain development')
for (const file of [manifest.main, manifest.logo, manifest.preload, 'preload/git-core.cjs']) await access(path.join(dist, file))
const declared = Object.keys(manifest.tools || {})
if (JSON.stringify(declared) !== JSON.stringify(['snapshot_approved'])) throw new Error('dist MCP tool declaration is incomplete')
const preload = await readFile(path.join(dist, manifest.preload), 'utf8')
if (!preload.includes("'snapshot_approved'")) throw new Error('dist preload does not register snapshot_approved')
const distBytes = await measureDirectoryBytes(dist)
console.log(`git-worktree-cockpit dist size: ${distBytes} bytes (limit ${MAX_DIST_BYTES} bytes)`)
assertDistSize(distBytes, 'git-worktree-cockpit dist')
console.log('Verified git-worktree-cockpit dist')

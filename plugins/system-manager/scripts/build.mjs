import { spawn } from 'node:child_process'
import path from 'node:path'

import { modules, root } from './config.mjs'
import { resolveNpmInvocation } from './npm-invocation.mjs'

const npm = resolveNpmInvocation()
const cache = path.join(root, '.npm-cache')

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, npm_config_cache: cache },
      shell: false,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} 失败：${signal || code}`))
    })
  })
}

for (const module of modules) {
  console.log(`\n[system-manager] Building ${module.id}`)
  await run(npm.file, [...npm.prefix, 'run', 'build:dist', '--workspace', module.id])
}

await run(process.execPath, ['scripts/assemble-dist.mjs'])
await run(process.execPath, ['scripts/verify-dist.mjs'])
await run(process.execPath, ['scripts/package-release.mjs'])

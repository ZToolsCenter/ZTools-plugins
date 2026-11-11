import { spawnSync } from 'node:child_process'
const run = (file, env = {}) => {
  const result = spawnSync(process.execPath, ['--test', file], { stdio: 'inherit', env: { ...process.env, ...env } })
  if (result.status !== 0) process.exit(result.status || 1)
}
run('tests/ztools/sync.test.cjs')
for (const failure of [false, true]) for (const role of ['client', 'server']) run('tests/ztools/sync-interop.test.cjs', { LX_SYNC_ROLE: role, LX_SYNC_FAILURE: failure ? '1' : '0' })

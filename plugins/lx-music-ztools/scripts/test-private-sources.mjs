import { startHost } from './host-fixture.mjs'
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

// User-owned scripts stay in the selected directory; private results and host DB stay in OS temp.
const directory = process.env.LX_SOURCE_DIR
if (!directory) throw new Error('Set LX_SOURCE_DIR to the local directory to verify; no sources are bundled')
const output = mkdtempSync(join(tmpdir(), 'lx-private-source-check-'))
const results = [], seen = new Set()
let host
try {
  host = await startHost('dist/lx.html')
  const invoke = (channel, value) => host.evaluate(`lxHost.invoke(${JSON.stringify(channel)},${JSON.stringify(value)})`)
  for (const file of readdirSync(directory).filter(file => file.endsWith('.js'))) {
    const script = readFileSync(join(directory, file), 'utf8')
    const hash = createHash('sha256').update(script).digest('hex')
    if (seen.has(hash)) continue
    seen.add(hash)
    const result = { file, hash, imported: false, initialized: false }
    try {
      const { apiInfo } = await invoke('winMain_import_user_api', script)
      result.imported = true
      await invoke('winMain_set_user_api', apiInfo.id)
      const status = await invoke('winMain_get_user_api_status')
      result.initialized = status.status
      result.capabilities = status.apiInfo?.sources
    } catch (error) {
      result.error = String(error.message || error).split('\n')[0].replace(/https?:\/\/\S+/g, '[remote]').slice(0, 200)
    }
    results.push(result)
    console.log(`${results.length}: import=${result.imported}, init=${result.initialized}`)
  }
  await invoke('winMain_set_user_api', 'temp')
} finally {
  writeFileSync(join(output, 'report.json'), JSON.stringify({ input: resolve(directory), results }, null, 2))
  await host?.close()
}
console.log(JSON.stringify({ imported: results.filter(x => x.imported).length, initialized: results.filter(x => x.initialized).length, unique: results.length, privateReport: join(output, 'report.json') }))

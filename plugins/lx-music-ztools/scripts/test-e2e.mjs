import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

// Host launches must remain serialized: each owns its disposable profile. The
// official sync peer is only a test oracle; the installed plugin never needs it.
const groups = [
  ['host-probe', ['test-p0.mjs', 'test-lx-renderer.mjs']],
  ['settings', ['test-settings.mjs', 'test-settings-effects.mjs', 'test-font-size.mjs']],
  ['source', ['test-source.mjs', 'test-source-ui.mjs']],
  ['catalog', ['test-catalog.mjs']],
  ['player', ['test-player.mjs', 'test-local-media.mjs']],
  ['library', ['test-library.mjs']],
  ['download', ['test-download.mjs']],
  ['storage', ['test-recovery.mjs']],
  ['sync', ['test-sync-host.mjs']],
  ['system', ['test-system.mjs', 'test-commands.mjs']],
  ['acceptance', ['test-install.mjs']],
  ['stability', ['test-stability.mjs']],
]
const args = process.argv.slice(2), index = args.indexOf('--grep')
if (args.includes('--list')) { console.log(groups.map(([name, scripts]) => `${name}: ${scripts.join(', ')}`).join('\n')); process.exit(0) }
if (index >= 0 && !args[index + 1]) throw new Error('--grep needs a group expression')
const filter = index < 0 ? null : new RegExp(args[index + 1])
const scripts = [...new Set(groups.filter(([name]) => !filter || filter.test(name)).flatMap(([, scripts]) => scripts))]
if (!scripts.length) throw new Error('No matching E2E group')
mkdirSync('artifacts/e2e', { recursive: true })
const report = { startedAt: new Date().toISOString(), pluginZip: process.env.ZTOOLS_PLUGIN_ZIP || null, results: [] }
for (const script of scripts) {
  console.log(`Running ${script}`)
  const child = spawn(process.execPath, ['scripts/' + script], { stdio: 'inherit', env: process.env, windowsHide: true })
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) })
  report.results.push({ script, exitCode: code }); writeFileSync('artifacts/e2e/report.json', JSON.stringify(report, null, 2))
  if (code !== 0) { process.exitCode = code || 1; break }
}
report.status = process.exitCode ? 'FAIL' : 'PASS'; report.finishedAt = new Date().toISOString()
writeFileSync('artifacts/e2e/report.json', JSON.stringify(report, null, 2))

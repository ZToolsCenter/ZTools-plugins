import { startHost } from './host-fixture.mjs'
import { expect } from '@playwright/test'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Exercise the same ZIP users import, without a development server or project registration.
const manifest = JSON.parse(readFileSync('src-ztools/plugin.json', 'utf8'))
const zip = resolve(process.env.ZTOOLS_PLUGIN_ZIP || resolve('../output/lx-music-ztools', `${manifest.name}-${manifest.version}.zip`))
mkdirSync('artifacts/install', { recursive: true })
let host
const report = { zip, status: 'FAIL', isolated: true }
try {
  host = await startHost(undefined, { zip })
  await expect.poll(() => host.evaluate('typeof window.lxPlayer'), { timeout: 20000 }).toBe('object')
  await expect.poll(() => host.evaluate('document.body.innerText')).toMatch(/搜索/)
  report.host = await host.evaluate('window.services.diagnose()')
  report.sources = await host.evaluate(`lxHost.invoke('winMain_get_user_api_list')`)
  const png = await host.app.evaluate(async ({ webContents }) => {
    const wc = webContents.getAllWebContents().find(x => x.getURL().includes('/dist/lx.html'))
    return (await wc.capturePage()).toPNG().toString('base64')
  })
  writeFileSync('artifacts/install/lxmusic.png', Buffer.from(png, 'base64'))
  report.status = 'PASS'
  console.log('PASS ZIP install → lxmusic search → original LX player, without development server')
} catch (error) {
  report.error = String(error.stack || error)
  report.logs = await host?.logs()
  process.exitCode = 1
} finally {
  writeFileSync('artifacts/install/report.json', JSON.stringify(report, null, 2))
  await host?.close()
}

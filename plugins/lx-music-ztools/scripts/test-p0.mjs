import { _electron as electron, expect } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, copyFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
import { generateKeyPairSync, publicEncrypt, constants } from 'node:crypto'

const data = mkdtempSync(join(tmpdir(), 'lx-ztools-p0-'))
const evidence = resolve('artifacts/p0')
mkdirSync(join(data, 'legacy'))
mkdirSync(evidence, { recursive: true })
const plugin = join(data, 'plugin')
function copyDirectory(source, target) {
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isDirectory()) copyDirectory(join(source, entry.name), join(target, entry.name))
    else copyFileSync(join(source, entry.name), join(target, entry.name))
  }
}
copyDirectory(resolve('src-ztools'), plugin)
const manifest = JSON.parse(readFileSync(join(plugin, 'plugin.json'), 'utf8'))
const suffix = '/' + manifest.main
delete manifest.development
writeFileSync(join(plugin, 'plugin.json'), JSON.stringify(manifest, null, 2))
let app
const result = { data, entry: manifest.main, time: new Date().toISOString(), checks: {} }
try {
  app = await electron.launch({
    executablePath: process.env.ZTOOLS_EXECUTABLE || resolve('../tmp/lx-electron-42/electron.exe'),
    args: [process.env.ZTOOLS_APP || 'D:/Program Files/ZTools/resources/app.asar'],
    env: { ...process.env, ZTOOLS_DATA_ROOT: data, ZTOOLS_LEGACY_USER_DATA_PATH: join(data, 'legacy'), ZTOOLS_E2E: '1' },
    timeout: 45000,
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.search-input', { timeout: 30000 })
  const registration = await app.evaluate(async ({ ipcMain, BrowserWindow }, file) => {
    const sender = BrowserWindow.getAllWindows().find(x => x.getTitle() === 'ZTools').webContents
    const registered = await ipcMain._invokeHandlers.get('upsert-dev-project-by-config-path')({ sender }, file)
    if (!registered.success) throw new Error(JSON.stringify(registered))
    return ipcMain._invokeHandlers.get('install-dev-plugin')({ sender }, registered.pluginName)
  }, join(plugin, 'plugin.json'))
  assert.equal(registration.success, true)
  // Production entry without a development server: the page must be installed locally.
  await page.locator('.search-input').fill('洛雪音乐')
  await page.locator('.app-item').filter({ hasText: '洛雪音乐' }).first().click()
  await expect.poll(() => app.evaluate(({ webContents }, suffix) => webContents.getAllWebContents().some(x => x.getURL().includes(suffix)), suffix), { timeout: 20000 }).toBe(true)
  const evaluate = code => app.evaluate(async ({ webContents }, { code, suffix }) => {
    const wc = webContents.getAllWebContents().find(x => x.getURL().includes(suffix))
    return wc.executeJavaScript(code)
  }, { code, suffix })
  assert.equal(await evaluate('typeof window.services.probeCapabilities'), 'function', 'P0 requires real source isolation and persistence probes')
  result.checks = await evaluate('window.services.probeCapabilities()')
  result.settings = await evaluate(`(async()=>{await lxHost.invoke('common_set_app_setting',{'player.volume':0.42,'common.isAgreePact':true,'common.showChangeLog':false});return lxHost.invoke('common_get_app_setting')})()`)
  assert.equal(result.settings['player.volume'], 0.42)
  assert.deepEqual(await evaluate(`lxHost.invoke('player_list_get')`), [])
  const publicKey = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ type: 'spki', format: 'pem' })
  result.pluginPreferences = await app.evaluate(({ webContents }, suffix) => webContents.getAllWebContents().filter(x => x.getURL().includes(suffix)).map(x => x.getLastWebPreferences()), suffix)
  app.process().stderr.on('data', bytes => { writeFileSync(join(evidence, 'stderr.log'), bytes, { flag: 'a' }) })
  try { result.guest = await evaluate('window.services.probeSourceIsolation()') }
  catch (error) { result.guestFailure = String(error); result.worker = await evaluate(`window.services.probeWorkerIsolation(${JSON.stringify(publicKey)})`) }
  result.guestPreferences = await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(x => x.getType() === 'webview').map(x => ({ url: x.getURL(), preferences: x.getLastWebPreferences() })))
  assert.equal(result.checks.storage.roundtrip, true)
  const isolation = result.worker || result.guest
  assert.equal(isolation.node, 'undefined')
  assert.equal(isolation.ztools, 'undefined')
  assert.equal(isolation.hostFileReadable, false)
  assert.equal(isolation.syncMd5, '900150983cd24fb0d6963f7d28e17f72')
  if (result.worker) {
    assert.equal(isolation.networkReadable, false); assert.equal(isolation.requests, 3); assert.equal(isolation.compressed, '中文')
    assert.equal(isolation.aes, 'a9313268ef30a1d8ffb00161ce2a5977')
    assert.equal(isolation.rsa, publicEncrypt({ key: publicKey, padding: constants.RSA_NO_PADDING }, Buffer.concat([Buffer.alloc(125), Buffer.from('abc')])).toString('hex'))
    assert.equal(isolation.terminatedBusyWorker, true)
  }
  else { assert.equal(result.guestPreferences[0].preferences.contextIsolation, true); assert.equal(result.guestPreferences[0].preferences.webSecurity, true) }
  assert.equal(result.checks.storage.stale.name, 'conflict')
  assert.equal(result.checks.storage.size.error, true)
  assert.equal(result.checks.storage.bulk[0].ok, true)
  assert.equal(result.checks.storage.bulk[1].error, true)
  assert.deepEqual(result.checks.localSQLite, { rollback: true, reopen: true })
  await expect.poll(() => evaluate(`!!document.querySelector('#container') || document.body.innerText.includes('原 LX 组件')`)).toBe(true)
  const instance = await evaluate(`window.services.startLifecycleProbe()`)
  await evaluate('window.ztools.outPlugin(false)')
  await new Promise(resolve => setTimeout(resolve, 1500))
  const hidden = await evaluate('window.services.getLifecycleProbe()')
  assert.equal(hidden.id, instance.id); assert.ok(hidden.ticks >= instance.ticks + 5)
  await page.locator('.search-input').fill('洛雪音乐')
  await page.locator('.app-item').filter({ hasText: '洛雪音乐' }).first().click()
  const reentered = await evaluate('window.services.getLifecycleProbe()')
  assert.equal(reentered.id, instance.id)
  const detached = await page.evaluate(() => window.ztools.detachPlugin())
  assert.equal(detached.success, true)
  const afterDetach = await evaluate('window.services.getLifecycleProbe()')
  assert.equal(afterDetach.id, instance.id)
  result.lifecycle = { hidden, reentered, detached, afterDetach }
  await evaluate('window.ztools.outPlugin(true)')
  await expect.poll(() => app.evaluate(({ webContents }, suffix) => webContents.getAllWebContents().filter(x => x.getURL().includes(suffix)).length, suffix)).toBe(0)
  result.status = 'PASS'
} catch (error) {
  if (app) result.webContentsOnFailure = await app.evaluate(({ webContents }) => webContents.getAllWebContents().map(x => ({ type: x.getType(), url: x.getURL(), preferences: x.getLastWebPreferences() }))).catch(() => [])
  result.status = 'FAIL'
  result.error = String(error.stack || error)
  process.exitCode = 1
} finally {
  writeFileSync(join(evidence, 'report.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
  await app?.close()
}

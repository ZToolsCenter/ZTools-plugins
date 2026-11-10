import { _electron as electron, expect } from '@playwright/test'
import { mkdtempSync, mkdirSync, readdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

function copyDirectory(source, target) {
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isDirectory()) copyDirectory(join(source, entry.name), join(target, entry.name))
    else copyFileSync(join(source, entry.name), join(target, entry.name))
  }
}

/** Load the actual production plugin in a separate, disposable ZTools instance. */
export async function startHost(entry, { zip = process.env.ZTOOLS_PLUGIN_ZIP } = {}) {
  const data = mkdtempSync(join(tmpdir(), 'lx-ztools-host-'))
  mkdirSync(join(data, 'legacy'))
  const plugin = join(data, 'plugin')
  copyDirectory(resolve('src-ztools'), plugin)
  const manifest = JSON.parse(readFileSync(join(plugin, 'plugin.json'), 'utf8'))
  delete manifest.development
  if (entry) manifest.main = entry
  entry = manifest.main
  writeFileSync(join(plugin, 'plugin.json'), JSON.stringify(manifest))
  const app = await electron.launch({ executablePath: process.env.ZTOOLS_EXECUTABLE || resolve('../tmp/lx-electron-42/electron.exe'),
    args: [process.env.ZTOOLS_APP || 'D:/Program Files/ZTools/resources/app.asar'],
    env: { ...process.env, ZTOOLS_DATA_ROOT: data, ZTOOLS_LEGACY_USER_DATA_PATH: join(data, 'legacy'), ZTOOLS_E2E: '1' }, timeout: 45000 })
  try {
    await app.evaluate(({ app, webContents }) => {
      globalThis.__lxTestConsole = []
      const attach = wc => wc.on('console-message', (_event, details, message) => globalThis.__lxTestConsole.push(typeof details === 'object' ? details.message : String(message)))
      webContents.getAllWebContents().forEach(attach)
      app.on('web-contents-created', (_event, wc) => attach(wc))
    })
    const page = await app.firstWindow()
    await page.waitForSelector('.search-input', { timeout: 30000 })
    const installed = await app.evaluate(async ({ ipcMain, BrowserWindow }, { file, zip }) => {
      const sender = BrowserWindow.getAllWindows().find(x => x.getTitle() === 'ZTools').webContents
      if (zip) return ipcMain._invokeHandlers.get('install-plugin-from-path')({ sender }, zip)
      const registered = await ipcMain._invokeHandlers.get('upsert-dev-project-by-config-path')({ sender }, file)
      if (!registered.success) throw new Error(JSON.stringify(registered))
      return ipcMain._invokeHandlers.get('install-dev-plugin')({ sender }, registered.pluginName)
    }, { file: join(plugin, 'plugin.json'), zip: zip ? resolve(zip) : null })
    assert.equal(installed.success, true, JSON.stringify(installed))
    await page.locator('.search-input').fill('lxmusic')
    await page.locator('.app-item').filter({ hasText: /lxmusic|洛雪音乐|LX Music/i }).first().click()
    const suffix = '/' + entry
    await expect.poll(() => app.evaluate(({ webContents }, suffix) => webContents.getAllWebContents().some(x => x.getURL().includes(suffix)), suffix), { timeout: 20000 }).toBe(true)
    const evaluate = async (script, timeout = 35000) => {
      let timer
      try {
        return await Promise.race([app.evaluate(({ webContents }, { suffix, script }) => {
          const wc = webContents.getAllWebContents().find(x => x.getURL().includes(suffix))
          if (!wc) throw new Error('Plugin WebContents not found')
          return wc.executeJavaScript(script)
        }, { suffix, script }), new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Plugin evaluation timed out')), timeout) })])
      } finally { clearTimeout(timer) }
    }
    const close = async () => {
      // Only this launch's process: a blocked native dialog must not leave a test host running.
      const timer = setTimeout(() => app.process()?.kill(), 5000)
      try { await app.close() } finally { clearTimeout(timer) }
    }
    return { app, page, data, plugin, evaluate, logs: () => app.evaluate(() => globalThis.__lxTestConsole), close }
  } catch (error) {
    mkdirSync('artifacts', { recursive: true })
    const logs = await app.evaluate(() => globalThis.__lxTestConsole).catch(() => [])
    const body = await (await app.firstWindow()).locator('body').innerText().catch(() => '')
    writeFileSync('artifacts/host-last-failure.json', JSON.stringify({ data, error: String(error), body, logs }, null, 2))
    await app.close(); throw error
  }
}

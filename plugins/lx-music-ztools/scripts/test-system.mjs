import { startHost } from './host-fixture.mjs'
import { expect } from '@playwright/test'
import { createServer } from 'node:net'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import fixtureAPI from '../tests/ztools/fixtures/audio-server.cjs'
mkdirSync('artifacts/system', { recursive: true })
const template = readFileSync('tests/ztools/fixtures/source-api-v2.js', 'utf8')
const fixture = await fixtureAPI.startAudioServer(template)
const report = { evidence: 'Actual installed ZTools, original desktop lyric renderer and original player/Sync services' }
let host, port
const reserve = createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve)); port = reserve.address().port; await new Promise(resolve => reserve.close(resolve))
try {
  host = await startHost('dist/lx.html')
  const invoke = (channel, params) => host.evaluate(`lxHost.invoke(${JSON.stringify(channel)},${JSON.stringify(params)})`)
  await expect.poll(() => host.evaluate('typeof lxPlayer'), { timeout: 15000 }).toBe('object')
  const fonts = await invoke('common_get_system_fonts')
  assert.ok(Array.isArray(fonts) && fonts.length > 0, 'Native font enumeration must work from preload')
  await host.evaluate(`lxHost.subscribe('bridge:error',error=>console.error('bridge: '+JSON.stringify(error))); undefined`)
  const imported = await invoke('winMain_import_user_api', template.replaceAll('__BASE_URL__', fixture.base))
  await invoke('common_set_app_setting', { 'common.isAgreePact': true, 'common.showChangeLog': false, 'common.apiSource': imported.apiInfo.id, 'player.volume': 0.01,
    'desktopLyric.width': 600, 'desktopLyric.height': 150, 'desktopLyric.isAlwaysOnTop': true, 'desktopLyric.isLock': false, 'desktopLyric.pauseHide': false })
  await invoke('winMain_set_user_api', imported.apiInfo.id)
  const track = { id: 'kw_system', source: 'kw', name: '系统验证', singer: '本地合成', interval: '00:12', meta: { musicId: 'system', qualitys: [{ type: '128k' }], _qualitys: { '128k': {} }, albumName: '原播放器' } }
  await invoke('winMain_save_lyric_raw', { id: track.id, lyrics: { lyric: '[00:00.00]第一行本地歌词\n[00:02.00]第二行本地歌词\n[00:04.00]第三行本地歌词', tlyric: '', lxlyric: '', rlyric: '' } })
  await invoke('player_list_music_add', { id: 'default', musicInfos: [track], addMusicLocationType: 'bottom' })
  await host.evaluate(`lxPlayer.dispatch({type:'playList',listId:'default',index:0})`)
  await expect.poll(() => host.evaluate('lxPlayer.getState().progress'), { timeout: 20000 }).toBeGreaterThan(0.5)
  await invoke('windows:openLyrics')
  const child = script => host.app.evaluate(({ webContents }, script) => {
    const wc = webContents.getAllWebContents().find(wc => wc.getURL().includes('/dist/lyric.html'))
    if (!wc) return ''
    return wc.executeJavaScript(script)
  }, script)
  await expect.poll(() => child('document.body.innerText'), { timeout: 15000 }).toContain('本地歌词')
  const windows = await host.app.evaluate(({ BrowserWindow, webContents }) => {
    const lyric = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('/dist/lyric.html'))
    const player = webContents.getAllWebContents().find(wc => wc.getURL().includes('/dist/lx.html'))
    return { top: lyric.isAlwaysOnTop(), bounds: lyric.getBounds(), lyricPID: lyric.webContents.getOSProcessId(), playerPID: player.getOSProcessId(), audioElements: 0 }
  })
  assert.equal(windows.top, true)
  assert.notEqual(windows.lyricPID, windows.playerPID, 'Original lyric UI must be a separate host process')
  assert.equal(await child('document.querySelectorAll("audio").length'), 0)
  await invoke('common_set_app_setting', { 'desktopLyric.isLock': true })
  await expect.poll(() => child('document.querySelector("#container").classList.contains("lock")')).toBe(true)
  await invoke('common_set_app_setting', { 'desktopLyric.isLock': false })
  await expect.poll(() => child('document.querySelector("#container").classList.contains("lock")')).toBe(false)
  assert.equal((await invoke('winMain_sync_action', { action: 'get_server_status' })).status, false)
  await invoke('winMain_sync_action', { action: 'enable_server', data: { enable: true, port: String(port) } })
  assert.equal((await invoke('winMain_sync_action', { action: 'get_server_status' })).status, true)
  assert.equal((await fetch(`http://127.0.0.1:${port}/hello`)).status, 200)
  const before = await host.evaluate('lxPlayer.getState().progress')
  await host.evaluate('ztools.outPlugin(false)')
  await new Promise(resolve => setTimeout(resolve, 700))
  assert.ok(await host.evaluate('lxPlayer.getState().progress') > before + 0.3)
  assert.equal((await invoke('winMain_sync_action', { action: 'get_server_status' })).status, true)
  await invoke('winMain_sync_action', { action: 'enable_server', data: { enable: false, port: String(port) } })
  await invoke('windows:closeLyrics')
  await expect.poll(() => host.app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(wc => wc.getURL().includes('/dist/lyric.html')).length)).toBe(0)
  report.status = 'PASS'; report.fontCount = fonts.length; report.windows = windows; report.lyric = 'Original page consumes original millisecond port events; lock/top/background/close verified'; report.sync = 'Default closed, explicit start/hello, background listener, stop verified'
  console.log('PASS original desktop lyrics, separate renderer, top/lock/background/close; native Sync start/hide/stop')
} catch (error) {
  report.status = 'FAIL'; report.error = String(error.stack || error); report.logs = await host?.logs()
  report.views = await host?.app.evaluate(async ({ webContents }) => Promise.all(webContents.getAllWebContents().map(async wc => ({ url: wc.getURL(), state: await wc.executeJavaScript(`({host:typeof window.lxHost,body:document.body?.innerHTML.slice(0,1500),title:document.title})`).catch(error => String(error)) })))).catch(() => [])
  report.windowState = await host?.evaluate(`lxHost.invoke('windows:status')`).catch(() => null)
  process.exitCode = 1
}
finally { writeFileSync('artifacts/system/report.json', JSON.stringify(report, null, 2)); await host?.close(); await fixture.close() }

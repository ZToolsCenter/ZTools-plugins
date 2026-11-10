import { startHost } from './host-fixture.mjs'
import { expect } from '@playwright/test'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import audioFixture from '../tests/ztools/fixtures/audio-server.cjs'
mkdirSync('artifacts/player', { recursive: true })
const template = readFileSync('tests/ztools/fixtures/source-api-v2.js', 'utf8')
const fixture = await audioFixture.startAudioServer(template)
let host
const report = { evidence: 'Actual original LX audio engine; local source and generated WAV fixture' }
try {
  host = await startHost('dist/lx.html')
  const invoke = (channel, params) => host.evaluate(`lxHost.invoke(${JSON.stringify(channel)},${JSON.stringify(params)})`)
  await expect.poll(() => host.evaluate('typeof window.lxPlayer'), { timeout: 15000 }).toBe('object')
  const source = await invoke('winMain_import_user_api', template.replaceAll('__BASE_URL__', fixture.base))
  await invoke('common_set_app_setting', { 'common.isAgreePact': true, 'common.showChangeLog': false, 'common.apiSource': source.apiInfo.id, 'player.volume': 0.01 })
  await invoke('winMain_set_user_api', source.apiInfo.id)
  await expect.poll(async () => (await invoke('winMain_get_user_api_status')).status).toBe(true)
  const tracks = ['one', 'two'].map(id => ({ id: `kw_${id}`, source: 'kw', name: `Test ${id}`, singer: 'Local fixture', interval: '00:12', meta: { musicId: id, qualitys: [{ type: '128k', size: '512KB' }], _qualitys: { '128k': {} }, albumName: 'Test' } }))
  await invoke('player_list_music_add', { id: 'default', musicInfos: tracks, addMusicLocationType: 'bottom' })
  await host.evaluate(`lxPlayer.dispatch({type:'playList',listId:'default',index:0})`)
  await expect.poll(() => host.evaluate('lxPlayer.getState().progress'), { timeout: 20000 }).toBeGreaterThan(0.6)
  const playing = await host.evaluate('lxPlayer.getState()')
  assert.ok(playing.duration > 11 && playing.duration < 13)
  assert.equal(playing.status, 'playing')
  await host.evaluate(`document.querySelector('#player > div[aria-label]').click()`)
  await expect.poll(() => host.evaluate(`([...document.querySelectorAll('button')].some(button=>button.checkVisibility() && [...button.querySelectorAll('use')].some(use=>use.getAttribute('xlink:href')==='#icon-window-hide')))`)).toBe(true)
  const detailControls = await host.evaluate(`([...document.querySelectorAll('button')].filter(button=>button.checkVisibility() && [...button.querySelectorAll('use')].some(use=>/^#icon-window-(minimize|close)/.test(use.getAttribute('xlink:href')||''))).length)`)
  assert.equal(detailControls, 0, 'Playback details must also omit desktop window buttons')
  await host.evaluate(`([...document.querySelectorAll('button')].find(button=>button.checkVisibility() && [...button.querySelectorAll('use')].some(use=>use.getAttribute('xlink:href')==='#icon-window-hide'))).click()`)
  await host.evaluate(`lxPlayer.dispatch({type:'pause'})`)
  const paused = await host.evaluate('lxPlayer.getState().progress')
  await new Promise(resolve => setTimeout(resolve, 400))
  assert.ok(Math.abs(await host.evaluate('lxPlayer.getState().progress') - paused) < 0.1)
  await host.evaluate(`lxPlayer.dispatch({type:'play'})`)
  await host.evaluate('ztools.outPlugin(false)')
  await new Promise(resolve => setTimeout(resolve, 1000))
  assert.ok(await host.evaluate('lxPlayer.getState().progress') > paused + 0.5)
  await host.evaluate(`lxPlayer.dispatch({type:'next'})`)
  await expect.poll(() => host.evaluate('lxPlayer.getState().name'), { timeout: 10000 }).toBe('Test two')
  await expect.poll(() => host.evaluate('lxPlayer.getState().progress')).toBeGreaterThan(0.3)
  report.status = 'PASS'; report.playing = playing; report.requests = fixture.requests
  console.log('PASS source-driven original audio playback, metadata/time, pause/resume, background, next track')
} catch (error) { report.status = 'FAIL'; report.error = String(error.stack || error); report.logs = await host?.logs(); process.exitCode = 1 }
finally { writeFileSync('artifacts/player/report.json', JSON.stringify(report, null, 2)); await host?.close(); await fixture.close() }

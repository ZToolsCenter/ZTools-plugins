import { startHost } from './host-fixture.mjs'
import { expect } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import fixtureAPI from '../tests/ztools/fixtures/audio-server.cjs'

mkdirSync('artifacts/commands', { recursive: true })
const source = readFileSync('tests/ztools/fixtures/source-api-v2.js', 'utf8')
const fixture = await fixtureAPI.startAudioServer(source)
const report = { evidence: 'Actual isolated ZTools search results activate native feature codes; original player and router' }
let host
try {
  host = await startHost('dist/lx.html')
  const invoke = (channel, value) => host.evaluate(`lxHost.invoke(${JSON.stringify(channel)},${JSON.stringify(value)})`)
  await expect.poll(() => host.evaluate('typeof lxPlayer'), { timeout: 20000 }).toBe('object')
  const imported = await invoke('winMain_import_user_api', source.replaceAll('__BASE_URL__', fixture.base))
  await invoke('common_set_app_setting', { 'common.isAgreePact': true, 'common.showChangeLog': false, 'common.apiSource': imported.apiInfo.id, 'player.volume': 0.01 })
  await invoke('winMain_set_user_api', imported.apiInfo.id)
  const tracks = ['one', 'two'].map(id => ({ id: `kw_command_${id}`, name: id, singer: '本地合成', source: 'kw', interval: '00:12', meta: { songId: id, qualitys: [{ type: '128k' }], _qualitys: { '128k': {} } } }))
  await invoke('player_list_music_add', { id: 'default', musicInfos: tracks, addMusicLocationType: 'bottom' })
  await host.evaluate(`lxPlayer.dispatch({type:'playList',listId:'default',index:0})`)
  await expect.poll(() => host.evaluate('lxPlayer.getState().progress'), { timeout: 15000 }).toBeGreaterThan(0.5)
  const run = async (input, label) => {
    await host.evaluate('ztools.outPlugin(false)')
    await host.page.locator('.search-input').fill(input)
    await host.page.locator('.app-item').filter({ hasText: label }).first().click()
  }
  await run('LX 播放/暂停', 'LX 播放/暂停')
  await expect.poll(() => host.evaluate('lxPlayer.getState().status')).toBe('paused')
  await run('LX 播放/暂停', 'LX 播放/暂停')
  await expect.poll(() => host.evaluate('lxPlayer.getState().status')).toBe('playing')
  await run('LX 下一首', 'LX 下一首')
  await expect.poll(() => host.evaluate('lxPlayer.getState().name')).toBe('two')
  await run('LX 上一首', 'LX 上一首')
  await expect.poll(() => host.evaluate('lxPlayer.getState().name')).toBe('one')
  const fixtures = JSON.parse(readFileSync('tests/ztools/fixtures/catalog-search.json', 'utf8'))
  await host.evaluate(`{const invoke=lxHost.invoke, fixtures=${JSON.stringify(fixtures)}; lxHost.invoke=(channel,params)=>{
    if(channel!=='network:fetch')return invoke(channel,params);
    const url=params.url, platform=url.includes('kuwo.cn')?'kw':url.includes('kugou.com')?'kg':url.includes('qq.com')?'tx':url.includes('163.com')?'wy':url.includes('migu.cn')?'mg':null;
    if(!platform)return invoke(channel,params);
    const body=fixtures[platform];return Promise.resolve({statusCode:200,headers:{'content-type':'application/json'},body,raw:new TextEncoder().encode(JSON.stringify(body))});
  };undefined}`)
  await run('lx 搜索 指令验证', 'LX 搜索')
  await expect.poll(() => host.evaluate('decodeURIComponent(location.hash)')).toContain('text=指令验证')
  assert.ok((await host.evaluate('location.hash')).includes('/search'))
  assert.equal((await invoke('windows:status')).open, false)
  await run('LX 桌面歌词', 'LX 桌面歌词')
  await expect.poll(async () => (await invoke('windows:status')).open).toBe(true)
  await run('LX 桌面歌词', 'LX 桌面歌词')
  await expect.poll(async () => (await invoke('windows:status')).open).toBe(false)
  report.status = 'PASS'; report.commands = ['play-pause', 'next', 'prev', 'search regex payload', 'lyrics toggle']; report.hotkey = 'Native features verified; physical global shortcut assignment remains user-managed in ZTools'
  console.log('PASS native ZTools play/pause/next/prev/search/lyrics commands target original player/router')
} catch (error) { report.status = 'FAIL'; report.error = String(error.stack || error); report.logs = await host?.logs(); process.exitCode = 1 }
finally { writeFileSync('artifacts/commands/report.json', JSON.stringify(report, null, 2)); await host?.close(); await fixture.close() }

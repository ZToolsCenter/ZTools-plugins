import { startHost } from './host-fixture.mjs'
import { expect } from '@playwright/test'
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
const directory = process.env.LX_SOURCE_DIR
if (!directory) throw new Error('Set LX_SOURCE_DIR; user scripts are never bundled')
const output = mkdtempSync(join(tmpdir(), 'lx-private-playback-'))
const report = { catalog: {}, sources: [], status: 'FAIL' }, seen = new Set()
const names = readdirSync(directory).filter(name => name.endsWith('.js') && (!process.env.LX_SOURCE_FILE || name === process.env.LX_SOURCE_FILE))
let host
try {
  host = await startHost('dist/lx.html')
  const invoke = (channel, value) => host.evaluate(`lxHost.invoke(${JSON.stringify(channel)},${JSON.stringify(value)})`)
  await expect.poll(() => host.evaluate('typeof lxCatalog'), { timeout: 20000 }).toBe('object')
  await invoke('common_set_app_setting', { 'common.isAgreePact': true, 'common.showChangeLog': false, 'player.volume': 0.01, 'player.startupAutoPlay': false })
  const tracks = []
  for (const source of ['kw', 'tx', 'wy', 'mg', 'kg']) {
    try {
      const result = await host.evaluate(`lxCatalog.search({text:${JSON.stringify(process.env.LX_TEST_QUERY || '晴天')},source:${JSON.stringify(source)},page:1})`, 65000)
      if (result.list[0]) tracks.push(result.list[0])
      report.catalog[source] = { count: result.list.length }
    } catch (error) { report.catalog[source] = { error: String(error.message).split('\n')[0].slice(0, 160) } }
  }
  for (const file of names) {
    const script = readFileSync(join(directory, file), 'utf8'), hash = createHash('sha256').update(script).digest('hex')
    if (seen.has(hash)) continue
    seen.add(hash)
    const record = { file, hash, initialized: false, requests: [] }; report.sources.push(record)
    try {
      const { apiInfo } = await invoke('winMain_import_user_api', script)
      await invoke('common_set_app_setting', { 'common.apiSource': apiInfo.id })
      await invoke('winMain_set_user_api', apiInfo.id)
      const status = await invoke('winMain_get_user_api_status'); record.initialized = status.status
      for (const track of tracks) {
        if (!status.apiInfo?.sources?.[track.source]?.qualitys?.includes('128k')) continue
        const item = { platform: track.source, trackId: track.id }; record.requests.push(item)
        try {
          const url = await host.evaluate(`lxCatalog.resolve(${JSON.stringify(track)},'128k')`, 35000)
          item.resolved = /^https?:\/\//.test(url)
          if (!item.resolved) throw new Error('Source did not return HTTP(S) audio URL')
          // URL is deliberately never printed or included in the private report.
          await invoke('player_list_music_add', { id: 'default', musicInfos: [track], addMusicLocationType: 'top' })
          await host.evaluate(`lxPlayer.dispatch({type:'playList',listId:'default',index:0})`)
          await expect.poll(() => host.evaluate('lxPlayer.getState().progress'), { timeout: 20000 }).toBeGreaterThan(0.5)
          item.played = true
          const downloadPath = await host.evaluate('ztools.getPath("pluginData")')
          await invoke('common_set_app_setting', { 'download.savePath': downloadPath, 'download.isEmbedPic': false, 'download.isEmbedLyric': false, 'download.isDownloadLrc': false, 'download.isSavePathGroupByListName': false })
          await host.evaluate(`lxDownload.create([${JSON.stringify(track)}], '128k', 'default')`)
          await expect.poll(async () => (await host.evaluate('lxDownload.getState()')).find(task => task.metadata.musicInfo.id === track.id)?.status, { timeout: 90000 }).toBe('completed')
          item.downloaded = true; report.status = 'PASS'
          await host.evaluate(`lxPlayer.dispatch({type:'pause'})`)
          break
        } catch (error) { item.error = String(error.message).split('\n')[0].replace(/https?:\/\/\S+/g, '[remote]').slice(0, 160) }
      }
    } catch (error) { record.error = String(error.message).split('\n')[0].replace(/https?:\/\/\S+/g, '[remote]').slice(0, 160) }
    console.log(`checked=${report.sources.length}, initialized=${record.initialized}, resolved=${record.requests.filter(x => x.resolved).length}, played=${record.requests.filter(x => x.played).length}`)
    if (report.status === 'PASS') break
  }
  await invoke('winMain_set_user_api', 'temp')
} finally { writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2)); await host?.close() }
console.log(JSON.stringify({ status: report.status, privateReport: join(output, 'report.json') }))
if (report.status !== 'PASS') process.exitCode = 1

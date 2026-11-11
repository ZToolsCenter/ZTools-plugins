import { startHost } from './host-fixture.mjs'
import { expect } from '@playwright/test'
import { createCipheriv, createDecipheriv } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'

mkdirSync('artifacts/library', { recursive: true })
const key = Buffer.from([112, 87, 39, 61, 199, 250, 41, 191, 57, 68, 45, 114, 221, 94, 140, 228])
const encrypted = document => { const aes = createCipheriv('aes-128-ecb', key, null); return encodeURIComponent(Buffer.concat([aes.update(JSON.stringify(document)), aes.final()]).toString('base64')) }
const boards = Array.from({ length: 3 }, (_, page) => encrypted({ code: 200, data: { total: '201', musiclist: Array.from({ length: page === 2 ? 1 : 100 }, (_, offset) => {
  const id = page * 100 + offset + 1
  return { id, name: `榜单歌曲${id}`, artist: '测试歌手', album: '榜单专辑', albumId: 901, duration: 180, pic: '', n_minfo: 'level:a,bitrate:320,format:mp3,size:8m;level:b,bitrate:128,format:mp3,size:3m' }
}) } }))
const songs = Array.from({ length: 65 }, (_, offset) => ({ songId: String(offset + 1001), copyrightId: `CID${offset + 1001}`, songName: `歌单歌曲${offset + 1}`, album: '在线专辑', albumId: '902', duration: 180, singerList: [{ name: '测试歌手' }], audioFormats: [{ formatType: 'PQ', size: 3000000 }, { formatType: 'HQ', size: 8000000 }] }))
let host
const report = { evidence: 'Actual isolated ZTools, original KW encrypted leaderboard SDK + MG shared-link playlist SDK/store + original list IPC and backup service', requests: [] }
try {
  host = await startHost('dist/lx.html')
  const invoke = (channel, value) => host.evaluate(`lxHost.invoke(${JSON.stringify(channel)},${JSON.stringify(value)})`)
  await expect.poll(() => host.evaluate('typeof lxCatalog'), { timeout: 20000 }).toBe('object')
  await invoke('common_set_app_setting', { 'common.isAgreePact': true, 'common.showChangeLog': false, 'player.volume': 0.02 })
  await host.evaluate(`{
    const invoke = lxHost.invoke; const boardPages=${JSON.stringify(boards)}, songs=${JSON.stringify(songs)};
    window.__libraryRequests=[];
    lxHost.invoke=(channel,params)=>{
      if(channel!=='network:fetch') return invoke(channel,params);
      const url=new URL(params.url); let body;
      if(url.hostname==='wbd.kuwo.cn' && url.pathname.includes('bang_info')) {
        const count=__libraryRequests.filter(item=>item.includes('bang_info')).length;
        body=boardPages[count%3];
      } else if(url.pathname.includes('/playlist/song/')) { const page=Number(url.searchParams.get('pageNo')); body={code:'000000',data:{songList:songs.slice((page-1)*50,page*50),totalCount:65}}; }
      else if(url.pathname.includes('/resource/playlist/')) body={code:'000000',data:{title:'受控在线歌单',summary:'跨页完整导入',ownerName:'本地',imgItem:{img:''},opNumItem:{playNum:100}}};
      else return invoke(channel,params);
      __libraryRequests.push(params.url);
      return Promise.resolve({statusCode:200,headers:{'content-type':typeof body==='string'?'text/plain':'application/json'},raw:new TextEncoder().encode(typeof body==='string'?body:JSON.stringify(body)),body});
    }; undefined;
  }`)
  const catalog = await host.evaluate(`lxCatalog.boards('kw')`)
  assert.ok(catalog.list.some(item => item.bangid === '93'))
  const board = await host.evaluate(`lxCatalog.boardAll('kw','93',true)`)
  assert.equal(board.length, 201); assert.equal(new Set(board.map(item => item.id)).size, 201)
  assert.equal(board[200].id, 'kw_201'); assert.equal(board[0].meta.albumId, 901)
  assert.deepEqual(board[0].meta.qualitys.map(item => item.type), ['128k', '320k'])
  const playlist = await host.evaluate(`lxCatalog.listAll('mg','https://h5.nf.migu.cn/app/v4/p/share/playlist/index.html?id=12345&channel=test',true)`)
  assert.equal(playlist.length, 65); assert.equal(playlist[64].id, 'mg_1065')
  assert.equal(playlist[0].meta.copyrightId, 'CID1001')
  const list = { id: 'userlist_acceptance', name: '整单导入', source: 'mg', sourceListId: '12345', locationUpdateTime: Date.now() }
  await invoke('player_list_add', { position: 0, listInfos: [list] })
  await invoke('player_list_music_add', { id: list.id, musicInfos: playlist, addMusicLocationType: 'bottom' })
  await invoke('player_list_music_add', { id: 'love', musicInfos: board, addMusicLocationType: 'bottom' })
  assert.equal((await invoke('player_list_music_get', 'love')).length, 201)
  await invoke('player_list_update', [{ ...list, name: '编辑后的歌单' }])
  await invoke('player_list_music_update_position', { listId: list.id, position: 0, ids: [playlist[64].id] })
  const expected = JSON.parse(JSON.stringify([playlist[64], ...playlist.slice(0, 64)]))
  assert.deepEqual(await invoke('player_list_music_get', list.id), expected)
  assert.equal((await invoke('player_list_get'))[0].name, '编辑后的歌单')
  await host.evaluate(`location.hash='/list'`)
  await expect.poll(() => host.evaluate(`document.body.innerText.includes('编辑后的歌单')`)).toBe(true)
  const directory = await host.evaluate('ztools.getPath("pluginData")')
  for (const kind of ['all', 'lists', 'settings']) {
    const file = join(directory, `${kind}.lxmc`)
    await invoke('backup:export', { kind, path: file })
    assert.ok(readFileSync(file).length > 0)
    if (kind === 'all') {
      await invoke('player_list_music_clear', list.id)
      await invoke('common_set_app_setting', { 'player.volume': 0.3 })
      await invoke('backup:import', { kind, path: file })
      assert.deepEqual(await invoke('player_list_music_get', list.id), expected)
      assert.equal((await invoke('common_get_app_setting'))['player.volume'], 0.02)
    }
  }
  for (const format of ['txt', 'csv']) {
    const file = join(directory, `列表.${format}`)
    await invoke('backup:exportText', { path: file, format, merge: true })
    assert.ok(readFileSync(file, 'utf8').includes('歌单歌曲65'))
  }
  report.requests = await host.evaluate('__libraryRequests')
  const chartRequests = report.requests.filter(url => url.includes('bang_info')).map(url => {
    const encrypted = Buffer.from(new URL(url).searchParams.get('data'), 'base64')
    const aes = createDecipheriv('aes-128-ecb', key, null)
    return JSON.parse(Buffer.concat([aes.update(encrypted), aes.final()]).toString())
  })
  assert.deepEqual(chartRequests.map(request => request.pn), [0, 1, 2])
  assert.ok(chartRequests.every(request => request.rn === 100 && request.id === '93'))
  const playlistRequests = report.requests.filter(url => url.includes('/playlist/song/')).map(url => new URL(url))
  assert.deepEqual(playlistRequests.map(url => url.searchParams.get('pageNo')), ['1', '2'])
  assert.ok(playlistRequests.every(url => url.searchParams.get('playlistId') === '12345'))
  report.status = 'PASS'; report.boardCount = board.length; report.playlistCount = playlist.length
  report.backup = 'All/lists/settings gzip exports; all-data restores settings+list; original TXT/CSV exports'
  console.log('PASS original encrypted charts 201 tracks/3 pages, shared-link playlist 65/2 pages, batch collection/edit/order and backups')
} catch (error) { report.status = 'FAIL'; report.error = String(error.stack || error); report.logs = await host?.logs(); process.exitCode = 1 }
finally { writeFileSync('artifacts/library/report.json', JSON.stringify(report, null, 2)); await host?.close() }

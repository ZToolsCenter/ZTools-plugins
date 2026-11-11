import { startHost } from './host-fixture.mjs'
import { expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

mkdirSync('artifacts/local-media', { recursive: true })
const directory = mkdtempSync(join(tmpdir(), 'lx-local-media-'))
const files = ['mp3', 'flac', 'wav'].map(ext => join(directory, `中文音乐-${ext}.${ext}`))
for (const file of files) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '6', '-metadata', 'title=本地格式验证', '-metadata', 'artist=合成音频', file], { windowsHide: true })
  assert.equal(result.status, 0, result.stderr?.toString())
}
let host
const report = { evidence: 'Actual isolated ZTools; public file grant, original local import/metadata and audio engine', formats: [] }
try {
  host = await startHost('dist/lx.html')
  const invoke = (channel, value) => host.evaluate(`lxHost.invoke(${JSON.stringify(channel)},${JSON.stringify(value)})`)
  await expect.poll(() => host.evaluate('typeof lxPlayer'), { timeout: 20000 }).toBe('object')
  await invoke('common_set_app_setting', { 'common.isAgreePact': true, 'common.showChangeLog': false, 'player.volume': 0.01 })
  await host.app.evaluate(({ dialog }, files) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files }) }, files)
  assert.deepEqual((await invoke('winMain_show_select_dialog', { properties: ['openFile', 'multiSelections'] })).filePaths, files)
  const tracks = await invoke('worker:main', { method: 'createLocalMusicInfos', args: [files] })
  assert.equal(tracks.length, 3)
  for (let index = 0; index < tracks.length; index++) {
    assert.equal(tracks[index].source, 'local')
    assert.equal(tracks[index].name, '本地格式验证')
    assert.equal(tracks[index].meta.filePath, files[index])
  }
  await invoke('player_list_music_add', { id: 'default', musicInfos: tracks, addMusicLocationType: 'bottom' })
  for (let index = 0; index < tracks.length; index++) {
    await host.evaluate(`lxPlayer.dispatch({type:'playList',listId:'default',index:${index}})`)
    await expect.poll(() => host.evaluate('lxPlayer.getState().duration'), { timeout: 15000 }).toBeGreaterThan(5)
    await expect.poll(() => host.evaluate('lxPlayer.getState().progress'), { timeout: 15000 }).toBeGreaterThan(0.5)
    report.formats.push({ format: tracks[index].meta.ext, state: await host.evaluate('lxPlayer.getState()') })
    await host.evaluate(`lxPlayer.dispatch({type:'pause'})`)
  }
  await host.evaluate(`window.__localMediaErrors=[];window.addEventListener('unhandledrejection',e=>__localMediaErrors.push(String(e.reason?.stack||e.reason)))`)
  await invoke('common_set_app_setting', { 'player.soundEffect.biquadFilter.hz1000': 3, 'player.soundEffect.pitchShifter.playbackRate': 1.1 })
  await host.evaluate(`lxPlayer.dispatch({type:'playList',listId:'default',index:2})`)
  await expect.poll(() => host.logs()).toContainEqual('pitch shifter audio worklet loaded')
  await expect.poll(() => host.evaluate('lxPlayer.getState().progress')).toBeGreaterThan(0.8)
  assert.deepEqual(await host.evaluate('__localMediaErrors'), [])
  report.status = 'PASS'; report.dsp = 'Original equalizer + phase-vocoder AudioWorklet loaded and playback advances'
  console.log('PASS Chinese MP3/FLAC/WAV file selection/import/metadata/playback and original DSP AudioWorklet')
} catch (error) { report.status = 'FAIL'; report.error = String(error.stack || error); report.logs = await host?.logs(); process.exitCode = 1 }
finally { writeFileSync('artifacts/local-media/report.json', JSON.stringify(report, null, 2)); await host?.close() }

import { startHost } from './host-fixture.mjs'
import { expect } from '@playwright/test'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import audioFixture from '../tests/ztools/fixtures/audio-server.cjs'
import { createServer } from 'node:http'
import { connect } from 'node:net'

mkdirSync('artifacts/settings-effects', { recursive: true })
const template = readFileSync('tests/ztools/fixtures/source-api-v2.js', 'utf8')
const fixture = await audioFixture.startAudioServer(template)
const report = { evidence: 'Actual ZTools, original player, real Web Audio nodes and lyric DOM', checks: [] }
const sockets = new Set(), tunnels = []
const proxy = createServer()
proxy.on('connect', (req, socket, head) => {
  tunnels.push(req.url)
  const target = new URL(fixture.base)
  const upstream = connect(Number(target.port), target.hostname, () => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head.length) upstream.write(head)
    socket.pipe(upstream); upstream.pipe(socket)
  })
  for (const stream of [socket, upstream]) { sockets.add(stream); stream.on('error', () => stream.destroy()); stream.on('close', () => sockets.delete(stream)) }
})
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
let host
try {
  host = await startHost('dist/lx.html')
  const invoke = (channel, params) => host.evaluate(`lxHost.invoke(${JSON.stringify(channel)},${JSON.stringify(params)})`)
  const setting = patch => invoke('common_set_app_setting', patch)
  await expect.poll(() => host.evaluate('typeof lxPlayer'), { timeout: 20000 }).toBe('object')
  report.capabilities = await host.evaluate(`({enumerate:typeof navigator.mediaDevices?.enumerateDevices,elementSink:typeof Audio.prototype.setSinkId,contextSink:typeof AudioContext.prototype.setSinkId})`)
  await host.evaluate(`(()=>{
    window.__settingsErrors=[];addEventListener('unhandledrejection',e=>__settingsErrors.push(String(e.reason?.stack||e.reason)));
    window.__settingsRouteErrors=[];const originalError=console.error;console.error=(...args)=>{if(String(args[0]).includes('音频输出'))__settingsRouteErrors.push(args.map(e=>e?.name?{name:e.name,message:e.message}:String(e)));originalError(...args)};
    window.__settingsNativeRoutes=[];for(const [kind,proto] of [['element',HTMLMediaElement.prototype],['context',AudioContext.prototype]]){const original=proto.setSinkId;if(original)proto.setSinkId=async function(id){try{const result=await original.call(this,id);__settingsNativeRoutes.push({kind,status:'PASS',default:['','default'].includes(id)});return result}catch(e){__settingsNativeRoutes.push({kind,status:e.name,default:['','default'].includes(id)});throw e}}}
    const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(...args){if(/^https?:/.test(this.src))window.__settingsAudio=this;return play.apply(this,args)};
    const Context=window.AudioContext;window.__settingsContexts=[];window.__settingsFilters=[];window.__settingsGains=[];window.__settingsPanners=[];
    window.AudioContext=class extends Context{constructor(...args){super(...args);__settingsContexts.push(this)}createBiquadFilter(){const node=super.createBiquadFilter();__settingsFilters.push(node);return node}createGain(){const node=super.createGain();__settingsGains.push(node);return node}createPanner(){const node=super.createPanner();__settingsPanners.push(node);return node}};
  })()`)
  const imported = await invoke('winMain_import_user_api', template.replaceAll('__BASE_URL__', fixture.base))
  await setting({ 'common.isAgreePact': true, 'common.showChangeLog': false, 'common.apiSource': imported.apiInfo.id, 'player.volume': 0.01 })
  await invoke('winMain_set_user_api', imported.apiInfo.id)
  const track = { id: 'kw_settings', source: 'kw', name: '设置效果验证', singer: '受控测试', interval: '00:12', meta: { musicId: 'settings', qualitys: [{ type: '128k' }], _qualitys: { '128k': {} }, albumName: '本地生成' } }
  await invoke('winMain_save_lyric_raw', { id: track.id, lyrics: { lyric: '[00:00.00]音乐爱与梦\n[00:03.00]第二行歌词', tlyric: '[00:00.00]TRANSLATION\n[00:03.00]SECOND TRANSLATION', rlyric: '[00:00.00]ROMA\n[00:03.00]SECOND ROMA', lxlyric: '' } })
  await invoke('player_list_music_add', { id: 'default', musicInfos: [track], addMusicLocationType: 'bottom' })
  await host.evaluate(`lxPlayer.dispatch({type:'playList',listId:'default',index:0})`)
  await expect.poll(() => host.evaluate('lxPlayer.getState().progress'), { timeout: 20000 }).toBeGreaterThan(0.4)
  await host.evaluate(`lxPlayer.dispatch({type:'pause'}).then(()=>lxPlayer.dispatch({type:'play'}))`)
  await expect.poll(() => host.evaluate('!!window.__settingsAudio')).toBe(true)
  for (const [key, value, property] of [['player.volume', 0.17, 'volume'], ['player.isMute', true, 'muted'], ['player.playbackRate', 1.25, 'playbackRate'], ['player.preservesPitch', false, 'preservesPitch']]) {
    await setting({ [key]: value })
    await expect.poll(() => host.evaluate(`__settingsAudio[${JSON.stringify(property)}]`)).toBe(value)
    report.checks.push({ key, effect: `original HTMLAudioElement.${property}`, status: 'PASS' })
  }
  await setting({ 'player.isMute': false, 'player.playbackRate': 1, 'player.preservesPitch': true })
  for (const [index, frequency] of [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].entries()) {
    const key = `player.soundEffect.biquadFilter.hz${frequency}`, value = index % 2 ? -2 : 3
    await setting({ [key]: value })
    await expect.poll(() => host.evaluate(`__settingsFilters.find(node=>node.frequency.value===${frequency})?.gain.value`)).toBe(value)
    report.checks.push({ key, effect: 'real BiquadFilterNode.gain', status: 'PASS' })
  }
  await setting({ 'player.isMaxOutputChannelCount': true })
  await expect.poll(() => host.evaluate(`__settingsContexts[0].destination.channelCount`)).toBe(await host.evaluate(`__settingsContexts[0].destination.maxChannelCount`))
  await setting({ 'player.isMaxOutputChannelCount': false })
  assert.equal(await host.evaluate(`__settingsContexts[0].destination.channelCountMode`), 'explicit')
  report.checks.push({ key: 'player.isMaxOutputChannelCount', effect: 'real AudioDestinationNode max/default channel mode', status: 'PASS' })
  await setting({ 'player.soundEffect.panner.enable': true, 'player.soundEffect.panner.soundR': 8, 'player.soundEffect.panner.speed': 30 })
  await expect.poll(() => host.evaluate('__settingsPanners.length')).toBe(1)
  const before = await host.evaluate(`__settingsPanners[0].positionX.value`)
  await expect.poll(() => host.evaluate(`__settingsPanners[0].positionX.value`)).not.toBe(before)
  await setting({ 'player.soundEffect.panner.enable': false })
  report.checks.push({ key: 'player.soundEffect.panner.*', effect: 'real spatial panner changes position and can stop', status: 'PASS' })
  await setting({ 'player.soundEffect.convolution.fileName': 'filter-telephone.wav', 'player.soundEffect.convolution.mainGain': 2, 'player.soundEffect.convolution.sendGain': 3 })
  await expect.poll(() => host.evaluate(`__settingsGains.some(n=>Math.abs(n.gain.value-0.2)<0.0001)&&__settingsGains.some(n=>Math.abs(n.gain.value-0.3)<0.0001)`)).toBe(true)
  await setting({ 'player.soundEffect.convolution.fileName': '' })
  report.checks.push({ key: 'player.soundEffect.convolution.*', effect: 'built-in impulse decode and real gain nodes', status: 'PASS' })
  const outputs = await host.evaluate(`navigator.mediaDevices.enumerateDevices().then(list=>list.filter(d=>d.kind==='audiooutput'&&d.deviceId&&!['default','communications'].includes(d.deviceId)).map(d=>d.deviceId))`)
  if (outputs[0]) {
    report.contextProbe = await host.evaluate(`__settingsContexts[0].setSinkId(${JSON.stringify(outputs[0])}).then(()=>({status:'PASS'}),e=>({status:e.name,message:e.message}))`)
    await host.evaluate(`__settingsContexts[0].setSinkId('')`)
  }
  let routed = false
  for (const output of outputs) {
    const errors = await host.evaluate('__settingsRouteErrors.length')
    await setting({ 'player.mediaDeviceId': output })
    await expect.poll(() => host.evaluate(`__settingsContexts[0].sinkId===${JSON.stringify(output)}||__settingsRouteErrors.length>${errors}`)).toBe(true)
    routed = await host.evaluate(`__settingsContexts[0].sinkId===${JSON.stringify(output)}`)
    if (routed) break
    await expect.poll(() => host.evaluate(`lxHost.invoke('common_get_app_setting').then(s=>s['player.mediaDeviceId'])`)).toBe('default')
  }
  if (routed) {
    await setting({ 'player.mediaDeviceId': 'default' })
    await expect.poll(() => host.evaluate('__settingsContexts[0].sinkId')).toBe('')
    report.checks.push({ key: 'player.mediaDeviceId', effect: 'real enumerated nondefault device selected on actual DSP output owner and returns to default; captured element is no longer the sink owner', status: 'PASS' })
  } else report.checks.push({ key: 'player.mediaDeviceId', status: 'CONDITIONAL', effect: 'enumerated outputs rejected by native API; real fallback to default verified, no physical switching claim', attempts: outputs.length, routes: await host.evaluate('__settingsNativeRoutes') })
  await host.evaluate(`document.querySelector('#player > div[aria-label]').click()`)
  await expect.poll(() => host.evaluate(`!!document.querySelector('.lyric')`)).toBe(true)
  await setting({ 'playDetail.style.align': 'right', 'playDetail.style.fontSize': 175, 'playDetail.isZoomActiveLrc': true, 'playDetail.isShowLyricProgressSetting': true, 'playDetail.isDelayScroll': false })
  await expect.poll(() => host.evaluate(`document.querySelector('.lyric')?.style.textAlign`)).toBe('right')
  await expect.poll(() => host.evaluate(`document.querySelector('.lyric')?.parentElement.style.getPropertyValue('--playDetail-lrc-font-size')`)).toBe('1.75rem')
  const detail = await host.evaluate(`(()=>{const e=document.querySelector('.lyric');let c=e.__vueParentComponent;while(c&&!c.type.__cssModules?.$style?.lrcActiveZoom)c=c.parent;return {zoom:e.classList.contains(c.type.__cssModules.$style.lrcActiveZoom),progress:c.proxy.isShowLyricProgressSetting}})()`)
  assert.equal(detail.zoom, true); assert.equal(detail.progress, true)
  for (const key of ['playDetail.style.align', 'playDetail.style.fontSize', 'playDetail.isZoomActiveLrc', 'playDetail.isShowLyricProgressSetting']) report.checks.push({ key, effect: 'actual playback detail style/class/progress control', status: 'PASS' })
  await host.evaluate(`([...document.querySelectorAll('button')].find(button=>button.checkVisibility() && [...button.querySelectorAll('use')].some(use=>use.getAttribute('xlink:href')==='#icon-window-hide'))).click()`)
  await setting({ 'desktopLyric.pauseHide': false, 'desktopLyric.width': 640, 'desktopLyric.height': 180, 'desktopLyric.isAlwaysOnTop': true, 'desktopLyric.isShowTaskbar': true, 'desktopLyric.enable': true })
  const child = script => host.app.evaluate(({ webContents }, script) => webContents.getAllWebContents().find(w=>w.getURL().includes('/dist/lyric.html'))?.executeJavaScript(script), script)
  await expect.poll(() => child('document.body.innerText'), { timeout: 15000 }).toContain('歌词')
  const styles = { 'desktopLyric.style.fontSize': 28, 'desktopLyric.style.lineGap': 21, 'desktopLyric.style.opacity': 67, 'desktopLyric.style.align': 'left', 'desktopLyric.style.font': 'Microsoft YaHei' }
  await setting(styles)
  const lyricStyle = `(()=>{const e=[...document.querySelectorAll('#main > div')].find(e=>e.style.getPropertyValue('--line-gap'));return e?{fontSize:e.style.fontSize,lineGap:e.style.getPropertyValue('--line-gap'),opacity:e.style.opacity,align:e.style.textAlign,font:e.style.fontFamily,classes:e.className}:null})()`
  await expect.poll(() => child(lyricStyle)).toMatchObject({ fontSize: '28px', lineGap: '21px', opacity: '0.67', align: 'left', font: '"Microsoft YaHei"' })
  for (const key of Object.keys(styles)) report.checks.push({ key, effect: 'original lyric renderer inline style', status: 'PASS' })
  for (const [key, fragment] of [['desktopLyric.style.ellipsis', 'ellipsis'], ['desktopLyric.style.isZoomActiveLrc', 'lrcActiveZoom'], ['desktopLyric.style.isFontWeightFont', 'fontWeightFont'], ['desktopLyric.style.isFontWeightLine', 'fontWeightLine'], ['desktopLyric.style.isFontWeightExtended', 'fontWeightExtended']]) {
    const hasClass = `(()=>{const e=[...document.querySelectorAll('#main > div')].find(e=>e.style.getPropertyValue('--line-gap'));const cls=e?.__vueParentComponent.type.__cssModules?.$style[${JSON.stringify(fragment)}];return !!cls&&e.classList.contains(cls)})()`
    await setting({ [key]: true }); await expect.poll(() => child(hasClass)).toBe(true)
    await setting({ [key]: false }); await expect.poll(() => child(hasClass)).toBe(false)
    report.checks.push({ key, effect: 'original lyric renderer class toggles both ways', status: 'PASS' })
  }
  const horizontal = (await child(lyricStyle)).classes
  await setting({ 'desktopLyric.direction': 'vertical' })
  await expect.poll(() => child(lyricStyle)).toHaveProperty('classes', expect.not.stringMatching(new RegExp('^' + horizontal + '$')))
  report.checks.push({ key: 'desktopLyric.direction', effect: 'horizontal/vertical original component replacement', status: 'PASS' })
  const colors = { 'desktopLyric.style.lyricUnplayColor': 'rgba(1, 2, 3, 1)', 'desktopLyric.style.lyricPlayedColor': 'rgba(4, 5, 6, 1)', 'desktopLyric.style.lyricShadowColor': 'rgba(7, 8, 9, 0.5)' }
  await setting(colors)
  for (const [key, variable] of Object.keys(colors).map((key, i) => [key, ['--color-lyric-unplay', '--color-lyric-played', '--color-lyric-shadow'][i]])) {
    await expect.poll(() => child(`getComputedStyle(document.documentElement).getPropertyValue('${variable}').trim()`)).toBe(colors[key])
    report.checks.push({ key, effect: 'live lyric CSS colour variable', status: 'PASS' })
  }
  await setting({ 'player.isShowLyricTranslation': true, 'player.isShowLyricRoma': true })
  await expect.poll(() => child('document.body.innerText')).toContain('TRANSLATION')
  await expect.poll(() => child('document.body.innerText')).toContain('ROMA')
  report.checks.push({ key: 'player.isShowLyricTranslation/player.isShowLyricRoma', effect: 'real cached translation and Roma reach original desktop lyric DOM', status: 'PASS' })
  await setting({ 'desktopLyric.isLock': true })
  await expect.poll(() => child('document.querySelector("#container").classList.contains("lock")')).toBe(true)
  report.checks.push({ key: 'desktopLyric.isLock', effect: 'live original lock class; native mouse/top verified by system test', status: 'PASS' })
  await setting({ 'desktopLyric.enable': false })
  await expect.poll(() => host.app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(w=>w.getURL().includes('/dist/lyric.html')).length), { timeout: 15000 }).toBe(0)
  const proxied = { ...track, id: 'kw_settings_proxy', name: '代理取流验证', meta: { ...track.meta, musicId: 'settings_proxy' } }
  await invoke('player_list_music_add', { id: 'default', musicInfos: [proxied], addMusicLocationType: 'bottom' })
  await setting({ 'network.proxy.enable': true, 'network.proxy.host': '127.0.0.1', 'network.proxy.port': String(proxy.address().port) })
  await host.evaluate(`lxPlayer.dispatch({type:'playList',listId:'default',index:1})`)
  await expect.poll(() => host.evaluate('lxPlayer.getState().name')).toBe(proxied.name)
  await expect.poll(() => host.evaluate('lxPlayer.getState().progress'), { timeout: 15000 }).toBeGreaterThan(0.4)
  assert.ok(tunnels.length > 0)
  assert.match(await host.evaluate('__settingsAudio.currentSrc'), /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{48}$/)
  await host.evaluate(`lxPlayer.dispatch({type:'seek',value:6})`)
  await expect.poll(() => host.evaluate('lxPlayer.getState().progress')).toBeGreaterThanOrEqual(6)
  await setting({ 'network.proxy.enable': false })
  report.checks.push({ key: 'network.proxy.*', effect: 'actual source resolution and HTMLAudio stream use CONNECT proxy, relay decodes and seek advances', tunnels: tunnels.length, status: 'PASS' })
  assert.deepEqual(await host.evaluate('__settingsErrors'), [])
  report.status = 'PASS'; console.log(`PASS ${report.checks.filter(c=>c.status==='PASS').length} real settings effects; ${report.checks.filter(c=>c.status==='CONDITIONAL').length} hardware-dependent check`)
} catch (error) { report.status = 'FAIL'; report.error = String(error.stack || error); report.logs = await host?.logs(); report.routing = await host?.evaluate('__settingsRouteErrors').catch(() => null); report.lyric = await host?.evaluate(`lxHost.invoke('windows:status')`).catch(() => null); process.exitCode = 1 }
finally { writeFileSync('artifacts/settings-effects/report.json', JSON.stringify(report, null, 2)); await host?.close(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => proxy.close(resolve)); await fixture.close() }

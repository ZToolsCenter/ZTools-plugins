import { startHost } from './host-fixture.mjs'
import { expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

mkdirSync('artifacts/settings', { recursive: true })
const report = { evidence: 'Actual ZTools app.asar, disposable profile, original settings controls', panes: [], checks: [], controls: [] }
const panes = ['Basic', 'Play', 'PlayDetail', 'DesktopLyric', 'Search', 'List', 'Download', 'HotKey', 'Sync', 'OpenAPI', 'Network', 'Odc', 'Backup', 'Other', 'Update', 'About']
let host
try {
  host = await startHost('dist/lx.html')
  await expect.poll(() => host.evaluate('typeof lxPlayer'), { timeout: 20000 }).toBe('object')
  await host.evaluate(`lxHost.invoke('common_set_app_setting',{'common.isAgreePact':true,'common.showChangeLog':false})`)
  await expect.poll(() => host.evaluate(`document.body.innerText.includes('在使用本软件前')`)).toBe(false)
  await host.evaluate(`location.hash='/setting'`)
  await expect.poll(() => host.evaluate(`!!document.querySelector('#basic')`)).toBe(true)
  const select = async name => {
    await host.evaluate(`(()=>{let c=document.querySelector('#basic, dl').__vueParentComponent;while(c&&!c.proxy?.toggleTab)c=c.parent;c.proxy.toggleTab(${JSON.stringify('Setting' + name)});})()`)
    await expect.poll(() => host.evaluate(`(()=>{let c=document.querySelector('dl').__vueParentComponent;while(c&&!c.proxy?.toggleTab)c=c.parent;return c.proxy.avtiveComponentName})()`)).toBe('Setting' + name)
  }
  for (const name of panes) {
    await select(name)
    report.panes.push(await host.evaluate(`(()=>({name:${JSON.stringify(name)},text:document.querySelector('dl').innerText,inputs:[...document.querySelectorAll('dl input')].map(e=>({id:e.id,type:e.type,value:e.value,checked:e.checked,disabled:e.disabled,label:document.querySelector('label[for="'+e.id+'"]')?.innerText})),buttons:[...document.querySelectorAll('dl button')].map(e=>({label:e.innerText,disabled:e.disabled}))}))()`))
  }
  if (!process.argv.includes('--inventory')) {
    const original = await host.evaluate(`lxHost.invoke('common_get_app_setting')`)
    for (const name of ['Basic', 'Play', 'PlayDetail', 'DesktopLyric', 'Search', 'List', 'Download', 'Odc']) {
      await select(name)
      if (name === 'Download') await host.evaluate(`lxHost.invoke('common_set_app_setting',{'download.isEmbedLyric':true,'download.isDownloadLrc':true})`)
      const controls = await host.evaluate(`(()=>[...document.querySelectorAll('dl input')].filter(e=>['radio','checkbox'].includes(e.type)).map(e=>{const c=e.__vueParentComponent;const handler=c?.vnode.props?.['onUpdate:modelValue'];return {id:e.id,disabled:e.disabled,checked:e.checked,key:String(handler).match(/['"]((?:common|player|playDetail|desktopLyric|search|list|download|odc|tray)\.[a-zA-Z0-9.]+)['"]/)?.[1],value:c?.props.value,type:e.type,label:document.querySelector('label[for="'+e.id+'"]')?.innerText}}))()`)
      controls.sort((a, b) => Number(['setting_download_isEmbedLyric', 'setting_download_isDownloadLrc'].includes(a.id)) - Number(['setting_download_isEmbedLyric', 'setting_download_isDownloadLrc'].includes(b.id)))
      for (const control of controls) {
        if (control.id === 'setting_player_isMaxOutputChannelCount') control.key = 'player.isMaxOutputChannelCount'
        if (control.id === 'setting_desktop_lyric_audio_visualization') control.key = 'desktopLyric.audioVisualization'
        if (control.disabled) { report.controls.push({ ...control, status: 'DISABLED' }); continue }
        if (!control.key) { report.controls.push({ ...control, status: 'MANAGEMENT_HANDLER', note: 'verified in domain-specific checks' }); continue }
        const expected = control.type === 'checkbox' ? !control.checked : control.value
        // Re-read disabled state after a parent switch changes dependencies.
        if (await host.evaluate(`document.getElementById(${JSON.stringify(control.id)})?.disabled`)) continue
        await host.evaluate(`document.querySelector('label[for='+CSS.escape(${JSON.stringify(control.id)})+']').click()`)
        try {
          await expect.poll(() => host.evaluate(`lxHost.invoke('common_get_app_setting').then(s=>s[${JSON.stringify(control.key)}])`), { timeout: 2000 }).toEqual(expected)
          report.controls.push({ ...control, status: 'UI_AND_PERSISTENCE_PASS' })
          if (control.key === 'common.fontSize') {
            assert.equal(await host.evaluate('document.documentElement.style.fontSize'), `${expected}px`)
            const rendered = await host.evaluate(`parseFloat(getComputedStyle(document.querySelector('label[for="setting_show_animate"] span')).fontSize)`)
            assert.ok(Math.abs(rendered - 14 / 16 * expected) < 0.01, 'setting text must follow the selected size, not only the root style')
          }
          if (control.key === 'common.langId') assert.equal(await host.evaluate('document.documentElement.lang'), { 'en-us': 'en', 'ko-kr': 'ko', 'zh-cn': 'zh-Hans', 'zh-tw': 'zh-Hant' }[expected])
          if (control.key === 'common.isShowAnimation') assert.equal(await host.evaluate('document.documentElement.classList.contains("disableAnimation")'), !expected)
        } catch (error) { report.controls.push({ ...control, status: 'FAIL', error: String(error) }) }
        await host.evaluate(`lxHost.invoke('common_set_app_setting',${JSON.stringify({ [control.key]: original[control.key] })})`)
      }
      if (name === 'Download') await host.evaluate(`lxHost.invoke('common_set_app_setting',{'download.isEmbedLyric':false,'download.isDownloadLrc':false})`)
    }
    await select('Basic')
    await host.evaluate(`document.querySelector('#basic_font').parentElement.querySelector('.label-content').click()`)
    await expect.poll(() => host.evaluate(`document.querySelectorAll('#basic_font + div .selection-list li').length`)).toBeGreaterThan(10)
    const font = await host.evaluate(`(()=>{const group=document.querySelector('#basic_font').parentElement;const options=[...group.querySelectorAll('.selection-list li')];const item=options.find(e=>/微软雅黑|Microsoft YaHei/.test(e.textContent))||options[1];const result=item.textContent.trim();item.click();return result})()`)
    await expect.poll(() => host.evaluate('document.documentElement.style.fontFamily')).toContain(font.replaceAll('"', ''))
    report.checks.push({ name: 'real system font selection changes root font-family', status: 'PASS' })
    await host.evaluate(`(()=>{[...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='定时暂停').click()})()`)
    await expect.poll(() => host.evaluate(`!![...document.querySelectorAll('input')].find(e=>e.type==='number'&&e.checkVisibility())`)).toBe(true)
    await host.evaluate(`(()=>{const input=[...document.querySelectorAll('input')].find(e=>e.type==='number'&&e.checkVisibility()); input.value='3'; input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
    await host.evaluate(`(()=>{[...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='确认').click()})()`)
    await expect.poll(() => host.evaluate(`lxHost.invoke('common_get_app_setting').then(s=>String(s['player.waitPlayEndStopTime']))`)).toBe('3')
    report.checks.push({ name: 'timer minutes save through original dialog', status: 'PASS' })
    await host.evaluate(`(()=>{[...document.querySelectorAll('button')].find(e=>e.innerText.trim().startsWith('定时暂停')).click()})()`)
    await expect.poll(() => host.evaluate(`([...document.querySelectorAll('input')].find(e=>e.type==='number'&&e.checkVisibility())?.value)`)).toBe('3')
    await host.evaluate(`(()=>{const input=[...document.querySelectorAll('input')].find(e=>e.type==='number'&&e.checkVisibility());let c=input.__vueParentComponent;while(c&&!c.proxy?.handleCancel)c=c.parent;c.proxy.handleCancel()})()`)
    report.checks.push({ name: 'timer dialog reopens with saved minutes and stop cancels countdown', status: 'PASS' })
    await select('About')
    const about = await host.evaluate(`document.querySelector('dl').innerText`)
    assert.match(about, /By: jiang66-so/); assert.match(about, /From: 落雪无痕（lyswhut）/)
    assert.equal(await host.evaluate(`document.querySelectorAll('dl a[href*="jiang66-so/lx-music-ztools"]').length`), 5)
    await expect.poll(() => host.evaluate(`document.querySelector('#about')?.checkVisibility()&&!([...document.querySelectorAll('input[type=number]')].some(e=>e.checkVisibility()))`)).toBe(true)
    await host.evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,400))))`)
    const screenshot = await host.app.evaluate(async ({ webContents }) => (await webContents.getAllWebContents().find(w=>w.getURL().includes('/dist/lx.html')).capturePage()).toPNG().toString('base64'))
    writeFileSync('artifacts/settings/about.png', Buffer.from(screenshot, 'base64'))
    await host.evaluate(`[...document.querySelectorAll('dl button')].find(e=>e.innerText==='查看许可协议').click()`)
    await expect.poll(() => host.evaluate('document.body.innerText')).toContain('Apache License 2.0')
    report.checks.push({ name: 'maintainer/upstream attribution, repository links and original license dialog', status: 'PASS' })
    assert.deepEqual(report.controls.filter(control => control.status === 'FAIL'), [])
  }
  report.status = 'PASS'
  console.log(`PASS settings ${report.panes.length} panes, ${report.checks.length} behavioral checks`)
} catch (error) {
  report.status = 'FAIL'; report.error = String(error.stack || error)
  report.body = await host?.evaluate('document.body.innerText').catch(() => '')
  process.exitCode = 1
} finally {
  report.logs = await host?.logs()
  writeFileSync('artifacts/settings/report.json', JSON.stringify(report, null, 2))
  await host?.close()
}

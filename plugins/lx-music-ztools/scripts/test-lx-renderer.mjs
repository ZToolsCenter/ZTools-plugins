import { startHost } from './host-fixture.mjs'
import { expect } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
mkdirSync('artifacts/renderer', { recursive: true })
let host
try {
  host = await startHost('dist/lx.html')
  await expect.poll(() => host.evaluate('document.body.innerText'), { timeout: 20000 }).toMatch(/搜索/)
  // Test data only: close the original agreement modal to exercise the actual page.
  await host.evaluate(`lxHost.invoke('common_set_app_setting',{'common.isAgreePact':true,'common.showChangeLog':false})`)
  await expect.poll(() => host.evaluate(`document.body.innerText.includes('在使用本软件前')`)).toBe(false)
  await host.evaluate(`location.hash='/setting'`)
  let stable = 0
  await expect.poll(async () => {
    const visible = await host.evaluate(`location.hash==='#/setting' && !!document.querySelector('#basic')?.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})`)
    stable = visible ? stable + 1 : 0
    return stable
  }, { timeout: 15000, intervals: [200] }).toBeGreaterThanOrEqual(4)
  const layout = await host.evaluate(`(()=>{
    const bounds=document.querySelector('#container').getBoundingClientRect();
    const windowButtons=[...document.querySelectorAll('button')].filter(button=>[...button.querySelectorAll('use')].some(use=>/^#icon-window-(close|minimize)/.test(use.getAttribute('xlink:href')||use.getAttribute('href')||'')));
    return {x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height,viewport:{width:innerWidth,height:innerHeight},visibleWindowButtons:windowButtons.filter(button=>button.checkVisibility()).length,rootShadow:getComputedStyle(document.querySelector('#root')).boxShadow,rightRadius:getComputedStyle(document.querySelector('#right')).borderTopLeftRadius};
  })()`)
  assert.equal(layout.visibleWindowButtons, 0, 'LX window controls must be absent from the plugin UI')
  // Chromium can round zoomed CSS bounds to fractional pixels.
  assert.ok(Math.abs(layout.x) < 0.5); assert.ok(Math.abs(layout.y) < 0.5)
  assert.ok(Math.abs(layout.width - layout.viewport.width) < 0.5)
  assert.ok(Math.abs(layout.height - layout.viewport.height) < 0.5)
  assert.equal(layout.rootShadow, 'none'); assert.equal(layout.rightRadius, '0px')
  const themes = JSON.parse(readFileSync('vendor/lx/src/common/theme/index.json', 'utf8'))
  const colors = id => { const theme = themes.find(item => item.id === id); return { ...theme.config.themeColors, ...theme.config.extInfo } }
  const dark = colors('black'), light = colors('green')
  const property = Object.keys(dark).find(key => dark[key] !== light[key] && !key.includes('image'))
  assert.ok(property)
  const color = () => host.evaluate(`getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify(property)}).trim()`)
  await host.evaluate(`lxHost.invoke('common_set_app_setting',{'theme.id':'black'})`)
  await expect.poll(color).toBe(dark[property].trim())
  await host.evaluate(`lxHost.invoke('common_set_app_setting',{'theme.id':'auto','theme.lightId':'green','theme.darkId':'black'})`)
  const themeEvent = isDark => host.app.evaluate(({ webContents }, isDark) => webContents.getAllWebContents().find(wc => wc.getURL().includes('/dist/lx.html')).send('update-theme-info', { isDark, primaryColor: 'green', windowMaterial: 'acrylic' }), isDark)
  await themeEvent(true); await expect.poll(color).toBe(dark[property].trim())
  await themeEvent(false); await expect.poll(color).toBe(light[property].trim())
  assert.equal(await host.evaluate('window.dom_style.isConnected'), true)
  const screenshot = await host.app.evaluate(async ({ webContents }) => {
    const wc = webContents.getAllWebContents().find(x => x.getURL().includes('/dist/lx.html'))
    return (await wc.capturePage()).toPNG().toString('base64')
  })
  writeFileSync('artifacts/renderer/settings.png', Buffer.from(screenshot, 'base64'))
  writeFileSync('artifacts/renderer/report.json', JSON.stringify({ status: 'PASS', data: host.data, layout, theme: 'Manual dark and auto light/dark via public host theme event, opaque styles connected', text: await host.evaluate('document.body.innerText'), logs: await host.logs() }, null, 2))
  console.log('PASS original LX renderer navigation and source settings')
} catch (error) { writeFileSync('artifacts/renderer/report.json', JSON.stringify({ status: 'FAIL', error: String(error.stack || error), theme: await host?.evaluate(`({setting:window.lxData?.appSetting?.['theme.id'],style:window.dom_style?.innerText,connected:window.dom_style?.isConnected,rootStyle:document.documentElement.getAttribute('style'),styles:[...document.querySelectorAll('style')].map(style=>style.textContent.slice(0,180))})`).catch(() => null), logs: await host?.logs() }, null, 2)); throw error }
finally { await host?.close() }

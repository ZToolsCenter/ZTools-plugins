import { startHost } from './host-fixture.mjs'
import { expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('artifacts/font-size', { recursive: true })
const report = { evidence: 'Actual ZTools app.asar, original font-size radio controls, computed text and layout measurements', sizes: [] }
let host
try {
  host = await startHost('dist/lx.html')
  await expect.poll(() => host.evaluate('typeof lxPlayer'), { timeout: 20000 }).toBe('object')
  await host.evaluate(`lxHost.invoke('common_set_app_setting',{'common.isAgreePact':true,'common.showChangeLog':false})`)
  await host.evaluate(`location.hash='/setting'`)
  await expect.poll(() => host.evaluate(`!!document.querySelector('#basic_font_size')`)).toBe(true)
  const selectors = { setting: 'label[for="setting_show_animate"] span', navigation: '[role="tab"][aria-label="基本设置"]', option: 'label[for="setting_basic_font_size_16"] span', search: '#toolbar input' }
  for (const size of [14, 15, 16, 17, 18, 19]) {
    await host.evaluate(`document.querySelector('label[for="setting_basic_font_size_${size}"]').click()`)
    await expect.poll(() => host.evaluate(`lxHost.invoke('common_get_app_setting').then(s=>s['common.fontSize'])`)).toBe(size)
    const metrics = await host.evaluate(`(()=>{
      const texts=Object.fromEntries(Object.entries(${JSON.stringify(selectors)}).map(([key,selector])=>{
        const element=document.querySelector(selector);if(!element)throw Error('Missing measured text: '+selector);
        const range=document.createRange();range.selectNodeContents(element);
        return [key,{fontSize:parseFloat(getComputedStyle(element).fontSize),height:element.getBoundingClientRect().height,textWidth:range.getBoundingClientRect().width}];
      }));
      const rect=document.querySelector('#container').getBoundingClientRect();
      return {root:parseFloat(getComputedStyle(document.documentElement).fontSize),texts,layout:{x:rect.x,y:rect.y,width:rect.width,height:rect.height,viewportWidth:innerWidth,viewportHeight:innerHeight}};
    })()`)
    report.sizes.push({ size, ...metrics })
    assert.equal(metrics.root, size)
  }
  const baseline = report.sizes[0]
  for (const result of report.sizes.slice(1)) {
    for (const key of Object.keys(selectors)) {
      const ratio = result.texts[key].fontSize / baseline.texts[key].fontSize
      assert.ok(Math.abs(ratio - result.size / baseline.size) < 0.002, `${key} text must actually scale at ${result.size}px (got ${result.texts[key].fontSize}px)`)
    }
    assert.ok(Math.abs(result.layout.width - result.layout.viewportWidth) < 0.5)
    assert.ok(Math.abs(result.layout.height - result.layout.viewportHeight) < 0.5)
  }
  assert.ok(report.sizes.at(-1).texts.option.textWidth > baseline.texts.option.textWidth * 1.2, 'visible glyph width must grow, not only root style')
  // Check navigation away and re-entry, then a public plugin kill/reopen against persisted data.
  await host.evaluate(`location.hash='/search'`)
  await expect.poll(() => host.evaluate(`location.hash`)).toMatch(/^#\/search(?:\?|$)/)
  await host.evaluate(`location.hash='/setting'`)
  await expect.poll(() => host.evaluate(`!!document.querySelector('#basic_font_size')`)).toBe(true)
  await host.evaluate('ztools.outPlugin(true)')
  await expect.poll(() => host.app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(w=>w.getURL().includes('/dist/lx.html')).length)).toBe(0)
  await host.page.locator('.search-input').fill('lxmusic')
  await host.page.locator('.app-item').filter({ hasText: /lxmusic|洛雪音乐|LX Music/i }).first().click()
  await expect.poll(() => host.evaluate(`typeof lxPlayer`).catch(() => ''), { timeout: 20000 }).toBe('object')
  await host.evaluate(`location.hash='/setting'`)
  await expect.poll(() => host.evaluate(`document.querySelector('#setting_basic_font_size_19')?.checked`), { timeout: 15000 }).toBe(true)
  const persisted = await host.evaluate(`parseFloat(getComputedStyle(document.querySelector('label[for="setting_show_animate"] span')).fontSize)`)
  assert.equal(persisted, report.sizes.at(-1).texts.setting.fontSize)
  report.persistedFontSize = persisted
  for (const size of [14, 19]) {
    await host.evaluate(`document.querySelector('label[for="setting_basic_font_size_${size}"]').click()`)
    await host.evaluate(`document.querySelector('#basic_font_size').scrollIntoView({block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,250))))`)
    const png = await host.app.evaluate(async ({ webContents }) => (await webContents.getAllWebContents().find(w=>w.getURL().includes('/dist/lx.html')).capturePage()).toPNG().toString('base64'))
    writeFileSync(`artifacts/font-size/size-${size}.png`, Buffer.from(png, 'base64'))
  }
  report.status = 'PASS'
  console.log('PASS six font sizes change actual text and layout, survive navigation and public plugin kill/reopen')
} catch (error) { report.status = 'FAIL'; report.error = String(error.stack || error); process.exitCode = 1 }
finally { report.logs = await host?.logs(); writeFileSync('artifacts/font-size/report.json', JSON.stringify(report, null, 2)); await host?.close() }

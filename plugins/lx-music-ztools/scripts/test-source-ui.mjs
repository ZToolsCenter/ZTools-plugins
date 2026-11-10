import { startHost } from './host-fixture.mjs'
import { expect } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import audioFixture from '../tests/ztools/fixtures/audio-server.cjs'
mkdirSync('artifacts/source-ui', { recursive: true })
const template = readFileSync('tests/ztools/fixtures/source-api-v2.js', 'utf8')
const fixture = await audioFixture.startAudioServer(template + '\n// online source variant')
let host
const report = { evidence: 'Original LX controls in isolated ZTools. Native file picker alone returns a controlled fixture path.' }
try {
  host = await startHost('dist/lx.html')
  await expect.poll(() => host.evaluate('typeof window.lxPlayer')).toBe('object')
  await host.evaluate(`window.__testSourceErrors=[];window.addEventListener('unhandledrejection',event=>window.__testSourceErrors.push(String(event.reason?.stack||event.reason)))`)
  await host.evaluate(`lxHost.invoke('common_set_app_setting',{'common.isAgreePact':true,'common.showChangeLog':false})`)
  const scriptPath = join(host.data, '音源测试.js')
  writeFileSync(scriptPath, template.replaceAll('__BASE_URL__', fixture.base))
  await host.app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialogSync = () => [file]
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, scriptPath)
  await host.evaluate(`location.hash='/setting'`)
  await expect.poll(() => host.evaluate(`!!document.querySelector('#basic')?.checkVisibility()`)).toBe(true)
  const click = text => host.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)} && x.checkVisibility());if(!button)throw new Error('Button missing: '+${JSON.stringify(text)});button.scrollIntoView({block:'center'});button.click()})()`)
  await click('自定义源管理')
  await expect.poll(() => host.evaluate(`document.body.innerText.includes('本地导入')`)).toBe(true)
  await click('本地导入')
  await expect.poll(() => host.evaluate(`lxHost.invoke('winMain_get_user_api_list').then(x=>x.length)`), { timeout: 10000 }).toBe(1)
  await click('在线导入')
  await expect.poll(() => host.evaluate(`!!document.querySelector('input[type=url]')?.checkVisibility()`)).toBe(true)
  await host.evaluate(`(()=>{const input=document.querySelector('input[type=url]');input.value=${JSON.stringify(fixture.base + '/source.js')};input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await click('导入')
  await expect.poll(() => host.evaluate(`lxHost.invoke('winMain_get_user_api_list').then(x=>x.length)`), { timeout: 10000 }).toBe(2)
  report.status = 'PASS'; report.sources = await host.evaluate(`lxHost.invoke('winMain_get_user_api_list')`)
  const png = await host.app.evaluate(async ({ webContents }) => {
    const wc = webContents.getAllWebContents().find(x => x.getURL().includes('/dist/lx.html'))
    return (await wc.capturePage()).toPNG().toString('base64')
  })
  writeFileSync('artifacts/source-ui/import.png', Buffer.from(png, 'base64'))
  console.log('PASS original LX local file and URL source import controls')
} catch (error) { report.status = 'FAIL'; report.error = String(error.stack || error); report.logs = await host?.logs(); report.rejections = await host?.evaluate('window.__testSourceErrors'); process.exitCode = 1 }
finally { writeFileSync('artifacts/source-ui/report.json', JSON.stringify(report, null, 2)); await host?.close(); await fixture.close() }

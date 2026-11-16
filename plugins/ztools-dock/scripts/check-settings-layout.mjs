import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
export async function checkSettingsLayout({app,evaluate,screenshot,check}) {
 const original=(await evaluate('window.dock.call("snapshot")')).config;
 const bounds=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=settings')).getBounds());
 const page=app.windows().find(p=>p.url().includes('surface=settings'));
 try{
  await evaluate('document.querySelectorAll(".settings-tabs button")[1].click()');
  for(const [title,id] of [['停靠位置','position'],['边缘触发区','trigger'],['菜单导航','navigation'],['卡片弹窗','cards'],['材质与颜色','material'],['展开与收起','behavior']]){
   await page.getByRole('navigation',{name:'外观设置分组'}).getByRole('button',{name:title,exact:true}).click();
   await expect.poll(()=>evaluate(`(()=>{const r=document.querySelector('#heading-${id}').getBoundingClientRect(),n=document.querySelector('.preference-jumps').getBoundingClientRect();return r.top>=n.bottom-1&&r.bottom<innerHeight})()`)).toBe(true);
  }
  await page.getByRole('button',{name:'导航条宽度恢复自动',exact:true}).click();
  await expect.poll(()=>evaluate('window.dock.call("snapshot").then(s=>s.config.settings.dockWidth)')).toBe(0);
  const input=page.getByRole('spinbutton',{name:'导航条宽度',exact:true});
  await input.fill('380');await input.press('Tab');
  await expect.poll(()=>evaluate('window.dock.call("snapshot").then(s=>s.config.settings.dockWidth)')).toBe(380);
  await input.fill('9999');await input.press('Tab');
  await expect(input).toHaveValue('380');assert.equal((await evaluate('window.dock.call("snapshot")')).config.settings.dockWidth,380);
  await page.getByRole('button',{name:'导航条宽度恢复自动',exact:true}).click();
  await expect.poll(()=>evaluate('window.dock.call("snapshot").then(s=>s.config.settings.dockWidth)')).toBe(0);
  check('six section links reveal unobscured headings; dimension field saves manual size, rejects invalid input and restores auto via its button');
  await expect(page.locator('.toast')).toHaveCount(0,{timeout:9000});
  for(const theme of ['light','dark']){
   await evaluate(`(async()=>{const s=await window.dock.call('snapshot');s.config.settings.theme='${theme}';await window.dock.call('save',s.config)})()`);
   await expect.poll(()=>evaluate('document.documentElement.dataset.theme')).toBe(theme);
   await evaluate('document.querySelector(".preferences").scrollTop=0');await screenshot(`settings-${theme}.png`);
  }
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=settings')).setSize(620,720));
  await expect.poll(()=>evaluate('innerWidth')).toBeLessThan(625);
  await evaluate('document.querySelector(".preferences").scrollTop=0');
  assert.equal(await evaluate('document.querySelector(".preferences").scrollWidth<=document.querySelector(".preferences").clientWidth'),true);
  await screenshot('settings-narrow.png');
  await app.evaluate(({BrowserWindow},b)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=settings')).setBounds(b),bounds);
  await evaluate(`(async()=>{const s=await window.dock.call('snapshot');s.config.settings.theme='light';await window.dock.call('save',s.config)})()`);
  await evaluate('document.querySelector(".preferences").scrollTop=0');await screenshot('settings-overview.png');
  await page.getByRole('navigation',{name:'外观设置分组'}).getByRole('button',{name:'菜单导航',exact:true}).click();await screenshot('settings-card-controls.png');
  await evaluate('document.querySelectorAll(".settings-tabs button")[0].click()');await screenshot('settings-entries.png');
  await evaluate('document.querySelectorAll(".settings-tabs button")[2].click()');await screenshot('settings-backup.png');
  check('grouped settings render in light/dark and 620-DIP narrow window; entry and backup pages captured from production ZIP');
 }finally{
  await app.evaluate(({BrowserWindow},b)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=settings')).setBounds(b),bounds);
  await evaluate(`window.dock.call('save',${JSON.stringify(original)})`);
  await evaluate('document.querySelectorAll(".settings-tabs button")[0].click()');
 }
}

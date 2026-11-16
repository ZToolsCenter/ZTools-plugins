import {expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
export async function checkBackgroundImage({app,evaluate,screenshot,temp,check}) {
 const before=await evaluate('window.dock.call("snapshot")');
 const page=app.windows().find(w=>w.url().includes('surface=settings'));
 const setDialog=file=>app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:!file,filePaths:file?[file]:[]})},file);
 const appearance=()=>evaluate('document.querySelectorAll(".settings-tabs button")[1].click()');
 try {
  await appearance();
  assert.equal(await page.locator('[data-material]').count(),0);
  await setDialog(null);await page.getByLabel('上传背景图片',{exact:true}).click();
  await expect(page.getByLabel('上传背景图片',{exact:true})).toBeEnabled();
  assert.equal((await evaluate('window.dock.call("snapshot")')).config.settings.backgroundImage,'');
  await assert.rejects(evaluate('window.dock.call("background-image")','panel'),/此窗口不支持/);
  const invalid=join(temp,'bad-background.png');writeFileSync(invalid,'invalid');await setDialog(invalid);
  await assert.rejects(evaluate('window.dock.call("background-image")'),/解码/);
  const transparent=join(temp,'transparent-background.png');
  const blank=await evaluate('(()=>{const c=document.createElement("canvas");c.width=8;c.height=8;return c.toDataURL()})()');
  writeFileSync(transparent,Buffer.from(blank.split(',')[1],'base64'));await setDialog(transparent);
  await assert.rejects(evaluate('window.dock.call("background-image")'),/透明/);
  for(const ext of ['png','jpeg','webp']){
   const data=await evaluate(`(()=>{const c=document.createElement('canvas');c.width=2000;c.height=800;const x=c.getContext('2d');const g=x.createLinearGradient(0,0,2000,800);g.addColorStop(0,'#4c8d92');g.addColorStop(.5,'#a7cbd9');g.addColorStop(1,'#d59f80');x.fillStyle=g;x.fillRect(0,0,2000,800);x.fillStyle='#fff4';for(let i=0;i<10;i++)x.fillRect(i*220,0,6,800);return c.toDataURL('image/${ext}')})()`);
   const file=join(temp,`background.${ext}`);writeFileSync(file,Buffer.from(data.split(',')[1],'base64'));await setDialog(file);
   await page.getByLabel('上传背景图片',{exact:true}).click();
   await expect(page.locator('.background-image-preview')).toBeVisible();
   await expect(page.getByLabel('上传背景图片',{exact:true})).toBeEnabled();
   const stored=(await evaluate('window.dock.call("snapshot")')).config.settings.backgroundImage;
   assert.match(stored,/^data:image\/png;base64,/);const bytes=Buffer.from(stored.split(',')[1],'base64');assert.equal(bytes.readUInt32BE(16),1600);assert.ok(bytes.length<=1024*1024);
   await evaluate('window.dock.call("expand")');
   await expect.poll(()=>evaluate('getComputedStyle(document.querySelector(".dock-bar"),"::before").backgroundImage','panel')).toContain(stored);
   assert.equal(await evaluate('getComputedStyle(document.querySelector(".dock-tray"),"::before").backgroundSize','panel'),'cover');
   assert.equal(await evaluate('getComputedStyle(document.querySelector(".launch-name")).opacity','panel'),'1');
   assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes('material.html')).length),0);
  }
  await evaluate(`(async()=>{const s=await window.dock.call('snapshot');Object.assign(s.config.settings,{tileMaterial:'clear',theme:'light'});await window.dock.call('save',s.config)})()`);
  await screenshot('dock-background-image.png','panel',true);
  await expect(page.locator('.toast')).toHaveCount(0,{timeout:9000});
  await page.getByLabel('上传背景图片',{exact:true}).scrollIntoViewIfNeeded();await screenshot('background-image-settings.png');
  const withImage=(await evaluate('window.dock.call("snapshot")')).config;
  const exported=join(temp,'background-backup.json');
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file})},exported);
  await evaluate('window.dock.call("export")');await setDialog(exported);const imported=await evaluate('window.dock.call("import")');assert.equal(imported.settings.backgroundImage,withImage.settings.backgroundImage);
  await appearance();await page.getByRole('button',{name:'移除背景',exact:true}).click();
  await expect(page.locator('.background-image-preview')).toHaveCount(0);
  await expect.poll(()=>evaluate('getComputedStyle(document.querySelector(".dock-bar"),"::before").backgroundImage','panel')).toBe('none');
  check('background upload UI replaces native materials; PNG/JPEG/WebP normalize to bounded PNG, cancel/invalid preserve config, bar/tray show cover image, removal clears both; backup includes image and no native backdrop windows remain');
 } finally {await setDialog(null);await evaluate(`window.dock.call('save',${JSON.stringify(before.config)})`);await evaluate(`(async()=>{if((await window.dock.call('snapshot')).pinned!==${before.pinned})await window.dock.call('pin');await window.dock.call('${before.expanded?'expand':'collapse'}')})()`);await evaluate('document.querySelectorAll(".settings-tabs button")[0].click()');}
}

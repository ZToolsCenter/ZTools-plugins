import {createServer} from 'node:http';
import {writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {expect} from '@playwright/test';
import assert from 'node:assert/strict';

export async function checkAddition({app,main,evaluate,screenshot,native,temp,check}) {
 const before=(await evaluate('window.dock.call("snapshot")')).config;
 const server=createServer((req,res)=>{
  if(req.url==='/page'){res.setHeader('content-type','text/html');res.end('<link rel="icon" href="/icon.svg">');}
  else if(req.url==='/icon.svg'){res.setHeader('content-type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="12" fill="#087fe7"/><path d="M16 32h32M32 16v32" stroke="white" stroke-width="6"/></svg>');}
  else {res.writeHead(404);res.end();}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 async function launch(value, files, batch=false) {
  await app.evaluate(({webContents})=>{const wc=webContents.getAllWebContents().find(w=>w.getURL().includes('/plugins/ztools-dock/')&&!w.getURL().includes('surface='));if(!wc.addTraceAttached){wc.addTraceAttached=true;const send=wc.send.bind(wc);wc.send=(channel,...args)=>{if(channel==='on-plugin-enter')globalThis.addTrace=args;return send(channel,...args)}}});
  await evaluate('window.ztools.outPlugin(false)','host');
  await evaluate('window.ztools.showMainWindow()','host');
  await main.locator('.search-input').fill('');await main.locator('.search-input').press('Backspace');
  if(files) {
   await app.evaluate(({ipcMain},files)=>{globalThis.dockCopiedOriginal=ipcMain._invokeHandlers.get('get-last-copied-content');ipcMain._invokeHandlers.set('get-last-copied-content',async()=>({type:'file',data:files}))},files);
   await main.evaluate(()=>document.querySelector('.search-input').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true})));
  } else await main.locator('.search-input').fill(value);
  const item=main.locator('.app-item').filter({hasText:'添加到程序坞'});
  await item.first().waitFor({timeout:12000});await item.first().click();
  if(files)await app.evaluate(({ipcMain})=>{ipcMain._invokeHandlers.set('get-last-copied-content',globalThis.dockCopiedOriginal);delete globalThis.dockCopiedOriginal});
  try { await expect.poll(()=>evaluate(`Boolean(document.querySelector('${batch?'.confirm-modal':'.editor-modal'}'))`)).toBe(true); }
  catch(e) { console.log('add trace',await app.evaluate(()=>globalThis.addTrace),await evaluate('window.dock.call("snapshot").then(s=>({error:s.error,additionId:s.additionId}))','host')); throw e; }
 }
 const values=()=>evaluate(`(()=>{const e=document.querySelector('.editor-modal');return {name:e.querySelector('input').value,type:e.querySelector('.field-pair select').value,category:e.querySelectorAll('.field-pair select')[1].selectedOptions[0].textContent,target:e.querySelector('.input-with-button input').value}})()`);
 const cancel=()=>evaluate('document.querySelector("button[title=关闭编辑]")?.click()');
 try {
  await launch(base+'/page');
  assert.equal((await values()).category,'网址');assert.equal((await values()).type,'url');
  assert.deepEqual((await evaluate('window.dock.call("snapshot")')).config,before);
  await evaluate('[...document.querySelectorAll(".editor-modal button")].find(b=>b.textContent==="获取图标").click()');
  await expect.poll(()=>evaluate('document.querySelector(".custom-icon-preview img")?.getAttribute("src")||""'),{timeout:12000}).toMatch(/^data:image\/png;base64,/);
  await screenshot('website-icon-editor.png');
  const priorIcon=await evaluate('document.querySelector(".custom-icon-preview img").src');
  await evaluate(`(()=>{const input=document.querySelector('.input-with-button input');input.value=${JSON.stringify(base+'/missing')};input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await evaluate('[...document.querySelectorAll(".editor-modal button")].find(b=>b.textContent==="获取图标").click()');
  await expect.poll(()=>evaluate('document.querySelector(".toast")?.textContent||""'),{timeout:12000}).toContain('未获取');
  assert.equal(await evaluate('document.querySelector(".custom-icon-preview img").src'),priorIcon);
  await evaluate(`(()=>{const input=document.querySelector('.input-with-button input');input.value=${JSON.stringify(base+'/page')};input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await evaluate('document.querySelector(".editor-modal").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))');
  await expect.poll(()=>evaluate('window.dock.call("snapshot").then(s=>s.config.entries.length)')).toBe(before.entries.length+1);
  const saved=(await evaluate('window.dock.call("snapshot")')).config.entries.at(-1);
  assert.ok(saved.image.startsWith('data:image/png'));assert.equal(saved.categoryId,'web');
  check('URL search matches Add to Dock; missing website category created only on save; website SVG icon fetched and stored as PNG');
  await evaluate(`window.dock.call('save',${JSON.stringify(before)})`);
  const text=join(temp,'测试 文件.txt'),folder=join(temp,'测试文件夹');writeFileSync(text,'fixture');mkdirSync(folder);
  for(const [target,type,category] of [[native.exe,'app','常用工具'],[text,'file','文件处理'],[folder,'folder','文件夹']]) {
   await launch(target);const draft=await values();assert.equal(draft.type,type);assert.equal(draft.category,category);
   if(type==='app')assert.ok(!/\.exe$/i.test(draft.name));
   await cancel();assert.deepEqual((await evaluate('window.dock.call("snapshot")')).config,before);
  }
  check('application/file/folder path matching opens prefilled drafts with correct categories; application suffix stripped; cancel preserves data');
  for(const [target,type,category] of [[native.exe,'app','常用工具'],[text,'file','文件处理'],[folder,'folder','文件夹']]) {
   await launch('',[{path:target,name:target.split(/[\\/]/).at(-1),isDirectory:type==='folder',isFile:type!=='folder'}]);
   assert.equal((await values()).category,category);assert.equal((await values()).type,type);await cancel();
  }
  await launch('',[{path:native.exe,name:'程序.exe',isFile:true,isDirectory:false},{path:folder,name:'文件夹',isFile:false,isDirectory:true}],true);
  assert.ok(await evaluate('document.querySelector(".confirm-modal").textContent.includes("常用工具")'));
  await evaluate('document.querySelector(".confirm-modal .button:not(.primary)").click()');
  assert.deepEqual((await evaluate('window.dock.call("snapshot")')).config,before);
  await launch('',[{path:native.exe,name:'程序.exe',isFile:true,isDirectory:false},{path:folder,name:'文件夹',isFile:false,isDirectory:true}],true);
  await evaluate('document.querySelector(".confirm-modal .primary").click()');
  await expect.poll(()=>evaluate('window.dock.call("snapshot").then(s=>s.config.entries.length)')).toBe(before.entries.length+2);
  assert.deepEqual((await evaluate('window.dock.call("snapshot")')).config.entries.slice(-2).map(e=>e.categoryId),['tools','folders']);
  check('host file-paste matching handles applications, files, folders and mixed batch confirmation using a controlled clipboard-read adapter');
 }finally {
  await app.evaluate(({ipcMain})=>{if(globalThis.dockCopiedOriginal){ipcMain._invokeHandlers.set('get-last-copied-content',globalThis.dockCopiedOriginal);delete globalThis.dockCopiedOriginal}});
  await cancel().catch(()=>{});await evaluate(`window.dock.call('save',${JSON.stringify(before)})`);
  await new Promise(r=>server.close(r));
 }
}

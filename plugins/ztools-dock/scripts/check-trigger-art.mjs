import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';

export async function checkTriggerArt({app,evaluate,screenshot,native,temp,check}){
 const original=await evaluate('window.dock.call("snapshot")');
 try{
  await evaluate('document.querySelectorAll(".settings-tabs button")[1].click()');
  for(const [edge,nx,ny] of [['top',0,-1],['bottom',0,1],['left',-1,0],['right',1,0]]){
   await evaluate(`(async()=>{const s=await window.dock.call('snapshot');Object.assign(s.config.settings,{triggerTheme:'snail',dockEdge:'${edge}',triggerEdgeDistance:0});await window.dock.call('save',s.config)})()`);
   await expect.poll(()=>evaluate('document.body.dataset.edge','trigger')).toBe(edge);
   for(const distance of [0,12,-8]){
    await evaluate(`(()=>{const input=document.querySelector('[aria-label="底部距屏幕边缘"]');input.value='${distance}';input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await expect.poll(()=>evaluate('window.dock.call("snapshot").then(s=>s.config.settings.triggerEdgeDistance)')).toBe(distance);
    const visual=await evaluate('(()=>{const t=getComputedStyle(document.querySelector(".trigger-visual")).transform;return t.slice(7,-1).split(",").map(Number)})()','trigger');
    assert.ok(Math.abs(visual[2]-nx)<0.001&&Math.abs(visual[3]-ny)<0.001,`bottom normal points toward ${edge}`);
    const state=await evaluate('window.dock.call("snapshot")');
    const info=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=trigger'));return {bounds:w.getBounds(),handle:w.getNativeWindowHandle().readBigUInt64LE().toString()};});
    const scale=native.probe(info.handle).dpi/96;
    const point={x:Math.round((state.bounds.trigger.x-info.bounds.x+state.bounds.trigger.width/2)*scale),y:Math.round((state.bounds.trigger.y-info.bounds.y+state.bounds.trigger.height/2)*scale)};
    assert.equal(native.probe(info.handle,'0',point).contains,true);
    assert.equal(edge==='top'||edge==='bottom'?state.bounds.trigger.height:state.bounds.trigger.width,distance<0?24:32);
   }
  }
  check('trigger art bottom points toward all four edges; real distance input accepts 0/12/-8 DIP and clipped native region remains reachable');
  const bytes=await app.evaluate(({nativeImage})=>{const bitmap=Buffer.alloc(8*6*4);for(let y=2;y<4;y++)for(let x=2;x<6;x++){const i=(y*8+x)*4;bitmap[i]=220;bitmap[i+1]=90;bitmap[i+2]=35;bitmap[i+3]=255;}return [...nativeImage.createFromBitmap(bitmap,{width:8,height:6}).toPNG()];});
  const png=join(temp,'trigger-upload.png'),invalid=join(temp,'invalid-trigger.png');writeFileSync(png,Buffer.from(bytes));writeFileSync(invalid,'not a PNG');
  await app.evaluate(({dialog})=>{globalThis.triggerOriginalDialog=dialog.showOpenDialog;dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});
  const before=(await evaluate('window.dock.call("snapshot")')).config;
  const click='document.querySelector("[aria-label=上传PNG触发图案]").click()';
  await evaluate(click);await expect.poll(()=>evaluate('!document.querySelector("[aria-label=上传PNG触发图案]").disabled')).toBe(true);
  assert.deepEqual((await evaluate('window.dock.call("snapshot")')).config,before);
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},invalid);
  await evaluate(click);await expect.poll(()=>evaluate('document.querySelector(".toast")?.textContent||""')).toContain('PNG');
  assert.deepEqual((await evaluate('window.dock.call("snapshot")')).config,before);
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},png);
  await expect.poll(()=>evaluate('!document.querySelector("[aria-label=上传PNG触发图案]").disabled')).toBe(true);await evaluate(click);
  await expect.poll(()=>evaluate('window.dock.call("snapshot").then(s=>s.config.settings.triggerTheme)')).toBe('custom');
  const state=await evaluate('window.dock.call("snapshot")');
  const broken={...state.config,settings:{...state.config.settings,triggerImage:`data:image/png;base64,${Buffer.from(bytes.slice(0,33)).toString('base64')}`}};
  await assert.rejects(evaluate(`window.dock.call('save',${JSON.stringify(broken)})`),/PNG/);
  const brokenFile=join(temp,'broken-trigger.json');writeFileSync(brokenFile,JSON.stringify(broken));
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},brokenFile);
  await assert.rejects(evaluate('window.dock.call("import")'),/PNG/);
  assert.deepEqual((await evaluate('window.dock.call("snapshot")')).config,state.config);
  const normalized=Buffer.from(state.config.settings.triggerImage.slice(22),'base64');assert.equal(normalized.readUInt32BE(16),4);assert.equal(normalized.readUInt32BE(20),2);
  await expect.poll(()=>evaluate('document.querySelector(".trigger img")?.complete','trigger')).toBe(true);
  assert.equal(state.bounds.triggerArt.width,40);assert.equal(state.bounds.triggerArt.height,80);
  await assert.rejects(evaluate('window.dock.call("trigger-image")','panel'),/此窗口不支持/);
  await evaluate('document.querySelector("[aria-label=底部距屏幕边缘]").scrollIntoView({block:"center"})');await expect.poll(()=>evaluate('Boolean(document.querySelector(".toast"))'),{timeout:8000}).toBe(false);await screenshot('trigger-art-settings.png');
  check('PNG picker cancel/invalid preserves config; real PNG decoder trims alpha padding, preserves aspect and renders custom image; panel cannot invoke picker');
 }finally{
  await app.evaluate(({dialog})=>{if(globalThis.triggerOriginalDialog)dialog.showOpenDialog=globalThis.triggerOriginalDialog});
  await evaluate(`window.dock.call('save',${JSON.stringify(original.config)})`);
  await evaluate(`(async()=>{if((await window.dock.call('snapshot')).pinned!==${original.pinned})await window.dock.call('pin');await window.dock.call('${original.expanded?'expand':'collapse'}')})()`);
  await expect.poll(()=>evaluate('document.body.dataset.edge','trigger')).toBe(original.config.settings.dockEdge);
  await evaluate('document.querySelectorAll(".settings-tabs button")[0].click()');
 }
}

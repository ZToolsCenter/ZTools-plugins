import assert from 'node:assert/strict';
import {expect} from '@playwright/test';

export async function checkPosition({app,evaluate,screenshot,native,check}) {
 const original=await evaluate('window.dock.call("snapshot")'),before=original.config;
 await app.evaluate(({screen,BrowserWindow})=>{globalThis.positionOriginalCursor=screen.getCursorScreenPoint;globalThis.positionEdge='top';screen.getCursorScreenPoint=()=>{const b=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=trigger')).getBounds();return globalThis.positionEdge==='right'?{x:b.x+b.width-1,y:b.y+b.height/2}:globalThis.positionEdge==='bottom'?{x:b.x+b.width/2,y:b.y+b.height-1}:globalThis.positionEdge==='left'?{x:b.x+1,y:b.y+b.height/2}:{x:b.x+b.width/2,y:b.y+1}};});
 const control=async(label,value)=>{
  const selector=`[aria-label="${label}"]`;
  await expect.poll(()=>evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)).toBe(true);
  await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});input.value='${value}';input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  if(label==='停靠方向')await app.evaluate((_,edge)=>{globalThis.positionEdge=edge},value);
  const key={'停靠方向':'dockEdge','位置方式':'positionMode','距离参考边':'positionAnchor','位置距离':'positionDistance','位置比例':'positionRatio'}[label];
  await expect.poll(()=>evaluate(`window.dock.call('snapshot').then(s=>s.config.settings.${key})`)).toBe(value);
 };
 const read=script=>evaluate(script,'panel');
 const layout=()=>read(`(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};return {bar:rect('.dock-bar'),tray:rect('.dock-tray'),width:innerWidth,height:innerHeight,edge:document.querySelector('.dock-panel').dataset.edge}})()`);
 try {
  await evaluate('document.querySelectorAll(".settings-tabs button")[1].click()');
  for(const edge of ['top','bottom','left','right']){
   await control('停靠方向',edge);await expect.poll(()=>evaluate('window.dock.call("snapshot").then(s=>s.config.settings.dockEdge)')).toBe(edge);
   await evaluate('window.dock.call("expand")');await evaluate('(async()=>{if(!(await window.dock.call("snapshot")).pinned)await window.dock.call("pin")})()');
   await expect.poll(async()=>{const r=await layout();return r.edge===edge&&r.tray.x>=-1&&r.tray.y>=-1&&r.tray.right<=r.width+1&&r.tray.bottom<=r.height+1}).toBe(true);
   const r=await layout();
   if(edge==='top')assert.ok(r.tray.y>=r.bar.bottom-1);
   if(edge==='bottom')assert.ok(r.tray.bottom<=r.bar.y+1);
   if(edge==='left')assert.ok(r.tray.x>=r.bar.right-1);
   if(edge==='right')assert.ok(r.tray.right<=r.bar.x+1);
   const state=await evaluate('window.dock.call("snapshot")');
   const actual=await app.evaluate(({BrowserWindow})=>{const t=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=trigger'));const p=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=panel'));return {trigger:t.getBounds(),panel:p.getBounds(),handle:p.getNativeWindowHandle().readBigUInt64LE().toString()};});
   for(const key of ['panel'])for(const axis of ['x','y'])assert.ok(Math.abs(actual[key][axis]-state.bounds[key][axis])<=1,`${edge}: ${key}.${axis} actual=${actual[key][axis]} expected=${state.bounds[key][axis]} native=${JSON.stringify(actual[key])}`);
   const dpi=native.probe(actual.handle).dpi/96;
   const point={x:Math.round((r.tray.x+r.tray.width/2)*dpi),y:Math.round((r.tray.y+20)*dpi)};assert.equal(native.probe(actual.handle,'0',point).contains,true);
   const trigger=await evaluate('(()=>{const r=document.querySelector(".trigger").getBoundingClientRect();return {x:r.x,y:r.y,width:Math.round(r.width),height:Math.round(r.height)}})()','trigger');
   assert.ok(Math.abs(actual.trigger.x+trigger.x-state.bounds.trigger.x)<=1);assert.ok(Math.abs(actual.trigger.y+trigger.y-state.bounds.trigger.y)<=1);assert.equal(trigger.width,state.bounds.trigger.width);assert.equal(trigger.height,state.bounds.trigger.height);
   await screenshot(`dock-position-${edge}.png`,'panel',true);
  }
  check('four real docking controls move native windows; cards open inward, stay in bounds and retain native hit regions');
  await control('停靠方向','top');await control('位置方式','distance');await control('距离参考边','end');await control('位置距离',100);
  await expect.poll(()=>evaluate('window.dock.call("snapshot").then(s=>s.config.settings.positionDistance)')).toBe(100);
  const area=await app.evaluate(({screen})=>screen.getPrimaryDisplay().workArea);
  const t=(await evaluate('window.dock.call("snapshot")')).bounds.trigger;assert.equal(t.x+t.width,area.x+area.width-100);
  for(const edge of ['top','left']){
   await control('停靠方向',edge);await control('位置方式','ratio');
   for(const value of [0,50,100]){
    await control('位置比例',value);
    await expect.poll(()=>evaluate('window.dock.call("snapshot").then(s=>s.config.settings.positionRatio)')).toBe(value);
    await expect.poll(async()=>{const r=await layout();return r.tray.x>=-1&&r.tray.y>=-1&&r.tray.right<=r.width+1&&r.tray.bottom<=r.height+1}).toBe(true);
   }
  }
  check('distance from right edge uses 100 DIP; horizontal/vertical ratio 0/50/100 stays within work area');
  const many=structuredClone(before);Object.assign(many.settings,{dockEdge:'right',triggerTheme:'snail',positionMode:'ratio',positionRatio:50,lastCategoryId:'position-39'});
  for(let i=7;i<40;i++)many.categories.push({id:`position-${i}`,name:`分类${i}`,icon:'Folder',color:'#087fe7'});
  for(const cat of many.categories)if(!many.entries.some(e=>e.categoryId===cat.id))many.entries.push({id:`entry-${cat.id}`,categoryId:cat.id,type:'url',target:'https://example.com',name:cat.name,icon:cat.icon,color:cat.color});
  await app.evaluate(()=>{globalThis.positionEdge='right'});
  await evaluate(`window.dock.call('save',${JSON.stringify(many)})`);await evaluate('window.dock.call("expand")');
  await expect.poll(()=>read('document.querySelector(".dock-category.selected")?.title')).toBe('分类39');
  await expect.poll(()=>read('document.querySelector(".dock-categories").scrollTop')).toBeGreaterThan(0);
  const r=await layout();assert.ok(r.bar.height<=r.height);assert.ok(r.tray.y>=0&&r.tray.bottom<=r.height+1);
  const trigger=await evaluate('(()=>{const r=document.querySelector(".trigger").getBoundingClientRect();return {x:r.x,y:r.y,width:Math.round(r.width),height:Math.round(r.height),transform:getComputedStyle(document.querySelector(".trigger-visual")).transform}})()','trigger');
  assert.equal(trigger.width,32);assert.equal(trigger.height,80);assert.notEqual(trigger.transform,'none');
  await screenshot('dock-position-side-many.png','panel',true);
  await evaluate('document.querySelector("[aria-label=停靠方向]").scrollIntoView({block:"center"})');await screenshot('position-settings.png');
  check('40 vertical categories scroll to selected item; side snail trigger rotates within its native region');
  for(const edge of ['top','left','bottom','right']){
   await control('停靠方向',edge);
   await expect.poll(()=>read(`(()=>{const s=document.querySelector('.dock-category.selected').getBoundingClientRect(),n=document.querySelector('.dock-categories').getBoundingClientRect();return s.left>=n.left-1 && s.right<=n.right+1 && s.top>=n.top-1 && s.bottom<=n.bottom+1})()`)).toBe(true);
   assert.equal((await evaluate('window.dock.call("snapshot")')).config.settings.lastCategoryId,'position-39');
  }
  check('direction switches keep the same last-of-40 selected category visible across horizontal/vertical scroll axes');
  if((await evaluate('window.dock.call("snapshot")')).materialsSupported){
   await evaluate('(async()=>{const s=await window.dock.call("snapshot");s.config.settings.material="acrylic";s.config.settings.panelOpacity=0.55;await window.dock.call("save",s.config)})()');
   await expect.poll(()=>read('Boolean(document.querySelector(".dock-panel.material-native"))').catch(()=>false)).toBe(true);
   await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=panel'))?.isVisible())).toBe(true);
   const handle=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=panel')).getNativeWindowHandle().readBigUInt64LE().toString());
   assert.equal(native.probe(handle).material,3);const r=await layout();assert.ok(r.tray.right<=r.bar.x+1);
   check('right-edge long category list also supports visible native Acrylic with inward tray placement');
  }

 }finally{
  await evaluate(`window.dock.call('save',${JSON.stringify(before)})`);
  await evaluate(`(async()=>{if((await window.dock.call('snapshot')).pinned!==${original.pinned})await window.dock.call('pin');await window.dock.call('${original.expanded?'expand':'collapse'}')})()`);
  await expect.poll(()=>read('document.querySelector(".dock-panel")?.dataset.edge').catch(()=>false)).toBe(before.settings.dockEdge);
  await app.evaluate(({screen})=>{screen.getCursorScreenPoint=globalThis.positionOriginalCursor});
  await evaluate('document.querySelectorAll(".settings-tabs button")[0].click()');
 }
}

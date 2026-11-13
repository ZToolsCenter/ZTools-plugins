import assert from 'node:assert/strict';
import {expect} from '@playwright/test';

export async function checkPinAdaptive({app,evaluate,screenshot,check}){
 const original=await evaluate('window.dock.call("snapshot")');
 const read=s=>evaluate(s,'panel');
 const toggle=async enabled=>{await evaluate(`(()=>{const t=document.querySelector('[aria-label="启用钉住功能"]');t.checked=${enabled};t.dispatchEvent(new Event('change',{bubbles:true}))})()`);await expect.poll(()=>evaluate('window.dock.call("snapshot").then(s=>s.config.settings.pinEnabled)')).toBe(enabled)};
 await app.evaluate(({screen})=>{globalThis.adaptiveOriginalCursor=screen.getCursorScreenPoint;screen.getCursorScreenPoint=()=>globalThis.adaptivePoint||{x:0,y:0};});
 try{
  await evaluate('document.querySelectorAll(".settings-tabs button")[1].click()');
  await evaluate('window.dock.call("expand")');
  const s=await evaluate('window.dock.call("snapshot")');await app.evaluate((_,p)=>{globalThis.adaptivePoint=p},{x:s.bounds.trigger.x+1,y:s.bounds.trigger.y+1});
  if(!s.pinned)await read('document.querySelector(".dock-menu-toggle").click()');
  await toggle(false);
  await expect.poll(()=>read('document.querySelectorAll(".dock-menu-toggle").length')).toBe(0);
  assert.equal((await evaluate('window.dock.call("snapshot")')).pinned,false);assert.equal(await read('window.dock.call("pin")'),false);
  await app.evaluate(()=>{globalThis.adaptivePoint={x:-10000,y:-10000}});
  await expect.poll(()=>evaluate('window.dock.call("snapshot").then(s=>s.expanded)'),{timeout:4000}).toBe(false);
  await toggle(true);await evaluate('window.dock.call("expand")');
  await app.evaluate((_,p)=>{globalThis.adaptivePoint=p},{x:s.bounds.trigger.x+1,y:s.bounds.trigger.y+1});
  await expect.poll(()=>read('document.querySelectorAll(".dock-menu-toggle").length')).toBe(1);
  await read('document.querySelector(".dock-menu-toggle").click()');assert.equal((await evaluate('window.dock.call("snapshot")')).pinned,true);
  check('real pin setting hides/shows button, cancels pin and prevents re-pinning while disabled; pointer leave resumes full collapse');
  await toggle(false);
  const fixture=structuredClone(original.config);Object.assign(fixture.settings,{pinEnabled:false,columns:5,material:'solid',searchEnabled:false,lastCategoryId:'folders'});
  for(const edge of ['top','bottom','left','right'])for(const count of [1,2,5,7]){
   fixture.settings.dockEdge=edge;fixture.entries=Array.from({length:count},(_,i)=>({id:`adaptive-${i}`,categoryId:'folders',name:`适应入口${i+1}`,type:'url',target:`https://example.com/${i}`,icon:'Globe',color:'#087fe7'}));
   await evaluate(`window.dock.call('save',${JSON.stringify(fixture)})`);await evaluate('window.dock.call("expand")');
   const state=await evaluate('window.dock.call("snapshot")');await app.evaluate((_,p)=>{globalThis.adaptivePoint=p},{x:state.bounds.trigger.x+1,y:state.bounds.trigger.y+1});
   await expect.poll(()=>read(`(()=>{const t=document.querySelector('.dock-tray').getBoundingClientRect(),cards=[...document.querySelectorAll('.launch-card')];return cards.length===${count}&&Math.abs(t.width-${Math.min(count,5)*128+8})<1&&cards.every(c=>Math.abs(c.getBoundingClientRect().width-120)<1)})()`)).toBe(true);
   await expect.poll(()=>read(`(()=>{const t=document.querySelector('.dock-tray').getBoundingClientRect();return document.querySelector('.dock-panel').dataset.edge==='${edge}'&&t.x>=0&&t.y>=0&&t.right<=innerWidth+1&&t.bottom<=innerHeight+1})()`)).toBe(true);
  }
  check('adaptive tray uses 1/2/5 columns for 1/2/5/7 entries on all four edges; card width remains 120 DIP and tray stays in bounds');
  Object.assign(fixture.settings,{dockEdge:'top',searchEnabled:true,material:s.materialsSupported?'acrylic':'solid'});
  await evaluate(`window.dock.call('save',${JSON.stringify(fixture)})`);await evaluate('window.dock.call("expand")');
  const state=await evaluate('window.dock.call("snapshot")');await app.evaluate((_,p)=>{globalThis.adaptivePoint=p},{x:state.bounds.trigger.x+1,y:state.bounds.trigger.y+1});
  for(const [query,width] of [['适应入口1',136],['没有结果',264],['',648]]){
   await read(`(()=>{const i=document.querySelector('.dock-search input');i.value='${query}';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
   await expect.poll(()=>read('document.querySelector(".dock-tray").getBoundingClientRect().width')).toBe(width);
   if(s.materialsSupported)await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=material-tray'))?.getBounds().width)).toBe(width);
  }
  fixture.entries=fixture.entries.slice(0,2);fixture.settings.searchEnabled=false;
  await evaluate(`window.dock.call('save',${JSON.stringify(fixture)})`);
  await expect.poll(()=>read('document.querySelector(".dock-tray").getBoundingClientRect().width')).toBe(264);
  await screenshot('dock-adaptive-width.png','panel',true);
  await evaluate('document.querySelector("[aria-label=启用钉住功能]").scrollIntoView({block:"center"})');await screenshot('pin-setting.png');
  check('search result counts resize tray and native Acrylic backdrop together; empty search remains usable; two-entry preview has no empty columns');
 }finally{
  await evaluate(`window.dock.call('save',${JSON.stringify(original.config)})`);
  await evaluate(`(async()=>{if((await window.dock.call('snapshot')).pinned!==${original.pinned})await window.dock.call('pin');await window.dock.call('${original.expanded?'expand':'collapse'}')})()`);
  await app.evaluate(({screen})=>{screen.getCursorScreenPoint=globalThis.adaptiveOriginalCursor});
  await evaluate('document.querySelectorAll(".settings-tabs button")[0].click()');
 }
}

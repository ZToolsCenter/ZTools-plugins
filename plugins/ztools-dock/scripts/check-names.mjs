import assert from 'node:assert/strict';
import {expect} from '@playwright/test';

export async function checkNames({app,evaluate,screenshot,check}) {
 const original=await evaluate('window.dock.call("snapshot")');
 const read=script=>evaluate(script,'panel');
 const toggle=async(label,key,value)=>{
  await evaluate(`(()=>{const input=document.querySelector('[aria-label="${label}"]');input.checked=${value};input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await expect.poll(()=>evaluate(`window.dock.call('snapshot').then(s=>s.config.settings.${key})`)).toBe(value);
 };
 await app.evaluate(({screen})=>{globalThis.namesOriginalCursor=screen.getCursorScreenPoint;screen.getCursorScreenPoint=()=>globalThis.namesPoint||{x:0,y:0};});
 try {
  await evaluate('document.querySelectorAll(".settings-tabs button")[1].click()');
  for(const edge of ['top','left']){
   await evaluate(`(async()=>{const s=await window.dock.call('snapshot');s.config.settings.dockEdge='${edge}';await window.dock.call('save',s.config)})()`);
   const state=await evaluate('window.dock.call("snapshot")');await app.evaluate((_,point)=>{globalThis.namesPoint=point},{x:state.bounds.trigger.x+1,y:state.bounds.trigger.y+1});
   await evaluate('window.dock.call("expand")');
   for(const [category,entry] of [[true,true],[false,true],[true,false],[false,false]]){
    await toggle('显示菜单栏名称','showCategoryNames',category);await toggle('显示入口名称','showEntryNames',entry);
    await expect.poll(()=>read(`(()=>{const c=document.querySelectorAll('.dock-category').length,e=document.querySelectorAll('.launch-card').length;return c>0&&e>0&&document.querySelectorAll('.dock-category-name').length===${category?'c':'0'}&&document.querySelectorAll('.launch-name').length===${entry?'e':'0'}})()`)).toBe(true);
    const accessible=await read(`([...document.querySelectorAll('.dock-category'),...document.querySelectorAll('.launch-card')]).every(b=>b.getAttribute('aria-label')&&b.title.startsWith(b.getAttribute('aria-label')))`);assert.equal(accessible,true);
    if(!entry)assert.equal(await read(`(()=>{const c=document.querySelector('.launch-card').getBoundingClientRect(),i=document.querySelector('.launch-icon').getBoundingClientRect();return Math.abs(c.y+c.height/2-i.y-i.height/2)<1})()`),true);
   }
   await screenshot(`names-hidden-${edge}.png`,'panel',true);
  }
  check('two real name switches independently control all four combinations on top/left docks; hidden labels retain tooltips, accessible names and centred icons');
  await evaluate('document.querySelector("[aria-label=显示入口名称]").scrollIntoView({block:"center"})');await screenshot('name-visibility-settings.png');
  await evaluate('(async()=>{const s=await window.dock.call("snapshot");s.config.settings.searchEnabled=true;await window.dock.call("save",s.config)})()');
  await expect.poll(()=>read('Boolean(document.querySelector(".dock-search input"))')).toBe(true);
  await read('(()=>{const input=document.querySelector(".dock-search input");input.value="下载";input.dispatchEvent(new Event("input",{bubbles:true}))})()');
  await expect.poll(()=>read('document.querySelectorAll(".launch-card").length')).toBe(1);
  assert.equal(await read('document.querySelector(".launch-card").getAttribute("aria-label")'),'下载');assert.equal(await read('document.querySelectorAll(".launch-name").length'),0);
  check('search still matches entry names while both menu and entry labels are hidden');
 }finally{
  await evaluate(`window.dock.call('save',${JSON.stringify(original.config)})`);
  await evaluate(`(async()=>{if((await window.dock.call('snapshot')).pinned!==${original.pinned})await window.dock.call('pin');await window.dock.call('${original.expanded?'expand':'collapse'}')})()`);
  await expect.poll(()=>read('document.querySelector(".dock-panel")?.dataset.edge').catch(()=>false)).toBe(original.config.settings.dockEdge);
  await app.evaluate(({screen})=>{screen.getCursorScreenPoint=globalThis.namesOriginalCursor});
  await evaluate('document.querySelectorAll(".settings-tabs button")[0].click()');
 }
}

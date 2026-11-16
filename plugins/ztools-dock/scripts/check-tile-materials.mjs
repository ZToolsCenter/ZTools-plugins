import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
export async function checkTileMaterials({app,evaluate,screenshot,check}) {
 const original=await evaluate('window.dock.call("snapshot")');
 const appearance=()=>evaluate('document.querySelectorAll(".settings-tabs button")[1].click()');
 const styles=()=>evaluate(`(()=>{const read=sel=>{const e=document.querySelector(sel),s=getComputedStyle(e),p=getComputedStyle(e,'::before'),r=e.getBoundingClientRect();return{background:s.backgroundImage,shadow:s.boxShadow,border:s.borderColor,before:p.backgroundImage,width:r.width,height:r.height,opacity:s.opacity,ink:s.color}};return{menu:read('.dock-category'),card:read('.launch-card'),tray:read('.dock-tray'),strength:getComputedStyle(document.querySelector('.dock-panel')).getPropertyValue('--glass-strength')}})()`,'panel');
 const results=[];
 try {
  await evaluate(`(async()=>{const s=await window.dock.call('snapshot');Object.assign(s.config.settings,{dockEdge:'top',material:'solid',theme:'light',tileStrength:85});s.config.entries.push({...s.config.entries[0],id:'material-tools',categoryId:'tools',name:'常用工具'},{...s.config.entries[1],id:'material-ai',categoryId:'ai',name:'AI工具'});await window.dock.call('save',s.config);await window.dock.call('expand');if(!(await window.dock.call('snapshot')).pinned)await window.dock.call('pin')})()`);
  await appearance();
  for(const kind of ['plain','ice','frosted','liquid','clear','iridescent']){
   await evaluate(`document.querySelector('[data-tile-choice="${kind}"]').click()`);
   await expect.poll(()=>evaluate('window.dock.call("snapshot").then(s=>s.config.settings.tileMaterial)')).toBe(kind);
   await expect.poll(()=>evaluate('document.querySelector(".dock-panel").dataset.tileMaterial','panel')).toBe(kind);
   await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))','panel');
   const info=await styles();results.push({kind,...info});
   assert.equal(info.card.opacity,'1');assert.equal(info.menu.opacity,'1');
   if(kind!=='plain') {assert.notEqual(info.card.shadow,'none');assert.notEqual(info.menu.shadow,'none');}
   await screenshot(`tile-${kind}-light.png`,'panel',true);
  }
  assert.equal(new Set(results.map(r=>JSON.stringify([r.card.background,r.card.shadow,r.card.before]))).size,6,'six distinct card surfaces');
  assert.equal(new Set(results.map(r=>r.tray.background)).size,1,'tile choices do not replace outer background');
  for(const value of [0,40,100]) {
   await evaluate(`(()=>{const el=document.querySelector('[aria-label="材质强度"]');el.value='${value}';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
   await expect.poll(()=>evaluate('window.dock.call("snapshot").then(s=>s.config.settings.tileStrength)')).toBe(value);
   await expect.poll(()=>evaluate('getComputedStyle(document.querySelector(".dock-panel")).getPropertyValue("--glass-strength")','panel')).toBe(String(value/100));
   results.push({strength:value,...await styles()});
  }
  assert.notEqual(results.at(-1).card.shadow,results.at(-3).card.shadow);
  assert.equal(results.at(-1).card.width,results.at(-3).card.width);assert.equal(results.at(-1).card.height,results.at(-3).card.height);
  await evaluate(`(async()=>{const s=await window.dock.call('snapshot');Object.assign(s.config.settings,{tileStrength:85,theme:'dark'});await window.dock.call('save',s.config)})()`);
  for(const kind of ['ice','frosted','liquid','clear','iridescent']){
   await evaluate(`document.querySelector('[data-tile-choice="${kind}"]').click()`);
   await expect.poll(()=>evaluate('document.querySelector(".dock-panel").dataset.tileMaterial','panel')).toBe(kind);
   await screenshot(`tile-${kind}-dark.png`,'panel',true);
  }
  await evaluate('document.querySelector(".tile-material-picker").scrollIntoView({block:"center"})');
  await screenshot('tile-material-picker-dark.png');
  await evaluate(`(async()=>{const s=await window.dock.call('snapshot');s.config.settings.theme='light';await window.dock.call('save',s.config)})()`);
  await screenshot('tile-material-picker.png');
  writeFileSync('artifacts/tile-material-styles.json',JSON.stringify(results,null,2));
  check('six distinct menu/entry surfaces selected through real controls; intensity 0/40/100 persists and changes rim/shadow without resizing or fading content; light/dark screenshots captured');
 } finally {
  await evaluate(`window.dock.call('save',${JSON.stringify(original.config)})`);
  await evaluate(`(async()=>{if((await window.dock.call('snapshot')).pinned!==${original.pinned})await window.dock.call('pin');await window.dock.call('${original.expanded?'expand':'collapse'}')})()`);
  await evaluate('document.querySelectorAll(".settings-tabs button")[0].click()');
 }
}

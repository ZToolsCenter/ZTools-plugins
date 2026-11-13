import assert from 'node:assert/strict';
import {expect} from '@playwright/test';

export async function checkAppearance({app,evaluate,screenshot,native,check}) {
 const original=await evaluate('window.dock.call("snapshot")');
 const before=original.config;
 await app.evaluate(({screen})=>{globalThis.appearanceOriginalCursor=screen.getCursorScreenPoint;screen.getCursorScreenPoint=()=>({x:960,y:50});});
 try {
  await evaluate('document.querySelectorAll(".settings-tabs button")[1].click()');
  for(const [theme,index] of [['worm',1],['snail',2]]) {
   await evaluate(`document.querySelectorAll('.trigger-theme-choice')[${index}].click()`);
   await expect.poll(()=>evaluate('window.dock.call("snapshot").then(s=>s.config.settings.triggerTheme)')).toBe(theme);
   await expect.poll(()=>evaluate('Boolean(document.querySelector(".trigger-art"))','trigger')).toBe(true);
   const info=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=trigger'));return {bounds:w.getBounds(),handle:w.getNativeWindowHandle().readBigUInt64LE().toString()};});
   assert.ok(info.bounds.height>=32);assert.equal((await evaluate('window.dock.call("snapshot")')).bounds.trigger.height,32);assert.equal(native.probe(info.handle).height,Math.round(32*native.probe(info.handle).dpi/96));
  }
  await evaluate('document.querySelector(".trigger-theme-choice").scrollIntoView({block:"center"})');
  await screenshot('trigger-themes.png');
  check('real theme controls switch worm/snail SVG and resize native trigger painting/hit region to 32 DIP');
  await evaluate('window.dock.call("expand")');
  await evaluate('(async()=>{if(!(await window.dock.call("snapshot")).pinned) await window.dock.call("pin")})()');
  for(const [size,px] of [['small',24],['medium',29],['large',36]]) {
   await evaluate(`(()=>{const s=document.querySelector('[aria-label="图标大小"]');s.value='${size}';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
   await expect.poll(()=>evaluate('Math.round(document.querySelector(".launch-icon svg")?.getBoundingClientRect().width || 0)','panel')).toBe(px);
  }
  await evaluate('(async()=>{const s=await window.dock.call("snapshot");s.config.settings.cardSize=76;await window.dock.call("save",s.config)})()');
  const fit=await evaluate('(()=>{const c=document.querySelector(".launch-card").getBoundingClientRect(),i=document.querySelector(".launch-icon").getBoundingClientRect(),n=document.querySelector(".launch-name").getBoundingClientRect();return i.top>=c.top && n.bottom<=c.bottom})()','panel');assert.equal(fit,true);
  check('icon size selector applies 24/29/36 DIP; largest icons and text fit minimum card height');
  if((await evaluate('window.dock.call("snapshot")')).materialsSupported) {
   for(const [material,code] of [['mica',2],['acrylic',3]]) {
    await evaluate(`(()=>{const s=document.querySelector('[aria-label="面板材质"]');s.value='${material}';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await expect.poll(()=>evaluate('window.dock.call("snapshot").then(s=>s.material)')).toBe(material);
    await expect.poll(()=>evaluate('Boolean(document.querySelector(".dock-panel.material-native"))','panel').catch(()=>false)).toBe(true);
    await evaluate('window.dock.call("expand")');
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=panel'))?.isVisible())).toBe(true);
    const handle=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=panel')).getNativeWindowHandle().readBigUInt64LE().toString());
    const probe=native.probe(handle);assert.equal(probe.materialResult,0);assert.equal(probe.material,code);
    const state=await evaluate('window.dock.call("snapshot")');assert.equal(state.pinned,true);assert.equal(state.expanded,true);
    const outside=native.probe(handle,'0',{x:1,y:150});assert.equal(outside.contains,false);
   }
   check('Windows DWM confirms native Mica=2/Acrylic=3; material switch preserves pin/expand; outside shape stays click-through');
  }
  await evaluate('(()=>{const s=document.querySelector("[aria-label=背景不透明度]");s.value="0.35";s.dispatchEvent(new Event("change",{bubbles:true}))})()');
  await expect.poll(()=>evaluate('window.dock.call("snapshot").then(s=>s.config.settings.panelOpacity)')).toBe(0.35);
  const opacity=await evaluate('(()=>{const p=getComputedStyle(document.querySelector(".dock-panel")),t=getComputedStyle(document.querySelector(".launch-name"));return {opacity:p.opacity,text:t.opacity,bg:getComputedStyle(document.querySelector(".dock-tray")).backgroundColor}})()','panel');
  assert.equal(opacity.opacity,'1');assert.equal(opacity.text,'1');assert.match(opacity.bg, /0\.35/);
  await evaluate('document.querySelector("[aria-label=面板材质]").scrollIntoView({block:"center"})');
  await screenshot('appearance-options.png');await screenshot('dock-large-icons.png','panel',true);
  check('background opacity control affects surface tint only; panel and text stay fully opaque');
 } finally {
  await evaluate(`window.dock.call('save',${JSON.stringify(before)})`);
  await evaluate(`(async()=>{if((await window.dock.call('snapshot')).pinned!==${original.pinned})await window.dock.call('pin');await window.dock.call('${original.expanded?'expand':'collapse'}');${original.expanded&&!original.trayVisible?"await window.dock.call('collapse');":''}})()`);
  await expect.poll(()=>evaluate('Boolean(document.querySelector(".dock-panel"))','panel').catch(()=>false)).toBe(true);
  await evaluate('window.dock.call("snapshot")','panel');
  await evaluate('document.querySelectorAll(".settings-tabs button")[0].click()');
  await app.evaluate(({screen})=>{screen.getCursorScreenPoint=globalThis.appearanceOriginalCursor});
 }
}

import assert from 'node:assert/strict';
import {expect} from '@playwright/test';

export async function checkDockDimensions({app,evaluate,screenshot,check}) {
 const original=await evaluate('window.dock.call("snapshot")');
 const read=s=>evaluate(s,'panel');
 await app.evaluate(({screen})=>{globalThis.dimensionsCursor=screen.getCursorScreenPoint;screen.getCursorScreenPoint=()=>globalThis.dimensionsPoint||{x:0,y:0};});
 const apply=async config=>{await evaluate(`window.dock.call('save',${JSON.stringify(config)})`);await evaluate('window.dock.call("expand")');const s=await evaluate('window.dock.call("snapshot")');await app.evaluate((_,p)=>{globalThis.dimensionsPoint=p},{x:s.bounds.trigger.x+1,y:s.bounds.trigger.y+1});};
 const rects=()=>read(`(()=>{const r=s=>{const t=document.querySelector(s).getBoundingClientRect();return {x:t.x,y:t.y,width:t.width,height:t.height,right:t.right,bottom:t.bottom}};return {bar:r('.dock-bar'),tray:r('.dock-tray'),width:innerWidth,height:innerHeight}})()`);
 try{
  const c=structuredClone(original.config);Object.assign(c.settings,{dockWidth:0,dockHeight:0,popupWidth:0,popupHeight:0,pinEnabled:true,cardScale:100,material:'solid'});
  for(const edge of ['top','bottom','left','right']){
   c.settings.dockEdge=edge;c.settings.pinEnabled=true;await apply(c);
   await expect.poll(()=>read('document.querySelector(".dock-panel").dataset.edge')).toBe(edge);
   await expect.poll(()=>read('document.querySelectorAll(".dock-menu-toggle").length')).toBe(1);
   const before=await rects();c.settings.pinEnabled=false;await apply(c);
   const axis=['top','bottom'].includes(edge)?'width':'height';
   await expect.poll(async()=>Math.round(before.bar[axis]-(await rects()).bar[axis])).toBe(26);
  }
  check('hiding pin removes its full 26-DIP slot in horizontal and vertical navigation bars');
  await evaluate('document.querySelectorAll(".settings-tabs button")[1].click()');
  for(const edge of ['top','bottom','left','right']){
   c.settings.dockEdge=edge;await apply(c);
   for(const [label,key,value] of [['导航条宽度','dockWidth',320],['导航条高度','dockHeight',160],['卡片弹窗宽度','popupWidth',420],['卡片弹窗高度','popupHeight',230]]){
    await evaluate(`(()=>{const i=document.querySelector('[aria-label="${label}"]');i.value='${value}';i.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await expect.poll(()=>evaluate(`window.dock.call('snapshot').then(s=>s.config.settings.${key})`)).toBe(value);
   }
   await expect.poll(async()=>{const r=await rects();return Math.abs(r.bar.width-320)<1&&Math.abs(r.bar.height-160)<1&&Math.abs(r.tray.width-420)<1&&Math.abs(r.tray.height-230)<1&&r.tray.x>=0&&r.tray.y>=0&&r.tray.right<=r.width+1&&r.tray.bottom<=r.height+1}).toBe(true);
  }
  check('four independent dimension inputs set 320x160 navigation and 420x230 popup on all edges; cards scroll within fixed popup');
  Object.assign(c.settings,{dockEdge:'top',dockWidth:240,dockHeight:40,popupWidth:0,popupHeight:0});await apply(c);
  await expect.poll(()=>read(`(()=>{const b=document.querySelector('.dock-bar').getBoundingClientRect();return b.height===40&&[...document.querySelectorAll('.dock-category svg,.dock-category-name')].every(el=>{const r=el.getBoundingClientRect();return r.top>=b.top&&r.bottom<=b.bottom})})()`)).toBe(true);
  c.settings.dockEdge='top';Object.assign(c.settings,{dockWidth:2000,dockHeight:1200,popupWidth:2000,popupHeight:1200});
  for(const edge of ['top','bottom','left','right']){
   c.settings.dockEdge=edge;await apply(c);
   await expect.poll(async()=>{const r=await rects();return ['bar','tray'].every(k=>r[k].x>=0&&r[k].y>=0&&r[k].right<=r.width+1&&r[k].bottom<=r.height+1)}).toBe(true);
  }
  check('oversized manual dimensions are clamped to available space on all four docking edges');
  Object.assign(c.settings,{dockEdge:'top',dockWidth:400,dockHeight:80,popupWidth:420,popupHeight:230});await apply(c);
  await screenshot('dock-manual-dimensions.png','panel',true);
  await evaluate('document.querySelector("[aria-label=导航条宽度]").scrollIntoView({block:"center"})');await screenshot('dock-dimension-settings.png');
  // Switching while collapsed must survive the hidden renderer and then restore both backgrounds.
  if(original.materialsSupported){
   const page=app.windows().find(p=>p.url().includes('surface=settings'));
   for(const m of ['mica','acrylic','solid','acrylic','mica','solid']){
    await evaluate('window.dock.call("collapse")');
    await page.locator(`[data-material="${m}"]`).click();
    await expect.poll(()=>evaluate('window.dock.call("snapshot").then(s=>s.material)')).toBe(m);
    await page.locator(`[data-material="${m}"]`).getAttribute('aria-pressed').then(value=>assert.equal(value,'true'));
    await evaluate('window.dock.call("expand")');
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes('material.html')&&w.isVisible()).length)).toBe(m==='solid'?0:2);
   }
   check('actual material buttons survive repeated collapsed solid/Mica/Acrylic switches and restore native backgrounds on expand');
  }
 }finally{
  await evaluate(`window.dock.call('save',${JSON.stringify(original.config)})`);
  await evaluate(`(async()=>{if((await window.dock.call('snapshot')).pinned!==${original.pinned})await window.dock.call('pin');await window.dock.call('${original.expanded?'expand':'collapse'}')})()`);
  await app.evaluate(({screen})=>{screen.getCursorScreenPoint=globalThis.dimensionsCursor});
 }
}

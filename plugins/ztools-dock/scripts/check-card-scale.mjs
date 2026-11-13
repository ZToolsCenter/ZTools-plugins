import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {expect} from '@playwright/test';
export async function checkCardScale({app,evaluate,screenshot,check}){
 const original=await evaluate('window.dock.call("snapshot")'),read=s=>evaluate(s,'panel');
 const config=structuredClone(original.config);Object.assign(config.settings,{columns:5,cardSize:100,cardScale:100,iconSize:'medium',showEntryNames:true,material:'solid',dockEdge:'top',lastCategoryId:'folders'});
 config.entries=Array.from({length:2},(_,i)=>({id:`scale-${i}`,categoryId:'folders',name:`缩放入口${i+1}`,type:'url',target:`https://example.com/${i}`,icon:'Globe',color:'#087fe7'}));
 await app.evaluate(({screen})=>{globalThis.scaleOriginalCursor=screen.getCursorScreenPoint;screen.getCursorScreenPoint=()=>globalThis.scalePoint||{x:0,y:0};});
 try{
  await evaluate('document.querySelectorAll(".settings-tabs button")[1].click()');
  for(const edge of ['top','bottom','left','right'])for(const scale of [50,100,150]){
   Object.assign(config.settings,{dockEdge:edge,cardScale:scale});await evaluate(`window.dock.call('save',${JSON.stringify(config)})`);await evaluate('window.dock.call("expand")');
   const state=await evaluate('window.dock.call("snapshot")');await app.evaluate((_,p)=>{globalThis.scalePoint=p},{x:state.bounds.trigger.x+1,y:state.bounds.trigger.y+1});
   await expect.poll(()=>read(`(()=>{const c=document.querySelector('.launch-card').getBoundingClientRect(),t=document.querySelector('.dock-tray').getBoundingClientRect(),i=document.querySelector('.launch-icon svg').getBoundingClientRect(),n=document.querySelector('.launch-name').getBoundingClientRect();return Math.abs(c.width-${120*scale/100})<1&&Math.abs(c.height-${scale})<1&&Math.abs(t.width-${262*scale/100+2})<1&&Math.abs(t.height-${114*scale/100+2})<1&&Math.abs(i.width-${Math.round(29*scale/100)})<1&&n.bottom<=c.bottom&&t.x>=0&&t.y>=0&&t.right<=innerWidth+1&&t.bottom<=innerHeight+1})()`)).toBe(true);
   if(edge==='top')await screenshot(`dock-card-scale-${scale}.png`,'panel',true);
  }
  check('whole-card 50/100/150 percent scales card, icon, spacing and two-entry tray in all four docking directions');
  Object.assign(config.settings,{dockEdge:'top',cardScale:150,columns:6,material:original.materialsSupported?'acrylic':'solid'});
  config.entries=Array.from({length:7},(_,i)=>({...config.entries[i%2],id:`scale-${i}`}));
  await evaluate(`window.dock.call('save',${JSON.stringify(config)})`);await evaluate('window.dock.call("expand")');
  const state=await evaluate('window.dock.call("snapshot")');await app.evaluate((_,p)=>{globalThis.scalePoint=p},{x:state.bounds.trigger.x+1,y:state.bounds.trigger.y+1});
  const actual=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=panel')).getBounds());
  try{for(const [width,columns] of [[360,1],[620,3]]){
   await app.evaluate(({BrowserWindow},bounds)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=panel')).setBounds(bounds),{...actual,width});
   await expect.poll(async()=>{const m=await read(`(()=>{const g=document.querySelector('.dock-grid'),t=document.querySelector('.dock-tray').getBoundingClientRect(),c=document.querySelector('.launch-card').getBoundingClientRect();return {width:innerWidth,tray:{x:t.x,right:t.right,width:t.width},card:c.width,columns:getComputedStyle(g).gridTemplateColumns,scroll:g.offsetWidth-g.clientWidth,scrollHeight:g.scrollHeight,clientHeight:g.clientHeight}})()`);writeFileSync('artifacts/card-scale-narrow.json',JSON.stringify(m,null,2));return m.columns.split(' ').length===columns&&Math.abs(m.card-180)<1&&m.tray.x>=0&&m.tray.right<=m.width+1}).toBe(true);
   if(original.materialsSupported)await expect.poll(async()=>{const actual=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=material-tray'))?.getBounds().width);const width=await read('document.querySelector(".dock-tray").getBoundingClientRect().width');return Number.isFinite(actual)&&Math.abs(actual-Math.ceil(width))<=1}).toBe(true);
  }}finally{await app.evaluate(({BrowserWindow},bounds)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=panel')).setBounds(bounds),actual)}
  check('150 percent cards retain width by reducing columns at 360/620-DIP window widths; native Acrylic tray follows resized dimensions');
  await evaluate('document.querySelector("[aria-label=卡片缩放]").scrollIntoView({block:"center"})');await screenshot('card-scale-settings.png');
 }finally{
  await evaluate(`window.dock.call('save',${JSON.stringify(original.config)})`);await evaluate(`(async()=>{if((await window.dock.call('snapshot')).pinned!==${original.pinned})await window.dock.call('pin');await window.dock.call('${original.expanded?'expand':'collapse'}')})()`);
  await app.evaluate(({screen})=>{screen.getCursorScreenPoint=globalThis.scaleOriginalCursor});await evaluate('document.querySelectorAll(".settings-tabs button")[0].click()');
 }
}

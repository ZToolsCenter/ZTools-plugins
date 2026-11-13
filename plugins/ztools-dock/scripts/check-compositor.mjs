import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';

// Test DWM's composed pixels, not capturePage (which omits native backdrops).
export async function checkCompositor({app,evaluate,native,check}) {
 const original=await evaluate('window.dock.call("snapshot")');
 if(!original.materialsSupported)return false;
 if(native.desktopLocked()){writeFileSync('artifacts/compositor-result.json',JSON.stringify({blocked:true,reason:'Windows locked; desktop pixels cannot validate dock surfaces'}));console.warn('BLOCKED: desktop compositor check requires Windows to be unlocked');return false;}
 const results=[];
 await app.evaluate(async({BrowserWindow,screen})=>{
  const area=screen.getPrimaryDisplay().workArea;
  globalThis.materialPlate=new BrowserWindow({...area,frame:false,thickFrame:false,show:false,focusable:true,skipTaskbar:true,backgroundColor:'#315a89'});
  await globalThis.materialPlate.loadURL('data:text/html,<html><body style="margin:0;background:%23315a89"></body></html>');
  globalThis.materialPlate.setContentProtection(false);globalThis.materialPlate.setAlwaysOnTop(true,'screen-saver');globalThis.materialPlate.show();globalThis.materialPlate.focus();
  globalThis.compositorCursor=screen.getCursorScreenPoint;screen.getCursorScreenPoint=()=>globalThis.compositorPoint||{x:0,y:0};
 });
 try{
  for(const material of ['mica','acrylic']){
   await evaluate(`(async()=>{const s=await window.dock.call('snapshot');Object.assign(s.config.settings,{material:'${material}',dockEdge:'top',positionMode:'ratio',positionRatio:50,columns:3,cardSize:100});await window.dock.call('save',s.config);await window.dock.call('expand');if(!(await window.dock.call('snapshot')).pinned)await window.dock.call('pin')})()`);
   await expect.poll(()=>evaluate('Boolean(document.querySelector(".dock-panel.material-native"))','panel').catch(()=>false)).toBe(true);
   const state=await evaluate('window.dock.call("snapshot")');
   await app.evaluate((_,point)=>{globalThis.compositorPoint=point},{x:state.bounds.trigger.x+1,y:state.bounds.trigger.y+1});
   await new Promise(r=>setTimeout(r,350));
   await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes('material.html')&&w.isVisible()).length)).toBe(2);
   let stable=0;
   const card=await evaluate('(()=>{const r=document.querySelector(".launch-card").getBoundingClientRect();return {x:r.x+8,y:r.y+8}})()','panel');
   for(let attempt=0;attempt<6;attempt++){
   const sample=await app.evaluate(({BrowserWindow,screen},{panel,card})=>{
    globalThis.materialPlate.moveTop();
    const owned=BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes('/plugins/ztools-dock/')&&!w.webContents.getURL().includes('surface=settings'));
    owned.forEach(w=>w.setContentProtection(false));
    owned.filter(w=>w.webContents.getURL().includes('material.html')).forEach(w=>w.moveTop());
    owned.filter(w=>w.webContents.getURL().includes('surface=panel')).forEach(w=>w.moveTop());
    const d=screen.getPrimaryDisplay(),area=d.workArea;
    return {panel,plateInfo:{opacity:globalThis.materialPlate.getOpacity(),visible:globalThis.materialPlate.isVisible(),minimized:globalThis.materialPlate.isMinimized(),top:globalThis.materialPlate.isAlwaysOnTop()},plateHandle:globalThis.materialPlate.getNativeWindowHandle().readBigUInt64LE().toString(),native:owned.map(w=>({surface:w.webContents.getURL().split('surface=')[1],bounds:w.getBounds(),visible:w.isVisible()})),plate:globalThis.materialPlate.getBounds(),points:[{x:area.x+8,y:area.y+area.height-8},{x:panel.x+card.x,y:panel.y+card.y},{x:panel.x+panel.width/2,y:panel.y+panel.height-10}].map(p=>screen.dipToScreenPoint({x:Math.round(p.x),y:Math.round(p.y)}))};
   },{panel:state.bounds.panel,card});
   await new Promise(r=>setTimeout(r,120));
   [sample.baseline,sample.inside,sample.blank]=native.pixels(sample.points);sample.flags=native.flags(sample.plateHandle);
   const good=sample.baseline.every((v,i)=>Math.abs(v-[137,90,49][i])<=4)&&sample.inside.some((v,i)=>Math.abs(v-sample.baseline[i])>10)&&sample.blank.every((v,i)=>Math.abs(v-sample.baseline[i])<=4);
   stable=good?stable+1:0;
   results.push({material,attempt,good,...sample});writeFileSync('artifacts/compositor-result.json',JSON.stringify(results,null,2));
   if(stable>=2)break;
   await new Promise(r=>setTimeout(r,200));
   }
   assert.ok(stable>=2,`${material} desktop backdrop did not remain clear outside surfaces; see compositor-result.json`);
  }
  check('real desktop compositor keeps test background unchanged outside Mica/Acrylic dock surfaces');return true;
 }finally{
  await evaluate(`window.dock.call('save',${JSON.stringify(original.config)})`);
  await evaluate(`(async()=>{if((await window.dock.call('snapshot')).pinned!==${original.pinned})await window.dock.call('pin');await window.dock.call('${original.expanded?'expand':'collapse'}')})()`);
  await expect.poll(()=>evaluate('Boolean(document.querySelector(".dock-panel"))','panel').catch(()=>false)).toBe(true);
  await app.evaluate(({screen})=>{screen.getCursorScreenPoint=globalThis.compositorCursor;globalThis.materialPlate?.destroy();delete globalThis.materialPlate;});
 }
}

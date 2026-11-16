import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export async function checkHoverStability({app,evaluate,native,check}) {
 const original=await evaluate('window.dock.call("snapshot")');
 const measure=()=>evaluate(`(()=>{const el=document.querySelector('.dock-tray'),r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,display:getComputedStyle(el).display,visibility:getComputedStyle(el).visibility}})()`,'panel');
 const handle=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=panel')).getNativeWindowHandle().readBigUInt64LE().toString());
 const scale=native.probe(handle).dpi/96;
 try {
  for(const edge of ['top','bottom','left','right']) {
   await evaluate(`(async()=>{const s=await window.dock.call('snapshot');Object.assign(s.config.settings,{dockEdge:'${edge}',material:'solid',openDelay:0,closeDelay:1500});await window.dock.call('save',s.config);await window.dock.call('expand')})()`);
   await expect.poll(async()=> (await measure()).height).toBeGreaterThan(0);
   await expect.poll(async()=> (await measure()).visibility).toBe('visible');
   // Let resize observers finish positioning before comparing subsequent shows.
   await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))','panel');
   const shown=await measure();
   for(let i=0;i<3;i++) {
    await evaluate('(async()=>{if((await window.dock.call("snapshot")).pinned)await window.dock.call("pin");await window.dock.call("collapse")})()');
    await new Promise(r=>setTimeout(r,100));
    const hidden=await measure();
    assert.equal(hidden.display,'flex',`${edge}: collapsed tray retains measurable layout`);
    assert.deepEqual({x:hidden.x,y:hidden.y,width:hidden.width,height:hidden.height},{x:shown.x,y:shown.y,width:shown.width,height:shown.height},`${edge}: collapse must not reposition or resize tray`);
    assert.equal(native.probe(handle,undefined,{x:Math.round((shown.x+shown.width/2)*scale),y:Math.round((shown.y+shown.height/2)*scale)}).contains,true,edge+': hidden native window retains card region before show');
    await evaluate('window.dock.call("hover",true)','panel');
    await expect.poll(()=>evaluate('window.dock.call("snapshot").then(s=>s.expanded)')).toBe(true);
    await expect.poll(async()=> (await measure()).visibility).toBe('visible');
    const again=await measure();
    assert.deepEqual(again,shown,`${edge}: hover reopening uses the prepared layout`);
   }
   await evaluate('window.dock.call("pin")');await evaluate('window.dock.call("collapse",false)');
   await expect.poll(async()=>(await measure()).visibility).toBe('hidden');
   const pinned=await measure();assert.equal(pinned.width,shown.width);assert.equal(pinned.height,shown.height);
   assert.equal(await evaluate('document.querySelector(".dock-tray").inert','panel'),true);
   await evaluate('window.dock.call("expand")');
   await expect.poll(async()=>(await measure()).visibility).toBe('visible');
   await evaluate('(async()=>{if((await window.dock.call("snapshot")).pinned)await window.dock.call("pin");await window.dock.call("collapse")})()');
  }
  check('12 hover reopenings across all edges retain tray dimensions, position and complete native regions before show; pinned hidden tray retains size and is inert');
 } finally {
  await evaluate(`window.dock.call('save',${JSON.stringify(original.config)})`);
  await evaluate(`(async()=>{await window.dock.call('${original.expanded?'expand':'collapse'}');if((await window.dock.call('snapshot')).pinned!==${original.pinned})await window.dock.call('pin')})()`);
 }
}

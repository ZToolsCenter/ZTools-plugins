import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';

export async function checkStyle({ app, evaluate, screenshot, native, check }) {
  const before = (await evaluate('window.dock.call("snapshot")')).config;
  const read = script => evaluate(script, 'panel');
  const layout = () => read(`(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};return {bar:rect('.dock-bar'),tray:rect('.dock-tray'),selected:rect('.dock-category.selected'),cards:[...document.querySelectorAll('.launch-card')].slice(0,4).map(e=>({x:e.offsetLeft,y:e.offsetTop})),columns:getComputedStyle(document.querySelector('.dock-grid')).gridTemplateColumns,selectedColor:getComputedStyle(document.querySelector('.dock-category.selected')).color,background:getComputedStyle(document.body).backgroundColor,width:innerWidth,height:innerHeight}})()`);
  const evidence = {};
  try {
    // Keep the user's pointer outside this synthetic visual fixture's interaction path.
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>/surface=(panel|trigger)/.test(w.webContents.getURL())).forEach(w=>w.setIgnoreMouseEvents(true)));
    const config = structuredClone(before); config.settings.theme = 'light'; config.settings.columns = 3; config.settings.cardSize = 76; config.settings.lastCategoryId = 'tools';
    const names = ['截图','录屏','快捷文字识别','翻译','文字识别','计算稿纸','滚动截图','提醒助手','万年历','钉住剪贴板图片','二维码','应用统计','动态壁纸','内存清理','系统优化','待办事项','输入提示','查找鼠标'];
    const icons = ['Image','Video','FileText','Globe','FilePenLine','Keyboard','Copy','Info','LayoutGrid','Pin','LayoutGrid','SlidersHorizontal','Image','Box','SlidersHorizontal','Check','Keyboard','Search'];
    const colors = ['#ff8c00','#f10a24','#40a3f4','#0084d9','#00bae0','#9029ea'];
    config.entries.push(...names.map((name,i)=>({id:'style-'+i,categoryId:'tools',name,type:'url',target:'https://example.com',icon:icons[i],color:colors[i%colors.length]})));
    for (const category of config.categories.filter(c=>!['folders','tools'].includes(c.id))) config.entries.push({id:'sample-'+category.id,categoryId:category.id,name:category.name+'示例',type:'url',target:'https://example.com',icon:category.icon,color:category.color});
    config.categories.push({id:'style-empty',name:'空分类',icon:'Folder',color:'#087fe7'});
    await evaluate(`window.dock.call('save',${JSON.stringify(config)})`);
    await evaluate('window.dock.call("expand")'); await evaluate('window.dock.call("pin")');
    await expect.poll(()=>read('document.querySelectorAll(".launch-card").length')).toBe(18);
    await expect.poll(async()=>{const r=await layout();return Math.abs(r.tray.x+r.tray.width/2-r.selected.x-r.selected.width/2)}).toBeLessThan(2);
    evidence.reference = await layout();
    assert.ok(evidence.reference.bar.width > evidence.reference.tray.width * 1.5);
    assert.equal(evidence.reference.background,'rgba(0, 0, 0, 0)');
    assert.equal(evidence.reference.selectedColor,'rgb(255, 255, 255)');
    assert.equal(evidence.reference.cards[0].y,evidence.reference.cards[2].y);
    assert.ok(evidence.reference.cards[3].y>evidence.reference.cards[0].y);
    assert.equal(await read('document.querySelectorAll(".dock-category").length'),7);
    await screenshot('dock-style-reference.png','panel',true);
    check('reference layout: wide category bar, 3-column separate tray, white selected icons and transparent surroundings');

    const handle=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=panel')).getNativeWindowHandle().readBigUInt64LE().toString());
    const probe=native.probe(handle), scale=probe.dpi/96;
    const r=evidence.reference;
    const blank={x:Math.round((r.width-25)*scale),y:Math.round((r.height-25)*scale)};
    const card={x:Math.round((r.tray.x+r.tray.width/2)*scale),y:Math.round((r.tray.y+30)*scale)};
    evidence.blank=native.probe(handle,undefined,blank); evidence.card=native.probe(handle,undefined,card);
    assert.equal(evidence.blank.contains,false); assert.equal(evidence.card.contains,true);
    assert.equal(probe.kind,3,'actual HWND region is the union of bar and tray');
    await assert.rejects(evaluate('window.dock.call("panel-layout",[{x:0,y:0,width:100,height:100}])','trigger'),/此窗口不支持/);
    check('native shaped region excludes transparent space and restricts layout updates to the panel');

    for(const id of ['folders','quick']) {
      await read(`document.querySelectorAll('.dock-category')[${id==='folders'?0:6}].dispatchEvent(new MouseEvent('mouseenter'))`);
      await expect.poll(()=>read('document.querySelector(".dock-category.selected").title')).toBe(id==='folders'?'文件夹':'快捷操作');
      await expect.poll(async()=>{const r=await layout();return Math.abs(r.tray.x+r.tray.width/2-r.selected.x-r.selected.width/2)}).toBeLessThan(2);
      const v=await layout(); assert.ok(v.tray.x>=0&&v.tray.x+v.tray.width<=v.width);
    }
    assert.equal(await read('[...document.querySelectorAll(".dock-category")].some(e=>e.title==="空分类")'),false);
    assert.equal((await evaluate('window.dock.call("snapshot")')).config.categories.length,8);
    assert.equal(await read('document.querySelectorAll(".dock-tools .icon-button").length'),0);
    assert.equal(await read('document.querySelectorAll(".dock-search input").length'),0);
    await evaluate('document.querySelectorAll(".settings-tabs button")[1].click()');
    await evaluate('(()=>{const s=document.querySelector("input[aria-label=显示搜索框]");s.checked=true;s.dispatchEvent(new Event("change",{bubbles:true}))})()');
    await expect.poll(()=>read('Boolean(document.querySelector(".dock-search input"))')).toBe(true);
    await read('const q=document.querySelector(".dock-search input");q.value="截图";q.dispatchEvent(new Event("input",{bubbles:true}))');
    await expect.poll(()=>read('document.querySelectorAll(".launch-card").length')).toBe(2);
    await screenshot('dock-style-search.png','panel',true);
    await read('document.querySelector(".dock-panel").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    await evaluate('(()=>{const s=document.querySelector("input[aria-label=显示搜索框]");s.checked=false;s.dispatchEvent(new Event("change",{bubbles:true}))})()');
    await expect.poll(()=>read('document.querySelectorAll(".dock-search input").length')).toBe(0);
    check('empty categories remain hidden; toolbar buttons removed; settings enable and disable search, off by default');

    config.settings.theme='dark'; await evaluate(`window.dock.call('save',${JSON.stringify(config)})`);
    await expect.poll(()=>read('document.documentElement.dataset.theme')).toBe('dark');
    await expect.poll(()=>read('document.querySelectorAll(".launch-card").length')).toBe(18);
    await screenshot('dock-style-dark.png','panel',true);

    const original = await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=panel')).getBounds());
    try {
      await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=panel'));w.setResizable(true);w.setSize(620,480)});
      await expect.poll(()=>read('innerWidth')).toBeLessThan(625);
      await read('document.querySelector(".dock-category:last-child").click()');
      await expect.poll(()=>read('document.querySelector(".dock-category.selected").title')).toBe('快捷操作');
      await expect.poll(async()=>{const r=await layout();return r.tray.x>=0&&r.tray.x+r.tray.width<=r.width}).toBe(true);
      await screenshot('dock-style-narrow.png','panel',true);
      check('dark mode and a 620-DIP narrow viewport keep the dropdown within the window');
    } finally {
      await app.evaluate(({BrowserWindow},bounds)=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=panel'));w.setBounds(bounds);w.setResizable(false)},original);
    }
    // The navbar pin is a direct toggle; leaving hides cards while retaining the bar.
    await read('document.querySelector(".dock-menu-toggle").click()');
    await expect.poll(()=>read('window.dock.call("snapshot").then(s=>s.pinned)')).toBe(false);
    await read('document.querySelector(".dock-menu-toggle").click()');
    await app.evaluate(({screen})=>{screen.getCursorScreenPoint=()=>({x:-100000,y:-100000})});
    await expect.poll(()=>read('window.dock.call("snapshot").then(s=>s.trayVisible)'),{timeout:4000}).toBe(false);
    assert.equal((await read('window.dock.call("snapshot")')).expanded,true);
    assert.equal(await read('getComputedStyle(document.querySelector(".dock-tray")).display'),'none');
    await read('document.querySelector(".dock-bar").dispatchEvent(new MouseEvent("mouseenter"))');
    await expect.poll(()=>read('window.dock.call("snapshot").then(s=>s.trayVisible)')).toBe(true);
    await read('document.querySelector(".dock-menu-toggle").click()');
    await expect.poll(()=>read('window.dock.call("snapshot").then(s=>s.expanded)'),{timeout:4000}).toBe(false);
    await app.evaluate(({screen,BrowserWindow})=>{screen.getCursorScreenPoint=()=>{const b=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=panel')).getBounds();return {x:b.x+b.width/2,y:b.y+20}}});
    await evaluate('window.dock.call("expand")');
    check('navbar button directly pins/unpins; pinned bar survives pointer leave while cards hide and reopen on hover');
    // Removing the final entry in the selected category must select a populated fallback.
    const reduced=structuredClone(config); reduced.entries=reduced.entries.filter(e=>e.categoryId!=='tools');
    await evaluate(`window.dock.call('save',${JSON.stringify(reduced)})`);
    await expect.poll(()=>read('document.querySelector(".dock-category.selected")?.title')).toBe('文件夹');
    assert.equal(await read('document.querySelectorAll(".dock-category").length'),6);
    reduced.entries=[]; await evaluate(`window.dock.call('save',${JSON.stringify(reduced)})`);
    await expect.poll(()=>read('document.querySelectorAll(".dock-category").length')).toBe(0);
    assert.ok(await read('document.querySelector(".dock-empty")?.textContent.includes("添加入口")'));
    check('removing the selected category contents falls back to populated categories; all-empty state keeps settings accessible');
  } finally {
    await evaluate(`window.dock.call('save',${JSON.stringify(before)})`); await evaluate('window.dock.call("collapse")');
    await evaluate('document.querySelectorAll(".settings-tabs button")[0].click()');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>/surface=(panel|trigger)/.test(w.webContents.getURL())).forEach(w=>w.setIgnoreMouseEvents(false)));
    writeFileSync('artifacts/style-result.json',JSON.stringify(evidence,null,2));
  }
}

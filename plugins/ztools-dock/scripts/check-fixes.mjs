import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';

/** Check actual Windows z-order, rendered swatch geometry and category deletion in the installed ZIP. */
export async function checkFixes({ app, evaluate, screenshot, native, triggerHandle, check }) {
  const result = { checks: [], failures: [] };
  async function attempt(name, fn) {
    try { await fn(); result.checks.push(name); check(name); }
    catch(error) { result.failures.push({ name, error: String(error) }); }
  }
  await attempt('topmost recovery above another topmost window without stealing foreground focus', async () => {
    const cover = await app.evaluate(async ({ BrowserWindow, screen }) => {
      const area = screen.getPrimaryDisplay().bounds;
      globalThis.dockCover = new BrowserWindow({ ...area, frame:false, show:false, focusable:false, skipTaskbar:true, backgroundColor:'#b12735' });
      await Promise.race([globalThis.dockCover.loadURL('data:text/html,<body>Dock controlled occluder</body>'),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Controlled occluder failed to load')),15000))]);
      globalThis.dockCover.setAlwaysOnTop(true, 'screen-saver'); globalThis.dockCover.showInactive(); globalThis.dockCover.moveTop();
      return globalThis.dockCover.getNativeWindowHandle().readBigUInt64LE().toString();
    });
    try {
      result.windowHandles = await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().map(w=>({title:w.getTitle(),handle:w.getNativeWindowHandle().readBigUInt64LE().toString(),url:w.webContents.getURL().includes('surface=')?w.webContents.getURL().split('surface=')[1]:''})));
      let stable=false;
      for(let attempt=0;attempt<3;attempt++) {
        const before = native.probe(triggerHandle, cover); result.zOrderBefore = before;
        await expect.poll(() => native.probe(triggerHandle, cover).otherAbove, {timeout:4000,intervals:[100,200,300]}).toBe(false);
        const after = native.probe(triggerHandle, cover); result.zOrderAfter = after;
        if(after.foreground===before.foreground){stable=true;break;}
        // Shared desktop input can change external focus. Never retry a focus transfer to a test-owned window.
        assert.ok(!result.windowHandles.some(w=>w.handle===after.foreground),'dock maintenance transferred focus to an owned window');
      }
      assert.ok(stable,'foreground changed externally during all three measurements');
      await evaluate('window.dock.call("expand")'); await evaluate('window.dock.call("pin")');
      const panelHandle = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=panel')).getNativeWindowHandle().readBigUInt64LE().toString());
      await app.evaluate(() => { globalThis.dockCover.setAlwaysOnTop(true,'screen-saver'); globalThis.dockCover.moveTop(); });
      await expect.poll(() => native.probe(panelHandle, cover).otherAbove, {timeout:4000,intervals:[100,200,300]}).toBe(false);
      result.panelOrder = native.probe(panelHandle, cover);
      await evaluate('window.dock.call("collapse")');
      // Test recovery from the flag itself being unset, not only a competing topmost peer.
      await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=trigger')).setAlwaysOnTop(false));
      await expect.poll(() => app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=trigger')).isAlwaysOnTop()), {timeout:4000}).toBe(true);
    } finally { await app.evaluate(() => { globalThis.dockCover.destroy(); delete globalThis.dockCover; }); }
  });
  await attempt('entry and category color swatches remain square at normal and narrow widths', async () => {
    const original = await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=settings')).getBounds());
    result.swatches = [];
    try {
      for(const width of [920,560]) {
        await app.evaluate(({BrowserWindow},width) => BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=settings')).setSize(width,720), width);
        for(const selector of ['.content-heading .primary','button[title="编辑分类"]']) {
          await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
          await expect.poll(() => evaluate('document.querySelectorAll(".color-choice").length')).toBe(8);
          const layout = await evaluate('({swatches:[...document.querySelectorAll(".color-choice")].map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),custom:document.querySelector(".color-picker input").getBoundingClientRect().width,overflow:document.querySelector(".color-picker").scrollWidth>document.querySelector(".color-picker").clientWidth})');
          result.swatches.push({width,selector,...layout});
          if(width===920&&selector.includes('primary')) await screenshot('entry-editor-colors.png');
          if(width===560&&selector.includes('primary')) await screenshot('entry-editor-colors-narrow.png');
          await evaluate('document.querySelector("button[title=关闭编辑]").click()');
          for(const s of layout.swatches) { assert.ok(Math.abs(s.width-s.height)<1, JSON.stringify(s)); assert.ok(s.width>=24); }
          assert.ok(layout.custom<=40); assert.equal(layout.overflow,false);
        }
      }
    } finally { await evaluate('document.querySelector("button[title=关闭编辑]")?.click()'); await app.evaluate(({BrowserWindow},bounds) => BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=settings')).setBounds(bounds), original); }
  });
  await attempt('visible category delete supports cancel, confirmed deletion and final-category protection', async () => {
    const before = (await evaluate('window.dock.call("snapshot")')).config;
    try {
      const changed = structuredClone(before);
      changed.categories.push({id:'delete-fixture', name:'待删除分类',icon:'Folder',color:'#087fe7'});
      changed.entries.push({...changed.entries[0],id:'delete-entry',categoryId:'delete-fixture',name:'临时入口'});
      changed.settings.lastCategoryId = 'delete-fixture';
      await evaluate(`window.dock.call('save',${JSON.stringify(changed)})`);
      await expect.poll(() => evaluate('document.querySelectorAll(".category-row").length')).toBe(changed.categories.length);
      await evaluate('[...document.querySelectorAll(".category-row")].find(e=>e.textContent.includes("待删除分类")).click()');
      assert.equal(await evaluate('document.querySelector(".category-delete")?.textContent.trim()'), '删除分类');
      await evaluate('document.querySelector(".category-delete").click()');
      await expect.poll(() => evaluate('document.querySelector(".confirm-modal")?.textContent||""')).toContain('1 个快捷入口');
      await evaluate('document.querySelector(".confirm-modal .button:not(.primary)").click()');
      assert.deepEqual((await evaluate('window.dock.call("snapshot")')).config, changed);
      await evaluate('document.querySelector(".category-delete").click()');
      await expect.poll(() => evaluate('Boolean(document.querySelector(".confirm-modal"))')).toBe(true);
      await evaluate('document.querySelector(".confirm-modal .primary").click()');
      await expect.poll(() => evaluate('window.dock.call("snapshot").then(s=>s.config.categories.some(c=>c.id==="delete-fixture"))')).toBe(false);
      const saved = (await evaluate('window.dock.call("snapshot")')).config;
      assert.equal(saved.entries.some(e=>e.categoryId==='delete-fixture'),false);
      assert.ok(saved.categories.some(c=>c.id===saved.settings.lastCategoryId));
      saved.categories=[saved.categories[0]]; saved.entries=saved.entries.filter(e=>e.categoryId===saved.categories[0].id); saved.settings.lastCategoryId=saved.categories[0].id;
      await evaluate(`window.dock.call('save',${JSON.stringify(saved)})`);
      await expect.poll(() => evaluate('document.querySelector(".category-delete").disabled')).toBe(true);
    } finally { await evaluate('document.querySelector(".confirm-modal .button:not(.primary)")?.click()'); await evaluate(`window.dock.call('save',${JSON.stringify(before)})`); }
  });
  writeFileSync('artifacts/fixes-result.json',JSON.stringify(result,null,2));
  assert.equal(result.failures.length,0,JSON.stringify(result.failures,null,2));
}

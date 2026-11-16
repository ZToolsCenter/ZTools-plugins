import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';

export async function checkPluginSelection({app,evaluate,screenshot,temp,check}) {
  const before=(await evaluate('window.dock.call("snapshot")')).config;
  const page=app.windows().find(w=>w.url().includes('surface=settings'));
  const fixture=join(temp,'selector-fixture.zip');
  writeFileSync(fixture,zipSync({
    'plugin.json':strToU8(JSON.stringify({name:'dock-select-fixture',title:'图标验收工具',version:'1.0.0',main:'index.html',logo:'logo.svg',features:[{code:'first',cmds:['打开工具','工具设置',{type:'over',label:'需要文本'}]}]})),
    'index.html':strToU8('<html><body>图标验收工具</body></html>'),
    'logo.svg':strToU8('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#e64960"/></svg>')
  }));
  await app.evaluate(async({ipcMain,BrowserWindow},zip)=>ipcMain._invokeHandlers.get('install-plugin-from-path')({sender:BrowserWindow.getAllWindows().find(w=>w.getTitle()==='ZTools').webContents},zip),fixture);
  try {
    await page.getByRole('button',{name:'添加入口',exact:true}).first().click();
    await page.locator('.field-pair select').first().selectOption('plugin');
    await expect(page.getByRole('button',{name:'授权读取',exact:true})).toBeVisible();
    assert.deepEqual(await evaluate('window.dock.call("plugin-catalog")'),{authorized:false,plugins:[]});
    await assert.rejects(evaluate('window.dock.call("plugin-catalog")','panel'),/此窗口不支持/);
    await page.getByRole('button',{name:'授权读取',exact:true}).click();
    await expect.poll(()=>evaluate('window.ztools.getInternalApiPermissions().then(s=>s.pending.includes("internal:get-plugins"))','host')).toBe(true);
    const approval=await app.evaluate(async({ipcMain,BrowserWindow})=>ipcMain._invokeHandlers.get('internal:resolve-internal-api-request')({sender:BrowserWindow.getAllWindows().find(w=>w.getTitle()==='ZTools').webContents},'ztools-dock',['internal:get-plugins','internal:get-disabled-plugins']));
    assert.equal(approval.success,true);
    await page.getByRole('button',{name:'刷新列表',exact:true}).click();
    await expect(page.locator('#dock-plugin-select')).toBeEnabled();
    check('plugin list respects host permission, narrow request approved through isolated host management handler; panel denied');
    await page.locator('#dock-plugin-select').selectOption('dock-launch-fixture');
    await page.locator('.field-pair select').first().selectOption('url');
    await page.locator('.field-pair select').first().selectOption('plugin');
    await expect(page.locator('#dock-plugin-select')).toHaveValue('');
    await expect(page.locator('#dock-plugin-select')).toBeEnabled();
    await page.locator('.editor-modal input').first().fill('');
    await page.locator('#dock-plugin-select').selectOption('dock-select-fixture');
    const commands=page.getByLabel('插件指令',{exact:true});
    await expect(commands).toHaveValue('打开工具');
    assert.deepEqual(await commands.locator('option').allTextContents(),['选择插件指令','打开工具','工具设置']);
    try { await expect(page.locator('.custom-icon-preview img')).toBeVisible(); }
    catch(e) { console.log('icon diagnostic',await page.locator('.toast').allTextContents(),await evaluate('window.dock.call("plugin-icon","dock-select-fixture").then(x=>({length:x?.length,prefix:x?.slice(0,45)})).catch(e=>({error:e.stack}))','host'));throw e; }
    const svgIcon=await page.locator('.custom-icon-preview img').getAttribute('src');
    assert.match(svgIcon,/^data:image\/png;base64,/);
    await commands.selectOption('工具设置');
    assert.equal(await page.locator('.editor-modal input').first().inputValue(),'工具设置');
    await expect(page.locator('.toast')).toHaveCount(0,{timeout:9000});
    await screenshot('plugin-selector.png');
    await page.locator('.editor-modal button[type=submit]').click();
    await expect(page.locator('.editor-modal')).toHaveCount(0);
    const saved=(await evaluate('window.dock.call("snapshot")')).config.entries.at(-1);
    assert.equal(saved.plugin,'图标验收工具');assert.equal(saved.target,'工具设置');assert.equal(saved.image,svgIcon);
    check('real installed plugin and text commands selectable; SVG plugin logo converted to PNG and persisted with selected command');
    await page.getByTitle('编辑工具设置',{exact:true}).click();
    await expect(page.locator('#dock-plugin-select')).toHaveValue('dock-select-fixture');
    assert.equal(await page.locator('.custom-icon-preview img').getAttribute('src'),svgIcon);
    await page.locator('#dock-plugin-select').selectOption('dock-launch-fixture');
    await expect(commands).toHaveValue('验证跳转');
    await expect(page.locator('.custom-icon-preview img')).toBeVisible();
    assert.notEqual(await page.locator('.custom-icon-preview img').getAttribute('src'),svgIcon);
    assert.equal(await commands.locator('option').count(),2);
    await page.getByTitle('关闭编辑',{exact:true}).click();
    assert.equal((await evaluate('window.dock.call("snapshot")')).config.entries.at(-1).image,svgIcon);
    check('editing preserves saved icon; switching plugin replaces commands and icon; cancelling preserves saved entry');
    const legacy={...saved,id:'legacy-plugin',name:'旧插件入口',plugin:'已卸载的旧插件',target:'旧指令'};
    await evaluate(`(async()=>{const s=await window.dock.call('snapshot');s.config.entries.push(${JSON.stringify(legacy)});await window.dock.call('save',s.config)})()`);
    await page.getByTitle('编辑旧插件入口',{exact:true}).click();
    await expect(page.locator('#dock-plugin-select')).toHaveValue('__legacy');
    await page.locator('.editor-modal input').first().fill('旧插件重命名');
    await page.locator('.editor-modal button[type=submit]').click();
    await expect(page.locator('.editor-modal')).toHaveCount(0);
    const old=(await evaluate('window.dock.call("snapshot")')).config.entries.at(-1);
    assert.equal(old.plugin,legacy.plugin);assert.equal(old.target,legacy.target);assert.equal(old.image,svgIcon);
    check('unavailable legacy plugin remains editable without losing command or saved icon');
  } finally {
    if (await page.getByTitle('关闭编辑',{exact:true}).count()) await page.getByTitle('关闭编辑',{exact:true}).click();
    await evaluate(`window.dock.call('save',${JSON.stringify(before)})`);
  }
}

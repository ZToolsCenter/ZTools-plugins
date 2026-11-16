import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import {checkDropdowns} from './check-dropdowns.mjs';

export async function checkPluginSelection({app,evaluate,screenshot,temp,check}) {
  const before=(await evaluate('window.dock.call("snapshot")')).config;
  // The isolated Electron runtime has no bundled settings folder of its own.
  // Install the unchanged official settings UI from the tested host resources.
  const settingPresent=await app.evaluate(async({ipcMain,BrowserWindow})=>(await ipcMain._invokeHandlers.get('get-all-plugins')({sender:BrowserWindow.getAllWindows()[0].webContents})).some(p=>p.name==='setting'));
  if(!settingPresent){
    const folder=join(dirname(process.env.ZTOOLS_APP),'app.asar.unpacked/internal-plugins/setting'),files={};
    function collect(dir,prefix=''){for(const e of readdirSync(dir,{withFileTypes:true})){if(e.isDirectory())collect(join(dir,e.name),prefix+e.name+'/');else files[prefix+e.name]=new Uint8Array(readFileSync(join(dir,e.name)));}}
    collect(folder);const manifest=JSON.parse(Buffer.from(files['plugin.json']).toString());delete manifest.development;files['plugin.json']=strToU8(JSON.stringify(manifest));
    const zip=join(temp,'official-host-settings.zip');writeFileSync(zip,zipSync(files));
    const result=await app.evaluate(async({ipcMain,BrowserWindow},zip)=>ipcMain._invokeHandlers.get('install-plugin-from-path')({sender:BrowserWindow.getAllWindows().find(w=>w.getTitle()==='ZTools').webContents},zip),zip);assert.equal(result.success,true);
  }

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
    const proceed=page.getByRole('button',{name:'继续授权',exact:true});
    await expect(proceed).toBeDisabled();
    const boxes=page.locator('.plugin-consent input[type=checkbox]');
    assert.equal(await boxes.count(),2);await expect(boxes.nth(0)).not.toBeChecked();await expect(boxes.nth(1)).not.toBeChecked();
    await boxes.nth(0).check();await expect(proceed).toBeDisabled();
    await boxes.nth(1).check();await expect(proceed).toBeEnabled();
    await boxes.nth(0).uncheck();await expect(proceed).toBeDisabled();await boxes.nth(0).check();
    assert.deepEqual(await evaluate('window.dock.call("plugin-catalog")'),{authorized:false,plugins:[]});
    await assert.rejects(evaluate('window.dock.call("plugin-catalog")','panel'),/此窗口不支持/);
    await proceed.click();
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
    const commands=page.locator('.rich-select').filter({has:page.getByRole('combobox',{name:'插件指令',exact:true})}).locator('select');
    await expect(commands).toHaveValue('打开工具');
    assert.deepEqual(await commands.locator('option').allTextContents(),['打开工具','工具设置']);
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
    assert.equal(await commands.locator('option').count(),1);
    await page.getByTitle('关闭编辑',{exact:true}).click();
    assert.equal((await evaluate('window.dock.call("snapshot")')).config.entries.at(-1).image,svgIcon);
    check('editing preserves saved icon; switching plugin replaces commands and icon; cancelling preserves saved entry');
    await checkDropdowns({app,evaluate,screenshot,check,page});
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
    await page.locator('.settings-tabs button').nth(2).click();
    await page.locator('.permission-settings-entry button').click();
    await expect(page.getByRole('dialog',{name:'插件授权',exact:true})).toBeVisible();
    await expect(page.locator('.permission-status strong').first()).toHaveText('宿主已授权');
    await page.getByRole('button',{name:'停止读取',exact:true}).click();
    await expect(page.locator('.permission-summary')).toHaveText('程序坞已停止读取');
    assert.equal((await evaluate('window.dock.call("plugin-catalog")')).authorized,false);
    await assert.rejects(evaluate('window.dock.call("plugin-icon","dock-select-fixture")'),/授权/);
    await expect(page.locator('.permission-status strong').first()).toHaveText('宿主已授权');
    await expect(page.locator('.permission-status').first()).toBeVisible();
    await expect(page.locator('.permission-status').nth(1)).toBeVisible();
    await screenshot('plugin-permissions.png');
    await page.getByRole('button',{name:'打开 ZTools 设置',exact:true}).click();
    await expect.poll(()=>app.evaluate(({webContents})=>webContents.getAllWebContents().some(w=>w.getURL().includes('/setting/index.html')))).toBe(true).catch(async e=>{console.log('host settings diagnostic',await app.evaluate(async({webContents,ipcMain,BrowserWindow})=>({urls:webContents.getAllWebContents().map(w=>w.getURL()),setting:(await ipcMain._invokeHandlers.get('get-all-plugins')({sender:BrowserWindow.getAllWindows()[0].webContents})).filter(p=>p.name==='setting').map(p=>({title:p.title,name:p.name}))})));throw e});
    const hostSettings=app.windows().find(w=>w.url().includes('/setting/index.html'));
    await hostSettings.getByText('高级权限',{exact:true}).click();
    await hostSettings.locator('[data-testid=permission-tab-granted]').click();
    const grant=hostSettings.locator('[data-testid="permission-grant-card"]').filter({hasText:'ztools-dock'});
    await grant.locator('.plugin-head').click();
    await grant.locator('[data-testid="grant-remove-all"]').click();
    await hostSettings.getByRole('button',{name:'移除',exact:true}).click();
    await expect.poll(()=>evaluate('window.dock.call("plugin-permissions").then(s=>s.permissions.every(p=>!p.granted))')).toBe(true);
    check('authorization manager reports host grants; local stop blocks list/icon reads; real host settings removal revokes both grants');
    await evaluate('window.dock.call("settings")','panel');
  } finally {
    await evaluate('document.querySelector("button[title=关闭授权管理]")?.click()').catch(()=>{});
    if (await page.getByTitle('关闭编辑',{exact:true}).count()) await page.getByTitle('关闭编辑',{exact:true}).click();
    await evaluate(`window.dock.call('save',${JSON.stringify(before)})`);
  }
}

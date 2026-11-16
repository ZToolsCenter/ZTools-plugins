import {expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
export async function checkDropdowns({app,evaluate,screenshot,check,page}) {
 const before=(await evaluate('window.dock.call("snapshot")')).config;
 const box=name=>page.getByRole('combobox',{name,exact:true});
 const list=name=>page.getByRole('listbox',{name:name+'选项',exact:true});
 const working=structuredClone(before);
 working.categories.push(...Array.from({length:20},(_,i)=>({id:'dropdown-category-'+i,name:'自定义分类'+i,icon:'Folder',color:'#087fe7',...(i===0?{image:before.entries.at(-1).image}:{})})));
 await evaluate(`window.dock.call('save',${JSON.stringify(working)})`);
 try {
  await page.getByTitle('编辑工具设置',{exact:true}).click();
  await box('所属分类').click();await expect(list('所属分类').getByRole('option',{name:'开发工具',exact:true}).locator('svg')).toBeVisible();
  const categoryBounds=await page.locator('.rich-select-popup').boundingBox();assert.ok(categoryBounds.height<=320.1);
  assert.ok(await list('所属分类').evaluate(el=>el.scrollHeight>el.clientHeight),'long category menu scrolls');
  await screenshot('category-dropdown.png');
  await list('所属分类').getByRole('option',{name:'开发工具',exact:true}).click();
  await expect(box('所属分类')).toHaveText('开发工具');await expect(box('所属分类').locator('svg').first()).toBeVisible();
  await box('所属分类').click();await page.getByLabel('搜索所属分类',{exact:true}).fill('自定义分类0');
  await expect(list('所属分类').getByRole('option',{name:'自定义分类0',exact:true}).locator('img')).toBeVisible();
  await list('所属分类').getByRole('option',{name:'自定义分类0',exact:true}).click();await expect(box('所属分类').locator('img')).toBeVisible();
  await box('类型').click();await expect(list('类型').getByRole('option',{name:'网址',exact:true}).locator('svg')).toBeVisible();
  await box('类型').press('Escape');assert.equal(await page.locator('.editor-modal').count(),1);
  await box('插件名称').scrollIntoViewIfNeeded();await box('插件名称').click();
  await expect(list('插件名称').getByRole('option',{name:'图标验收工具',exact:true}).locator('img')).toBeVisible();
  await expect(list('插件名称').getByRole('option',{name:'程序坞验收工具',exact:true}).locator('img')).toBeVisible();
  await expect(box('插件名称').locator('img')).toBeVisible();
  await screenshot('plugin-icon-dropdown.png');
  const rect=await page.locator('.rich-select-popup').boundingBox();assert.ok(rect.height<=320.1);assert.ok(rect.y>=0&&rect.y+rect.height<=await page.evaluate(()=>innerHeight));
  await page.getByLabel('搜索插件名称',{exact:true}).fill('图标');assert.equal(await list('插件名称').getByRole('option').count(),1);
  await page.getByLabel('搜索插件名称',{exact:true}).fill('不存在的插件');await expect(page.getByText('没有匹配项',{exact:true})).toBeVisible();
  await page.getByLabel('搜索插件名称',{exact:true}).press('Escape');
  await evaluate('window.originalIconCall=window.dock.call;window.iconReadCount=0;window.dock.call=(op,...args)=>{if(op==="plugin-icon")window.iconReadCount++;return window.originalIconCall(op,...args)};true');
  for(let i=0;i<3;i++){await box('插件名称').click();await expect(list('插件名称').getByRole('option').first()).toBeVisible();await page.getByLabel('搜索插件名称',{exact:true}).press('Escape');}
  const reads=await evaluate('window.iconReadCount');assert.equal(reads,0,'cached visible icons require no new preload reads during repeated opening');
  writeFileSync('artifacts/dropdown-performance.json',JSON.stringify({fixturePlugins:2,reopens:3,additionalIconReads:reads,thumbnailMaximum:64,concurrentLoads:3,cacheLimit:128},null,2));
  await box('插件名称').click();await list('插件名称').getByRole('option',{name:'程序坞验收工具',exact:true}).click();
  await expect(box('插件名称')).toHaveText('程序坞验收工具');await expect(box('插件名称').locator('img')).toBeVisible();
  await expect(box('插件指令')).toHaveText('验证跳转');
  await page.getByTitle('关闭编辑',{exact:true}).click();assert.deepEqual((await evaluate('window.dock.call("snapshot")')).config,working);
  check('custom type/category/plugin/command dropdowns show icons and bound search lists; three reopenings of two cached plugin icons cause zero additional icon reads; cancel preserves entry');
  await page.locator('.settings-tabs button').nth(1).click();await box('颜色模式').scrollIntoViewIfNeeded();await box('颜色模式').click();await list('颜色模式').getByRole('option',{name:'深色',exact:true}).click();
  await expect.poll(()=>evaluate('window.dock.call("snapshot").then(s=>s.config.settings.theme)')).toBe('dark');
  await box('每行最多列数').scrollIntoViewIfNeeded();await box('每行最多列数').click();await screenshot('dropdown-dark.png');await box('每行最多列数').press('Escape');
  await box('颜色模式').focus();await box('颜色模式').press('ArrowDown');await page.locator('.rich-select-popup').press('Home');await page.locator('.rich-select-popup').press('ArrowDown');await page.locator('.rich-select-popup').press('Enter');
  await expect.poll(()=>evaluate('window.dock.call("snapshot").then(s=>s.config.settings.theme)')).toBe('light');
  check('appearance selectors use matching popup style in dark mode; Home/Arrow/Enter choose and persist the expected value');
 } finally {
  await evaluate('if(window.originalIconCall){window.dock.call=window.originalIconCall;delete window.originalIconCall}document.querySelector("button[title=关闭编辑]")?.click()').catch(()=>{});
  await evaluate(`window.dock.call('save',${JSON.stringify(before)})`);await page.locator('.settings-tabs button').nth(0).click();
 }
}

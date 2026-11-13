import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import core from '../public/runtime/core.cjs';

export async function checkReset({evaluate,screenshot,check}) {
 const before=(await evaluate('window.dock.call("snapshot")')).config;
 const custom=structuredClone(before);
 custom.categories.push({id:'reset-preserved',name:'重置保留分类',icon:'Folder',color:'#123456'});
 custom.entries.reverse();custom.entries.push({id:'reset-entry',categoryId:'reset-preserved',name:'重置保留网址',type:'url',target:'https://example.com',icon:'Globe',color:'#123456'});
 Object.assign(custom.settings,{cardScale:125,pinEnabled:false,showCategoryNames:false,showEntryNames:false,lastCategoryId:'reset-preserved',accent:'#123456',theme:'dark',columns:6,cardSize:144,searchEnabled:true,openDelay:600,closeDelay:1300,triggerWidth:200,triggerHeight:12,triggerOpacity:0.4});
 try {
  await evaluate(`window.dock.call('save',${JSON.stringify(custom)})`);
  await evaluate('document.querySelectorAll(".settings-tabs button")[2].click()');
  assert.equal(await evaluate('[...document.querySelectorAll(".backup-page button")].some(b=>/重置|恢复默认/.test(b.textContent))'),false);
  await evaluate('document.querySelectorAll(".settings-tabs button")[1].click()');
  await expect.poll(()=>evaluate('[...document.querySelectorAll(".preferences button")].some(b=>b.textContent.includes("重置外观与行为"))')).toBe(true);
  const click='[...document.querySelectorAll(".preferences button")].find(b=>b.textContent.includes("重置外观与行为")).click()';
  await evaluate(click);
  await expect.poll(()=>evaluate('document.querySelector(".confirm-modal")?.textContent||""')).toContain('分类、快捷入口和启用状态会保留');
  await evaluate('document.querySelector(".confirm-modal .button:not(.primary)").click()');
  assert.deepEqual((await evaluate('window.dock.call("snapshot")')).config,custom);
  await evaluate(click);await expect.poll(()=>evaluate('Boolean(document.querySelector(".confirm-modal"))')).toBe(true);
  await evaluate('document.querySelector(".confirm-modal .primary").click()');
  await expect.poll(()=>evaluate('window.dock.call("snapshot").then(s=>s.config.settings.accent)')).toBe(core.defaults().settings.accent);
  const actual=(await evaluate('window.dock.call("snapshot")')).config;
  assert.deepEqual(actual.categories,custom.categories);assert.deepEqual(actual.entries,custom.entries);
  assert.deepEqual(actual.settings,{...core.defaults().settings,enabled:custom.settings.enabled,lastCategoryId:custom.settings.lastCategoryId});
  await evaluate('document.querySelector(".preferences").scrollTop=document.querySelector(".preferences").scrollHeight');
  await screenshot('appearance-reset.png');
  check('reset lives only in appearance tab; cancel preserves data; confirm resets appearance/behavior while preserving categories, entries/order and enabled state');
 }finally {
  await evaluate('document.querySelector(".confirm-modal .button:not(.primary)")?.click()');
  await evaluate(`window.dock.call('save',${JSON.stringify(before)})`);
  await evaluate('document.querySelectorAll(".settings-tabs button")[0].click()');
 }
}

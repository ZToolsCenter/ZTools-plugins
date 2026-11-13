const {test}=require('node:test');const assert=require('node:assert/strict');
const {defaults,validateConfig}=require('../public/runtime/core.cjs');
test('名称开关独立保存，旧配置默认显示名称，非法类型不接受',()=>{
 const c=defaults();delete c.settings.showCategoryNames;delete c.settings.showEntryNames;
 const migrated=validateConfig(c);assert.equal(migrated.settings.showCategoryNames,true);assert.equal(migrated.settings.showEntryNames,true);
 for(const category of [false,true])for(const entry of [false,true]){
  const next=structuredClone(migrated);next.settings.showCategoryNames=category;next.settings.showEntryNames=entry;
  assert.deepEqual(validateConfig(JSON.parse(JSON.stringify(next))),next);
 }
 for(const key of ['showCategoryNames','showEntryNames'])for(const value of [null,0,1,'false']){
  const next=structuredClone(migrated);next.settings[key]=value;assert.throws(()=>validateConfig(next));
 }
});

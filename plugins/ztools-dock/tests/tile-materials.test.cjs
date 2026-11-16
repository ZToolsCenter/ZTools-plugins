const {test}=require('node:test');
const assert=require('node:assert/strict');
const {defaults,validateConfig}=require('../public/runtime/core.cjs');
test('旧配置迁移菜单卡片材质；六款材质和0～100强度往返，非法配置不能覆盖',()=>{
 const old=defaults();delete old.settings.tileMaterial;delete old.settings.tileStrength;
 assert.equal(validateConfig(old).settings.tileMaterial,'plain');assert.equal(validateConfig(old).settings.tileStrength,70);
 for(const tileMaterial of ['plain','ice','frosted','liquid','clear','iridescent'])for(const tileStrength of [0,40,100]){
  const c=defaults();Object.assign(c.settings,{tileMaterial,tileStrength});assert.deepEqual(validateConfig(c),c);
 }
 for(const patch of [{tileMaterial:'fake'},{tileMaterial:null},{tileStrength:-1},{tileStrength:101},{tileStrength:NaN},{tileStrength:1.5},{tileStrength:'70'}]){
  const c=defaults();Object.assign(c.settings,patch);assert.throws(()=>validateConfig(c),/材质/);
 }
});

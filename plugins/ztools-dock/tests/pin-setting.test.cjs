const {test}=require('node:test');const assert=require('node:assert/strict');
const {defaults,validateConfig}=require('../public/runtime/core.cjs');
test('钉住开关默认开启，旧配置迁移，关闭持久化且非法值拒绝',()=>{
 const c=defaults();assert.equal(c.settings.pinEnabled,true);delete c.settings.pinEnabled;assert.equal(validateConfig(c).settings.pinEnabled,true);
 c.settings.pinEnabled=false;assert.equal(validateConfig(c).settings.pinEnabled,false);
 for(const v of [null,0,'false']){c.settings.pinEnabled=v;assert.throws(()=>validateConfig(c));}
});

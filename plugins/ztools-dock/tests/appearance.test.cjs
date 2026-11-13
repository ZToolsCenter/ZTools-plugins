const {test}=require('node:test');
const assert=require('node:assert/strict');
const {defaults,validateConfig,geometry}=require('../public/runtime/core.cjs');
test('旧配置补齐外观默认值；新配置保真，拒绝非法主题尺寸材质与透明度',()=>{
 const c=defaults();for(const k of ['triggerTheme','iconSize','material','panelOpacity'])delete c.settings[k];
 const migrated=validateConfig(c);
 assert.deepEqual([migrated.settings.triggerTheme,migrated.settings.iconSize,migrated.settings.material,migrated.settings.panelOpacity],['bar','medium','solid',1]);
 Object.assign(migrated.settings,{triggerTheme:'snail',iconSize:'large',material:'acrylic',panelOpacity:0.4});
 assert.deepEqual(validateConfig(migrated),migrated);
 for(const [key,value] of [['triggerTheme','bad'],['iconSize','huge'],['material','bad'],['panelOpacity',NaN],['panelOpacity',0.05],['panelOpacity',1.1]]){
  const invalid=structuredClone(migrated);invalid.settings[key]=value;assert.throws(()=>validateConfig(invalid));
 }
 assert.deepEqual(migrated.entries,c.entries);
});
test('虫仔蜗牛触发窗口提供完整 32px 绘制命中区域，切回细条保持原高度',()=>{
 const display={id:1,workArea:{x:-1200,y:0,width:1200,height:800}},s=defaults().settings;
 s.triggerWidth=24; s.triggerHeight=5;
 for(const theme of ['worm','snail']){
  s.triggerTheme=theme;const g=geometry(s,[display],display,2);
  assert.equal(g.trigger.height,32);assert.ok(g.trigger.width>=64);assert.equal(g.panel.y,32);
 }
 s.triggerTheme='bar';const g=geometry(s,[display],display,2);assert.equal(g.trigger.height,5);assert.equal(g.trigger.width,24);assert.equal(g.panel.y,5);
});

const {test}=require('node:test');const assert=require('node:assert/strict');
const {defaults,validateConfig,geometry}=require('../public/runtime/core.cjs');
test('卡片缩放默认为100%，旧配置保留基准高度和图标；50～150整数保真，越界拒绝',()=>{
 const c=defaults();assert.equal(c.settings.cardScale,100);delete c.settings.cardScale;c.settings.cardSize=120;c.settings.iconSize='small';
 const old=validateConfig(c);assert.equal(old.settings.cardScale,100);assert.equal(old.settings.cardSize,120);assert.equal(old.settings.iconSize,'small');
 for(const scale of [50,75,100,150]){c.settings.cardScale=scale;assert.equal(validateConfig(c).settings.cardScale,scale)}
 for(const scale of [49,151,null,NaN,50.5]){c.settings.cardScale=scale;assert.throws(()=>validateConfig(c))}
});
test('原生主画布为缩放后的卡片预留空间，四向缩放不越工作区',()=>{
 const d={id:1,workArea:{x:0,y:0,width:1920,height:1040}},s=defaults().settings;
 for(const edge of ['top','bottom','left','right']){
  s.dockEdge=edge;s.cardScale=50;const small=geometry(s,[d],d).panel;s.cardScale=150;const large=geometry(s,[d],d).panel;assert.ok(large.width>small.width);
  for(const r of [small,large]){assert.ok(Number.isInteger(r.width));assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=1920&&r.y+r.height<=1040)}
 }
});

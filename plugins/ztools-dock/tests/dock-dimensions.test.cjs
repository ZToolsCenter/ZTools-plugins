const {test}=require('node:test');
const assert=require('node:assert/strict');
const {defaults,validateConfig,geometry}=require('../public/runtime/core.cjs');
test('四项尺寸旧配置自动迁移，边界可保存，非法尺寸不能覆盖配置',()=>{
 const c=defaults(),keys=['dockWidth','dockHeight','popupWidth','popupHeight'];
 for(const k of keys)delete c.settings[k];
 const next=validateConfig(c);for(const k of keys)assert.equal(next.settings[k],0);
 for(const [key,min,max] of [['dockWidth',80,2000],['dockHeight',40,1200],['popupWidth',160,2000],['popupHeight',100,1200]]){
  for(const value of [0,min,max]){const v=structuredClone(next);v.settings[key]=value;assert.equal(validateConfig(v).settings[key],value);}
  for(const value of [-1,1.5,min-1,max+1,null,NaN]){const v=structuredClone(next);v.settings[key]=value;assert.throws(()=>validateConfig(v));}
 }
});
test('最大导航条与弹窗尺寸在四边都限制在显示屏工作区内',()=>{
 const d={id:1,workArea:{x:-1600,y:-100,width:1600,height:900}},s=defaults().settings;
 Object.assign(s,{dockWidth:2000,dockHeight:1200,popupWidth:2000,popupHeight:1200});
 for(const edge of ['top','bottom','left','right']){s.dockEdge=edge;const p=geometry(s,[d],d,2).panel;assert.ok(p.x>=-1600&&p.y>=-100&&p.x+p.width<=0&&p.y+p.height<=800);}
});

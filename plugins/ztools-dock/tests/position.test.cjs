const {test}=require('node:test');const assert=require('node:assert/strict');
const {defaults,validateConfig,geometry}=require('../public/runtime/core.cjs');
const display={id:2,workArea:{x:-1280,y:-80,width:1280,height:800}};
test('旧配置默认顶部居中；位置参数往返并拒绝非法值',()=>{
 const old=defaults();for(const k of ['dockEdge','positionMode','positionRatio','positionDistance','positionAnchor'])delete old.settings[k];
 const c=validateConfig(old);assert.deepEqual([c.settings.dockEdge,c.settings.positionMode,c.settings.positionRatio,c.settings.positionDistance,c.settings.positionAnchor],['top','ratio',50,0,'start']);
 Object.assign(c.settings,{dockEdge:'right',positionMode:'distance',positionDistance:123,positionAnchor:'end',positionRatio:25.5});assert.deepEqual(validateConfig(c),c);
 for(const [key,v] of [['dockEdge','bad'],['positionMode','bad'],['positionAnchor','bad'],['positionDistance',-1],['positionDistance',20001],['positionDistance',1.5],['positionRatio',NaN],['positionRatio',101]]){const bad=structuredClone(c);bad.settings[key]=v;assert.throws(()=>validateConfig(bad));}
});
test('四个停靠边沿各自方向定位，面板向内展开且不越工作区',()=>{
 for(const dockEdge of ['top','bottom','left','right']){
  const s={...defaults().settings,dockEdge,displayId:'2'};const g=geometry(s,[display],display,7),a=display.workArea,t=g.trigger,p=g.panel;
  assert.ok(t.x>=a.x&&t.y>=a.y&&t.x+t.width<=a.x+a.width&&t.y+t.height<=a.y+a.height);
  assert.ok(p.x>=a.x&&p.y>=a.y&&p.x+p.width<=a.x+a.width&&p.y+p.height<=a.y+a.height);
  const w=g.triggerWindow;assert.ok(w&&w.width>=128&&w.height>=64,'native backing must avoid OS minimum dimensions');
  assert.ok(w.x>=a.x&&w.y>=a.y&&w.x+w.width<=a.x+a.width&&w.y+w.height<=a.y+a.height);
  assert.ok(t.x>=w.x&&t.y>=w.y&&t.x+t.width<=w.x+w.width&&t.y+t.height<=w.y+w.height);
  if(dockEdge==='top')assert.equal(p.y,t.y+t.height);
  if(dockEdge==='bottom')assert.equal(p.y+p.height,t.y);
  if(dockEdge==='left'){assert.equal(t.width,5);assert.equal(t.height,80);assert.equal(p.x,t.x+t.width);}
  if(dockEdge==='right'){assert.equal(t.width,5);assert.equal(p.x+p.width,t.x);}
 }
});
test('距离参考两端，比例行程0/50/100，与屏幕尺寸和主题一致',()=>{
 const s={...defaults().settings,displayId:'2',positionMode:'distance',positionDistance:100,positionAnchor:'start'};
 assert.equal(geometry(s,[display],display).trigger.x,-1180);
 s.positionAnchor='end';assert.equal(geometry(s,[display],display).trigger.x,-180);
 s.dockEdge='left';assert.equal(geometry(s,[display],display).trigger.y,540);
 s.positionDistance=20000;assert.equal(geometry(s,[display],display).trigger.y,-80);
 s.positionMode='ratio';s.triggerTheme='snail';
 for(const ratio of [0,50,100]){s.positionRatio=ratio;const t=geometry(s,[display],display).trigger;assert.equal(t.y,-80+Math.round((800-80)*ratio/100));assert.equal(t.width,32);}
});

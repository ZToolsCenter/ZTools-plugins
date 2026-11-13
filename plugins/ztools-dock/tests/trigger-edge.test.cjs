const {test}=require('node:test');const assert=require('node:assert/strict');
const {defaults,validateConfig,geometry}=require('../public/runtime/core.cjs');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWQAAAAASUVORK5CYII=';
test('边缘距离默认零，PNG数据与负距可回读；非法PNG或距离拒绝',()=>{
 const old=defaults();delete old.settings.triggerImage;delete old.settings.triggerEdgeDistance;
 const c=validateConfig(old);assert.equal(c.settings.triggerImage,'');assert.equal(c.settings.triggerEdgeDistance,0);
 Object.assign(c.settings,{triggerTheme:'custom',triggerImage:png,triggerEdgeDistance:-8});assert.deepEqual(validateConfig(c),c);
 for(const change of [{triggerImage:''},{triggerImage:'data:image/png;base64,AAAA'},{triggerEdgeDistance:-401},{triggerEdgeDistance:Infinity},{triggerEdgeDistance:0.5}])assert.throws(()=>validateConfig({...c,settings:{...c.settings,...change}}));
});
test('四边底边距离一致，负距裁出边缘且最少保留1px，PNG保持比例',()=>{
 const d={id:1,workArea:{x:-100,y:40,width:1000,height:800}};
 for(const edge of ['top','bottom','left','right'])for(const distance of [-8,0,12]){
  const s={...defaults().settings,dockEdge:edge,triggerTheme:'snail',triggerEdgeDistance:distance};const g=geometry(s,[d],d),a=d.workArea;
  const t=g.triggerArt;assert.ok(t);
  if(edge==='top')assert.equal(t.y,a.y+distance);
  if(edge==='bottom')assert.equal(t.y+t.height,a.y+a.height-distance);
  if(edge==='left')assert.equal(t.x,a.x+distance);
  if(edge==='right')assert.equal(t.x+t.width,a.x+a.width-distance);
  assert.ok(g.trigger.x>=a.x&&g.trigger.y>=a.y&&g.trigger.x+g.trigger.width<=a.x+a.width&&g.trigger.y+g.trigger.height<=a.y+a.height);
 }
 const s={...defaults().settings,triggerTheme:'custom',triggerImage:png,triggerEdgeDistance:0};
 const g=geometry(s,[d],d);assert.equal(g.triggerArt.height,g.triggerArt.width);
 s.triggerEdgeDistance=-400;assert.equal(geometry(s,[d],d).trigger.height,1);
});

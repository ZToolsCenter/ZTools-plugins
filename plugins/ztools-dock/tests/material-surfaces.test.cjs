const {test}=require('node:test');const assert=require('node:assert/strict');
test('材质只存在于两个可见组件背景窗，复用布局、隐藏和销毁都正确',()=>{
 const {createMaterialSurfaces}=require('../public/runtime/material-surfaces.cjs');
 const wins=[],api={createBrowserWindow:(url,options)=>{const w={url,options,bounds:null,visible:false,dead:false,raised:0,ignore:false,isDestroyed(){return this.dead},setIgnoreMouseEvents(v){this.ignore=v},setBounds(r){this.bounds=r},showInactive(){this.visible=true},hide(){this.visible=false},moveTop(){this.raised++},setAlwaysOnTop(){},destroy(){this.dead=true}};wins.push(w);return w;}};
 const surfaces=createMaterialSurfaces(api);
 assert.equal(surfaces.setMaterial('mica',{}),true);assert.equal(wins.length,2);
 assert.ok(wins.every(w=>w.options.backgroundMaterial==='mica'&&w.options.transparent===false&&w.options.focusable===false&&w.ignore));
 const regions=[{x:100,y:0,width:200,height:66},{x:10,y:66,width:392,height:220}],panel={x:200,y:40};
 surfaces.layout(regions,panel,true,true);assert.deepEqual(wins[0].bounds,{x:300,y:40,width:200,height:66});assert.deepEqual(wins[1].bounds,{x:210,y:106,width:392,height:220});assert.ok(wins.every(w=>w.visible));
 assert.equal(surfaces.setMaterial('mica',{}),false);assert.equal(wins.length,2);
 surfaces.layout(regions,panel,true,false);assert.equal(wins[0].visible,true);assert.equal(wins[1].visible,false);
 surfaces.layout(regions,panel,false,false);assert.ok(wins.every(w=>!w.visible));
 surfaces.setMaterial('acrylic',{});assert.ok(wins.slice(0,2).every(w=>w.dead));assert.equal(wins.length,4);
 surfaces.dispose();assert.ok(wins.every(w=>w.dead));
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { windowsIconPath, normalizePlugins, pluginCatalog, pluginIcon, requestCatalog, PERMISSIONS, catalogPermissions, stopCatalog } = require('../public/runtime/plugin-catalog.cjs');
test('Windows logo URLs decode Chinese, spaces and UNC without accepting encoded separators', () => {
  assert.equal(windowsIconPath('file:///C:/插件/hello%20world.png'),'C:\\插件\\hello world.png');
  assert.equal(windowsIconPath('file://server/share/logo.png'),'\\\\server\\share\\logo.png');
  assert.throws(()=>windowsIconPath('file:///C:/logo%2Fother.png'),/无效/);
});
test('plugin choices preserve exact commands, exclude payload matchers and identify unavailable plugins', () => {
  const result = normalizePlugins([
    {name:'a',title:'A',path:'/a',features:[{cmds:['one','one',{type:'regex',label:'payload'},'two']}]},
    {name:'b',title:'B',path:'/b',features:[]}, {name:'c',title:'B',path:'/c'},
    {name:'d',title:'D',path:'/d'}, {name:'ztools-dock',title:'程序坞'}
  ], ['/d']);
  assert.deepEqual(result.find(p=>p.id==='a').commands,['one','two']);
  assert.equal(result.find(p=>p.id==='b').unavailable,'同名插件无法区分');
  assert.equal(result.find(p=>p.id==='d').unavailable,'已停用');
  assert.equal(result.length,4);
});
test('no list or icon read occurs before permission; requests only two read channels', async () => {
  let reads=0;
  let consent=true; const api={dbStorage:{getItem:()=>consent,setItem:(_k,v)=>{consent=v}},getInternalApiPermissions:async()=>({granted:[]}),internal:{getPlugins:async()=>{reads++;return[]},getDisabledPlugins:async()=>[]},requestInternalApiPermissions:async apis=>{assert.deepEqual(apis,PERMISSIONS);return{success:true,status:'pending'}}};
  assert.deepEqual(await pluginCatalog(api),{authorized:false,plugins:[]});
  await assert.rejects(pluginIcon(api,'a'),/授权/);
  assert.equal(await requestCatalog(api,PERMISSIONS),false);assert.equal(reads,0);
});
test('catalog uses granted host list and icon lookup cannot accept arbitrary renderer paths', async () => {
  const api={dbStorage:{getItem:()=>true},getInternalApiPermissions:async()=>({granted:PERMISSIONS}),internal:{getPlugins:async()=>[{name:'a',title:'A',logo:'data:image/png;base64,YQ==',features:[{cmds:['run']}]}],getDisabledPlugins:async()=>[]}};
  assert.equal((await pluginCatalog(api)).plugins[0].commands[0],'run');
  assert.equal(await pluginIcon(api,'a'),'data:image/png;base64,YQ==');
  await assert.rejects(pluginIcon(api,'C:\\private.png'),/卸载/);
});

test('two exact consents required; stopping blocks catalog and icons even while host grants remain',async()=>{
 let consent=false,reads=0,requests=0;const api={dbStorage:{getItem:()=>consent,setItem:(_k,v)=>{consent=v}},getInternalApiPermissions:async()=>({granted:PERMISSIONS}),requestInternalApiPermissions:async()=>{requests++;return{success:true,status:'granted'}},internal:{getPlugins:async()=>{reads++;return[{name:'a',title:'A',logo:'data:image/png;base64,YQ=='}]},getDisabledPlugins:async()=>[]}};
 for(const accepted of [undefined,[],[PERMISSIONS[0]],[PERMISSIONS[1]],[PERMISSIONS[0],PERMISSIONS[0]]])await assert.rejects(requestCatalog(api,accepted),/勾选/);
 assert.equal(reads,0);assert.equal(consent,false);assert.equal(await requestCatalog(api,PERMISSIONS),true);assert.equal(requests,0);assert.equal((await pluginCatalog(api)).authorized,true);
 stopCatalog(api);assert.equal((await catalogPermissions(api)).reading,false);assert.ok((await catalogPermissions(api)).permissions.every(p=>p.granted));
 const before=reads;assert.equal((await pluginCatalog(api)).authorized,false);await assert.rejects(pluginIcon(api,'a'),/授权/);assert.equal(reads,before);
});

test('icon lookups reuse catalog descriptors instead of enumerating installed plugins per row',async()=>{
 let lists=0;const plugins=Array.from({length:12},(_,i)=>({name:'perf-'+i,title:'测试'+i,logo:'data:image/png;base64,YQ==',features:[{cmds:['run']}]}));
 const api={dbStorage:{getItem:()=>true},getInternalApiPermissions:async()=>({granted:PERMISSIONS}),internal:{getPlugins:async()=>{lists++;return plugins},getDisabledPlugins:async()=>[]}};
 await pluginCatalog(api);for(const p of plugins)assert.equal(await pluginIcon(api,p.name),p.logo);assert.equal(lists,1);
 stopCatalog({...api,dbStorage:{getItem:()=>false,setItem(){}}});
});

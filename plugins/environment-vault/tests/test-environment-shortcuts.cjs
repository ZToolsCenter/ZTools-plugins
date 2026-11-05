const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const root=path.resolve(process.env.VAULT_PACKAGE_ROOT||path.join(__dirname,'..'));
const sc=require(path.join(root,'shortcuts.cjs')),groups=require(path.join(root,'restore-groups.js'));
const {Vault,pack,unpack,contentHash}=require(path.join(root,'vault.cjs')),{DEFINITIONS,LISTS}=require(path.join(root,'settings.cjs'));
const {createDav}=require('./env-dav-fixture.cjs'),{createPermissionHost}=require('./beta2-permission-fixture.cjs'),{BACKUP,ALL}=require(path.join(root,'permissions.cjs'));
const source=fs.readFileSync(path.join(__dirname,'test-environment-vault.cjs'),'utf8');const createHost=new Function('return ('+source.slice(source.indexOf('function host('),source.indexOf('function engine('))+')')();
const base=fs.mkdtempSync(path.join(require('os').tmpdir(),'shortcut-tests-')),dav=createDav();let url;
function fixture(platform='darwin',gated=false){
 const h=createHost(platform),runtime={global:new Map(),app:new Map()},fault={};
 const raw=async(channel,...args)=>{const name=channel.replace('internal:','');
  if(name==='db-put'&&fault.disk===args[0]){fault.disk=null;h.calls.push([channel,...args]);return {ok:false};}
  const match=/^(register|unregister)-(global|app)-shortcut$/.exec(name);
  if(match){h.calls.push([channel,...args]);const [,action,kind]=match;if(action==='unregister')runtime[kind].delete(args[0]);else {runtime[kind].set(args[0],{shortcut:args[0],target:args[1],enabled:true});if(fault.register){fault.register=false;return {success:false,error:'模拟操作系统拒绝注册'};}}return {success:true};}
  return h.invoke(channel,...args);
 };
 const auth=gated?createPermissionHost({data:h.data,invoke:raw}):null;const v=new Vault({invoke:auth?auth.invoke:raw,dataDir:fs.mkdtempSync(path.join(base,'device-')),platform,device:platform});
 return {...h,v,auth,runtime,fault};
}
async function config(h){await h.v.saveConfig({url,username:'tester',password:'app-password',device:'test',interval:30,timed:false});}
function add(h){h.data['global-shortcuts']=[{id:'g1',shortcut:'Command+Shift+K',target:'Alpha/打开',enabled:true,autoCopy:true,preScreenshotOptimization:false}];h.data['app-shortcuts']=[{id:'a1',shortcut:'Command+J',target:'alpha/打开',enabled:true}];h.data['settings-general'].builtinAppShortcutsEnabled={search:false};}
const writes=h=>h.calls.filter(([n])=>/db-put|register-.*shortcut|update-shortcut|install-plugin/.test(n));
test.before(async()=>{await new Promise(r=>dav.server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${dav.server.address().port}/backup/`;});
test.after(async()=>{await new Promise(r=>dav.server.close(r));});
test('分类覆盖全部白名单，顺序对应原生设置页，快捷键单独分组',()=>{
 for(const id of [...Object.keys(DEFINITIONS).map(k=>'setting:'+k),...Object.keys(LISTS).map(k=>'list:'+k),'disabled','shortcut:main','shortcut:global:0','shortcut:app:0','builtin:esc'])assert.notEqual(groups.groupFor({id}).id,'other',id);
 assert(groups.rank({id:'setting:theme'})<groups.rank({id:'setting:opacity'}));assert(groups.rank({id:'setting:showTrayIcon'})<groups.rank({id:'setting:theme'}));assert.equal(groups.groupFor({id:'shortcut:global:0'}).title,'快捷键 · 全局快捷键');
});
test('按键转换、别名冲突识别及非法/未知结构拒绝',()=>{
 assert.equal(sc.convert('Command+Shift+K','darwin','win32',{mode:'standard'}),'Super+Shift+K');assert.equal(sc.convert('Super+J','win32','darwin',{mode:'standard'}),'Command+J');assert.equal(sc.convert('Command+Ctrl+K','darwin','win32',{mode:'standard'}),'Super+Ctrl+K');assert.equal(sc.convert('AltGr+K','win32','darwin',{mode:'standard'}),null);
 assert.equal(sc.signature('Control+Shift+a','win32'),sc.signature('Shift+Ctrl+A','win32'));assert.equal(sc.signature('Cmd++','darwin'),sc.signature('Command+Plus','darwin'));assert.equal(sc.signature('Command+Comma','darwin'),sc.signature('Cmd+,','darwin'));assert(sc.accelerator('Ctrl+\\'));assert(!sc.accelerator('execute("evil")'));assert(sc.accelerator('Command+Command'));
 const data=sc.capture({},[],[]);assert.deepEqual(data.builtin,{search:true,killPlugin:true,closePlugin:true,esc:true});assert(sc.validate(data));assert(!sc.validate({...data,secret:'x'}));assert.throws(()=>sc.capture({},[{shortcut:'Ctrl+K',target:'C:\\bad',enabled:true}],[]));assert(!sc.validate({...data,app:[{shortcut:'Ctrl+K',target:'alpha/打开',enabled:true,id:'untrusted'}]}));
});
test('旧备份兼容；快捷键加入 ZIP 摘要和定时内容去重',async()=>{
 const h=fixture();await config(h);const snap=await h.v.capture();const legacy={...snap};delete legacy.shortcuts;assert.equal(unpack(pack(legacy).buffer).shortcuts,undefined);assert.deepEqual(unpack(pack(snap).buffer).shortcuts,snap.shortcuts);const hash=contentHash(snap);snap.shortcuts.main='Command+Shift+Space';assert.notEqual(contentHash(snap),hash);
 await h.v.upload(true);assert((await h.v.upload(true)).skipped);h.data['global-shortcuts']=[{shortcut:'Command+K',target:'alpha/打开',enabled:true}];assert(!(await h.v.upload(true)).skipped);h.v.close();
});
test('完整 Mac→Windows 快捷键恢复：插件指令、开关、即时注册、落盘、恢复前备份',async()=>{
 const a=fixture();add(a);await config(a);const {name}=await a.v.upload();const b=fixture('win32');await config(b);let p=await b.v.loadVersion(name);p=await b.v.remap(p.token,{mode:'standard'});const g=p.rows.find(r=>r.id==='shortcut:global:0'),app=p.rows.find(r=>r.id==='shortcut:app:0');assert(g.enabled);assert.equal(g.value.shortcut,'Super+Shift+K');assert.equal(g.value.target,'alpha/打开');assert.equal(app.value.shortcut,'Super+J');assert(p.rows.find(r=>r.id==='shortcut:main').enabled);
 const ids=['shortcut:main',g.id,app.id,'builtin:search'];const r=await b.v.restore(p.token,ids);assert(!r.results.some(x=>x.status==='failed'),JSON.stringify(r));assert.equal(b.data['settings-general'].hotkey,'Super+Space');assert.equal(b.data['settings-general'].builtinAppShortcutsEnabled.search,false);assert.equal(b.data['global-shortcuts'][0].autoCopy,true);assert(b.runtime.global.has('Super+Shift+K'));assert(b.runtime.app.has('Super+J'));assert(fs.existsSync(r.backupPath));assert(!unpack(fs.readFileSync(r.backupPath)).shortcuts.global.length);a.v.close();b.v.close();
});
test('Windows→Mac 转换；只恢复主题不改变本机自定义主快捷键',async()=>{
 const a=fixture('win32');a.data['app-shortcuts']=[{shortcut:'Ctrl+J',target:'alpha/打开',enabled:true}];await config(a);const {name}=await a.v.upload();const b=fixture();await b.v.call('update-shortcut','Command+Shift+Space');b.data['settings-general'].hotkey='Command+Shift+Space';await config(b);let p=await b.v.loadVersion(name);p=await b.v.remap(p.token,{mode:'standard'});assert.equal(p.rows.find(r=>r.id==='shortcut:app:0').value.shortcut,'Ctrl+J');const n=b.calls.length;await b.v.restore(p.token,['setting:theme']);assert.equal(await b.v.call('get-current-shortcut'),'Command+Shift+Space');assert.equal(b.data['settings-general'].hotkey,'Command+Shift+Space');assert(!b.calls.slice(n).some(([c])=>c==='internal:update-shortcut'));a.v.close();b.v.close();
});
test('本机绑定、内置键、转换重复、缺失指令均明确阻止，保留未选中的绑定',()=>{
 const data=sc.capture({hotkey:'Command+Space'},[],[]),manifest={platform:'darwin'},plugins=[{name:'alpha',title:'Alpha'}],commands={commands:[{type:'plugin',pluginName:'alpha',pluginTitle:'Alpha',name:'打开'}],regexCommands:[]};
 const preview=(global,app=[],current=data)=>sc.rows({manifest,plugins,shortcuts:sc.capture({hotkey:'Command+Space'},global,app)},structuredClone(current),'darwin',commands,new Set());
 const record={shortcut:'Command+K',target:'alpha/打开',enabled:true};const current={...data,global:[{...record,target:'other/打开'}]};assert.match(preview([record],[],current).find(r=>r.section==='global').reason,/其他目标/);assert.match(preview([],[{...record,shortcut:'Command+F'}]).find(r=>r.section==='app').reason,/内置/);assert.match(preview([record,{...record,shortcut:'Cmd+K'}]).find(r=>r.section==='global').reason,/备份中的多项/);assert.match(preview([{...record,target:'alpha/missing'}]).find(r=>r.section==='global').reason,/未找到/);
});
test('缺失插件必须同时选中安装，安装后重新核对指令再注册',async()=>{
 const a=fixture();add(a);await config(a);const {name}=await a.v.upload();const b=fixture('win32');b.data.plugins=[];await config(b);let p=await b.v.loadVersion(name);p=await b.v.remap(p.token,{mode:'standard'});assert.equal(p.rows.find(r=>r.id==='shortcut:global:0').needsPlugin,'alpha');let n=writes(b).length;await assert.rejects(b.v.restore(p.token,['shortcut:global:0']),/同时选择安装/);assert.equal(writes(b).length,n);const r=await b.v.restore(p.token,['plugin:alpha','shortcut:global:0']);assert(!r.results.some(x=>x.status==='failed'));assert(b.runtime.global.has('Super+Shift+K'));a.v.close();b.v.close();
});
test('应用快捷键恢复统一申请全部权限，批准后只注册选中项，不新增弹窗',async()=>{
 const a=fixture();add(a);await config(a);const {name}=await a.v.upload();const b=fixture('win32',true);await config(b);await assert.rejects(b.v.loadVersion(name),/申请已提交/);assert.deepEqual(new Set(b.auth.requests[0].apis),new Set(ALL));await b.auth.resolve('approve',ALL);let p=await b.v.loadVersion(name);p=await b.v.remap(p.token,{mode:'standard'});const r=await b.v.restore(p.token,['shortcut:app:0']);assert(!r.results.some(x=>x.status==='failed'));assert.equal(b.auth.requests.length,1);assert(!b.calls.some(([c])=>c==='internal:register-global-shortcut'));a.v.close();b.v.close();b.auth.close();
});
test('不完整授权时整次预览停止，批准后再预览不额外申请指令权限',async()=>{
 const a=fixture();add(a);await config(a);const {name}=await a.v.upload();const b=fixture('win32',true);b.auth.grant(BACKUP);await config(b);await assert.rejects(b.v.loadVersion(name),/申请已提交/);assert.equal(writes(b).length,0);await b.auth.resolve('approve',b.auth.requests.at(-1).apis);const p=await b.v.loadVersion(name);assert(!p.shortcutError);assert(p.rows.find(r=>r.id==='shortcut:app:0').enabled);assert.equal(b.auth.requests.length,1);a.v.close();b.v.close();b.auth.close();
});
test('快捷键落盘失败、注册失败均恢复原绑定和列表，其他绑定不变',async()=>{
 for(const failure of ['disk','register']){const a=fixture();add(a);await config(a);const {name}=await a.v.upload();const b=fixture();b.data['global-shortcuts']=[{id:'local',shortcut:'Cmd+Shift+K',target:'alpha/打开',enabled:true,autoCopy:false,preScreenshotOptimization:false},{id:'other',shortcut:'Command+U',target:'alpha/打开',enabled:true}];const old=structuredClone(b.data['global-shortcuts']);b.runtime.global.set(old[0].shortcut,old[0]);b.runtime.global.set(old[1].shortcut,old[1]);await config(b);const p=await b.v.loadVersion(name);if(failure==='disk')b.fault.disk='global-shortcuts';else b.fault.register=true;const r=await b.v.restore(p.token,['shortcut:global:0']);assert(r.results.some(x=>x.status==='failed'));assert.deepEqual(b.data['global-shortcuts'],old);assert.equal(b.runtime.global.get(old[0].shortcut).target,'alpha/打开');assert(b.runtime.global.has('Command+U'));a.v.close();b.v.close();}
});
test('主快捷键仅注册不等于持久化；保存失败回滚实际绑定与旧设置',async()=>{
 const a=fixture();await a.v.call('update-shortcut','Command+Shift+Space');await config(a);const {name}=await a.v.upload();const b=fixture();await config(b);const p=await b.v.loadVersion(name);b.fault.disk='settings-general';const r=await b.v.restore(p.token,['shortcut:main']);assert(r.results.some(x=>x.status==='failed'));assert.equal(await b.v.call('get-current-shortcut'),'Command+Space');assert.equal(b.data['settings-general'].hotkey,'Command+Space');const p2=await b.v.loadVersion(name);await b.v.restore(p2.token,['shortcut:main']);assert.equal(await b.v.call('get-current-shortcut'),'Command+Shift+Space');assert.equal(b.data['settings-general'].hotkey,'Command+Shift+Space');a.v.close();b.v.close();
});
test('恢复禁用快捷键会注销原绑定并保存禁用状态；恢复前出现新冲突时不覆盖',async()=>{
 const a=fixture();add(a);a.data['global-shortcuts'][0].enabled=false;await config(a);const {name}=await a.v.upload();const b=fixture();add(b);b.runtime.global.set('Command+Shift+K',b.data['global-shortcuts'][0]);await config(b);let p=await b.v.loadVersion(name);let r=await b.v.restore(p.token,['shortcut:global:0']);assert(!r.results.some(x=>x.status==='failed'));assert(!b.runtime.global.has('Command+Shift+K'));assert.equal(b.data['global-shortcuts'][0].enabled,false);p=await b.v.loadVersion(name);b.data['global-shortcuts'][0].target='other/打开';const old=structuredClone(b.data['global-shortcuts']);r=await b.v.restore(p.token,['shortcut:global:0']);assert(r.results.some(x=>x.status==='failed'));assert.deepEqual(b.data['global-shortcuts'],old);a.v.close();b.v.close();
});

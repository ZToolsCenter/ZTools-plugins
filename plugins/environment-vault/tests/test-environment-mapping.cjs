'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const root=path.resolve(process.env.VAULT_PACKAGE_ROOT||path.join(__dirname,'..')),mapping=require(path.join(root,'key-mapping.js')),sc=require(path.join(root,'shortcuts.cjs')),{Vault}=require(path.join(root,'vault.cjs')),{createDav}=require('./env-dav-fixture.cjs');
const text=fs.readFileSync(path.join(__dirname,'test-environment-vault.cjs'),'utf8'),host=new Function('return ('+text.slice(text.indexOf('function host('),text.indexOf('function engine('))+')')();
const base=fs.mkdtempSync(path.join(require('os').tmpdir(),'mapping-test-')),dav=createDav();let url;
const legacy={mode:'standard'},position={mode:'position'};
function engine(platform){const h=host(platform),dir=fs.mkdtempSync(path.join(base,'device-'));return {...h,dir,v:new Vault({invoke:h.invoke,dataDir:dir,platform})};}
async function configure(h){await h.v.saveConfig({url,username:'tester',password:'app-password',device:'test',interval:30,timed:false});}
async function pair(){const a=engine('darwin'),b=engine('win32');a.data['global-shortcuts']=[{shortcut:'Alt+V',target:'alpha/打开',enabled:true},{shortcut:'Command+K',target:'alpha/打开',enabled:true}];await configure(a);await configure(b);const {name}=await a.v.upload();return {a,b,p:await b.v.loadVersion(name)};}
const changed=h=>h.calls.filter(([n])=>/internal:(db-put|update-|register-|unregister-|install-plugin)/.test(n));
test.before(async()=>{await new Promise(r=>dav.server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${dav.server.address().port}/backup/`;});test.after(async()=>{await new Promise(r=>dav.server.close(r));});
test('不默认选择；位置方案双向对应用户习惯，主唤起键同样转换',()=>{
 assert.equal(sc.convert('Command+Space','darwin','win32'),null);assert.equal(sc.convert('Command+Space','darwin','win32',position),'Alt+Space');assert.equal(sc.convert('Alt+Space','win32','darwin',position),'Command+Space');assert.equal(sc.convert('Alt+V','darwin','win32',position),'Super+V');assert.equal(sc.convert('Super+V','win32','darwin',position),'Alt+V');assert.equal(sc.convert('Ctrl+V','darwin','win32',position),'Ctrl+V');
});
test('标准方案三键一一对应，双向自动反转；CommandOrControl 先按来源解析再执行选择的映射',()=>{
 assert.equal(sc.convert('Command+Space','darwin','win32',legacy),'Super+Space');assert.equal(sc.convert('Super+V','win32','darwin',legacy),'Command+V');assert.equal(sc.convert('CommandOrControl+Space','darwin','win32',position),'Alt+Space');assert.equal(sc.convert('CommandOrControl+V','win32','darwin',position),'Ctrl+V');assert.equal(sc.convert('Ctrl+Shift+V','win32','darwin',position),'Ctrl+Shift+V');
});
test('自定义仅接受三个修饰键的完整一一映射；未知字段、缺项或重复目标均拒绝',()=>{
 const custom={mode:'custom',custom:{Ctrl:'Super',Alt:'Alt',Command:'Ctrl'}};assert.equal(sc.convert('Ctrl+Alt+Shift+V','darwin','win32',custom),'Super+Alt+Shift+V');
 for(const config of [{mode:'x'},{mode:'custom',custom:{Ctrl:'Ctrl'}},{mode:'custom',custom:{Ctrl:'Ctrl',Alt:'Alt',Command:'Ctrl'}},{mode:'custom',custom:{Ctrl:'Ctrl',Alt:'Alt',Command:'Super',Shift:'Shift'}},{mode:'custom',custom:{Ctrl:'Ctrl',Alt:'Alt',Command:'Command'}}])assert.throws(()=>mapping.normalize(config,'darwin','win32'));
 const reverse={mode:'custom',custom:{Ctrl:'Alt',Alt:'Ctrl',Command:'Super'}};assert.equal(sc.convert('Ctrl+Super+Shift+K','win32','darwin',reverse),'Alt+Command+Shift+K');
});
test('未映射时可选快捷键但恢复必须先引导；禁止越过桥接，且零写入/零恢复前备份',async()=>{
 const {a,b,p}=await pair();assert.equal(p.mapping,null);assert(p.rows.find(r=>r.id==='shortcut:main').needsMapping);assert(p.rows.find(r=>r.id==='shortcut:global:0').enabled);assert.equal(p.rows.find(r=>r.id==='shortcut:global:0').value,null);const before=changed(b).length;
 await assert.rejects(b.v.restore(p.token,['setting:theme','shortcut:main']),/先配置跨系统/);assert.equal(changed(b).length,before);assert.equal((await b.v.versions(true)).length,0);a.v.close();b.v.close();
});
test('不恢复快捷键时可跨系统独立恢复设置；内置布尔开关不需要按键映射',async()=>{
 const {a,b,p}=await pair();b.data['settings-general'].theme='light';const r=await b.v.restore(p.token,['setting:theme','builtin:search']);assert(!r.results.some(x=>x.status==='failed'));assert.equal(b.data['settings-general'].theme,'dark');assert(!b.calls.some(([n])=>n==='internal:update-shortcut'));a.v.close();b.v.close();
});
test('切换映射重算预览和主键、使旧 token 失效，既不写入宿主也不改变备份',async()=>{
 const {a,b,p}=await pair(),before=changed(b).length,bytes=[...dav.files.values()].map(Buffer.from);const pos=await b.v.remap(p.token,position);assert.equal(pos.rows.find(r=>r.id==='shortcut:main').value,'Alt+Space');assert.equal(pos.rows.find(r=>r.id==='shortcut:global:0').value.shortcut,'Super+V');assert.equal(changed(b).length,before);assert.deepEqual([...dav.files.values()],bytes);await assert.rejects(b.v.restore(p.token,['shortcut:main']),/失效/);
 const old=await b.v.remap(pos.token,legacy);assert.equal(old.rows.find(r=>r.id==='shortcut:main').value,'Super+Space');const blank=await b.v.remap(old.token,null);await assert.rejects(b.v.restore(blank.token,['shortcut:main']),/先配置/);a.v.close();b.v.close();
});
test('位置方案走通主键注册与保存、插件快捷键恢复以及 Mac 反向恢复',async()=>{
 const {a,b,p}=await pair(),pos=await b.v.remap(p.token,position);const r=await b.v.restore(pos.token,['shortcut:main','shortcut:global:0','shortcut:global:1']);assert(!r.results.some(x=>x.status==='failed'),JSON.stringify(r));assert.equal(b.data['settings-general'].hotkey,'Alt+Space');assert.equal(b.data['global-shortcuts'][0].shortcut,'Super+V');assert.equal(b.data['global-shortcuts'][1].shortcut,'Alt+K');
 const {name}=await b.v.upload(),back=await a.v.loadVersion(name),reverse=await a.v.remap(back.token,position);assert.equal(reverse.rows.find(r=>r.id==='shortcut:main').value,'Command+Space');assert.equal(reverse.rows.find(r=>r.id==='shortcut:global:0').value.shortcut,'Alt+V');a.v.close();b.v.close();
});
test('切换映射重新核对本机占用，被冲突阻止的行不可恢复',async()=>{
 const {a,b,p}=await pair();b.data['global-shortcuts']=[{shortcut:'Super+K',target:'other/open',enabled:true}];const standard=await b.v.remap(p.token,{mode:'standard'});assert(!standard.rows.find(r=>r.id==='shortcut:global:1').enabled);await assert.rejects(b.v.restore(standard.token,['shortcut:global:1']),/不可恢复/);const pos=await b.v.remap(standard.token,{mode:'position'});assert(pos.rows.find(r=>r.id==='shortcut:global:1').enabled);a.v.close();b.v.close();
});
test('同系统保留原按键，不展示强制跨系统映射；新版本预览清空上个映射',async()=>{
 assert.equal(sc.convert('Alt+V','darwin','darwin'),'Alt+V');const a=engine('darwin');await configure(a);const {name}=await a.v.upload(),p=await a.v.loadVersion(name);assert(!p.rows.find(r=>r.id==='shortcut:main').needsMapping);const r=await a.v.restore(p.token,['shortcut:main']);assert(!r.results.some(x=>x.status==='failed'));a.v.close();
 const {a:source,b,p:initial}=await pair();await b.v.remap(initial.token,position);const fresh=await b.v.loadVersion(initial.manifest?b.v.preview.name:'');assert.equal(fresh.mapping,null);source.v.close();b.v.close();
});
test('两套预设均为单表双向互逆，自定义也不需要维护第二份配置',()=>{
 for(const config of [{mode:'standard'},{mode:'position'},{mode:'custom',custom:{Ctrl:'Alt',Alt:'Ctrl',Command:'Super'}}]){
  for(const key of ['Ctrl+V','Alt+V','Command+Space','Ctrl+Alt+Shift+K','Ctrl+Alt+Command+K']){const win=sc.convert(key,'darwin','win32',config);assert(win);assert.equal(sc.signature(sc.convert(win,'win32','darwin',config),'darwin'),sc.signature(key,'darwin'));}
 }
 assert.deepEqual(mapping.resolve({mode:'standard'},'darwin','win32'),{Ctrl:'Ctrl',Alt:'Alt',Command:'Super'});assert.deepEqual(mapping.resolve({mode:'standard'},'win32','darwin'),{Ctrl:'Ctrl',Alt:'Alt',Super:'Command'});
});

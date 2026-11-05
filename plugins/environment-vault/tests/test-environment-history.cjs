'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const root=path.resolve(process.env.VAULT_PACKAGE_ROOT||path.join(__dirname,'..'));
const {Vault}=require(path.join(root,'vault.cjs')),{Dav}=require(path.join(root,'dav.cjs')),{parseName}=require(path.join(root,'backup-names.cjs')),{platformName,shortcutText}=require(path.join(root,'platform-ui.js')),sc=require(path.join(root,'shortcuts.cjs'));
const {createDav}=require('./env-dav-fixture.cjs');const text=fs.readFileSync(path.join(__dirname,'test-environment-vault.cjs'),'utf8'),makeHost=new Function('return ('+text.slice(text.indexOf('function host('),text.indexOf('function engine('))+')')();
const dav=createDav(),base=fs.mkdtempSync(path.join(require('os').tmpdir(),'history-tests-'));let url;
function engine(device='Mac__验证',platform='darwin'){const host=makeHost(platform),dir=fs.mkdtempSync(path.join(base,'device-')),v=new Vault({invoke:host.invoke,dataDir:dir,device,platform});return {...host,v,dir};}
async function configure(h,password='app-password'){await h.v.saveConfig({url,username:'tester',password,device:'Mac__验证',interval:30,timed:false});}
const valid='2026-10-20_01-23-45.123Z__Mac__验证__darwin__1234abcd.zip';
test.before(async()=>{await new Promise(r=>dav.server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${dav.server.address().port}/backup/`;});
test.after(async()=>{await new Promise(r=>dav.server.close(r));});
test('Mac Alt 按 Option 显示；Windows 保留 Alt；备份和恢复按键值不受显示格式影响',()=>{
 assert.equal(shortcutText('Alt+V','darwin'),'Option + V');assert.equal(shortcutText('Alt+V','win32'),'Alt + V');assert.equal(shortcutText('CmdOrCtrl+Shift+V','darwin'),'Command + Shift + V');assert.equal(shortcutText('CommandOrControl+V','win32'),'Ctrl + V');assert.equal(platformName('darwin'),'macOS');assert.equal(platformName('win32'),'Windows');assert.equal(platformName('unknown'),'未知系统');
 const manifest={platform:'darwin'},shortcuts=sc.capture({hotkey:'Command+Space'},[{shortcut:'Alt+V',target:'alpha/打开',enabled:true}],[]),commands={commands:[{type:'plugin',pluginName:'alpha',name:'打开'}],regexCommands:[]};
 const rows=sc.rows({manifest,plugins:[],shortcuts},sc.capture({hotkey:'Alt+Space'},[],[]),'win32',commands,new Set(),{mode:'standard'});const row=rows.find(r=>r.section==='global');assert.equal(row.value.shortcut,'Alt+V');assert.equal(row.sourceValue.shortcut,'Alt+V');assert.equal(row.sourcePlatform,'darwin');assert.equal(row.targetPlatform,'win32');assert.equal(row.title,'Alt + V → alpha/打开');
});
test('Mac/Win 同系统修饰键别名、顺序和大小写不会被误报为快捷键差异',()=>{
 for(const [platform,key,currentKey,main,currentMain] of [['darwin','Alt+V','Option+v','Cmd+Space','Command+Space'],['win32','Control+Shift+V','Shift+CTRL+v','Alt+Space','Option+Space']]){
  const s=sc.capture({hotkey:main},[{shortcut:key,target:'alpha/打开',enabled:true}],[]),current=sc.capture({hotkey:currentMain},[{shortcut:currentKey,target:'alpha/打开',enabled:true}],[]);const rows=sc.rows({manifest:{platform},plugins:[],shortcuts:s},current,platform,{commands:[{type:'plugin',pluginName:'alpha',name:'打开'}]},new Set());assert.equal(rows.find(r=>r.section==='global').different,false);assert.equal(rows.find(r=>r.id==='shortcut:main').different,false);
 }
});
test('备份文件名从固定系统后缀解析，设备双下划线不再破坏设备/系统识别',()=>{
 const row=parseName(valid);assert.equal(row.platform,'darwin');assert.equal(row.device,'Mac__验证');assert.equal(row.createdAt,'2026-10-20T01:23:45.123Z');assert.equal(parseName(valid.replace('darwin','win32')).platform,'win32');
 for(const name of ['../'+valid,valid+'.uploading',valid.replace('darwin','linux'),valid.replace('01-23','99-99'),'before-restore-123.zip','../../config.json',valid.replace('Mac__验证','bad/name')])assert.equal(parseName(name),null,name);
});
test('云端删除一个版本并回查，仅影响所选文件；删除当前预览后 token 作废',async()=>{
 const h=engine();await configure(h);const a=await h.v.upload(),b=await h.v.upload();const preview=await h.v.loadVersion(a.name),before=structuredClone(h.data);const n=dav.files.size;const r=await h.v.deleteVersion(a.name,false);assert.equal(r.name,a.name);assert.equal(dav.files.size,n-1);assert((await h.v.versions()).some(row=>row.name===b.name));assert(!(await h.v.versions()).some(row=>row.name===a.name));assert.deepEqual(h.data,before);await assert.rejects(h.v.restore(preview.token,['setting:theme']),/失效/);await assert.rejects(h.v.deleteVersion(a.name),/不存在/);h.v.close();
});
test('删除其他版本保留当前预览；删除上次上传版本使定时检查可以重新上传',async()=>{
 const h=engine();await configure(h);const a=await h.v.upload(),b=await h.v.upload();const p=await h.v.loadVersion(a.name);assert((await h.v.upload(true)).skipped);await h.v.deleteVersion(b.name);assert.equal(h.v.preview.token,p.token);assert(!(await h.v.upload(true)).skipped);assert.equal(h.v.preview.token,p.token);h.v.close();
});
test('本机恢复前备份可删除，不触碰云端或其他文件；符号链接不列出也不删除',async()=>{
 const h=engine();await configure(h);const {name}=await h.v.upload(),p=await h.v.loadVersion(name);const restored=await h.v.restore(p.token,['setting:theme']);const before=dav.files.size,localName=path.basename(restored.backupPath),config=fs.readFileSync(path.join(h.dir,'webdav-local.json'));
 fs.symlinkSync(path.join(h.dir,'webdav-local.json'),path.join(h.dir,'before-restore-111.zip'));assert(!(await h.v.versions(true)).some(row=>row.name==='before-restore-111.zip'));await assert.rejects(h.v.deleteVersion('before-restore-111.zip',true),/不存在/);
 await h.v.deleteVersion(localName,true);assert(!fs.existsSync(restored.backupPath));assert.equal(dav.files.size,before);assert.deepEqual(fs.readFileSync(path.join(h.dir,'webdav-local.json')),config);h.v.close();
});
test('路径穿越、未知备份、错误来源均在任何删除请求之前拒绝',async()=>{
 const h=engine();await configure(h);const n=dav.requests.filter(r=>r.method==='DELETE').length;
 for(const [name,local] of [['../webdav-local.json',true],['../../plugins',false],['webdav-local.json',true],[valid,'true'],['before-restore-123.zip',false],[valid,true]])await assert.rejects(h.v.deleteVersion(name,local),/无效/);
 assert.equal(dav.requests.filter(r=>r.method==='DELETE').length,n);h.v.close();
});
test('删除失败不报成功；HTTP 202 仍存在、认证错误、确认读取失败均报错',async()=>{
 for(const [responses,expected] of [[[{status:403}],/认证失败/],[[{status:500}],/HTTP 500/],[[{status:202},{status:200}],/尚未完成/],[[{status:204},{status:503}],/HTTP 503/]]){
  const d=new Dav({url:'https://example.com/backup/',username:'tester',password:'p'});d.request=async()=>responses.shift();await assert.rejects(d.remove(valid),expected);
 }
 const d=new Dav({url:'https://example.com/backup/',username:'tester',password:'p'});d.request=async(method)=>({status:method==='DELETE'?204:404});await d.remove(valid);await assert.rejects(d.remove('webdav-local.json'),/无效/);
});
test('并发备份/恢复时不能删除；错误认证不能删除或写入本机设置',async()=>{
 const h=engine();await configure(h);h.v.busy=true;await assert.rejects(h.v.deleteVersion(valid),/正在执行/);h.v.busy=false;await configure(h,'wrong');const before=structuredClone(h.data);await assert.rejects(h.v.deleteVersion(valid),/认证失败/);assert.deepEqual(h.data,before);h.v.close();
});

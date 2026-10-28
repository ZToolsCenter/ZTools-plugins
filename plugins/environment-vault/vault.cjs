'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),{isDeepStrictEqual}=require('util');
const Zip=require('adm-zip'),{Dav}=require('./dav.cjs'),{DEFINITIONS,LISTS,SELF,valid,validNames}=require('./settings.cjs');
const {Permissions,BACKUP,ALL,IMMEDIATE}=require('./permissions.cjs');
const keyMapping=require('./key-mapping.js');
const shortcuts=require('./shortcuts.cjs');
const {shortcutText}=require('./platform-ui.js');
const {parseName,isLocalName}=require('./backup-names.cjs');
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const safeName=value=>String(value).replace(/[^\p{L}\p{N}_.-]/gu,'-').slice(0,60)||'device';
const FORMAT='ztools-environment-v1';
function json(text){return JSON.parse(text,(key,value)=>{if(['__proto__','constructor','prototype'].includes(key))throw Error('备份包含非法字段');return value;});}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));return value;}
const contentHash=snapshot=>hash(Buffer.from(JSON.stringify(stable({settings:snapshot.settings,lists:snapshot.lists,disabled:snapshot.disabled,plugins:snapshot.plugins,shortcuts:snapshot.shortcuts,platform:snapshot.platform}))));
/** 打包文件固定为三项，不保存机器路径、插件二进制、登录会话或 WebDAV 凭据。 */
function pack(snapshot){
 const zip=new Zip();const settings=Buffer.from(JSON.stringify({values:snapshot.settings,lists:snapshot.lists,disabled:snapshot.disabled,...(snapshot.shortcuts?{shortcuts:snapshot.shortcuts}:{})}));const plugins=Buffer.from(JSON.stringify(snapshot.plugins));
 const manifest={format:FORMAT,createdAt:new Date().toISOString(),device:snapshot.device,platform:snapshot.platform,sha256:{'settings.json':hash(settings),'plugins.json':hash(plugins)}};
 zip.addFile('manifest.json',Buffer.from(JSON.stringify(manifest)));zip.addFile('settings.json',settings);zip.addFile('plugins.json',plugins);return {buffer:zip.toBuffer(),manifest};
}
/** 在解压前限制条目和声明大小，逐项检查格式及摘要，不将 ZIP 内容解压到文件系统。 */
function unpack(buffer){
 if(buffer.length>12*1024*1024)throw Error('备份文件过大');const zip=new Zip(buffer),entries=zip.getEntries();
 const allowed=['manifest.json','settings.json','plugins.json'];if(entries.length!==3||new Set(entries.map(e=>e.entryName)).size!==3||entries.some(e=>!allowed.includes(e.entryName)||e.header.size>2*1024*1024))throw Error('备份 ZIP 结构或大小不受支持');
 const manifest=json(zip.readAsText('manifest.json'));if(manifest.format!==FORMAT||!['darwin','win32'].includes(manifest.platform)||typeof manifest.device!=='string'||manifest.device.length>100||!Number.isFinite(Date.parse(manifest.createdAt)))throw Error('备份版本或设备信息无效');
 for(const name of ['settings.json','plugins.json'])if(hash(zip.readFile(name))!==manifest.sha256?.[name])throw Error('备份内容校验失败');
 const settings=json(zip.readAsText('settings.json')),plugins=json(zip.readAsText('plugins.json'));
 if(!settings.values||typeof settings.values!=='object'||Array.isArray(settings.values)||!settings.lists||typeof settings.lists!=='object')throw Error('备份设置格式无效');
 for(const [key,value] of Object.entries(settings.values))if(!valid(key,value))throw Error(`不支持的设置或设置值：${key}`);
 for(const [key,value] of Object.entries(settings.lists))if(!LISTS[key]||!validNames(value))throw Error('插件行为列表无效');
 if(!validNames(settings.disabled)||!Array.isArray(plugins)||plugins.length>1000)throw Error('插件清单格式无效');
 if(settings.shortcuts!==undefined&&!shortcuts.validate(settings.shortcuts))throw Error('备份快捷键格式无效');
 const names=new Set();for(const p of plugins){if(!p||!validNames([p.name])||names.has(p.name)||typeof p.title!=='string'||p.title.length>200||typeof p.version!=='string'||p.version.length>100)throw Error('插件清单格式无效');names.add(p.name);}
 return {manifest,settings:settings.values,lists:settings.lists,disabled:settings.disabled,plugins,shortcuts:settings.shortcuts};
}

class Vault {
 constructor({invoke,dataDir,platform=process.platform,device=os.hostname(),notify=()=>{}}){
  if(!['darwin','win32'].includes(platform))throw Error('仅支持 macOS 和 Windows，无法确认本机系统');
  this.invoke=invoke;this.permissions=new Permissions(invoke,notify);this.dataDir=dataDir;this.platform=platform;this.device=device;this.notify=notify;this.preview=null;this.busy=false;this.timer=null;this.lastResult='尚未执行';
  fs.mkdirSync(dataDir,{recursive:true,mode:0o700});this.config={url:'',username:'',password:'',device,interval:30,timed:false,remember:false};
  const file=path.join(dataDir,'webdav-local.json');if(fs.existsSync(file)){const c=json(fs.readFileSync(file,'utf8'));this.config={...this.config,...c};}
  this.mappingPreference=null;this.mappingNotice='';const mappingFile=path.join(dataDir,'mapping-local.json');if(fs.existsSync(mappingFile)){const migrated=keyMapping.migrate(json(fs.readFileSync(mappingFile,'utf8')));this.mappingPreference=migrated.mapping;this.mappingNotice=migrated.notice;}
  this.lastHash='';const stateFile=path.join(dataDir,'upload-state.json');if(fs.existsSync(stateFile))this.lastHash=json(fs.readFileSync(stateFile,'utf8')).hash||'';
  this.schedule();
 }
 async call(channel,...args){try{return await this.invoke(`internal:${channel}`,...args);}catch(error){if(/PermissionDenied|没有权限|permission denied|仅限内置插件调用/i.test(error.message))throw Error('高级 API 权限不足或已停用，请重新申请所需权限；若已停用，请在 ZTools 权限管理中重新启用');throw error;}}
 async get(key){return this.call('db-get',key);}
 async put(key,value){const r=await this.call('db-put',key,value);if(!r?.ok)throw Error(`设置保存失败：${key}`);}
 status(){const {password,...config}=this.config;return {config,mappingPreference:structuredClone(this.mappingPreference),mappingNotice:this.mappingNotice,hasPassword:!!password,lastResult:this.lastResult,busy:this.busy,platform:this.platform,nextRun:this.nextRun||null};}
 async exclusive(work){if(this.busy)throw Error('已有备份或恢复任务正在执行');this.busy=true;try{return await work();}finally{this.busy=false;}}
 /** 一份双向共用的对照表只保存在本机，无需宿主授权或 WebDAV 连接。 */
 async saveMapping(config){return this.exclusive(async()=>{
  const normalized=keyMapping.preference(config);this.writeLocal('mapping-local.json',{version:2,mapping:normalized});this.mappingPreference=normalized;this.mappingNotice='';return structuredClone(normalized);
 });}
 /** 保存定时设置时由宿主配置后台自动启动；不自行扩展内部 API 授权。 */
 async saveConfig(input){
  if(this.busy)throw Error('请等待当前任务完成再修改配置');
  if(![5,15,30,60,180,720,1440].includes(Number(input.interval)))throw Error('定时间隔无效');
  const next={url:String(input.url||'').trim(),username:String(input.username||''),password:String(input.password||''),device:String(input.device||'').trim(),interval:Number(input.interval),timed:!!input.timed,remember:!!input.remember};
  if(!next.device||next.device.length>60||/[\x00-\x1f]/.test(next.device))throw Error('设备名称应为 1–60 个可见字符');new Dav(next);
  // 保存计划不弹授权；首次主动任务获批后再维护后台启动列表。
  const maintainStartup=next.timed||this.config.timed;
  const disk={...next,password:next.remember?next.password:''};this.writeLocal('webdav-local.json',disk);if(this.config.url!==next.url||this.config.username!==next.username){this.lastHash='';this.writeLocal('upload-state.json',{hash:''});}this.config=next;this.schedule();if(maintainStartup){const state=await this.permissions.state();if(state.fullAccess||ALL.every(api=>state.granted.includes(api)))await this.syncAutoStart();}return this.status();
 }
 /** 只在权限齐备后维护本插件后台启动；不会因为保存定时表单弹窗。 */
 async syncAutoStart(){
  const existing=await this.get('auto-start-plugin')||[];if(!validNames(existing))throw Error('宿主自动启动列表格式不兼容');const wanted=this.config.timed?[...new Set([...existing,SELF])]:existing.filter(n=>n!==SELF);if(!isDeepStrictEqual(existing,wanted))await this.put('auto-start-plugin',wanted);
 }
 writeLocal(name,data){const dest=path.join(this.dataDir,name),temporary=dest+'.tmp';fs.writeFileSync(temporary,JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(temporary,dest);try{fs.chmodSync(dest,0o600);}catch{}}
 /** 定时任务只上传；没有配置密码、未授权或任务冲突时明确记录状态。 */
 schedule(){
  if(this.timer)clearInterval(this.timer);this.timer=null;this.nextRun=null;
  if(!this.config.timed)return;const ms=this.config.interval*60000;this.nextRun=Date.now()+ms;
  this.timer=setInterval(()=>{this.nextRun=Date.now()+ms;this.upload(true).catch(error=>{this.lastResult=`定时备份失败：${error.message}`;this.notify(this.status());});},ms);this.timer.unref?.();
 }
 dav(){if(!this.config.url||!this.config.username||!this.config.password)throw Error('请填写并保存 WebDAV 地址、用户名和密码');return new Dav(this.config);}
 async capture(){
  const general=await this.get('settings-general')||{};const raw=await this.get('plugins')||[];if(!Array.isArray(raw))throw Error('宿主插件注册表格式不兼容');
  const settings={};for(const key of Object.keys(DEFINITIONS))if(Object.hasOwn(general,key)&&valid(key,general[key]))settings[key]=general[key];
  const plugins=raw.filter(p=>!p.isDevelopment&&!['setting','system',SELF].includes(p.name)).map(p=>({name:p.name,title:String(p.title||p.name),version:String(p.version||''),platform:Array.isArray(p.platform)?p.platform:[],development:false})).sort((a,b)=>a.name.localeCompare(b.name));
  if(plugins.some(p=>!validNames([p.name])))throw Error('宿主含有不支持的插件名称');
  const known=new Set(plugins.map(p=>p.name));const lists={};for(const key of Object.keys(LISTS)){const value=await this.get(key);if(value!==null&&value!==undefined){if(!validNames(value))throw Error(`宿主插件列表格式不兼容：${key}`);lists[key]=value.filter(n=>known.has(n));}}
  const disabledPaths=await this.call('get-disabled-plugins');if(!Array.isArray(disabledPaths))throw Error('禁用插件列表格式不兼容');const disabled=raw.filter(p=>disabledPaths.includes(p.path)||disabledPaths.includes(p.name)).map(p=>p.name).filter(n=>known.has(n));
  const shortcutData=shortcuts.capture({...general,hotkey:await this.call('get-current-shortcut')},await this.get('global-shortcuts'),await this.get('app-shortcuts'));
  return {settings,plugins,lists,disabled,shortcuts:shortcutData,platform:this.platform,device:this.config.device};
 }
 async upload(timed=false){return this.exclusive(async()=>{
  await this.permissions.ensure(BACKUP,{interactive:!timed});
  if(!timed)await this.syncAutoStart();
  const dav=this.dav(),snapshot=await this.capture(),digest=contentHash(snapshot);
  if(timed&&digest===this.lastHash){this.lastResult='定时检查：内容未变化，未重复上传';this.notify(this.status());return {skipped:true};}
  const {buffer,manifest}=pack(snapshot);const time=manifest.createdAt.replace('T','_').replace(/:/g,'-');const name=`${time}__${safeName(snapshot.device)}__${snapshot.platform}__${crypto.randomUUID().slice(0,8)}.zip`;
  await dav.put(name,buffer);this.lastHash=digest;this.writeLocal('upload-state.json',{hash:digest,name,at:manifest.createdAt});this.lastResult=`上传完成：${name}`;this.notify(this.status());return {name,settings:Object.keys(snapshot.settings).length,plugins:snapshot.plugins.length,shortcuts:(snapshot.shortcuts.main?1:0)+Object.keys(snapshot.shortcuts.builtin).length+snapshot.shortcuts.global.length+snapshot.shortcuts.app.length};
 });}
 /** 列表和删除使用同一白名单；本机仅列出常规文件，不跟随符号链接。 */
 async versions(local=false){return this.exclusive(()=>local===true?this.localVersions():this.dav().list());}
 localVersions(){return fs.readdirSync(this.dataDir).filter(isLocalName).filter(name=>fs.lstatSync(path.join(this.dataDir,name)).isFile()).sort().reverse().map(name=>({name,time:new Date(Number(name.match(/\d+/)[0])).toLocaleString(),device:'本机恢复前备份',platform:this.platform,bytes:fs.statSync(path.join(this.dataDir,name)).size}));}
 /** 用户在确认弹窗中删除单个版本；任务串行化，重新列目录后仅删除选中的备份。 */
 async deleteVersion(name,local=false){return this.exclusive(async()=>{
  if(local!==true&&local!==false)throw Error('备份来源无效');
  if(local?!isLocalName(name):!parseName(name))throw Error('备份文件名无效');
  const rows=local?this.localVersions():await this.dav().list();if(!rows.some(row=>row.name===name))throw Error('该备份已不存在，请刷新列表');
  // 删除当前预览的文件后立即作废 token，即使后续网络确认失败也不能继续用旧预览恢复。
  if(this.preview?.name===name&&this.preview.local===local)this.preview=null;
  if(local){fs.unlinkSync(path.join(this.dataDir,name));if(fs.existsSync(path.join(this.dataDir,name)))throw Error('本机备份删除校验失败');}
  else await this.dav().remove(name);
  // 删除最后上传的版本后，定时检查应允许重新上传相同内容。
  if(!local){const file=path.join(this.dataDir,'upload-state.json');if(fs.existsSync(file)&&json(fs.readFileSync(file,'utf8')).name===name){this.lastHash='';this.writeLocal('upload-state.json',{hash:''});}}
  return {name,local};
 });}
 /** 下载仅供预览；直到恢复按钮被明确点击才执行任何本机写入或安装。 */
 async loadVersion(name,local=false){return this.exclusive(async()=>{
  await this.permissions.ensure(BACKUP,{interactive:true});
  await this.syncAutoStart();
  this.preview=null;if(local===true&&!/^before-restore-\d+\.zip$/.test(name))throw Error('本机备份文件名无效');const buffer=local===true?fs.readFileSync(path.join(this.dataDir,name)):await this.dav().get(name);const snapshot=unpack(buffer),current=await this.capture();
  const raw=await this.get('plugins')||[];const installed=new Map(raw.map(p=>[p.name,p]));let market=[],marketError='';
  if(snapshot.plugins.some(p=>!installed.has(p.name))){try{await this.permissions.ensure(['internal:fetch-plugin-market'],{interactive:true});const r=await this.call('fetch-plugin-market');if(!r?.success||!Array.isArray(r.data))throw Error(r?.error||'市场列表不可用');market=r.data;}catch(error){marketError=error.message;}}
  const rows=[];let commands=null,shortcutError='';
  if(snapshot.shortcuts&&(snapshot.shortcuts.global.length||snapshot.shortcuts.app.length)){try{await this.permissions.ensure(['internal:get-commands'],{interactive:true});commands=await this.call('get-commands');if(!Array.isArray(commands?.commands)||!Array.isArray(commands?.regexCommands))throw Error('宿主指令清单格式不兼容');}catch(error){shortcutError=error.message;}}
  for(const [key,value] of Object.entries(snapshot.settings)){const same=DEFINITIONS[key][4]==='same-os';rows.push({id:`setting:${key}`,group:'setting',title:DEFINITIONS[key][0],value,current:current.settings[key]??'未配置',enabled:!same||snapshot.manifest.platform===this.platform,reason:same&&snapshot.manifest.platform!==this.platform?'窗口材质仅恢复到相同系统':'',different:!isDeepStrictEqual(value,current.settings[key])});}
  for(const [key,value] of Object.entries(snapshot.lists))rows.push({id:`list:${key}`,group:'setting',title:LISTS[key],value,current:current.lists[key]||[],enabled:true,different:!isDeepStrictEqual(value,current.lists[key]||[])});
  rows.push({id:'disabled',group:'setting',title:'插件禁用状态',value:snapshot.disabled,current:current.disabled,enabled:true,different:!isDeepStrictEqual(snapshot.disabled,current.disabled)});
  const marketByName=new Map(market.map(p=>[p.name,p]));
  for(const plugin of snapshot.plugins){
   const exists=installed.get(plugin.name),candidate=marketByName.get(plugin.name),supports=!candidate?.platform?.length||candidate.platform.includes(this.platform);
   rows.push({id:`plugin:${plugin.name}`,group:'plugin',title:plugin.title,name:plugin.name,value:plugin.version,current:exists?.version||'未安装',enabled:!!exists||!!candidate&&supports,reason:exists?'已安装，恢复时跳过':!candidate?(marketError?`${marketError}；重新读取版本可刷新`:'市场中未找到或不支持当前系统'):!supports?'不支持当前系统':`将安装市场当前版本 ${candidate.version||''}`,different:!exists});
  }
  const installable=new Set(rows.filter(row=>row.group==='plugin'&&row.enabled&&row.different).map(row=>row.name));
  const savedMapping=keyMapping.normalize(this.mappingPreference,snapshot.manifest.platform,this.platform);
  const shortcutRows=shortcuts.rows(snapshot,current.shortcuts,this.platform,commands,installable,savedMapping);if(shortcutError)for(const row of shortcutRows.filter(row=>['global','app'].includes(row.section))){row.enabled=false;row.reason=shortcutError+'；批准后重新读取版本';}rows.push(...shortcutRows);
  this.preview={token:crypto.randomUUID(),name,local,snapshot,rows,marketByName,commands,shortcutError,marketError,mapping:savedMapping};return this.previewResult();
 });}
 previewResult(){const p=this.preview;return {token:p.token,manifest:p.snapshot.manifest,targetPlatform:this.platform,rows:p.rows,marketError:p.marketError,shortcutError:p.shortcutError,mapping:p.mapping};}
 /** 修改映射只重算预览，不下载、安装或写宿主；每次生成新 token，旧映射不能继续用于恢复。 */
 async remap(token,config){return this.exclusive(async()=>{
  const p=this.preview;if(!p||p.token!==token)throw Error('预览已失效，请重新选择版本');
  const normalized=keyMapping.normalize(config,p.snapshot.manifest.platform,this.platform);
  await this.permissions.ensure(BACKUP,{interactive:true});
  const current=await this.capture(),installable=new Set(p.rows.filter(row=>row.group==='plugin'&&row.enabled&&row.different).map(row=>row.name));
  const rows=shortcuts.rows(p.snapshot,current.shortcuts,this.platform,p.commands,installable,normalized);
  if(p.shortcutError)for(const row of rows.filter(row=>['global','app'].includes(row.section))){row.enabled=false;row.reason=p.shortcutError+'；批准后重新读取版本';}
  p.rows=[...p.rows.filter(row=>!row.id.startsWith('shortcut:')&&!row.id.startsWith('builtin:')),...rows];p.mapping=normalized;p.token=crypto.randomUUID();return this.previewResult();
 });}
 /** 安装先于插件行为配置；只执行所选项目，失败逐项报告，不回滚用户原有插件。 */
 async restore(token,ids){return this.exclusive(async()=>{
  const p=this.preview;if(!p||p.token!==token)throw Error('预览已失效，请重新选择版本');
  if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)throw Error('请选择要恢复的项目');
  const byId=new Map(p.rows.map(row=>[row.id,row]));if(ids.some(id=>!byId.get(id)?.enabled))throw Error('选择了不存在或不可恢复的项目');
  // 即使绕过页面直接调用桥接，也必须在任何权限申请、备份落盘或修改前完成映射。
  if(p.snapshot.manifest.platform!==this.platform&&ids.some(id=>id.startsWith('shortcut:'))&&!keyMapping.normalize(p.mapping,p.snapshot.manifest.platform,this.platform))throw Error('请先配置跨系统快捷键映射，再恢复所选快捷键');
  // 先校验所选项目依赖，再检查统一完整权限；部分批准时整个任务停止。
  const required=[...BACKUP],chosenForPermission=ids.map(id=>byId.get(id));
  if(chosenForPermission.some(row=>row.id.startsWith('setting:')||row.id.startsWith('list:')))required.push('internal:db-put');
  for(const row of chosenForPermission.filter(row=>row.id.startsWith('setting:'))){const key=row.id.slice(8);if(IMMEDIATE[key])required.push('internal:'+IMMEDIATE[key]);if(['primaryColor','customColor'].includes(key))required.push('internal:update-primary-color');}
  if(chosenForPermission.some(row=>row.group==='plugin'&&row.different))required.push('internal:install-plugin-from-market');
  if(ids.includes('disabled'))required.push('internal:set-plugin-disabled');
  for(const row of chosenForPermission){
   if(row.id==='shortcut:main')required.push('internal:update-shortcut','internal:get-current-shortcut','internal:db-put');
   else if(row.id.startsWith('builtin:'))required.push('internal:db-put');
   else if(row.id.startsWith('shortcut:')){required.push('internal:db-put','internal:get-commands',`internal:register-${row.section}-shortcut`,`internal:unregister-${row.section}-shortcut`);if(row.needsPlugin&&!ids.includes('plugin:'+row.needsPlugin))throw Error(`快捷键需要同时选择安装插件 ${row.needsPlugin}`);}
  }
  await this.permissions.ensure(required,{interactive:true});
  // 在任何修改前备份当前可迁移配置和插件清单，保存于本机，不含账号和授权。
  const before=await this.capture(),recovery=pack(before);const backupPath=path.join(this.dataDir,`before-restore-${Date.now()}.zip`);fs.writeFileSync(backupPath,recovery.buffer,{mode:0o600});
  const results=[];const chosen=ids.map(id=>byId.get(id));
  for(const row of chosen.filter(row=>row.group==='plugin')){
   const registry=await this.get('plugins')||[];if(registry.some(plugin=>plugin.name===row.name)){results.push({title:row.title,status:'skipped',message:'已安装，保留现有版本'});continue;}
   try{const candidate=p.marketByName.get(row.name);if(!candidate)throw Error('市场中未找到此插件');const r=await this.call('install-plugin-from-market',candidate);if(!r?.success)throw Error(r?.error||'安装失败');const verify=await this.get('plugins')||[];if(!verify.some(plugin=>plugin.name===row.name))throw Error('安装后未找到注册记录');results.push({title:row.title,status:'success',message:'安装完成'});}catch(error){results.push({title:row.title,status:'failed',message:error.message});}
   this.notify({progress:`正在恢复插件：${row.title}`});
  }
  const settingRows=chosen.filter(row=>row.id.startsWith('setting:'));
  if(settingRows.length){
   try{
    const general={...await this.get('settings-general')};for(const row of settingRows)general[row.id.slice(8)]=row.value;await this.put('settings-general',general);
    const verified=await this.get('settings-general');for(const row of settingRows)if(!isDeepStrictEqual(verified[row.id.slice(8)],row.value))throw Error('设置回读校验失败');
    for(const row of settingRows){const key=row.id.slice(8);let warning='';if(IMMEDIATE[key])try{const r=await this.call(IMMEDIATE[key],row.value);if(r?.success===false)throw Error(r.error||'宿主未立即应用');}catch(error){warning=`；立即应用失败：${error.message}`;}
     results.push({title:row.title,status:'success',message:IMMEDIATE[key]?`已保存并请求宿主应用${warning}`:'已保存，下次重启 ZTools 后生效'});
    }
    if(settingRows.some(row=>['setting:primaryColor','setting:customColor'].includes(row.id)))await this.call('update-primary-color',general.primaryColor,general.customColor);
   }catch(error){results.push({title:'设置恢复',status:'failed',message:error.message});}
  }
  const registry=await this.get('plugins')||[],installed=new Set(registry.map(plugin=>plugin.name));
  for(const row of chosen.filter(row=>row.id.startsWith('list:'))){try{const key=row.id.slice(5),current=await this.get(key)||[];const values=row.value.filter(name=>installed.has(name)&&name!==SELF);let next;
    if(key==='plugin-order')next=[...new Set([...values,...current.filter(name=>installed.has(name))])];
    else {const sourceNames=new Set(p.snapshot.plugins.map(plugin=>plugin.name));next=[...new Set([...values,...current.filter(name=>!sourceNames.has(name))])];}
    await this.put(key,next);if(!isDeepStrictEqual(await this.get(key),next))throw Error('插件行为回读校验失败');results.push({title:row.title,status:'success',message:'已保存，下次重启 ZTools 后生效'});
   }catch(error){results.push({title:row.title,status:'failed',message:error.message});}}
  if(ids.includes('disabled')){try{const source=new Set(p.snapshot.plugins.map(plugin=>plugin.name));for(const plugin of registry)if(source.has(plugin.name)){const r=await this.call('set-plugin-disabled',plugin.path,p.snapshot.disabled.includes(plugin.name));if(r?.success===false)throw Error(r.error||'状态应用失败');}results.push({title:'插件禁用状态',status:'success',message:'已应用'});}catch(error){results.push({title:'插件禁用状态',status:'failed',message:error.message});}}
  for(const row of chosen.filter(row=>row.id==='shortcut:main')){
   let previousRuntime,previousGeneral,registered=false,persisted=false;
   try{
    previousRuntime=await this.call('get-current-shortcut');if(!shortcuts.accelerator(previousRuntime))throw Error('无法确认本机当前主快捷键，未修改');previousGeneral=await this.get('settings-general')||{};
    const state=await this.capture();const key=shortcuts.signature(row.value,this.platform);if([...state.shortcuts.global,...state.shortcuts.app].some(r=>shortcuts.signature(r.shortcut,this.platform)===key))throw Error('目标主快捷键已被其他配置占用');
    const r=await this.call('update-shortcut',row.value);if(r?.success!==true)throw Error(r?.error||'主快捷键注册失败');registered=true;
    persisted=true;await this.put('settings-general',{...await this.get('settings-general'),hotkey:row.value});
    if((await this.call('get-current-shortcut'))!==row.value||(await this.get('settings-general')).hotkey!==row.value)throw Error('主快捷键运行状态或保存结果校验失败');
    results.push({title:row.title,status:'success',message:'已注册并保存：'+shortcutText(row.value,this.platform)});
   }catch(error){
    const failures=[];if(registered)try{const r=await this.call('update-shortcut',previousRuntime);if(r?.success!==true)throw Error(r?.error||'注册失败');}catch(e){failures.push('运行绑定回滚失败：'+e.message);}
    if(persisted)try{const general={...await this.get('settings-general')};if(Object.hasOwn(previousGeneral,'hotkey'))general.hotkey=previousGeneral.hotkey;else delete general.hotkey;await this.put('settings-general',general);}catch(e){failures.push('配置回滚失败：'+e.message);}
    results.push({title:row.title,status:'failed',message:error.message+(failures.length?'；'+failures.join('；'):'')});
   }
  }
  for(const row of chosen.filter(row=>row.id.startsWith('builtin:'))){try{const general={...await this.get('settings-general')};general.builtinAppShortcutsEnabled={...general.builtinAppShortcutsEnabled,[row.id.slice(8)]:row.value};await this.put('settings-general',general);if((await this.get('settings-general')).builtinAppShortcutsEnabled[row.id.slice(8)]!==row.value)throw Error('内置开关回读校验失败');results.push({title:row.title,status:'success',message:'已保存内置快捷键开关；需要时重启 ZTools 生效'});}catch(error){results.push({title:row.title,status:'failed',message:error.message});}}
  for(const row of chosen.filter(row=>row.id.startsWith('shortcut:')&&row.id!=='shortcut:main')){try{await shortcuts.restoreOne(this,row);results.push({title:row.title,status:'success',message:'已注册/更新状态并保存'});}catch(error){results.push({title:row.title,status:'failed',message:error.message});}}
  this.preview=null;this.lastResult=`恢复完成：成功 ${results.filter(r=>r.status==='success').length}，跳过 ${results.filter(r=>r.status==='skipped').length}，失败 ${results.filter(r=>r.status==='failed').length}`;this.notify(this.status());return {results,backupPath,summary:this.lastResult};
 });}
 close(){if(this.timer)clearInterval(this.timer);}
}
module.exports={Vault,pack,unpack,contentHash};

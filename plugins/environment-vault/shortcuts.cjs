'use strict';
const {isDeepStrictEqual}=require('util'),crypto=require('crypto');
const {shortcutText}=require('./platform-ui.js');
const mapping=require('./key-mapping.js');
const BUILTIN={search:'二次筛选',killPlugin:'终止当前插件',closePlugin:'关闭插件/隐藏窗口',esc:'ESC 行为'};
const KEY_ALIASES={minus:'-',comma:',',period:'.',slash:'/',backslash:'\\',semicolon:';',quote:"'",backquote:'`',bracketleft:'[',bracketright:']'};
const MODIFIERS={cmd:'Command',command:'Command',ctrl:'Ctrl',control:'Ctrl',cmdorctrl:'CommandOrControl',commandorcontrol:'CommandOrControl',alt:'Alt',option:'Alt',shift:'Shift',meta:'Super',super:'Super',win:'Super',altgr:'AltGr'};
const KEY=/^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Space|Tab|Esc|Escape|Enter|Return|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Plus|Minus|Comma|Period|Slash|Backslash|Semicolon|Quote|Backquote|BracketLeft|BracketRight|CapsLock|NumLock|PrintScreen|VolumeUp|VolumeDown|VolumeMute|MediaNextTrack|MediaPreviousTrack|MediaStop|MediaPlayPause|[,.\/;=\-\[\]`'])$/i;
/** 仅接受明确的 Electron 按键结构，备份不执行字符串或搬运机器路径。 */
function accelerator(value){
 if(typeof value!=='string'||value.length>100)return false;const parts=value.replace(/\+\+$/,'+Plus').split('+');
 if(parts.length===2&&MODIFIERS[parts[0].toLowerCase()]&&parts[0].toLowerCase()===parts[1].toLowerCase())return true;
 return parts.length<=5&&(KEY.test(parts.at(-1))||parts.at(-1)==='\\')&&parts.slice(0,-1).every(p=>!!MODIFIERS[p.toLowerCase()]);
}
function safeTarget(value){return typeof value==='string'&&value.length>0&&value.length<=300&&!/[\x00-\x1f\x7f]/.test(value)&&!/^[/\\]|^[A-Za-z]:|:\/\//.test(value);}
function record(row,strict=false){return !!row&&(!strict||Object.keys(row).every(k=>['shortcut','target','enabled','autoCopy','preScreenshotOptimization'].includes(k)))&&accelerator(row.shortcut)&&safeTarget(row.target)&&typeof row.enabled==='boolean'&&['autoCopy','preScreenshotOptimization'].every(k=>row[k]===undefined||typeof row[k]==='boolean');}
function validate(data){
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!['version','main','builtin','global','app'].includes(k))||data.version!==1||!data.builtin||typeof data.builtin!=='object'||Array.isArray(data.builtin))return false;
 if(data.main!==undefined&&!accelerator(data.main))return false;
 if(Object.entries(data.builtin).some(([k,v])=>!BUILTIN[k]||typeof v!=='boolean'))return false;
 return ['global','app'].every(kind=>Array.isArray(data[kind])&&data[kind].length<=500&&data[kind].every(row=>record(row,true)));
}
function capture(general,global,app){
 const data={version:1,builtin:{},global:[],app:[]};
 if(general.hotkey!==undefined){if(!accelerator(general.hotkey))throw Error('主唤起快捷键格式不兼容');data.main=general.hotkey;}
 for(const key of Object.keys(BUILTIN))data.builtin[key]=general.builtinAppShortcutsEnabled?.[key]??true;
 for(const [kind,rows] of [['global',global??[]],['app',app??[]]]){
  if(!Array.isArray(rows)||rows.length>500||rows.some(row=>!record(row)))throw Error(`${kind==='global'?'全局':'应用'}快捷键格式不兼容或包含机器路径目标`);
  data[kind]=rows.map(row=>({shortcut:row.shortcut,target:row.target,enabled:row.enabled,...(kind==='global'?{autoCopy:row.autoCopy??false,preScreenshotOptimization:row.preScreenshotOptimization??false}:{})}));
 }
 if(!validate(data))throw Error('内置快捷键开关格式不兼容');return data;
}
/** 按恢复时选择的方案转换三个修饰键；先在来源系统解析通用键名，再映射到目标系统。 */
function convert(value,from,to,config=null){
 if(!accelerator(value))return null;const map=from===to?null:mapping.resolve(config,from,to);if(from!==to&&!map)return null;let parts=value.replace(/\+\+$/,'+Plus').split('+');
 const double=parts.length===2&&MODIFIERS[parts[0].toLowerCase()]&&parts[0].toLowerCase()===parts[1].toLowerCase();
 parts=parts.map(p=>{let mod=MODIFIERS[p.toLowerCase()];if(!mod)return KEY_ALIASES[p.toLowerCase()]||p;
  // CommandOrControl 按备份系统解释，不能直接跳到目标系统的默认键。
  if(mod==='CommandOrControl')mod=from==='darwin'?'Command':'Ctrl';if(mod==='Super'&&from==='darwin')mod='Command';
  if(from!==to){if(mod==='AltGr')return null;if(mod==='Shift')return mod;return map[mod]||null;}return mod;
 });
 if(parts.some(p=>p===null))return null;if(double)return parts.join('+');const mods=parts.slice(0,-1);if(new Set(mods).size!==mods.length)return null;return parts.join('+');
}
function signature(value,platform){const converted=convert(value,platform,platform);if(!converted)return null;const parts=converted.split('+');return [...parts.slice(0,-1).sort(),parts.at(-1)].join('+').toLowerCase().replace(/escape$/,'esc').replace(/return$/,'enter');}
// 比较按键语义而非修饰键拼写，避免 Cmd/Command、顺序和大小写产生假差异。
function equivalent(a,b,platform){return !!a&&!!b&&signature(a.shortcut,platform)===signature(b.shortcut,platform)&&isDeepStrictEqual({...a,shortcut:''},{...b,shortcut:''});}
function targetMap(commands){
 const map=new Map();
 for(const c of [...(commands?.commands||[]),...(commands?.regexCommands||[])]){
  if(c.type==='plugin'&&c.pluginName&&c.name){const value=`${c.pluginName}/${c.name}`;for(const label of [c.pluginName,c.pluginTitle])if(label)map.set(`${label}/${c.name}`,value);}
  else if(c.type==='direct'&&['app','local-shortcut'].includes(c.subType)&&safeTarget(c.name))map.set(c.name,c.name);
 }
 return map;
}
function canonical(target,plugins){target=target.split('/').map(part=>part.trim()).join('/');for(const p of plugins){for(const prefix of [p.name,p.title])if(target.startsWith(prefix+'/'))return p.name+'/'+target.slice(prefix.length+1).trim();}return target;}
function occupied(value,kind,current,platform,main){
 const key=signature(value.shortcut,platform);if(key===signature(main,platform))return '与主唤起快捷键冲突';
 for(const type of ['global','app'])for(const row of current[type])if(signature(row.shortcut,platform)===key&&(type!==kind||row.target!==value.target))return '本机相同按键已绑定其他目标';
 if(kind==='app'){
  const mod=platform==='darwin'?'Command':'Ctrl';const reserved=[mod+'+D',mod+'+,',platform==='darwin'?'Alt+Command+I':'Ctrl+Shift+I','Tab'];
  for(const [name,keyValue] of Object.entries({search:mod+'+F',killPlugin:mod+'+Q',closePlugin:mod+'+W',esc:'Esc'}))if(current.builtin[name]!==false)reserved.push(keyValue);
  if(reserved.some(v=>signature(v,platform)===key))return '与 ZTools 内置应用快捷键冲突';
 }
 return '';
}
/** 预览保留原值与目标系统转换值；缺失插件需显式同时选择安装，恢复时再次确认指令。 */
function rows(snapshot,current,platform,commands,installable,config=null){
 if(!snapshot.shortcuts)return [];const source=snapshot.shortcuts,available=targetMap(commands),result=[];
 const cross=snapshot.manifest.platform!==platform,pending=cross&&!mapping.normalize(config,snapshot.manifest.platform,platform);
 const mainValue=source.main?convert(source.main,snapshot.manifest.platform,platform,config):null;
 if(source.main){const collision=mainValue&&[...current.global,...current.app].some(r=>signature(r.shortcut,platform)===signature(mainValue,platform));result.push({id:'shortcut:main',section:'basic',group:'setting',title:'主唤起快捷键',value:mainValue,current:current.main??'未配置',enabled:pending||!!mainValue&&!collision,needsMapping:pending,reason:pending?'恢复前请选择快捷键映射方案':!mainValue?'无法可靠转换此快捷键':collision?'与本机其他快捷键配置冲突':'',sourceValue:source.main,sourcePlatform:snapshot.manifest.platform,targetPlatform:platform,different:pending||signature(mainValue,platform)!==signature(current.main,platform)});}
 for(const [key,value] of Object.entries(source.builtin))result.push({id:'builtin:'+key,section:'builtin',group:'setting',title:BUILTIN[key],value,current:current.builtin[key]??true,enabled:true,different:value!==(current.builtin[key]??true)});
 for(const kind of ['global','app'])current[kind]=current[kind].map(r=>({...r,target:canonical(r.target,snapshot.plugins)}));
 const main=mainValue||current.main;
 for(const kind of ['global','app'])source[kind].forEach((original,index)=>{
  const key=convert(original.shortcut,snapshot.manifest.platform,platform,config);const value={...original,shortcut:key||original.shortcut,target:canonical(original.target,snapshot.plugins)};const existing=current[kind].find(r=>signature(r.shortcut,platform)===signature(value.shortcut,platform));
  let reason=key||pending?'':'无法可靠转换此快捷键';let needsPlugin;
  if(!reason&&!available.has(value.target)){
   const plugin=snapshot.plugins.find(p=>value.target.startsWith(p.name+'/'));if(plugin&&installable.has(plugin.name)){needsPlugin=plugin.name;reason='';}else reason='本机未找到目标插件或指令';
  }
  if(!reason&&!pending)reason=occupied(value,kind,current,platform,main)||occupied(value,kind,current,platform,current.main);
  const duplicates=['global','app'].flatMap(type=>source[type].map((r,i)=>({type,i,key:convert(r.shortcut,snapshot.manifest.platform,platform,config)}))).filter(r=>r.key&&signature(r.key,platform)===signature(value.shortcut,platform));
  if(!reason&&!pending&&duplicates.length>1)reason='备份中的多项快捷键转换后按键冲突';
  result.push({id:`shortcut:${kind}:${index}`,section:kind,group:'setting',title:`${pending?'待映射 · '+shortcutText(original.shortcut,snapshot.manifest.platform):shortcutText(value.shortcut,platform)} → ${value.target}`,value:pending?null:value,current:existing||'未配置',needsMapping:pending,sourceValue:original,sourcePlatform:snapshot.manifest.platform,targetPlatform:platform,enabled:!reason,reason:reason||(pending?'恢复前请选择快捷键映射方案':needsPlugin?`需同时选择安装插件 ${needsPlugin}；安装后再次核对指令`:key!==original.shortcut?'已转换为目标系统的修饰键':''),needsPlugin,different:pending||!equivalent(value,existing,platform)});
 });return result;
}
async function checked(call,name,...args){const result=await call(name,...args);if(result?.success!==true)throw Error(result?.error||`${name} 失败`);}
/** 单个快捷键先注册再落盘，失败补偿原注册与原列表；不覆盖未选中的绑定。 */
async function restoreOne(vault,row){
 const kind=row.section,dbKey=kind==='global'?'global-shortcuts':'app-shortcuts',register=`register-${kind}-shortcut`,unregister=`unregister-${kind}-shortcut`;
 const old=await vault.get(dbKey)??[];const general=await vault.get('settings-general')??{};const current=capture(general,await vault.get('global-shortcuts'),await vault.get('app-shortcuts'));const commands=targetMap(await vault.call('get-commands'));
 if(!commands.has(row.value.target))throw Error('安装后或恢复时仍未找到目标指令，未注册');
 for(const type of ['global','app'])current[type]=current[type].map(r=>({...r,target:commands.get(r.target)||r.target}));
 const reason=occupied(row.value,kind,current,vault.platform,await vault.call('get-current-shortcut'));if(reason)throw Error(reason);
 const index=old.findIndex(r=>signature(r.shortcut,vault.platform)===signature(row.value.shortcut,vault.platform)),previous=index<0?null:old[index];
 const reg=async r=>checked(vault.call.bind(vault),register,r.shortcut,r.target,...(kind==='global'?[r.autoCopy??false,r.preScreenshotOptimization??false]:[]));
 let registrationAttempted=false,persistenceAttempted=false;
 try{
  // 先清理旧写法对应的宿主 Map，避免 Cmd/Command 等别名留下旧注册元数据。
  if(previous?.enabled){registrationAttempted=true;await checked(vault.call.bind(vault),unregister,previous.shortcut);}
  if(row.value.enabled){registrationAttempted=true;await reg(row.value);}
  const next=structuredClone(old),entry={...(previous||{id:crypto.randomUUID()}),...row.value};if(index<0)next.push(entry);else next[index]=entry;
  persistenceAttempted=true;await vault.put(dbKey,next);if(!isDeepStrictEqual(await vault.get(dbKey),next))throw Error('快捷键列表回读校验失败');
 }catch(error){
  const rollback=[];
  if(registrationAttempted)try{await checked(vault.call.bind(vault),unregister,row.value.shortcut);if(previous?.enabled)await reg(previous);}catch(e){rollback.push('注册回滚失败：'+e.message);}
  if(persistenceAttempted)try{await vault.put(dbKey,old);if(!isDeepStrictEqual(await vault.get(dbKey),old))throw Error('回读不一致');}catch(e){rollback.push('列表回滚失败：'+e.message);}
  throw Error(error.message+(rollback.length?'；'+rollback.join('；'):'；已保留/恢复原绑定'));
 }
}
module.exports={BUILTIN,accelerator,validate,capture,convert,signature,targetMap,rows,restoreOne};

'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),{EventEmitter}=require('events'),{stripTypeScriptTypes}=require('module');
const sourceRoot=path.join(__dirname,'fixtures/host-beta2');
/** 执行固定 beta.2 源码，Electron 窗口和持久化边界全部替换为内存夹具。 */
function load(file,globals,extra=''){
 let code=stripTypeScriptTypes(fs.readFileSync(path.join(sourceRoot,file),'utf8'));
 code=code.replace(/^import[\s\S]*?from ['"][^'"]+['"];?\s*$/gm,'');
 const names=[...code.matchAll(/^export (?:const|function|class) (\w+)/gm)].map(m=>m[1]);
 code=code.replace(/^export default ([^\n]+)/gm,'module.exports.default = $1').replace(/^export /gm,'');
 const ctx={module:{exports:{}},console:{log(){},error(){}},setTimeout,clearTimeout,...globals};
 vm.runInNewContext(code+'\n'+names.map(n=>`module.exports.${n}=${n};`).join('\n')+extra,ctx,{filename:file});return ctx.module.exports;
}
function createPermissionHost(host){
 const handlers=new Map(),listeners=new Map(),windows=[],requests=[],events=[];
 class BrowserWindow extends EventEmitter{
  constructor(){super();this.webContents={id:windows.length+100};this.destroyed=false;windows.push(this);}
  loadURL(url){this.html=decodeURIComponent(url.split(',').slice(1).join(','));queueMicrotask(()=>this.emit('ready-to-show'));}
  isDestroyed(){return this.destroyed;}show(){}close(){this.destroyed=true;this.emit('closed');}
 }
 const ipcMain={handle:(name,fn)=>handlers.set(name,fn),on:(name,fn)=>listeners.set(name,fn)};
 const core=load('src/main/core/internalPlugins.ts',{app:{getAppPath:()=>sourceRoot},path});
 const all=fs.readFileSync(path.join(sourceRoot,'src/main/api/plugin/internal.ts'),'utf8');
 for(const channel of all.matchAll(/['"](internal:[a-z0-9-]+)['"]/g))core.registerInternalApiChannel(channel[1]);
 const info=()=>{const general=host.data['settings-general'];const disabled=(general.customInternalApiDisabledPlugins||[]).includes('environment-vault');return {name:'environment-vault',canUseInternalApi:!disabled&&(general.customInternalApiPluginNames||[]).includes('environment-vault'),internalApiPermissions:disabled?[]:(general.customInternalApiPermissions?.['environment-vault']||[])};};
 const manager={getPluginInfoByWebContents:()=>info(),broadcastToPluginWebContents:channel=>events.push(channel)};
 const guardSource=all.slice(all.indexOf('export function requireInternalPlugin('),all.indexOf('/**\n * 内置插件专用 API 类'));
 const guard=vm.runInNewContext(stripTypeScriptTypes(guardSource).replace('export ','')+'\nrequireInternalPlugin');
 const dialog=load('src/main/api/plugin/internalApiRequestDialog.ts',{BrowserWindow,ipcMain,nativeTheme:{shouldUseDarkColors:false},screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1280,height:800}})},windowManager:{getMainWindow:()=>null}}).default;
 const enqueue=dialog.enqueue.bind(dialog);dialog.enqueue=(name,entry)=>{requests.push(structuredClone(entry));enqueue(name,entry);};
 const databaseAPI={dbGet:key=>structuredClone(host.data[key]??null),dbPut:(key,value)=>{host.data[key]=structuredClone(value);return {ok:true};}};
 class PermissionDeniedError extends Error{}
 const permissionAPI=load('src/main/api/plugin/internalApiPermissions.ts',{...core,BrowserWindow,ipcMain,databaseAPI,requireInternalPlugin:guard,PermissionDeniedError,internalApiRequestDialog:dialog}).default;
 permissionAPI.init({webContents:{send:channel=>events.push(channel)}},manager);
 const sender={id:1};
 return {requests,windows,events,core,dialog,info,
  invoke:async(channel,...args)=>{if(handlers.has(channel))return handlers.get(channel)({sender},...args);if(channel.startsWith('internal:')&&!guard(manager,{sender},channel))throw Error('PermissionDeniedError: '+channel);return host.invoke(channel,...args);},
  resolve:async(action,apis)=>{await dialog.handleDialogAction({action,apis});},
  grant:apis=>{host.data['settings-general'].customInternalApiPermissions={'environment-vault':apis};},
  close:()=>{for(const w of windows)if(!w.destroyed)w.close();}
 };
}
module.exports={createPermissionHost};

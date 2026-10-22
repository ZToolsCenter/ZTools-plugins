'use strict';
const {ipcRenderer}=require('electron');
let vault,initializationError;
function engine(){
 if(initializationError)throw initializationError;
 if(!vault){try{const {Vault}=require('./vault.cjs');vault=new Vault({invoke:(...args)=>ipcRenderer.invoke(...args),dataDir:window.ztools.getPath('pluginData'),notify:detail=>window.dispatchEvent(new CustomEvent('vault-status',{detail}))});}catch(error){initializationError=error;throw error;}}
 return vault;
}
// 页面只能调用固定业务动作，不能指定 IPC 通道、写任意设置或直接读写文件。
window.environmentVault={status:()=>engine().status(),permissions:()=>engine().permissions.state(),save:input=>engine().saveConfig(input),upload:()=>engine().upload(false),versions:local=>engine().versions(local),deleteVersion:(name,local)=>engine().deleteVersion(name,local),preview:(name,local)=>engine().loadVersion(name,local),saveMapping:config=>engine().saveMapping(config),remap:(token,config)=>engine().remap(token,config),restore:(token,ids)=>engine().restore(token,ids)};
// 自动启动插件时也建立定时器，不依赖页面保持前台。
window.addEventListener('DOMContentLoaded',()=>{try{engine();}catch{}});

// 宿主审批、撤销或停用授权时刷新状态；不自动重试写入或重新弹出申请。
ipcRenderer.on('internal-api-permissions-changed',()=>window.dispatchEvent(new CustomEvent('vault-status',{detail:{permissionsChanged:true}})));

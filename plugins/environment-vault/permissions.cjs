'use strict';
const BACKUP=['internal:db-get','internal:get-disabled-plugins','internal:get-current-shortcut'];
const IMMEDIATE={theme:'set-theme',opacity:'set-window-opacity',compactMainWindowHeader:'set-compact-main-window-header',windowDefaultHeight:'set-window-default-height',placeholder:'update-placeholder',autoPaste:'update-auto-paste',autoClear:'update-auto-clear',autoBackToSearch:'update-auto-back-to-search',hideMainWindowOnPluginEsc:'update-hide-main-window-on-plugin-esc',windowPositionStrategy:'update-window-position-strategy',showRecentInSearch:'update-show-recent-in-search',showMatchRecommendation:'update-match-recommendation',recentRows:'update-recent-rows',pinnedRows:'update-pinned-rows',searchMode:'update-search-mode',tabKeyFunction:'update-tab-key-function',localAppSearch:'update-local-app-search',showTrayIcon:'set-tray-icon-visible',windowMaterial:'set-window-material'};
// 仅列出备份、恢复和后台启动实际使用的通道，不请求完全授权或权限管理能力。
const ALL=[...new Set([...BACKUP,'internal:db-put','internal:fetch-plugin-market','internal:get-commands','internal:install-plugin-from-market','internal:set-plugin-disabled','internal:update-shortcut','internal:update-primary-color','internal:register-global-shortcut','internal:unregister-global-shortcut','internal:register-app-shortcut','internal:unregister-app-shortcut',...Object.values(IMMEDIATE).map(name=>'internal:'+name)])];
const REASON='环境备份与恢复需要读取设置/快捷键/插件清单、查询市场和指令，以及按所选项目写入和应用设置、注册快捷键、安装插件和维护后台启动。首次使用一次申请全部所需权限；批准本身不会执行恢复。';
/** 用户首次主动备份/预览/恢复时一次申请完整权限；后台从不申请。 */
class Permissions {
 constructor(invoke,notify=()=>{}){this.invoke=invoke;this.notify=notify;}
 async state(){
  let state;try{state=await this.invoke('plugin:get-internal-api-permissions');}catch{throw Error('请升级至 ZTools 3.3.0-beta.2 或更新版本后使用授权功能');}
  if(typeof state?.fullAccess!=='boolean'||!Array.isArray(state.granted)||!Array.isArray(state.pending))throw Error('宿主未提供可识别的高级 API 授权状态，请使用 ZTools 3.3.0-beta.2 或更新版本');return {...state,required:[...ALL]};
 }
 async ensure(apis,{interactive=false}={}){
  if(apis.some(api=>!ALL.includes(api)))throw Error('插件所需权限未列入统一申请清单，请更新插件');
  const state=await this.state();if(state.fullAccess)return state;
  if(!interactive){if(state.fullAccess||apis.every(api=>state.granted.includes(api)))return state;throw Error('缺少高级 API 授权，请在插件内手动执行一次备份或读取版本以完成授权');}
  // 已获批时宿主直接返回 granted，不产生弹窗；由宿主处理撤销、部分批准和整体停用，不能仅信任历史 granted。
  const result=await this.invoke('plugin:request-internal-api-permissions',ALL,REASON);if(!result?.success)throw Error(result?.error||'授权申请失败');
  const current=await this.state();
  if(result.status==='granted'&&(current.fullAccess||ALL.every(api=>current.granted.includes(api))))return current;
  this.notify({permissionsChanged:true});throw Error('授权申请已提交，请在 ZTools 弹窗中批准全部所需权限后重试当前操作；部分批准、拒绝或停用时不会执行任务');
 }
}
module.exports={Permissions,BACKUP,ALL,IMMEDIATE};

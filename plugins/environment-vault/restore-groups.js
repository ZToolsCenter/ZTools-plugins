'use strict';
(function(root){
 // 与 beta.2 设置页的分类、顺序一致；未支持的终端、网络、开发者项不创建空组。
 const groups=[
  {id:'basic',title:'通用设置 · 基础',keys:['shortcut:main','showTrayIcon','ignoreHotkeysOnFullscreen']},
  {id:'appearance',title:'通用设置 · 外观',keys:['theme','compactMainWindowHeader','primaryColor','customColor','opacity','windowMaterial','acrylicLightOpacity','acrylicDarkOpacity']},
  {id:'search',title:'通用设置 · 搜索',keys:['placeholder','searchMode','showRecentInSearch','showMatchRecommendation','recentRows','pinnedRows','localAppSearch','tabKeyFunction']},
  {id:'behavior',title:'通用设置 · 行为',keys:['autoPaste','autoClear','hideMainWindowOnPluginEsc','autoBackToSearch','windowPositionStrategy','windowDefaultHeight','clipboardRetentionDays']},
  {id:'super-panel',title:'通用设置 · 超级面板',keys:['superPanelEnabled','superPanelMouseButton','superPanelLongPressMs','superPanelTranslateEnabled']},
  {id:'floating-ball',title:'通用设置 · 悬浮球',keys:['floatingBallEnabled']},
  {id:'global',title:'快捷键 · 全局快捷键',prefix:'shortcut:global:'},
  {id:'app',title:'快捷键 · 应用快捷键',prefix:'shortcut:app:'},
  {id:'builtin',title:'快捷键 · 内置快捷键开关',prefix:'builtin:'},
  {id:'plugin-behavior',title:'已安装插件 · 插件行为',keys:['list:plugin-order','list:auto-start-plugin','list:auto-detach-plugin','list:out-kill-plugin','list:enabled-main-push-plugin','disabled']},
  {id:'updates',title:'关于 · 更新',keys:['autoCheckUpdate']}
 ];
 function groupFor(row){const key=row.id.startsWith('setting:')?row.id.slice(8):row.id;return groups.find(g=>g.keys?.includes(key)||g.prefix&&row.id.startsWith(g.prefix))||{id:'other',title:'其他已备份设置',keys:[]};}
 function rank(row){const g=groupFor(row),index=groups.findIndex(entry=>entry.id===g.id);return (index<0?groups.length:index)*1000+Math.max(0,g.keys?.indexOf(row.id.startsWith('setting:')?row.id.slice(8):row.id)||0);}
 const api={groups,groupFor,rank};root.RestoreGroups=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);

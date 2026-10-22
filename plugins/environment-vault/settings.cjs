'use strict';
// 明确列出可迁移字段；账号、代理、内部 API 授权和路径不进入备份；快捷键由 shortcuts.cjs 单独校验。
const DEFINITIONS = {
  theme:['主题','enum', ['system','light','dark']],
  primaryColor:['主题色','string'], customColor:['自定义颜色','string'],
  opacity:['窗口透明度','number',0.1,1], compactMainWindowHeader:['紧凑顶部栏','boolean'],
  windowDefaultHeight:['默认窗口高度','number',200,2000], placeholder:['搜索框提示','string'],
  autoPaste:['自动粘贴','boolean'], autoClear:['自动清空输入','boolean'],
  autoBackToSearch:['自动返回搜索','enum',['immediately','next-show','never','on-hide','on-show']],
  hideMainWindowOnPluginEsc:['插件内 ESC 隐藏窗口','boolean'],
  windowPositionStrategy:['窗口呼出位置','enum',['primary','mouse','last','center','follow-mouse']],
  showRecentInSearch:['显示最近使用','boolean'], showMatchRecommendation:['显示匹配推荐','boolean'],
  localAppSearch:['搜索本机应用','boolean'], recentRows:['最近使用行数','number',0,30], pinnedRows:['固定区行数','number',0,30],
  searchMode:['搜索模式','enum',['aggregate','list','default','mixed','compact','grid']],
  tabKeyFunction:['Tab 按键行为','enum',['navigate','none','command','plugin','switch','select','autocomplete']],
  showTrayIcon:['显示托盘图标','boolean'], clipboardRetentionDays:['剪贴板保留天数','number',1,3650],
  floatingBallEnabled:['启用悬浮球','boolean'], superPanelEnabled:['启用超级面板','boolean'],
  superPanelMouseButton:['超级面板鼠标按钮','enum',['middle','right','left']],
  superPanelLongPressMs:['超级面板长按时间','number',100,5000],
  superPanelTranslateEnabled:['超级面板翻译','boolean'], ignoreHotkeysOnFullscreen:['全屏时忽略快捷键','boolean'],
  autoCheckUpdate:['自动检查更新','boolean'],
  windowMaterial:['窗口材质（同系统）','string',null,null,'same-os'],
  acrylicLightOpacity:['浅色材质透明度（同系统）','number',0,100,'same-os'],
  acrylicDarkOpacity:['深色材质透明度（同系统）','number',0,100,'same-os']
};
const LISTS={ 'plugin-order':'插件排序', 'auto-start-plugin':'自动启动插件', 'auto-detach-plugin':'自动分离插件', 'out-kill-plugin':'退出时结束的插件', 'enabled-main-push-plugin':'启用主搜索推送的插件' };
const SELF='environment-vault';
function valid(key,value){
 const d=DEFINITIONS[key]; if(!d)return false;
 if(d[1]==='number')return typeof value==='number'&&Number.isFinite(value)&&value>=d[2]&&value<=d[3];
 if(d[1]==='enum')return typeof value==='string'&&d[2].includes(value);
 if(d[1]==='string')return typeof value==='string'&&value.length<=300;
 return typeof value===d[1];
}
function validNames(value){return Array.isArray(value)&&value.length<=1000&&value.every(v=>typeof v==='string'&&/^[\w.-]{1,160}$/.test(v));}
module.exports={DEFINITIONS,LISTS,SELF,valid,validNames};

'use strict';
(function(root){
 const labels={theme:{system:'跟随系统',light:'明亮',dark:'暗黑'},searchMode:{aggregate:'聚合模式',list:'列表模式',default:'默认',mixed:'混合',compact:'紧凑',grid:'网格'},tabKeyFunction:{navigate:'切换选中','target-command':'目标指令',none:'无',command:'指令',plugin:'插件',switch:'切换',select:'选择',autocomplete:'自动补全'},windowPositionStrategy:{remember:'记住上次位置',cursor:'鼠标屏居中',primary:'主屏居中',lastActive:'上次活动屏居中',mouse:'鼠标屏',last:'上次位置',center:'居中','follow-mouse':'跟随鼠标'},autoBackToSearch:{immediately:'立即',never:'从不','next-show':'下次显示','on-hide':'隐藏时','on-show':'显示时'},superPanelMouseButton:{middle:'鼠标中键',right:'鼠标右键',left:'鼠标左键','middle-long':'长按中键','right-long':'长按右键',back:'鼠标后退键',forward:'鼠标前进键'},windowMaterial:{none:'无',mica:'Mica（云母）',acrylic:'Acrylic（亚克力）',vibrancy:'毛玻璃'},primaryColor:{default:'默认',purple:'紫色',blue:'蓝色',green:'绿色',red:'红色',orange:'橙色',pink:'粉色',custom:'自定义'}};
 /** 卡片显示备份的具体值；保留未知字符串，不把不认识的选项猜成默认值。 */
 function format(row,value,names={}){
  const key=row.id.startsWith('setting:')?row.id.slice(8):row.id;
  if(value===null||value===undefined)return '未配置';if(typeof value==='boolean')return value?'开启':'关闭';
  if(Array.isArray(value))return value.length?value.map(n=>names[n]||n).join('、'):'无';
  if(row.sourcePlatform&&row.id.startsWith('shortcut:')){if(typeof value==='string')return root.PlatformUI.shortcutText(value,row.targetPlatform);if(value.shortcut)return [root.PlatformUI.shortcutText(value.shortcut,row.targetPlatform),value.enabled?'启用':'停用',value.autoCopy?'自动复制':'',value.preScreenshotOptimization?'截图优化':''].filter(Boolean).join(' · ');}
  if(typeof value==='number'){if(key==='opacity')return Math.round(value*100)+'%';const units={windowDefaultHeight:' px',clipboardRetentionDays:' 天',recentRows:' 行',pinnedRows:' 行',superPanelLongPressMs:' ms',acrylicLightOpacity:'%',acrylicDarkOpacity:'%'};return value+(units[key]||'');}
  if(typeof value==='string')return labels[key]?.[value]||(/^\d+[sm]$/.test(value)&&key==='autoBackToSearch'?value.replace('s',' 秒').replace('m',' 分钟'):value===''?'空白':value);
  return Object.entries(value).map(([k,v])=>k+'：'+String(v)).join('；');
 }
 function card(row,names){
  if(row.needsMapping)return '待映射 · '+root.PlatformUI.shortcutText(typeof row.sourceValue==='string'?row.sourceValue:row.sourceValue.shortcut,row.sourcePlatform);
  if(row.group==='plugin')return '备份 v'+row.value+' · '+(row.current==='未安装'?'待安装':'本机 v'+row.current);
  if(Array.isArray(row.value)&&row.value.length>3)return row.value.slice(0,3).map(n=>names?.[n]||n).join('、')+' 等 '+row.value.length+' 个';
  return format(row,row.value,names);
 }
 const api={format,card};root.SettingValues=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);

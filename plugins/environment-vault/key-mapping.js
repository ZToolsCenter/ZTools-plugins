'use strict';
(function(root){
 const keys=platform=>platform==='darwin'?['Ctrl','Alt','Command']:['Ctrl','Super','Alt'];
 /** 一份 Mac/Windows 对照表必须一一对应，Windows 恢复到 Mac 时直接反转此表。 */
 function preference(config){
  if(config===null||config===undefined)return null;
  if(!config||typeof config!=='object'||Array.isArray(config)||!['standard','position','custom'].includes(config.mode)||Object.keys(config).some(k=>!['mode','custom'].includes(k)))throw Error('请选择有效的快捷键映射方案');
  if(config.mode!=='custom')return {mode:config.mode};
  const source=keys('darwin'),target=keys('win32'),custom=config.custom;
  if(!custom||typeof custom!=='object'||Array.isArray(custom)||Object.keys(custom).length!==3||source.some(k=>!Object.hasOwn(custom,k)||!target.includes(custom[k]))||new Set(Object.values(custom)).size!==3)throw Error('请完整配置三个修饰键，Windows 对应键不能重复');
  return {mode:'custom',custom:Object.fromEntries(source.map(k=>[k,custom[k]]))};
 }
 function normalize(config,from,to){if(!['darwin','win32'].includes(from)||!['darwin','win32'].includes(to))throw Error('不支持的映射系统');return from===to?null:preference(config);}
 function resolve(config,from,to){
  const normalized=normalize(config,from,to);if(!normalized)return null;
  const table=normalized.mode==='custom'?normalized.custom:normalized.mode==='position'?{Ctrl:'Ctrl',Alt:'Super',Command:'Alt'}:{Ctrl:'Ctrl',Alt:'Alt',Command:'Super'};
  return from==='darwin'?{...table}:Object.fromEntries(Object.entries(table).map(([mac,win])=>[win,mac]));
 }
 /** 旧偏好只在两方向语义一致时合并；冲突不猜选，用提示要求重新确认。 */
 function migrate(saved){
  if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error('本机映射偏好格式无效');
  if(saved.version===2){if(!Object.hasOwn(saved,'mapping')||Object.keys(saved).some(k=>!['version','mapping'].includes(k)))throw Error('本机映射偏好格式无效');return {mapping:preference(saved.mapping),notice:''};}
  if(Object.keys(saved).some(k=>!['darwin-win32','win32-darwin','selectedDirection'].includes(k)))throw Error('本机映射偏好格式无效');
  if(saved.selectedDirection!==undefined&&!['darwin-win32','win32-darwin'].includes(saved.selectedDirection))throw Error('旧版映射偏好格式无效');
  const candidates=[];let oldStandard=false;
  for(const direction of ['darwin-win32','win32-darwin']){const config=saved[direction];if(!config)continue;
   if(config.mode==='legacy'){candidates.push({mode:'standard'});oldStandard=true;}
   else if(config.mode==='custom'&&direction==='win32-darwin'){const custom=config.custom;if(!custom||Object.keys(custom).length!==3||keys('win32').some(k=>!Object.hasOwn(custom,k)||!keys('darwin').includes(custom[k]))||new Set(Object.values(custom)).size!==3)throw Error('旧版自定义映射无效');candidates.push(preference({mode:'custom',custom:Object.fromEntries(Object.entries(custom).map(([win,mac])=>[mac,win]))}));}
   else candidates.push(preference(config));
  }
  const signature=config=>JSON.stringify(keys('darwin').map(k=>resolve(config,'darwin','win32')[k]));
  if(new Set(candidates.map(signature)).size>1)return {mapping:null,notice:'旧版保存的两套映射不一致，请重新选择一份双向共用的方案。'};
  return {mapping:candidates[0]||null,notice:oldStandard?'标准功能映射已调整为 Control ↔ Ctrl、Option ↔ Alt、Command ↔ Win。':''};
 }
 const api={keys,preference,normalize,resolve,migrate};root.KeyMapping=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);

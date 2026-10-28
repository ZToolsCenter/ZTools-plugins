'use strict';
/** 从固定后缀识别系统，设备名可包含双下划线；仅接受本插件正式发布的快照名称。 */
function parseName(name){
 if(typeof name!=='string')return null;
 const match=/^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.\d{3}Z)__([\p{L}\p{N}_.-]{1,60})__(darwin|win32)__([a-f0-9]{8})\.zip$/u.exec(name);
 if(!match)return null;
 const iso=match[1].replace('_','T').replace(/T(\d{2})-(\d{2})-(\d{2})/,'T$1:$2:$3');
 if(!Number.isFinite(Date.parse(iso)))return null;
 return {name,time:new Date(iso).toLocaleString(),createdAt:iso,device:match[2],platform:match[3]};
}
const isLocalName=name=>typeof name==='string'&&/^before-restore-\d{1,16}\.zip$/.test(name);
module.exports={parseName,isLocalName};

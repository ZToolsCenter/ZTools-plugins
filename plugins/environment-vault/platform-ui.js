'use strict';
(function(root){
 const platformName=p=>p==='darwin'?'macOS':p==='win32'?'Windows':'未知系统';
 /** 仅转换显示符号，恢复仍使用经过校验的原始 Electron 按键；不从按键反推系统。 */
 function shortcutText(value,platform){
  if(typeof value!=='string')return '';
  const mods=platform==='darwin'?{command:'Command',cmd:'Command',super:'Command',meta:'Command',ctrl:'Control',control:'Control',alt:'Option',option:'Option',shift:'Shift',commandorcontrol:'Command',cmdorctrl:'Command'}:{super:'Win',meta:'Win',win:'Win',command:'Command',cmd:'Command',ctrl:'Ctrl',control:'Ctrl',alt:'Alt',option:'Alt',shift:'Shift',commandorcontrol:'Ctrl',cmdorctrl:'Ctrl'};
  return value.replace(/\+\+$/,'+Plus').split('+').map(p=>mods[p.toLowerCase()]||p).join(' + ');
 }
 const api={platformName,shortcutText};root.PlatformUI=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);

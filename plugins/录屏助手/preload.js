window.getUser = () => {
    return {
      type: 'member',
      avatar: 'https://res.u-tools.cn/assets/avatars/avatar.png',
      nickname: '会员',
    }
  }


const{ipcRenderer}=require("electron"),path=require("path"),fs=require("fs"),cp=require("child_process"),os=require("os"),addon=require("./addon-"+process.platform+"-"+process.arch+".node");window.CONTEXT_ENV={isWindows:"win32"===process.platform,isMacOS:"darwin"===process.platform,isLinux:"linux"===process.platform,nativeId:window.ztools.getNativeId()},window.CONTEXT_ENV.isMacOS&&(window.CONTEXT_ENV.isMacOS13=parseInt(os.release().split(".")[0],10)>=22),window.services={pathJoin:(e,r)=>path.join(e,r),getDirReallyPath:e=>{let r=window.ztools.dbStorage.getItem(e+"/"+window.CONTEXT_ENV.nativeId);if(r||(r="videos"),/^(?:[c-z]:|\/)/i.test(r)){if(!fs.existsSync(r))throw new Error(`"${r}" 路径不存在`);return r}const o=window.ztools.getPath(r);if(!o)throw new Error(`"${r}" 路径不存在`);return o},appendFile:(e,r)=>{fs.appendFileSync(e,Buffer.from(r))},ipcRegionRecording:(e,r,o,i)=>{ipcRenderer.on("start_"+e,(e,o)=>{r(o)}),ipcRenderer.on("cancel_"+e,e=>{o()}),ipcRenderer.on("stop_"+e,e=>{i()})},quitIpcRegionRecording:e=>{ipcRenderer.removeAllListeners("start_"+e),ipcRenderer.removeAllListeners("cancel_"+e),ipcRenderer.removeAllListeners("stop_"+e)},openWin32AudioControl:()=>{"win32"===process.platform&&cp.exec("control mmsys.cpl,,1")},recorderCapture:require("./recorder/index.js"),/*globalHookKeyF10:e=>{addon.globalHookKeyF10(()=>{e()})},quitGlobalHookKeyF10:()=>{addon.quitGlobalHookKeyF10()},*/activeWindow:e=>{"win32"===process.platform&&addon.activeWindow(parseInt(e))},screenCaptureAccess:()=>{if("darwin"===process.platform)return addon.screenCaptureAccess()}};

// 曲线救国，mac下快捷键native有问题，已注释
let stopCallback = null;
window.services.globalHookKeyF10 = (callback) => {
  console.log('globalHookKeyF10' , callback);
  stopCallback = callback;
}
ipcRenderer.on('stopRecord', (event) => {
  console.log('stopRecord' , event);
  stopCallback && stopCallback();
});
// One connection state shared by research and English UI; never reads API keys.
(function(){
 'use strict';
 let current={ok:false,state:'idle',message:'进入页面后自动检测当前 AI。'},pending=null,revision=0;
 const listeners=new Set();
 function publish(value){current=value;for(const listener of listeners)listener({...current});return {...current}}
 async function refresh(force=false){
  if(pending)return pending;
  const token=revision,api=window.researchApi;
  publish({ok:false,state:'checking',message:'正在检测 AI 连接…'});
  pending=(async()=>{
   let result;
   try{result=api?.checkAvailability?await api.checkAvailability({force}):{ok:false,state:'unconfigured',message:api?'当前连接无法检测，请重新加载最新版插件。':'请在 ZTools 中配置 AI，或使用自己的 AI Agent。'}}
   catch{result={ok:false,state:'unavailable',message:'连接检测失败，请检查网络与模型配置后重试。'}}
   if(token===revision)publish(result);
   return {...current};
  })();
  try{return await pending}finally{pending=null}
 }
 window.AIConnection={refresh,get:()=>({...current}),invalidate(){revision++;publish({ok:false,state:'idle',message:'模型配置已更新，请重新检测。'})},subscribe(fn){listeners.add(fn);fn({...current});return()=>listeners.delete(fn)}};
})();

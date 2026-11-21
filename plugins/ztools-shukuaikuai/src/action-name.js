import {watch,onBeforeUnmount} from 'vue';

export function suggestedName(action){
  const value=(action.value||'').trim();
  if(action.type==='plugin')return [action.pluginTitle,value].filter(Boolean).join(' · ');
  if(action.type==='url'){
    try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.hostname.replace(/^www\./,''):''}catch{return ''}
  }
  if(!['app','path'].includes(action.type)||!value)return '';
  const name=value.replace(/[\\/]+$/,'').split(/[\\/]/).pop()||value;
  return action.type==='app'?name.replace(/\.(exe|lnk|appref-ms|bat|cmd)$/i,''):name;
}

// Generated names follow the target until the user supplies their own name.
// Ownership stays in memory; opening an existing action never renames it.
export function useActionName(current){
  const generated=new WeakMap();let revision=0,timer;
  watch(()=>{const a=current.value;return [a,a?.type,a?.value,a?.pluginId,a?.pluginTitle]},()=>{
    clearTimeout(timer);const token=++revision,action=current.value;
    if(!action||action.name?.trim()&&action.name!==generated.get(action))return;
    const next=suggestedName(action);action.name=next;generated.set(action,next);
    if(action.type!=='url'||!next||!window.skk?.actionName)return;
    const value=action.value;
    timer=setTimeout(async()=>{
      try{
        const name=await window.skk.actionName({type:'url',value});
        if(name&&revision===token&&current.value===action&&action.value===value&&action.name===generated.get(action)){
          action.name=name;generated.set(action,name);
        }
      }catch{/* Keep the hostname when the page has no readable title. */}
    },500);
  },{immediate:true});
  onBeforeUnmount(()=>{revision++;clearTimeout(timer)});
}

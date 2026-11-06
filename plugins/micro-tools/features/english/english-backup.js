// Portable learning data only. Credentials, endpoint settings and media are excluded.
const C=require('./english-core');
const clone=x=>JSON.parse(JSON.stringify(x));
const FORMAT='research-english-full-backup-v1';
const fixed=['research-english-library-v1','english-settings-v1','english-trash-v1','english-vocabulary-v1','english-activity-v1','english-achievements-v1','english-material-appearance-v1','english-wordbooks-v1','english-wordbooks-trash-v1','english-wordbook-preferences-v1','english-catalog-settings-v1'];
const allowedKey=k=>fixed.includes(k)||k==='english-course-badges-v1'||/^english-progress:english-[a-z0-9-]+$/.test(k)||/^english-wordbook-(progress|cardtime):[a-z0-9-]+$/.test(k);
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
function validate(raw){
 if(![FORMAT,'research-english-web-backup-v1'].includes(raw?.format)||!object(raw.data))throw Error('请选择双端完整备份或旧版网页完整备份');
 const serialized=JSON.stringify(raw);if(serialized.length>32*1024*1024)throw Error('完整备份最大 32 MB');
 const data=JSON.parse(serialized).data,entries=Object.entries(data);if(entries.length>2000)throw Error('备份条目过多');
 function safe(x){if(!x||typeof x!=='object')return;for(const [k,v]of Object.entries(x)){if(['__proto__','constructor','prototype'].includes(k))throw Error('备份包含无效字段');safe(v)}}safe(data);
 for(const [k,v]of entries){
  if(!allowedKey(k))throw Error('备份包含不支持的数据键：'+k);if(v==null)continue;
  if(JSON.stringify(v).length>12*1024*1024)throw Error('备份条目过大');
  if(k==='research-english-library-v1'){
   if(!Array.isArray(v)||v.length>500)throw Error('课程备份格式无效');const ids=new Set();
   for(const c of v){C.clean(c);if(!/^english-[a-z0-9-]+$/.test(c.id)||ids.has(c.id))throw Error('课程 ID 无效或重复');ids.add(c.id)}
  }else if(k==='english-wordbooks-v1'){
   if(!Array.isArray(v)||v.length>100)throw Error('单词本备份无效');const ids=new Set();
   for(const b of v){if(!/^words-[a-z0-9-]+$/.test(b.id)||ids.has(b.id)||typeof b.title!=='string'||!Array.isArray(b.words))throw Error('单词本结构无效');ids.add(b.id);if(b.words.length)require('./english-wordbooks').cleanRows(b.words.map(w=>[w.term,w.meaning,w.usphone,w.ukphone]));if(b.words.some(w=>typeof w.id!=='string'))throw Error('单词 ID 无效')}
  }else if(k==='english-vocabulary-v1'){
   if(!Array.isArray(v)||v.length>5000||v.some(w=>!w||typeof w.term!=='string'||!w.term.trim()||w.term.length>120||typeof w.id!=='string'))throw Error('收藏词汇格式无效');
  }else if(k==='english-material-appearance-v1'){
   if(!object(v)||Object.keys(v).length>1000)throw Error('卡片外观备份格式无效');for(const [id,style]of Object.entries(v)){if(!/^(english-[a-z0-9-]+|words-[a-z0-9-]+|favorites|review-(mistake-default|favorite-(default|folder-[a-z0-9-]+)))$/.test(id))throw Error('卡片外观素材标识无效');require('./english-domains').cleanCardStyle(style)}
  }else if(k==='english-achievements-v1'){
   require('./english-badges').validate(v);
  }else if(k==='english-course-badges-v1'){
   if(!Array.isArray(v)||v.length>60||v.some((b,i)=>!b||b.number!==i+1||typeof b.courseId!=='string'||typeof b.title!=='string'||!Number.isFinite(b.count)||typeof b.date!=='string')||new Set(v.map(b=>b.courseId)).size!==v.length)throw Error('课程徽章备份格式无效');
  }else if(k==='english-activity-v1'){
   if(v.version!==1||!object(v.days))throw Error('学习足迹数据格式异常');
   for(const [day,d]of Object.entries(v.days)){if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!object(d)||!object(d.sessions))throw Error('学习足迹日期或时长格式无效');for(const seconds of Object.values(d.sessions))if(!Number.isFinite(seconds)||seconds<0||seconds>86400)throw Error('学习时长无效');for(const field of ['words','sentences'])if(d[field]!==undefined&&!object(d[field]))throw Error('学习足迹内容无效')}
  }else if(k.startsWith('english-progress:')){if(!object(v))throw Error('练习进度格式无效');C.progress(v)}
  else if(!object(v))throw Error('备份设置格式无效');
 }
 return data;
}
function mergeActivity(old,value){
 if(!old)return clone(value);const next=clone(old),incoming=clone(value),validGoal=x=>Number.isInteger(x.goalMinutes)&&x.goalMinutes>=1&&x.goalMinutes<=1440;
 // Keep attendance earned under the old one-minute rule when importing into a goal-based record.
 for(const x of [next,incoming])if(!validGoal(x))for(const d of Object.values(x.days))if(Object.values(d.sessions||{}).reduce((n,s)=>n+s,0)>=60)d.checked=true;
 if(!validGoal(next)||!Object.keys(next.days).length){if(validGoal(incoming))next.goalMinutes=incoming.goalMinutes}
 next.legacySeconds=Math.max(Number(old.legacySeconds)||0,Number(value.legacySeconds)||0);
 for(const [day,d]of Object.entries(incoming.days)){const t=next.days[day]||={sessions:{}};t.checked=!!(t.checked||d.checked);for(const f of ['goalMinutes','checkedGoalMinutes','checkedAt'])if(t[f]==null&&d[f]!=null)t[f]=d[f];for(const [id,s]of Object.entries(d.sessions||{}))t.sessions[id]=Math.max(t.sessions[id]||0,s);for(const f of ['words','sentences'])t[f]={...d[f],...t[f]}}
 return next;
}
module.exports=function createBackup(storage,{lessonIds,wordbookIds,activity}){
 function get(k){return k==='english-activity-v1'?activity.exportData():storage.getItem(k)}
 function put(k,v){if(k==='english-activity-v1')return activity.restoreData(v);const r=storage.setItem(k,v);if(r===false||r?.error)throw Error('学习数据保存失败')}
 function exportData(){
  const keys=new Set([...fixed,...lessonIds().map(id=>'english-progress:'+id),...wordbookIds().flatMap(id=>['english-wordbook-progress:'+id,'english-wordbook-cardtime:'+id])]);const data={};
  for(const k of keys){const v=get(k);if(v!=null)data[k]=clone(v)}
  const out={format:FORMAT,exportedAt:new Date().toISOString(),data};validate(out);return out;
 }
 function restore(raw){
  const input=validate(raw),writes=new Map(),before=new Map();
  for(const [k,v]of Object.entries(input)){if(v==null||k==='english-course-badges-v1')continue;const old=get(k);let next;
   if(k==='english-activity-v1')next=mergeActivity(old,v);
   else if(k==='english-material-appearance-v1')next={...v,...old};
   else if(k==='english-achievements-v1')next=require('./english-badges').merge(old,v);
   else if(k.startsWith('english-progress:'))next=C.mergeProgress(old||{},v);
   else if(['research-english-library-v1','english-wordbooks-v1','english-vocabulary-v1'].includes(k)){
    const all=old||[],ids=new Set(all.map(x=>x.id));next=[...all,...v.filter(x=>!ids.has(x.id))];
   }else if(k.startsWith('english-wordbook-progress:')){const timestamp=x=>Number.isFinite(x)?x:Date.parse(x)||0;next={...v,...old,completed:[...new Set([...(old?.completed||[]),...(v.completed||[])])],cardCompleted:[...new Set([...(old?.cardCompleted||[]),...(v.cardCompleted||[])])],seconds:Math.max(old?.seconds||0,v.seconds||0),lastOpenedAt:Math.max(timestamp(old?.lastOpenedAt),timestamp(v.lastOpenedAt))}}
   else if(k.startsWith('english-wordbook-cardtime:')){const sessions={...v.sessions};for(const [id,s]of Object.entries(old?.sessions||{}))sessions[id]=Math.max(sessions[id]||0,s);next={...v,...old,sessions,seconds:Math.max(old?.seconds||0,v.seconds||0,Object.values(sessions).reduce((n,s)=>n+(Number(s)||0),0))}}
   else next=old??v;
   writes.set(k,next);before.set(k,old??null);
  }
  // Validate the merged result too, before the first mutation (including size caps).
  validate({format:FORMAT,data:Object.fromEntries(writes)});
  const committed=[];
  try{for(const [k,v]of writes){committed.push(k);put(k,v)}}catch(e){let failed=false;for(const k of committed.reverse()){try{put(k,before.get(k))}catch{failed=true}}throw Error(failed?'备份恢复失败，回退未完全完成；请保留原备份并检查存储。':'备份恢复失败，本次修改已回退：'+e.message)}
  return {merged:writes.size};
 }
 return {export:exportData,restore};
};
module.exports.validate=validate;module.exports.allowedKey=allowedKey;module.exports.mergeActivity=mergeActivity;

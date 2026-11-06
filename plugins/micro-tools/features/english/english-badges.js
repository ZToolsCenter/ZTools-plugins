'use strict';
// Only compact learning evidence is stored here; progress and recordings remain independent.
const KEY='english-achievements-v1',MODES=['dictation','typing','puzzle','speaking'],GRADED=MODES.slice(0,3);
const definitions=[
 ['cat','🐱','小猫','初来乍到','growth',5,'句','首次完成 5 个不同句子的练习'],
 ['rabbit','🐰','兔子','渐入佳境','growth',50,'句','累计完成 50 个不同句子'],
 ['panda','🐼','熊猫','拿下一门','growth',1,'门','首次完整完成一门课程'],
 ['cow','🐮','奶牛','功夫在平时','growth',300,'分钟','累计有效学习 300 分钟'],
 ['deer','🦌','鹿','七日有约','growth',7,'天','连续 7 天达到每日学习目标'],
 ['wolf','🐺','狼','长期主义','growth',30,'天','累计 30 天达成每日目标，不要求连续'],
 ['squirrel','🐿️','松鼠','学术粮仓','growth',100,'词','累计完成 100 个不同单词的拼写练习'],
 ['octopus','🐙','章鱼','触角伸远一点','growth',3,'领域','在 3 个科研领域中，各完成至少 20 个句子'],
 ['fox','🦊','狐狸','一遍就会','practice',10,'句','10 个不同句子的首次提交正确且未使用提示，限听写、打字或排序'],
 ['hedgehog','🦔','刺猬','拔掉小刺','practice',20,'句','累计订正 20 个不同错句'],
 ['rhino','🦏','犀牛','这句我偏要会','practice',1,'句','同一句出错至少 3 次后，最终不使用提示完成'],
 ['butterfly','🦋','蝴蝶','真的学会了','practice',10,'句','10 个历史错句，至少隔一天后的复习中首次提交正确且未使用提示'],
 ['dolphin','🐬','海豚','勇敢开口','practice',10,'句','为 10 个不同句子录音，并回放对照'],
 ['parrot','🦜','鹦鹉','听见自己的进步','practice',5,'句','为 5 个句子分别保留并回听两次录音，两次录音至少间隔 3 个自然日'],
 ['beaver','🦫','河狸','自己搭座桥','practice',1,'门','创建一门至少 10 句的自建课程，并完整练完'],
 ['giraffe','🦒','长颈鹿','多想一层','practice',10,'句','为 10 个不同句子添加自己的表达笔记'],
 ['owl','🦉','猫头鹰','夜里的研究员','secret',1,'次','在当地时间 23:00—次日 01:00 完成一次达标打卡','有位朋友，喜欢安静的夜晚。','夜深了，你和猫头鹰还醒着。'],
 ['pig','🐷','小猪','哼，再来一次','secret',1,'次','连续 5 个不同句子的首次提交出错，随后将这 5 句全部订正','有时候，卡住的地方会送来一位朋友。','刚才有点狼狈，但你一道也没放过。'],
 ['penguin','🐧','企鹅','好久不见','secret',1,'次','连续 14 天没有练习后，回归当天完成 10 个不同句子','有位朋友，会一直等你回来。','绕了一圈，你还是回来了。'],
 ['raccoon','🦝','浣熊','翻翻旧口袋','secret',5,'句','复习至少 7 天前收藏的 5 个句子，并完成练习','旧口袋里，也许藏着新发现。','以前收好的东西，今天派上用场了。'],
 ['crab','🦀','螃蟹','换条路也能到','secret',10,'句','一门课程全部完成听写后，再用打字模式完成其中 10 个不同句子','熟悉的路，还可以换一种走法。','换一种走法，这句话又认识了一遍。'],
 ['snail','🐌','蜗牛','慢慢来也算数','secret',7,'天','在 7 个不同日期各完成至少 1 句，不要求连续或达到时长目标','不赶路的朋友，也会留下脚印。','走得慢，也留下了七天的脚印。'],
 ['kangaroo','🦘','袋鼠','接着往前跳','secret',1,'次','连续打卡中断后，重新连续 3 天达标','空了一格，后面还有很长的路。','中间空了一格，故事接着写。'],
 ['bee','🐝','蜜蜂','到处采一点','secret',4,'模式','同一自然周（周一至周日）内，听写、打字、排序、口语各完成至少 5 个不同句子','花园里，不只有一种花。','这周，你试过了四种学法。']
].map(([id,emoji,animal,name,kind,target,unit,condition,hint,message])=>({id,emoji,animal,name,kind,target,unit,condition,hint,message}));
const ids=new Set(definitions.map(d=>d.id)),clone=x=>JSON.parse(JSON.stringify(x)),object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const dayKey=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
const dayNumber=d=>{const [y,m,n]=d.split('-').map(Number);return Date.UTC(y,m-1,n)/86400000};
const validDay=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&dayKey(new Date(d+'T12:00:00'))===d;
const validTime=t=>typeof t==='string'&&Number.isFinite(Date.parse(t));
const validKey=k=>/^english-[a-z0-9-]+:\d{1,3}$/.test(k);
function empty(){return {version:1,rows:{},days:{},courses:{},awards:{},failureRun:[],pigGroups:[],recent:[]}}
function validate(x){
 const bad=()=>{throw Error('成就徽章记录异常，原记录未被覆盖')};
 if(!object(x)||x.version!==1||!['rows','days','courses','awards'].every(k=>object(x[k]))||!['failureRun','pigGroups','recent'].every(k=>Array.isArray(x[k]))||JSON.stringify(x).length>12*1024*1024)bad();
 if(Object.keys(x.rows).length>60000||Object.keys(x.days).length>36600||Object.keys(x.courses).length>1000||x.failureRun.length>5||x.pigGroups.length>12000||x.recent.length>256)bad();
 for(const [key,r]of Object.entries(x.rows)){
  if(!validKey(key)||!object(r)||!Number.isInteger(r.errors)||r.errors<0||!object(r.modes))bad();
  for(const f of ['unknownFirst','completed','corrected','rhino','butterfly','raccoon','reviewed','compared','favorite'])if(r[f]!==undefined&&typeof r[f]!=='boolean')bad();
  if(r.first!==undefined&&(!object(r.first)||typeof r.first.correct!=='boolean'||typeof r.first.helped!=='boolean'))bad();
  for(const f of ['errorDay','favoriteDay'])if(r[f]!==undefined&&!validDay(r[f]))bad();
  for(const [m,t]of Object.entries(r.modes))if(!MODES.includes(m)||!validTime(t))bad();
  if(r.practice!==undefined&&(!object(r.practice)||typeof r.practice.id!=='string'||!Number.isInteger(r.practice.attempts)||r.practice.attempts<0||typeof r.practice.helped!=='boolean'||typeof r.practice.correct!=='boolean'))bad();
  for(const f of ['current','previous'])if(r[f]!==undefined&&(!object(r[f])||typeof r[f].id!=='string'||!validTime(r[f].at)||typeof r[f].played!=='boolean'||r[f].available!==undefined&&typeof r[f].available!=='boolean'))bad();
 }
 for(const [day,d]of Object.entries(x.days)){if(!validDay(day)||!object(d)||!Array.isArray(d.sentences)||d.sentences.length>10||d.sentences.some(k=>!validKey(k))||!object(d.modes))bad();for(const [m,keys]of Object.entries(d.modes))if(!MODES.includes(m)||!Array.isArray(keys)||keys.length>5||keys.some(k=>!validKey(k)))bad()}
 for(const [key,c]of Object.entries(x.courses))if(!/^english-[a-z0-9-]+$/.test(key)||!object(c)||!validTime(c.dictatedAt))bad();
 for(const [id,a]of Object.entries(x.awards))if(!ids.has(id)||!object(a)||!validTime(a.date)||typeof a.reason!=='string'||a.courseId!==undefined&&!/^english-[a-z0-9-]+$/.test(a.courseId)||a.courseTitle!==undefined&&typeof a.courseTitle!=='string')bad();
 if(x.failureRun.some(k=>!validKey(k))||x.pigGroups.some(g=>!Array.isArray(g)||g.length!==5||new Set(g).size!==5||g.some(k=>!validKey(k)))||x.recent.some(id=>typeof id!=='string'))bad();
 return x;
}
// Merge evidence without adding attempts twice, inventing a first attempt or replaying popups.
function merge(a,b){
 validate(b);b=clone(b);for(const r of Object.values(b.rows))for(const f of ['current','previous'])if(r[f])r[f].available=false;
 if(!a)return b;validate(a);const out=clone(a);
 for(const [k,r]of Object.entries(b.rows)){
  const t=out.rows[k];if(!t){out.rows[k]=clone(r);continue}t.errors=Math.max(t.errors,r.errors);
  for(const f of ['unknownFirst','completed','corrected','rhino','butterfly','raccoon','reviewed','compared'])t[f]=!!(t[f]||r[f]);
  if(!t.first&&r.first)t.first=clone(r.first);
  for(const [m,at]of Object.entries(r.modes))if(!t.modes[m]||Date.parse(at)>Date.parse(t.modes[m]))t.modes[m]=at;
  if(r.errorDay&&(!t.errorDay||r.errorDay<t.errorDay))t.errorDay=r.errorDay;
  if(t.favoriteDay===undefined&&r.favoriteDay){t.favoriteDay=r.favoriteDay;t.favorite=!!r.favorite}
  // Media is deliberately not portable; retained playback evidence still counts, unavailable files cannot be replayed.
  for(const f of ['current','previous'])if(!t[f]&&r[f])t[f]={...r[f],available:false};
 }
 for(const [day,d]of Object.entries(b.days)){const t=out.days[day]||={sentences:[],modes:{}};t.sentences=[...new Set([...t.sentences,...d.sentences])].slice(0,10);for(const [m,keys]of Object.entries(d.modes))t.modes[m]=[...new Set([...(t.modes[m]||[]),...keys])].slice(0,5)}
 for(const [k,c]of Object.entries(b.courses))if(!out.courses[k]||c.dictatedAt<out.courses[k].dictatedAt)out.courses[k]=clone(c);
 for(const [id,a]of Object.entries(b.awards))out.awards[id]||=clone(a);
 const groups=new Set(out.pigGroups.map(g=>g.join('|')));for(const g of b.pigGroups)if(!groups.has(g.join('|'))){out.pigGroups.push([...g]);groups.add(g.join('|'))}
 out.recent=[...new Set([...out.recent,...b.recent])].slice(-256);return validate(out);
}
module.exports=function createBadges({storage,courses,progress,activity,now=()=>new Date()}){
 function read(){const raw=storage.getItem(KEY);return raw==null?empty():clone(validate(raw))}
 function put(x){validate(x);const result=storage.setItem(KEY,x);if(result===false||result?.error)throw Error('成就徽章保存失败')}
 function entries(){return courses().map(c=>({...c,parts:(c.parts||[c]).map(p=>({...p,progress:progress(p.id)}))}))}
 function observe(x,all,today,at){
  for(const c of all)for(const part of c.parts)for(const [i,r]of Object.entries(part.progress.results||{})){
   if(Number(i)>=part.sentences.length)continue;const k=part.id+':'+i;
   if(!x.rows[k]){const ms=Object.values(r.modes||{}),graded=GRADED.map(m=>r.modes?.[m]).filter(Boolean);x.rows[k]={errors:ms.reduce((n,m)=>n+(m.errors||0),0),modes:{},completed:ms.some(m=>m.complete),unknownFirst:graded.some(m=>m.attempts||m.complete),corrected:graded.some(m=>m.complete&&m.errors>0),rhino:graded.some(m=>m.complete&&m.errors>=3&&!m.helped),favorite:!!r.favorite};if(graded.reduce((n,m)=>n+(m.attempts||0),0)===1&&graded.every(m=>!m.errors&&!m.helped)&&graded.some(m=>m.complete))x.rows[k].first={correct:true,helped:false};if(r.favorite)x.rows[k].favoriteDay=today;if(x.rows[k].errors)x.rows[k].errorDay=today;
    for(const [m,v]of Object.entries(r.modes||{}))if(MODES.includes(m)&&v.complete&&validTime(v.completedAt))x.rows[k].modes[m]=v.completedAt;
   }
  }
  for(const c of all){const rows=c.parts.flatMap(p=>p.sentences.map((_,i)=>({k:p.id+':'+i,r:p.progress.results?.[i]})));if(rows.length&&rows.every(({k,r})=>x.rows[k]?.modes.dictation||r?.modes?.dictation?.complete)&&!x.courses[c.id]){const times=rows.map(({k,r})=>x.rows[k]?.modes.dictation||r?.modes?.dictation?.completedAt);x.courses[c.id]={dictatedAt:times.every(validTime)?times.sort().at(-1):at}}}
 }
 function metrics(x,all,act,today){
  const completed=new Set(),notes=new Set(),domains=new Map();let finished=0,custom=0,crab=0;const contexts={};
  for(const c of all){let count=0,total=0,after=0;const gate=x.courses[c.id]?.dictatedAt;
   for(const part of c.parts){const saved=part.progress;for(let i=0;i<part.sentences.length;i++){
    total++;const k=part.id+':'+i,r=saved.results?.[i],row=x.rows[k],done=Object.values(r?.modes||{}).some(m=>m.complete)||Object.keys(row?.modes||{}).length>0||row?.completed;
    if(done){completed.add(k);count++;const domain=part.domain||c.domain||'other';if(domain!=='other'){const set=domains.get(domain)||new Set();set.add(k);domains.set(domain,set)}}
    if(r?.notes?.trim())notes.add(k);if(gate&&row?.modes.typing&&Date.parse(row.modes.typing)>Date.parse(gate))after++;
   }}if(total&&count===total){finished++;contexts.panda||={courseId:c.id,courseTitle:c.title};if(c.library==='custom'&&total>=10){custom++;contexts.beaver||={courseId:c.id,courseTitle:c.title}}}if(after>crab){crab=after;contexts.crab={courseId:c.id,courseTitle:c.title}}
  }
  // Awards remain permanent even if a course or its progress is subsequently removed.
  for(const [k,r]of Object.entries(x.rows))if(r.completed||Object.keys(r.modes).length)completed.add(k);
  const history=(act.history||[]).filter(d=>validDay(d.date)&&d.date<=today).sort((a,b)=>a.date.localeCompare(b.date)),checked=history.filter(d=>d.checked);let longest=0,run=0,kangaroo=false;
  checked.forEach((d,i)=>{run=i&&dayNumber(d.date)-dayNumber(checked[i-1].date)===1?run+1:1;longest=Math.max(longest,run);if(i>=2&&run>=3){const start=i-run+1;if(start>0&&dayNumber(checked[start].date)-dayNumber(checked[start-1].date)>1)kangaroo=true}});
  let owl=false;for(const d of checked)if(validTime(d.checkedAt)&&dayKey(new Date(d.checkedAt))===d.date){const h=new Date(d.checkedAt).getHours();if(h>=23||h<1)owl=true}
  const practiceDays=new Set(history.filter(d=>d.sentences>0).map(d=>d.date));for(const [day,d]of Object.entries(x.days))if(d.sentences.length)practiceDays.add(day);
  const active=new Map(history.filter(d=>d.seconds>0||d.words>0||d.sentences>0).map(d=>[d.date,d.sentences||0]));for(const [day,d]of Object.entries(x.days))active.set(day,Math.max(active.get(day)||0,d.sentences.length));
  const days=[...active.keys()].sort();let penguin=false;days.forEach((d,i)=>{if(i&&dayNumber(d)-dayNumber(days[i-1])>=15&&(active.get(d)||0)>=10)penguin=true});
  const weeks=new Map();for(const [day,d]of Object.entries(x.days)){const n=dayNumber(day),weekday=(new Date(day+'T12:00:00').getDay()+6)%7,key=n-weekday,week=weeks.get(key)||{};for(const [m,keys]of Object.entries(d.modes)){week[m]||=new Set();keys.forEach(k=>week[m].add(k))}weeks.set(key,week)}
  const rows=Object.values(x.rows),sum=fn=>rows.filter(fn).length;
  return {contexts,cat:completed.size,rabbit:completed.size,panda:finished,cow:Math.floor((act.totalSeconds||0)/60),deer:longest,wolf:checked.length,squirrel:act.totalWords||0,octopus:[...domains.values()].filter(s=>s.size>=20).length,
   fox:sum(r=>r.first?.correct&&!r.first.helped),hedgehog:sum(r=>r.corrected),rhino:sum(r=>r.rhino),butterfly:sum(r=>r.butterfly),dolphin:sum(r=>r.reviewed),parrot:sum(r=>r.compared),beaver:custom,giraffe:notes.size,
   owl:Number(owl),pig:Number(x.pigGroups.some(g=>g.every(k=>x.rows[k]?.corrected))),penguin:Number(penguin),raccoon:sum(r=>r.raccoon),crab,snail:practiceDays.size,kangaroo:Number(kangaroo),bee:Math.max(0,...[...weeks.values()].map(w=>MODES.filter(m=>w[m]?.size>=5).length))};
 }
 return function achievements(action='summary',input={}){
  if(!['summary','event'].includes(action))throw Error('不支持的成就操作');
  const x=read(),before=JSON.stringify(x),date=now(),at=date.toISOString(),today=dayKey(date),all=entries();let context;
  observe(x,all,today,at);
  if(action==='event'){
   const e=input,part=all.flatMap(c=>c.parts).find(p=>p.id===e.courseId);
   if(!part||!Number.isInteger(e.index)||e.index<0||e.index>=part.sentences.length||!['attempt','complete','favorite','recording','playback'].includes(e.type)||typeof e.id!=='string'||!/^[\w-]{1,100}$/.test(e.id))throw Error('成就学习事件无效');
   if(['attempt','complete'].includes(e.type)&&(!MODES.includes(e.mode)||typeof e.practiceId!=='string'||!/^[\w-]{1,100}$/.test(e.practiceId)||typeof e.helped!=='boolean'))throw Error('成就练习事件无效');
   if(e.type==='attempt'&&(!GRADED.includes(e.mode)||typeof e.correct!=='boolean')||e.type==='favorite'&&typeof e.value!=='boolean'||['recording','playback'].includes(e.type)&&(typeof e.recordingId!=='string'||!/^[\w-]{1,100}$/.test(e.recordingId)))throw Error('成就学习事件无效');
   if(!x.recent.includes(e.id)){
    const k=e.courseId+':'+e.index,r=x.rows[k]||={errors:0,modes:{}};context={courseId:e.courseId,courseTitle:part.title};
    if(e.type==='attempt'){
     if(!r.practice||r.practice.id!==e.practiceId)r.practice={id:e.practiceId,attempts:0,helped:false,correct:false};
     r.practice.attempts++;r.practice.helped||=e.helped;r.practice.correct=e.correct;if(e.correct)x.failureRun=[];
     if(!r.first&&!r.unknownFirst){r.first={correct:e.correct,helped:e.helped};if(e.correct)x.failureRun=[];else{x.failureRun.push(k);if(x.failureRun.length===5){x.pigGroups.push([...x.failureRun]);x.failureRun=[]}}}
     if(!e.correct){r.errors++;r.errorDay||=today}
    }else if(e.type==='complete'){
     // Graded completions require an actual correct submission in the same practice.
     const graded=GRADED.includes(e.mode),valid=!graded||r.practice?.id===e.practiceId&&r.practice.correct;
     if(valid){
      r.modes[e.mode]=at;r.completed=true;
      if(graded&&r.errors){r.corrected=true;if(!e.helped&&!r.practice.helped){if(r.errors>=3)r.rhino=true;if(r.errorDay<today&&r.practice.attempts===1)r.butterfly=true}}
      if(r.favorite&&r.favoriteDay&&dayNumber(today)-dayNumber(r.favoriteDay)>=7)r.raccoon=true;
      const d=x.days[today]||={sentences:[],modes:{}};if(!d.sentences.includes(k)&&d.sentences.length<10)d.sentences.push(k);const keys=d.modes[e.mode]||=[];if(!keys.includes(k)&&keys.length<5)keys.push(k);
     }
    }else if(e.type==='favorite'){if(e.value&&!r.favorite)r.favoriteDay=today;r.favorite=e.value}
    else if(e.type==='recording'){if(r.current?.id!==e.recordingId){if(e.previousAvailable&&r.current?.available!==false&&(!r.previous||r.previous.available===false))r.previous=r.current;r.current={id:e.recordingId,at,played:false,available:true}}}
    else if(e.type==='playback')for(const f of ['current','previous'])if(r[f]?.id===e.recordingId&&r[f].available!==false){r[f].played=true;r.reviewed=true}
    if(r.current?.played&&r.previous?.played&&r.current.available!==false&&r.previous.available!==false&&dayNumber(dayKey(new Date(r.current.at)))-dayNumber(dayKey(new Date(r.previous.at)))>=3)r.compared=true;
    x.recent.push(e.id);x.recent=x.recent.slice(-256);
   }
  }
  const act=activity(),values=metrics(x,all,act,today),newlyUnlocked=[];
  for(const d of definitions)if(!x.awards[d.id]&&values[d.id]>=d.target){x.awards[d.id]={date:at,reason:d.condition,...(values.contexts[d.id]||context)};newlyUnlocked.push(d.id)}
  if(JSON.stringify(x)!==before)put(x);
  // Retire sequential awards independently of courses, notes, wordbooks and attendance.
  if(storage.getItem('english-course-badges-v1')!=null)storage.setItem('english-course-badges-v1',null);
  const catalog=definitions.map(d=>{const a=x.awards[d.id],earned=!!a;if(d.kind==='secret'&&!earned)return {id:d.id,kind:'secret',earned:false,name:'神秘伙伴',emoji:'❔',hint:d.hint};return {...d,earned,current:Math.min(d.target,values[d.id]||0),...(a||{})}});
  return {total:definitions.length,catalog,earned:catalog.filter(d=>d.earned).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)),newlyUnlocked};
 };
};
module.exports.KEY=KEY;module.exports.definitions=definitions;module.exports.validate=validate;module.exports.merge=merge;

// Independent wordbooks; legacy vocabulary remains the default collection.
const crypto=require('crypto'),C=require('./english-core');
const copy=x=>JSON.parse(JSON.stringify(x));
const builtin=require('../../assets/data/english-wordbook-biomedical.json');
const signature=words=>crypto.createHash('sha256').update(JSON.stringify(words.map(w=>[w.term.normalize('NFKC').toLowerCase(),w.meaning,w.usphone||'',w.ukphone||'']).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0))).digest('hex');
function cleanRows(rows){
 if(!Array.isArray(rows)||rows.length>20001)throw Error('每个单词本最多 20000 行');
 const words=[],seen=new Set(),invalid=[];let duplicates=0,header=false;
 rows.forEach((row,i)=>{
  if(!Array.isArray(row)||row.every(x=>x==null||String(x).trim()===''))return;
  const cells=row.slice(0,4).map(x=>String(x??'').trim());
  if(!words.length&&!header&&/^(name|word|term|单词|英文|词条)$/i.test(cells[0])&&/^(trans|translation|meaning|中文|翻译|释义|中文释义)$/i.test(cells[1])){header=true;return}
  const [term,meaning,usphone='',ukphone='']=cells;
  if(!term||!meaning||term.length>120||meaning.length>2000||usphone.length>200||ukphone.length>200){invalid.push(i+1);return}
  const key=term.normalize('NFKC').toLowerCase();if(seen.has(key)){duplicates++;return}seen.add(key);
  words.push({id:crypto.createHash('sha256').update(key).digest('hex').slice(0,20),term,meaning,usphone,ukphone,mastered:false});
 });
 if(invalid.length)throw Error('第 '+invalid.slice(0,8).join('、')+' 行内容无效：前两列为英文和释义（必填），音标为可选。请修正后导入。');
 if(!words.length)throw Error('没有找到有效词条，请检查前两列是否为英文、释义');
 return {words,duplicates};
}
module.exports=function createWordbooks(storage,vocabulary,catalog){
 const key='english-wordbooks-v1',read=()=>{const x=storage.getItem(key)||[];if(!Array.isArray(x))throw Error('单词本数据格式异常');return copy(x)},pkey=id=>'english-wordbook-progress:'+id;
 const seed={...builtin,id:'words-builtin-'+builtin.id,words:cleanRows(builtin.words.map(w=>[w.term,w.meaning,w.usphone,w.ukphone])).words,kind:'builtin',builtin:true},seedSignature=signature(seed.words);
 const hidden=()=>storage.getItem('english-wordbooks-trash-v1')||{};function restore(id){const x=hidden();delete x[id];storage.setItem('english-wordbooks-trash-v1',x)}
 function all(){const books=read();let found=false;for(const b of books){if(!found&&(b.id===seed.id||b.customized&&b.originalKind==='builtin'||signature(b.words)===seedSignature)){b.kind='builtin';b.builtin=true;if(!b.customized)b.title=seed.title;found=true}else {b.kind=b.material?'optional':'imported';b.builtin=false}}if(!found)books.unshift(copy(seed));return books}
 function get(id){if(id==='favorites')return {id,title:'收藏词汇',words:vocabulary(),builtin:true,kind:'favorites'};const b=all().find(b=>b.id===id);if(!b)throw Error('找不到单词本');return b}
 function saveBook(title,words,material,metadata={}){metadata=C.wordbookMetadata(metadata);const contentSignature=signature(words),id='words-'+crypto.createHash('sha256').update(JSON.stringify({title,words})).digest('hex').slice(0,24);const existing=all().find(b=>(material||b.kind==='builtin'||b.kind==='optional'||b.id===id)&&signature(b.words)===contentSignature);if(existing){restore(existing.id);if(existing.kind!=='builtin'&&(material||Object.keys(metadata).length)){const books=read(),b=books.find(b=>b.id===existing.id);Object.assign(b,metadata);if(material)b.material=material;storage.setItem(key,books)}return {id:existing.id,existing:true,count:words.length}}const books=read();if(books.length>=100)throw Error('最多保存 100 个单词本，请先导出整理');books.push({...metadata,id,title,words,...(material?{material}:{}),createdAt:new Date().toISOString()});storage.setItem(key,books);return {id,count:words.length}}
 return function wordbooks(action='list',input={}){
  if(action==='list')return [get('favorites'),...all()].filter(b=>input.includeTrashed||!hidden()[b.id]).map(b=>({...C.wordbookMetadata(b),id:b.id,title:b.title,count:b.words.length,builtin:!!b.builtin,kind:b.kind,mastered:b.words.filter(w=>w.mastered).length,progress:copy(storage.getItem(pkey(b.id))||{})}));
  if(action==='get')return get(input.id);
  if(action==='catalog')return catalog.list(input).then(result=>({...result,wordbooks:result.wordbooks.map(item=>({...item,installedBookId:all().find(b=>!hidden()[b.id]&&signature(b.words)===item.contentHash)?.id||null}))}));
  if(action==='download')return catalog.downloadWordbook(input).then(({item,words,metadata})=>saveBook(item.title,words,{id:item.id,url:item.url,sha256:item.sha256},metadata));
  if(action==='import'){const parsed=cleanRows(input.rows),title=String(input.title||'').trim();if(!title||title.length>100)throw Error('请填写 1–100 字的单词本名称');if(input.preview!==false)return {title,...parsed};return saveBook(title,parsed.words,null,input.metadata)}
  if(action==='preferences'){const key='english-wordbook-preferences-v1',old=storage.getItem(key)||{};const next={layout:old.layout==='grid'?'grid':'list',autoMaster:old.autoMaster===true};if(input.value){if(['list','grid'].includes(input.value.layout))next.layout=input.value.layout;if(typeof input.value.autoMaster==='boolean')next.autoMaster=input.value.autoMaster;storage.setItem(key,next)}return next}
  if(action==='trashList')return [get('favorites'),...all()].filter(b=>hidden()[b.id]).map(b=>({id:b.id,title:b.title}));
  const book=get(input.id);
  if(action==='trash'){if(input.restore){restore(book.id)}else{const x=hidden();x[book.id]=new Date().toISOString();storage.setItem('english-wordbooks-trash-v1',x)}return {id:book.id}}
  if(action==='studyTime'){const key='english-wordbook-cardtime:'+book.id,old=storage.getItem(key)||{seconds:0,sessions:{}};if(input.session){if(!/^[\w-]{1,80}$/.test(input.session)||!Number.isFinite(input.seconds)||input.seconds<0||input.seconds>86400)throw Error('学习时长无效');const previous=old.sessions[input.session]||0,next=Math.max(previous,input.seconds);old.seconds+=next-previous;old.sessions[input.session]=next;storage.setItem(key,old)}return old.seconds}
  if(action==='edit'){
   const title=String(input.title||'').trim();if(!title||title.length>100)throw Error('请填写 1–100 字的名称');if(!Array.isArray(input.words)||input.words.length>20000)throw Error('单词本最多 20000 词');
   const oldByTerm=new Map(book.words.map(w=>[w.term.normalize('NFKC').toLowerCase(),w])),seen=new Set(),words=input.words.map(raw=>{const term=String(raw.term||'').trim(),meaning=String(raw.meaning||'').trim(),usphone=String(raw.usphone||'').trim(),ukphone=String(raw.ukphone||'').trim(),normalized=term.normalize('NFKC').toLowerCase();if(!term||term.length>120||meaning.length>2000||usphone.length>200||ukphone.length>200)throw Error('请检查词条长度：英文必填，最多 120 字符');if(seen.has(normalized))throw Error('存在重复词条：'+term);seen.add(normalized);const old=oldByTerm.get(normalized);return {...(old||{}),id:old?.id||crypto.createHash('sha256').update(normalized).digest('hex').slice(0,20),term,meaning,usphone,ukphone,mastered:old?.mastered===true}});
   if(book.id==='favorites')storage.setItem('english-vocabulary-v1',words);else{const books=read(),index=books.findIndex(b=>b.id===book.id),next={...book,title,words,customized:true,originalKind:book.kind};if(index<0)books.unshift(next);else books[index]=next;storage.setItem(key,books)}
   const progress=storage.getItem(pkey(book.id));if(progress){const valid=new Set(words.map(w=>w.id));storage.setItem(pkey(book.id),{...progress,index:Math.max(0,Math.min(progress.index||0,words.length-1)),completed:(progress.completed||[]).filter(id=>valid.has(id)),sequence:(progress.sequence||[]).filter(id=>valid.has(id))})}return {id:book.id};
  }
  if(action==='progress'){if(!input.value)return copy(storage.getItem(pkey(book.id))||{});const v=input.value,old=storage.getItem(pkey(book.id))||{},valid=new Set(book.words.map(w=>w.id));const next={index:Math.max(0,Math.min(book.words.length-1,Math.floor(Number(v.index)||0))),completed:[...new Set([...(old.completed||[]),...(Array.isArray(v.completed)?v.completed:[])])].filter(id=>valid.has(id)),seconds:Math.max(Number(old.seconds)||0,Math.min(1e8,Math.max(0,Number(v.seconds)||0))),updatedAt:new Date().toISOString()};next.order=v.order==='random'?'random':v.order==='sequential'?'sequential':old.order||'sequential';const sequence=Array.isArray(v.sequence)?v.sequence:old.sequence||[];next.sequence=[...new Set(sequence)].filter(id=>valid.has(id));storage.setItem(pkey(book.id),next);return copy(next)}
  if(action==='toggle'||action==='mastery'){if(action==='mastery'&&typeof input.mastered!=='boolean')throw Error('请指定掌握状态');const current=book.words.find(w=>w.id===input.wordId);if(!current)throw Error('词条不存在');if(action==='mastery'&&!!current.mastered===input.mastered)return copy(current);if(book.id==='favorites')return vocabulary('toggle',{id:input.wordId});const all=read();let b=all.find(x=>x.id===book.id);if(!b){b=copy(book);all.unshift(b)}const w=b.words.find(x=>x.id===input.wordId);if(!w)throw Error('词条不存在');w.mastered=action==='mastery'?input.mastered:!w.mastered;storage.setItem(key,all);return copy(w)}
  throw Error('不支持的单词本操作');
 };
};
module.exports.cleanRows=cleanRows;

module.exports.signature=signature;

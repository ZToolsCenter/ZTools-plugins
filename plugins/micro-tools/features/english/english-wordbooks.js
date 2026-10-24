// Independent wordbooks; legacy vocabulary remains the default collection.
const crypto=require('crypto');
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
 function all(){const books=read();let found=false;for(const b of books){if(!found&&signature(b.words)===seedSignature){b.kind='builtin';b.builtin=true;b.title=seed.title;found=true}else {b.kind=b.material?'optional':'imported';b.builtin=false}}if(!found)books.unshift(copy(seed));return books}
 function get(id){if(id==='favorites')return {id,title:'收藏词汇',words:vocabulary(),builtin:true,kind:'favorites'};const b=all().find(b=>b.id===id);if(!b)throw Error('找不到单词本');return b}
 function saveBook(title,words,material){const contentSignature=signature(words),id='words-'+crypto.createHash('sha256').update(JSON.stringify({title,words})).digest('hex').slice(0,24);const existing=all().find(b=>(material||b.kind==='builtin'||b.kind==='optional'||b.id===id)&&signature(b.words)===contentSignature);if(existing){if(material&&existing.kind!=='builtin'){const books=read(),b=books.find(b=>b.id===existing.id);b.material=material;storage.setItem(key,books)}return {id:existing.id,existing:true,count:words.length}}const books=read();if(books.length>=100)throw Error('最多保存 100 个单词本，请先导出整理');books.push({id,title,words,...(material?{material}:{}),createdAt:new Date().toISOString()});storage.setItem(key,books);return {id,count:words.length}}
 return function wordbooks(action='list',input={}){
  if(action==='list')return [get('favorites'),...all()].map(b=>({id:b.id,title:b.title,count:b.words.length,builtin:!!b.builtin,kind:b.kind,mastered:b.words.filter(w=>w.mastered).length,progress:copy(storage.getItem(pkey(b.id))||{})}));
  if(action==='get')return get(input.id);
  if(action==='catalog')return catalog.list(input).then(result=>({...result,wordbooks:result.wordbooks.map(item=>({...item,installedBookId:all().find(b=>signature(b.words)===item.contentHash)?.id||null}))}));
  if(action==='download')return catalog.downloadWordbook(input).then(({item,words})=>saveBook(item.title,words,{id:item.id,url:item.url,sha256:item.sha256}));
  if(action==='import'){const parsed=cleanRows(input.rows),title=String(input.title||'').trim();if(!title||title.length>100)throw Error('请填写 1–100 字的单词本名称');if(input.preview!==false)return {title,...parsed};return saveBook(title,parsed.words)}
  const book=get(input.id);
  if(action==='progress'){if(!input.value)return copy(storage.getItem(pkey(book.id))||{});const v=input.value,old=storage.getItem(pkey(book.id))||{},valid=new Set(book.words.map(w=>w.id));const next={index:Math.max(0,Math.min(book.words.length-1,Math.floor(Number(v.index)||0))),completed:[...new Set([...(old.completed||[]),...(Array.isArray(v.completed)?v.completed:[])])].filter(id=>valid.has(id)),seconds:Math.max(Number(old.seconds)||0,Math.min(1e8,Math.max(0,Number(v.seconds)||0))),updatedAt:new Date().toISOString()};next.order=v.order==='random'?'random':v.order==='sequential'?'sequential':old.order||'sequential';const sequence=Array.isArray(v.sequence)?v.sequence:old.sequence||[];next.sequence=[...new Set(sequence)].filter(id=>valid.has(id));storage.setItem(pkey(book.id),next);return copy(next)}
  if(action==='toggle'){if(book.id==='favorites')return vocabulary('toggle',{id:input.wordId});const all=read();let b=all.find(x=>x.id===book.id);if(!b){b=copy(book);all.unshift(b)}const w=b.words.find(x=>x.id===input.wordId);if(!w)throw Error('词条不存在');w.mastered=!w.mastered;storage.setItem(key,all);return copy(w)}
  throw Error('不支持的单词本操作');
 };
};
module.exports.cleanRows=cleanRows;

module.exports.signature=signature;

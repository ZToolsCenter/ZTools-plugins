// Public catalog + published community submissions. No account or private-pack access.
'use strict';
const crypto=require('crypto'),C=require('./english-core'),catalog=require('./english-catalog');
const ORIGIN='https://asa-english-community.netlify.app',MAX=2*1024*1024,CACHE='english-community-public-v1';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const text=(v,max=1200)=>typeof v==='string'?v.trim().slice(0,max):'';
function parse(bytes,max=MAX){const b=Buffer.from(bytes);if(b.length>max)throw Error('素材响应过大，请刷新后重试');return JSON.parse(b.toString('utf8').replace(/^\uFEFF/,''))}
function entry(raw,cloud=false){
 const m=cloud?raw.manifest:raw,id=cloud?(raw.official_key||'cloud-'+raw.id):raw.id,count=cloud?raw.item_count:raw.count,bytes=raw.bytes;
 if(!m||!['course','wordbook'].includes(m.type)||typeof id!=='string'||!(/^[a-z0-9-]{1,100}$/i).test(id)||!Number.isInteger(count)||count<1||count>(m.type==='course'?120:20000)||!Number.isInteger(bytes)||bytes<1||bytes>MAX||!/^[a-f0-9]{64}$/i.test(raw.sha256||'')||!text(m.title,160))throw Error('广场素材目录格式无效');
 let url='';if(!cloud){url=catalog.publicURL(raw.url,ORIGIN);const u=new URL(url);if(u.origin!==ORIGIN||!u.pathname.startsWith('/materials/')||!u.pathname.endsWith('.json'))throw Error('素材地址不属于广场公开目录')}
 return {id,cloudId:cloud?raw.id:null,official:cloud?!!raw.official_key:true,like_count:Number(raw.like_count)||0,download_count:Number(raw.download_count)||0,comment_count:Number(raw.comment_count)||0,updated_at:raw.updated_at||m.updatedAt||'',type:m.type,title:text(m.title,160),description:text(m.description),author:text(m.author,80),domain:text(m.domain,80),level:m.level===null?null:text(m.level,80),license:text(m.license,80),sourceNote:text(m.sourceNote),tags:(Array.isArray(m.tags)?m.tags:[]).map(t=>text(t,30)).filter(Boolean).slice(0,6),count,bytes,sha256:raw.sha256.toLowerCase(),cloud,url,version:text(m.version,40)};
}
module.exports=function({storage,request=catalog.requestBytes}={}){
 let configPromise,officialPromise;const entries=new Map(),contents=new Map();
 async function config(){if(!configPromise)configPromise=(async()=>{const raw=parse(await request(ORIGIN+'/config.json',{maxBytes:65536}),65536),c=raw.supabase,u=new URL(c?.url);if(u.protocol!=='https:'||!u.hostname.endsWith('.supabase.co')||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!/^sb_publishable_[\w-]+$/.test(c.publishableKey||''))throw Error('广场服务配置无效');return {url:u.origin,key:c.publishableKey,unified:raw.unifiedCatalog===true}})().catch(e=>{configPromise=null;throw e});return configPromise}
 async function cloud(query){const c=await config();return parse(await request(c.url+'/rest/v1/community_packs?'+new URLSearchParams(query),{headers:{apikey:c.key},maxBytes:8*MAX}),8*MAX)}
 const remember=items=>{for(const item of items)entries.set(item.id,item);return items};
 async function official(refresh){if(refresh)officialPromise=null;if(!officialPromise)officialPromise=(async()=>{const data=parse(await request(ORIGIN+'/community-index.json'));if(data.version!==1||!Array.isArray(data.packs)||data.packs.length>400)throw Error('广场目录格式无效');return data.packs.map(p=>entry(p))})().catch(e=>{officialPromise=null;throw e});return officialPromise}
 async function list({refresh=false,offset=0}={}){
  if(refresh)configPromise=null;
  if(!Number.isInteger(offset)||offset<0||offset>5000)throw Error('无效的素材页码');const old=storage.getItem(CACHE)||{},warnings=[];
  let unified=true;try{unified=(await config()).unified}catch{}
  const [a,b]=await Promise.allSettled([offset||unified?Promise.resolve([]):official(refresh),(async()=>{let rows=[],page;do{page=await cloud({select:'id,manifest,item_count,bytes,sha256,official_key,updated_at,like_count,download_count,comment_count',status:'eq.published',deleted_at:'is.null',order:'updated_at.desc,id.desc',limit:'50',offset:String(offset+rows.length)});if(!Array.isArray(page))throw Error('社区素材列表格式无效');rows.push(...page)}while(page.length===50);return rows})()]);
  let base=[],rows=[],nextOffset=null;
  if(a.status==='fulfilled')base=a.value;else{warnings.push('官方目录暂不可用');base=Array.isArray(old.official)?old.official:[]}
  if(b.status==='fulfilled'){if(!Array.isArray(b.value))throw Error('社区素材列表格式无效');rows=b.value.map(r=>entry(r,true));nextOffset=null}else{warnings.push('社区投稿暂未更新，可稍后重试');if(!offset)rows=Array.isArray(old.community)?old.community:[]}
  if(!offset&&(a.status==='fulfilled'||b.status==='fulfilled'))storage.setItem(CACHE,{official:base,community:rows});
  if(!base.length&&!rows.length&&a.status==='rejected'&&b.status==='rejected')throw Error('暂时无法连接素材广场，请检查网络后重试');
  return {packs:remember([...base,...rows]),nextOffset,warning:warnings.join('；')};
 }
 async function get({id}={}){
  if(typeof id!=='string')throw Error('请选择素材');if(!entries.has(id))await list();const item=entries.get(id);if(!item)throw Error('找不到素材，请刷新广场');const key=id+':'+item.sha256;let bytes;
  if(item.cloud){const rows=await cloud({select:'id,manifest,item_count,bytes,sha256,body',id:'eq.'+item.cloudId,status:'eq.published',deleted_at:'is.null',limit:'1'}),row=rows?.[0];if(!row||row.sha256!==item.sha256||row.bytes!==item.bytes||row.item_count!==item.count)throw Error('素材已更新或下架，请刷新广场');bytes=Buffer.from(row.body||'')}
  else bytes=Buffer.from(await request(item.url));
  if(bytes.length>MAX||bytes.length!==item.bytes||hash(bytes)!==item.sha256)throw Error('素材校验失败，请刷新广场后重试');
  const raw=parse(bytes),keys=['title','description','domain','level','tags'],metadata=Object.fromEntries(keys.filter(k=>item[k]!==''&&item[k]!=null&&!(k==='tags'&&!item[k].length)).map(k=>[k,item[k]]));
  // Fill metadata absent from legacy bodies before clean() adds defaults. Validate explicit mismatches first.
  const data=C.materialContent({format:'research-english-community-v1',manifest:{...metadata,type:item.type},content:C.materialContent(raw)});let content;
  if(item.type==='course'){content=C.clean(data);if(content.sentences.length!==item.count)throw Error('素材句数与目录不一致')}
  else{if(!Array.isArray(data.words))throw Error('单词素材格式无效');const parsed=require('./english-wordbooks').cleanRows(data.words.map(w=>[w.term,w.meaning,w.usphone||'',w.ukphone||'']));if(parsed.duplicates||parsed.words.length!==item.count)throw Error('词表与目录不一致');content={format:'research-english-wordbook-v1',title:text(data.title,100),description:text(data.description),...C.wordbookMetadata(data),words:parsed.words.map(({term,meaning,usphone,ukphone})=>({term,meaning,usphone,ukphone}))}}
  const result={manifest:{...item,...Object.fromEntries(keys.filter(k=>content[k]!==undefined).map(k=>[k,content[k]]))},content};if(contents.size>=12)contents.delete(contents.keys().next().value);contents.set(key,result);return structuredCopy(result);
 }
 async function recordDownload(id){const item=entries.get(id);if(!item?.cloudId)return null;const c=await config(),deviceKey='english-community-device-v1';let device=storage.getItem(deviceKey);if(typeof device!=='string'||!(/^[a-f0-9-]{36}$/i).test(device)){device=crypto.randomUUID();storage.setItem(deviceKey,device)}return parse(await request(c.url+'/rest/v1/rpc/community_download',{method:'POST',body:JSON.stringify({p_id:item.cloudId,p_device:device}),headers:{apikey:c.key,'Content-Type':'application/json'},maxBytes:65536}),65536)}
 return {list,get,recordDownload};
};
function structuredCopy(value){return JSON.parse(JSON.stringify(value))}

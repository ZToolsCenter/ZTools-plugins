// Public JSON catalogs only. Course code is never evaluated; downloads use EnglishCore validation.
'use strict';
const fs=require('fs'),path=require('path'),https=require('https'),dns=require('dns'),net=require('net'),crypto=require('crypto');
const C=require('./english-core');
const MAX_BYTES=2*1024*1024,TIMEOUT=20000,SETTINGS='english-catalog-settings-v1',CACHE='english-catalog-cache-v1';
const LEGACY_URLS=new Set(['https://asa12138.github.io/research-english/catalog.json','https://asa12138.github.io/resources/research-english/catalog.json']);
const DEFAULT_URL='https://asa12138.github.io/apps/research-english/materials/catalog.json';
const SAMPLE_DIR=path.join(__dirname,'../../assets/data/english-catalog-samples');
const bundledCatalog=require('../../assets/data/english-catalog-default.json');
const clone=value=>JSON.parse(JSON.stringify(value));
const blocked=new net.BlockList();
for(const [address,prefix]of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['192.0.0.0',24],['192.0.2.0',24],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])blocked.addSubnet(address,prefix,'ipv4');
for(const [address,prefix]of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8],['2001:db8::',32]])blocked.addSubnet(address,prefix,'ipv6');
function isPublicAddress(address){const version=net.isIP(address);return !!version&&!blocked.check(address,version===6?'ipv6':'ipv4')}
function publicURL(value,base){
 let url;try{url=new URL(value,base)}catch{throw Error('素材地址无效，请填写公开的 HTTPS JSON 地址')}
 if(url.protocol!=='https:'||url.username||url.password||url.hash)throw Error('素材地址需为无账号密码、无锚点的 HTTPS 地址');
 const host=url.hostname.replace(/^\[|\]$/g,'');
 if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||!host.includes('.')&&!net.isIP(host)||net.isIP(host)&&!isPublicAddress(host))throw Error('素材地址必须指向公开网站');
 if([...url.searchParams.keys()].some(k=>/^(?:token|access_token|api[_-]?key|key|password|secret|authorization|auth)$/i.test(k)))throw Error('请使用公开素材地址，不要在链接中填写密钥');
 return url.href;
}
function requestBytes(value,{maxBytes=MAX_BYTES,timeoutMs=TIMEOUT,headers={},method='GET',body}={}){
 let headerOrigin;try{headerOrigin=new URL(publicURL(value)).origin}catch(error){return Promise.reject(error)}
 const deadline=Date.now()+Math.min(60000,timeoutMs);
 function follow(value,redirects){return new Promise((resolve,reject)=>{
  let url;try{url=publicURL(value)}catch(error){reject(error);return}
  const remaining=deadline-Date.now();if(remaining<=0){reject(Error('素材请求超时，请稍后刷新'));return}
  let finished=false,req;const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);error?reject(error):resolve(value)};
  const timer=setTimeout(()=>{finish(Error('素材请求超时，请稍后刷新'));req?.destroy()},remaining);
  req=(method==='POST'?https.request:https.get)(url,{method,headers:{Accept:'application/json,text/plain','User-Agent':'Research-English-Catalog/1.0','Accept-Encoding':'identity',...(new URL(url).origin===headerOrigin?headers:{})},lookup(host,options,callback){
   dns.lookup(host,{all:true},(error,addresses)=>{if(error){callback(error);return}if(!addresses.length||addresses.some(a=>!isPublicAddress(a.address))){callback(Error('素材域名不能指向本机或内网地址'));return}if(options?.all)callback(null,addresses);else callback(null,addresses[0].address,addresses[0].family)})
  }},res=>{
   if([301,302,303,307,308].includes(res.statusCode)){
    if(method!=='GET'){res.resume();finish(Error('统计请求不接受重定向'));return}
    res.resume();if(redirects>=3||!res.headers.location){finish(Error('素材地址重定向次数过多或缺少跳转地址'));return}
    let next;try{next=publicURL(res.headers.location,url)}catch(error){finish(error);return}
    clearTimeout(timer);follow(next,redirects+1).then(v=>finish(null,v),finish);return;
   }
   if(res.statusCode!==200){res.resume();finish(Error('素材网站返回 HTTP '+res.statusCode));return}
   if(Number(res.headers['content-length'])>maxBytes){finish(Error('素材文件超过 '+(maxBytes/1024/1024)+' MB'));res.destroy();return}
   let size=0;const chunks=[];res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){finish(Error('素材文件超过 '+(maxBytes/1024/1024)+' MB'));res.destroy();return}chunks.push(chunk)});
   res.on('end',()=>finish(null,Buffer.concat(chunks)));res.on('error',finish);res.on('aborted',()=>finish(Error('素材下载中断，请重试')));
  });
  req.on('error',error=>finish(Error('无法获取素材：'+error.message)));
  if(method==='POST')req.end(body);
 })}return follow(value,0);
}
function parseBytes(value){const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);if(bytes.length>MAX_BYTES)throw Error('素材文件超过 2 MB');try{return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''))}catch{throw Error('素材网站未返回有效 JSON，请使用文件的原始内容地址')} }
function string(value,label,max,required=false){if(value==null&&!required)return '';if(typeof value!=='string'||value.length>max||required&&!value.trim())throw Error(label+'无效');return value.trim()}
function catalog(raw,base,origin){
 if(!raw||raw.version!==1||!Array.isArray(raw.courses)||raw.courses.length>200)throw Error('素材目录需为 version:1 且 courses 不超过 200 项');
 const ids=new Set();return raw.courses.map(item=>{
  if(!item||typeof item!=='object')throw Error('素材目录条目无效');const id=string(item.id,'素材 ID',100,true);if(!/^[A-Za-z0-9_-]+$/.test(id)||ids.has(id))throw Error('素材 ID 需唯一，且只能使用字母、数字、下划线和短横线');ids.add(id);
  const url=string(item.url,'素材链接',2000,true),sha256=string(item.sha256,'校验值',64);if(sha256&&!/^[a-f0-9]{64}$/i.test(sha256))throw Error('素材 SHA256 无效');
  if(!Number.isInteger(item.count)||item.count<1||item.count>120)throw Error('素材句数需为 1–120');
  if(origin==='sample'&&!/^[A-Za-z0-9_-]+\.json$/.test(url))throw Error('本地示例素材路径无效');
  const audio=item.audio?{voice:'andrew',url:publicURL(item.audio.url,base),sha256:string(item.audio.sha256,'音频校验值',64,true),count:item.audio.count,bytes:item.audio.bytes}:null;if(audio&&(item.audio.voice!=='andrew'||!/^[a-f0-9]{64}$/.test(audio.sha256)||audio.count!==item.count||!Number.isInteger(audio.bytes)||audio.bytes<100||audio.bytes>8*1024*1024))throw Error('音频目录无效');
  return {audio,id:origin+':'+id,title:string(item.title,'素材名称',160,true),domain:C.category(item.domain,'领域',C.domains,'other'),level:item.level===null?null:C.category(item.level,'难度',{},'B2'),count:item.count,description:string(item.description,'素材说明',1200),tags:C.tags(item.tags),url:origin==='remote'?publicURL(url,base):url,sha256:sha256.toLowerCase(),origin};
 });
}
function wordbookEntries(raw,base){
 const items=raw.wordbooks||[];if(!Array.isArray(items)||items.length>200)throw Error('单词素材目录最多 200 项');const ids=new Set();
 return items.map(item=>{const id=string(item.id,'单词素材 ID',100,true);if(!/^[A-Za-z0-9_-]+$/.test(id)||ids.has(id))throw Error('单词素材 ID 无效或重复');ids.add(id);const sha256=string(item.sha256,'单词素材校验值',64,true),contentHash=string(item.contentHash,'词条校验值',64,true);if(!/^[a-f0-9]{64}$/.test(sha256)||!/^[a-f0-9]{64}$/.test(contentHash))throw Error('单词素材校验值无效');if(!Number.isInteger(item.count)||item.count<1||item.count>20000)throw Error('单词素材词数需为 1–20000');return {...C.wordbookMetadata(item),id:'remote:'+id,title:string(item.title,'单词素材名称',100,true),description:string(item.description,'单词素材说明',1200),count:item.count,url:publicURL(string(item.url,'单词素材链接',2000,true),base),sha256,contentHash}});
}
module.exports=function createCatalog({storage,request=requestBytes}={}){
 if(!storage?.getItem||!storage?.setItem)throw Error('素材目录需要本地存储');
 const samples=catalog(parseBytes(fs.readFileSync(path.join(SAMPLE_DIR,'catalog.json'))),null,'sample');
 const bundled=catalog(bundledCatalog,DEFAULT_URL,'remote');
 function settings(value){
  if(value!==undefined){const url=publicURL(string(value.url,'素材目录地址',2000)||DEFAULT_URL);if(url!==settings().url)storage.setItem(CACHE,null);storage.setItem(SETTINGS,{url})}
  const saved=storage.getItem(SETTINGS)||{};return {url:publicURL(!saved.url||LEGACY_URLS.has(saved.url)?DEFAULT_URL:saved.url)};
 }
 function cached(){const saved=storage.getItem(CACHE);if(!saved||saved.url!==settings().url)return null;try{return {courses:catalog(saved.raw,saved.url,'remote'),wordbooks:wordbookEntries(saved.raw.wordbooks===undefined&&saved.url===DEFAULT_URL?bundledCatalog:saved.raw,saved.url),updatedAt:saved.updatedAt}}catch{return null}}
 async function list({refresh=false}={}){
  const {url}=settings();if(refresh&&url){const raw=parseBytes(await request(url));catalog(raw,url,'remote');wordbookEntries(raw,url);if(settings().url===url)storage.setItem(CACHE,{url,raw,updatedAt:new Date().toISOString()})}
  const saved=cached(),isDefault=settings().url===DEFAULT_URL;const courses=(saved?saved.courses:isDefault?bundled:samples).map(c=>{const b=isDefault&&bundled.find(b=>b.id===c.id&&b.sha256===c.sha256);return b?.audio&&!c.audio?{...c,audio:b.audio}:c});return {courses:clone(courses),wordbooks:clone(saved?saved.wordbooks:isDefault?wordbookEntries(bundledCatalog,DEFAULT_URL):[]),url:settings().url,updatedAt:saved?.updatedAt||null,offline:!url,cached:!!saved&&!refresh,fallback:!saved&&!isDefault,bundled:!saved&&isDefault};
 }
 async function download({id}={}){
  const entries=await list(),item=entries.courses.find(x=>x.id===id);if(!item)throw Error('找不到素材，请先刷新目录');
  const bytes=item.origin==='sample'?fs.readFileSync(path.join(SAMPLE_DIR,item.url)):Buffer.from(await request(item.url));
  if(bytes.length>MAX_BYTES)throw Error('素材文件超过 2 MB');
  if(item.sha256&&crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('素材校验失败，文件与目录 SHA256 不一致，请刷新目录后重试');
  const lesson=C.clean(parseBytes(bytes));if(lesson.sentences.length!==item.count)throw Error('素材实际句数与目录不一致，请联系素材维护者');
  const lessonId='english-'+crypto.createHash('sha256').update(JSON.stringify(lesson)).digest('hex').slice(0,24);
  let audio=null;if(item.audio){const audioBytes=Buffer.from(await request(item.audio.url,{maxBytes:8*1024*1024,timeoutMs:60000}));if(audioBytes.length!==item.audio.bytes||crypto.createHash('sha256').update(audioBytes).digest('hex')!==item.audio.sha256)throw Error('配套音频校验失败，请刷新素材目录');audio=JSON.parse(audioBytes.toString('utf8'));require('./english-prepared-audio').validate(audio,lesson.sentences)}
  return {lesson,audio,catalog:{id:item.id,origin:item.origin,url:item.origin==='remote'?item.url:'',sourceUrl:item.origin==='remote'?entries.url:'',sha256:item.sha256,lessonId}};
 }
 async function downloadWordbook({id}={}){
  const entries=await list(),item=entries.wordbooks.find(x=>x.id===id);if(!item)throw Error('找不到单词素材，请先刷新目录');const bytes=Buffer.from(await request(item.url,{maxBytes:MAX_BYTES,timeoutMs:60000}));if(bytes.length>MAX_BYTES)throw Error('素材文件超过 2 MB');if(crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('单词素材校验失败，请刷新目录后重试');const raw=parseBytes(bytes);if(raw.format!=='research-english-wordbook-v1'||!Array.isArray(raw.words)||raw.words.length>20000)throw Error('单词素材格式无效');const {cleanRows,signature}=require('./english-wordbooks'),{words,duplicates}=cleanRows(raw.words.map(w=>[w.term,w.meaning,w.usphone||'',w.ukphone||'']));if(duplicates||words.length!==item.count||signature(words)!==item.contentHash)throw Error('单词素材词条与目录不一致');return {item,words,metadata:C.wordbookMetadata({...item,...raw})};
 }
 return {settings,list,download,downloadWordbook,importURL:async url=>C.readCourse(parseBytes(await request(publicURL(url))))};
};
module.exports.publicURL=publicURL;
module.exports.isPublicAddress=isPublicAddress;
module.exports.requestBytes=requestBytes;
module.exports.DEFAULT_URL=DEFAULT_URL;

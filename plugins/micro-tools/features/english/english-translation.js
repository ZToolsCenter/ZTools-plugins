// Translation adapters. Credentials use the injected device-local store, never the host database.
// Protocol references (no third-party implementation copied):
// https://docs.cloud.google.com/docs/authentication/rest
// https://help.aliyun.com/zh/sdk/product-overview/v3-request-structure-and-signature
// https://api.aliyun.com/document/alimt/2018-10-12/TranslateGeneral
// https://fanyi-api.baidu.com/doc/21
// https://docs.volcengine.com/docs/4640/65067
// https://cloud.tencent.com/document/api/213/30654
// https://ai.youdao.com/DOCSIRMA/html/trans/api/wbfy/index.html
// https://github.com/NiuTrans/MCP-TextTranslation
// https://developers.deepl.com/api-reference/translate
// https://open.caiyunapp.com/五分钟学会彩云小译_API_2
const https=require('https'),crypto=require('crypto'),network=require('./english-network');
const clone=x=>JSON.parse(JSON.stringify(x));
const field=(key,label,secret=true,required=true,extra={})=>({key,label,secret,required,...extra});
const PROVIDERS=[
 {id:'google',name:'谷歌翻译',fields:[],unofficial:true,note:'内置免密钥网页接口，非官方 API；可能受网络或频率限制。仅点击查询时发送选中文本。'},
 {id:'google-cloud',name:'Google Cloud Translation',fields:[field('apiKey','API key')],note:'官方 Cloud Translation Basic v2；需开通对应服务，使用自己的额度。'},
 {id:'aliyun',name:'阿里翻译',fields:[field('accessKeyId','AccessKey ID'),field('accessKeySecret','AccessKey Secret')],note:'官方机器翻译通用版（TranslateGeneral）；ACS3 请求签名。'},
 {id:'baidu',name:'百度翻译',fields:[field('appId','APP ID'),field('secretKey','密钥')],note:'官方通用翻译 API。'},
 {id:'volcengine',name:'火山翻译',fields:[field('accessKeyId','Access Key ID'),field('secretAccessKey','Secret Access Key')],note:'官方机器翻译 TranslateText；区域 cn-north-1。'},
 {id:'tencent',name:'腾讯翻译',fields:[field('secretId','Secret ID'),field('secretKey','Secret Key'),field('region','地域',false,true,{default:'ap-guangzhou'}),field('projectId','项目 ID',false,true,{default:'0'})],note:'官方腾讯云 TMT；默认项目为 0，使用 TC3 签名。'},
 {id:'transmart',name:'腾讯交互翻译',fields:[],unofficial:true,note:'TranSmart 免密钥网页接口，非官方开放 API；可用性随网站变化。'},
 {id:'niutrans',name:'小牛翻译',fields:[field('apiKey','API key')],note:'官方小牛文本翻译 API。'},
 {id:'youdao',name:'有道翻译',fields:[field('appKey','应用 ID'),field('appSecret','应用密钥')],note:'官方智云文本翻译 API，v3 签名。'},
 {id:'deepl',name:'DeepL',fields:[field('apiKey','API key'),field('plan','套餐',false,true,{default:'auto',options:[{value:'auto',label:'自动（按密钥识别）'},{value:'free',label:'API Free'},{value:'pro',label:'API Pro'}]})],note:'官方 DeepL API；Free 和 Pro 使用不同服务地址。'},
 {id:'caiyun',name:'彩云小译',fields:[field('token','Token'),field('secretKey','Secret key（旧版 Token 可留空）',true,false)],note:'官方彩云小译 API；有 Secret key 时启用签名，兼容旧版 Token。'}
];
for(const p of PROVIDERS)for(const f of p.fields)if(['appId','appKey','accessKeyId','secretId'].includes(f.key))f.display=true;
const sha=text=>crypto.createHash('sha256').update(text).digest('hex');
const hmac=(key,text,encoding)=>crypto.createHmac('sha256',key).update(text).digest(encoding);
const compact=text=>{const chars=Array.from(text);return chars.length>20?chars.slice(0,10).join('')+chars.length+chars.slice(-10).join(''):text};
const form=obj=>new URLSearchParams(obj).toString();
const jsonRequest=(url,data,headers={})=>({url,method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
const formRequest=(url,data)=>({url,method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form(data)});
function failure(message){const error=new Error(message);error.translationSafe=true;return error}
function transport(request){return new Promise((resolve,reject)=>{
 const url=new URL(request.url);if(url.protocol!=='https:')return reject(failure('翻译接口必须使用 HTTPS。'));
 const headers={Accept:'application/json','User-Agent':'ResearchBox-English/1.0',...request.headers};
 if(request.body)headers['Content-Length']=Buffer.byteLength(request.body);
 let settled=false,timer;
 const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value)};
 const req=https.request(url,{method:request.method||'POST',headers},res=>{
  const chunks=[];let size=0;
  res.on('data',chunk=>{size+=chunk.length;if(size>256*1024)req.destroy(failure('翻译响应过大，请缩短选中文本。'));else chunks.push(chunk)});
  res.on('error',()=>finish(failure('翻译连接中断，请重试。')));
  res.on('end',()=>finish(null,{status:res.statusCode,body:Buffer.concat(chunks).toString('utf8')}));
 });
 timer=setTimeout(()=>req.destroy(failure('翻译请求超时，请检查网络或切换引擎。')),15000);
 req.on('error',error=>finish(error.translationSafe?error:failure('无法连接翻译服务，请检查网络或切换引擎。')));
 req.end(request.body||'');
})}
function buildRequest(engine,text,c,now,nonce){
 const iso=new Date(now).toISOString().replace(/\.\d{3}Z$/,'Z');
 const stamp=String(Math.floor(now/1000));
 if(engine==='google')return {url:'https://translate.googleapis.com/translate_a/single?'+form({client:'gtx',sl:'en',tl:'zh-CN',dt:'t',q:text}),method:'GET',headers:{}};
 if(engine==='google-cloud')return jsonRequest('https://translation.googleapis.com/language/translate/v2',{q:text,source:'en',target:'zh-CN',format:'text'},{'x-goog-api-key':c.apiKey});
 if(engine==='baidu')return formRequest('https://fanyi-api.baidu.com/api/trans/vip/translate',{q:text,from:'en',to:'zh',appid:c.appId,salt:nonce,sign:crypto.createHash('md5').update(c.appId+text+nonce+c.secretKey).digest('hex')});
 if(engine==='youdao')return formRequest('https://openapi.youdao.com/api',{q:text,from:'en',to:'zh-CHS',appKey:c.appKey,salt:nonce,curtime:stamp,signType:'v3',sign:sha(c.appKey+compact(text)+nonce+stamp+c.appSecret)});
 if(engine==='niutrans')return formRequest('https://api.niutrans.com/NiuTransServer/translation',{src_text:text,from:'en',to:'zh',apikey:c.apiKey});
 if(engine==='deepl')return jsonRequest('https://'+((c.plan==='free'||c.plan==='auto'&&c.apiKey.endsWith(':fx'))?'api-free.deepl.com':'api.deepl.com')+'/v2/translate',{text:[text],source_lang:'EN',target_lang:'ZH'},{Authorization:'DeepL-Auth-Key '+c.apiKey});
 if(engine==='caiyun'){
  const body={source:[text],trans_type:'en2zh',request_id:nonce,detect:false};
  if(c.secretKey)Object.assign(body,{salt:nonce,current_time:stamp,sign:sha(c.token+nonce+stamp+c.secretKey+compact(text))});
  return jsonRequest('https://api.interpreter.caiyunai.com/v1/translator',body,{'x-authorization':'token '+c.token});
 }
 if(engine==='transmart')return jsonRequest('https://transmart.qq.com/api/imt',{header:{fn:'auto_translation',client_key:'researchbox-'+nonce},type:'plain',model_category:'normal',source:{lang:'en',text_list:[text]},target:{lang:'zh'}},{Origin:'https://transmart.qq.com',Referer:'https://transmart.qq.com/'});
 if(engine==='aliyun'){
  const host='mt.aliyuncs.com',body=form({FormatType:'text',SourceLanguage:'en',TargetLanguage:'zh',SourceText:text,Scene:'general'}),hash=sha(body);
  const signed={'host':host,'x-acs-action':'TranslateGeneral','x-acs-content-sha256':hash,'x-acs-date':iso,'x-acs-signature-nonce':nonce,'x-acs-version':'2018-10-12'};
  const names=Object.keys(signed).sort(),canonical=['POST','/','',names.map(k=>k+':'+signed[k]+'\n').join(''),names.join(';'),hash].join('\n');
  return {url:'https://'+host+'/',method:'POST',headers:{...signed,'Content-Type':'application/x-www-form-urlencoded',Authorization:'ACS3-HMAC-SHA256 Credential='+c.accessKeyId+',SignedHeaders='+names.join(';')+',Signature='+hmac(c.accessKeySecret,'ACS3-HMAC-SHA256\n'+sha(canonical),'hex')},body};
 }
 if(engine==='tencent'){
  const host='tmt.tencentcloudapi.com',body=JSON.stringify({SourceText:text,Source:'en',Target:'zh',ProjectId:Number(c.projectId)}),contentType='application/json; charset=utf-8',date=iso.slice(0,10),scope=date+'/tmt/tc3_request';
  const names='content-type;host;x-tc-action',canonical=['POST','/','','content-type:'+contentType+'\nhost:'+host+'\nx-tc-action:texttranslate\n',names,sha(body)].join('\n');
  const signKey=hmac(hmac(hmac('TC3'+c.secretKey,date),'tmt'),'tc3_request');
  const signature=hmac(signKey,'TC3-HMAC-SHA256\n'+stamp+'\n'+scope+'\n'+sha(canonical),'hex');
  return {url:'https://'+host+'/',method:'POST',body,headers:{'Content-Type':contentType,Host:host,'X-TC-Action':'TextTranslate','X-TC-Version':'2018-03-21','X-TC-Timestamp':stamp,'X-TC-Region':c.region,Authorization:'TC3-HMAC-SHA256 Credential='+c.secretId+'/'+scope+', SignedHeaders='+names+', Signature='+signature}};
 }
 if(engine==='volcengine'){
  const host='translate.volcengineapi.com',query='Action=TranslateText&Version=2020-06-01',date=iso.replace(/[:-]/g,''),shortDate=date.slice(0,8),scope=shortDate+'/cn-north-1/translate/request';
  const body=JSON.stringify({SourceLanguage:'en',TargetLanguage:'zh',TextList:[text]}),hash=sha(body);
  const signed={'content-type':'application/json',host,'x-content-sha256':hash,'x-date':date},names=Object.keys(signed).sort();
  const canonical=['POST','/',query,names.map(k=>k+':'+signed[k]+'\n').join(''),names.join(';'),hash].join('\n');
  const signKey=hmac(hmac(hmac(hmac(c.secretAccessKey,shortDate),'cn-north-1'),'translate'),'request');
  return {url:'https://'+host+'/?'+query,method:'POST',body,headers:{...signed,Authorization:'HMAC-SHA256 Credential='+c.accessKeyId+'/'+scope+', SignedHeaders='+names.join(';')+', Signature='+hmac(signKey,'HMAC-SHA256\n'+date+'\n'+scope+'\n'+sha(canonical),'hex')}};
 }
 throw failure('请选择支持的翻译引擎。');
}
function readResult(engine,data){
 let value;
 if(engine==='google')value=Array.isArray(data?.[0])?data[0].map(x=>typeof x?.[0]==='string'?x[0]:'').join(''):undefined;
 else if(engine==='google-cloud')value=data?.data?.translations?.map(x=>x.translatedText).join('\n');
 else if(engine==='aliyun')value=String(data?.Code)==='200'?data?.Data?.Translated:undefined;
 else if(engine==='baidu')value=(!data?.error_code||String(data.error_code)==='52000')?data?.trans_result?.map(x=>x.dst).join('\n'):undefined;
 else if(engine==='volcengine')value=!data?.ResponseMetadata?.Error?data?.TranslationList?.map(x=>x.Translation).join('\n'):undefined;
 else if(engine==='tencent')value=!data?.Response?.Error?data?.Response?.TargetText:undefined;
 else if(engine==='transmart')value=Array.isArray(data?.auto_translation)?data.auto_translation.join('\n'):undefined;
 else if(engine==='niutrans')value=(!data?.error_code||String(data.error_code)==='0')?data?.tgt_text:undefined;
 else if(engine==='youdao')value=String(data?.errorCode)==='0'?data?.translation?.join('\n'):undefined;
 else if(engine==='deepl')value=data?.translations?.map(x=>x.text).join('\n');
 else if(engine==='caiyun')value=Array.isArray(data?.target)?data.target.join('\n'):data?.target;
 if(typeof value!=='string'||!value.trim())throw failure('翻译服务未返回结果，请检查凭据、额度和服务权限，或切换引擎。');
 // Results are text, never HTML. Decode the limited entities returned by Google v2.
 if(engine==='google-cloud')value=value.replace(/&(amp|lt|gt|quot|apos|#39|#x27);/g,(_,s)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",'#39':"'",'#x27':"'"})[s]);
 if(value.length>10000)throw failure('翻译结果过长，请缩短选中文本。');
 return value.trim();
}
module.exports=function createTranslation(storage,options={}){
 const STORE='english-translation-v1',send=options.transport||transport,now=options.now||Date.now,random=options.nonce||(()=>crypto.randomUUID());
 const credentials=options.credentials||require('../../shared/local-credentials')();let persisted=false;
 const settings={engine:'google',providers:{},googleNetwork:{mode:'auto',proxy:''}},cache=new Map(),pending=new Map(),audioCache=new Map(),audioPending=new Map();let googleBackoffUntil=0,googleBackoffRoute='';
 for(const provider of PROVIDERS){settings.providers[provider.id]={};for(const f of provider.fields)settings.providers[provider.id][f.key]=f.default||''}
 const saved=storage?.getItem(STORE);
 if(saved&&typeof saved==='object'){
  persisted=true;if(saved.googleNetwork){try{settings.googleNetwork=networkSettings(saved.googleNetwork)}catch{}}
  if(PROVIDERS.some(p=>p.id===saved.engine))settings.engine=saved.engine;
  for(const p of PROVIDERS)for(const f of p.fields)if(!f.secret&&typeof saved.providers?.[p.id]?.[f.key]==='string'){
   const value=saved.providers[p.id][f.key];if(value.length<=200&&!/[\r\n]/.test(value)&&(!f.options||f.options.some(o=>o.value===value)))settings.providers[p.id][f.key]=value;
  }
 }
 const savedCredentials=credentials.read('translation');
 for(const p of PROVIDERS)for(const f of p.fields)if(f.secret){const value=savedCredentials[p.id]?.[f.key];if(typeof value==='string'&&value.length<=2048&&!/[\r\n\0]/.test(value))settings.providers[p.id][f.key]=value}
 function secretValues(value){const result={};for(const p of PROVIDERS){const fields={};for(const f of p.fields)if(f.secret&&value.providers[p.id][f.key])fields[f.key]=value.providers[p.id][f.key];if(Object.keys(fields).length)result[p.id]=fields}return result}
 function view(){const result={engine:settings.engine,googleNetwork:clone(settings.googleNetwork),providers:{},credentialStorage:credentials.mode(),persisted};for(const p of PROVIDERS){const c=settings.providers[p.id],safe={has:{}};for(const f of p.fields){if(f.secret){safe.has[f.key]=Boolean(c[f.key]);if(f.display)safe[f.key]=c[f.key]}else safe[f.key]=c[f.key]}result.providers[p.id]=safe}return result}
 function networkSettings(value){const mode=value?.mode||'auto';if(!['auto','direct','manual'].includes(mode))throw failure('谷歌网络模式无效。');const proxy=value.proxy?network.normalizeProxy(value.proxy):'';if(mode==='manual'&&!proxy)throw failure('请填写代理地址。');return {mode,proxy}}
 function config(patch){
  if(patch===undefined)return view();
  if(!patch||typeof patch!=='object'||Array.isArray(patch))throw failure('翻译设置格式无效。');
  const next=clone(settings);if(patch.googleNetwork!==undefined)next.googleNetwork=networkSettings(patch.googleNetwork);
  if(patch.engine!==undefined){if(!PROVIDERS.some(p=>p.id===patch.engine))throw failure('请选择支持的翻译引擎。');next.engine=patch.engine}
  if(patch.clearCredentials!==undefined){if(!Array.isArray(patch.clearCredentials)||patch.clearCredentials.some(id=>!PROVIDERS.some(p=>p.id===id)))throw failure('清除凭据的引擎无效。');for(const p of PROVIDERS.filter(p=>patch.clearCredentials.includes(p.id)))for(const f of p.fields)if(f.secret)next.providers[p.id][f.key]=''}
  if(patch.providers!==undefined){
   if(!patch.providers||typeof patch.providers!=='object'||Array.isArray(patch.providers))throw failure('翻译设置格式无效。');
   for(const id of Object.keys(patch.providers)){
    const p=PROVIDERS.find(p=>p.id===id),values=patch.providers[id];if(!p||!values||typeof values!=='object'||Array.isArray(values))throw failure('翻译设置格式无效。');
    for(const f of p.fields){
     if(!Object.hasOwn(values,f.key))continue;const raw=values[f.key];
     if(typeof raw!=='string'||raw.length>2048||/[\r\n\0]/.test(raw))throw failure(p.name+'的'+f.label+'格式无效。');
     const value=raw.trim();if(f.secret&&!value)continue; // Blank password means keep existing; explicit clear button removes it.
     if(f.options&&!f.options.some(o=>o.value===value))throw failure('请选择有效套餐。');
     if(f.key==='region'&&!/^[a-z]{2}-[a-z]+(?:-\d+)?$/.test(value))throw failure('请填写有效的腾讯云地域，如 ap-guangzhou。');
     if(f.key==='projectId'&&(!/^\d{1,12}$/.test(value)||!Number.isSafeInteger(Number(value))))throw failure('项目 ID 必须为非负整数。');
     next.providers[id][f.key]=value;
    }
   }
  }
  // Persist only the allowlisted, non-secret fields. Never persist the has flags or caches.
  const publicSettings={engine:next.engine,providers:{},googleNetwork:next.googleNetwork};
  for(const p of PROVIDERS){publicSettings.providers[p.id]={};for(const f of p.fields)if(!f.secret)publicSettings.providers[p.id][f.key]=next.providers[p.id][f.key]}
  const before=secretValues(settings),after=secretValues(next),changed=JSON.stringify(before)!==JSON.stringify(after);
  if(changed)credentials.write('translation',after);
  let saved=false;
  try{if(typeof storage?.setItem==='function'){const result=storage.setItem(STORE,publicSettings);if(result===false||result?.error)throw Error('write failed');saved=true}}
  catch(_){if(changed){try{credentials.write('translation',before)}catch(_){throw failure('翻译设置保存失败，凭据回退也失败；请重新打开设置核对已保存状态。')}}throw failure('翻译设置保存失败，请检查本机存储后重试。')}
  settings.engine=next.engine;settings.providers=next.providers;settings.googleNetwork=next.googleNetwork;persisted=saved;cache.clear();return view();
 }
 function googleLimitError(){const seconds=Math.max(1,Math.ceil((googleBackoffUntil-now())/1000));return failure('谷歌翻译返回 HTTP 429（请求被限流）'+(googleBackoffRoute?' · '+googleBackoffRoute:'')+'。本地暂停新翻译请求 '+seconds+' 秒，之后可手动重试；服务可能仍未解除限制。此接口无需密钥，可在练习设置切换翻译引擎。单词发音是独立接口，也可能来自缓存。')}
 async function translate(input){
  if(!input||typeof input.text!=='string'||!input.text.trim()||input.text.trim().length>500)throw failure('请选择 1–500 个字符的单词或短语。');
  const text=input.text.trim(),engine=input.engine||settings.engine,p=PROVIDERS.find(p=>p.id===engine);
  if(!p)throw failure('请选择支持的翻译引擎。');const c=clone(settings.providers[engine]);
  for(const f of p.fields)if(f.required&&!c[f.key])throw failure('请先在设置中填写'+p.name+'的'+f.label+'。');
  const key=sha(JSON.stringify([engine,c,text]));
  const cached=cache.get(key);if(cached&&now()-cached.at<86400000)return {...cached.result,cached:true};
  if(pending.has(key))return pending.get(key);
  if(engine==='google'&&now()<googleBackoffUntil)throw googleLimitError();
  if(pending.size>=3)throw failure('正在查询，请稍后再试。');
  const request=buildRequest(engine,text,c,now(),random());
  const work=(async()=>{
   try{
    const response=await Promise.resolve().then(()=>(engine==='google'&&!options.transport?network.request(request,settings.googleNetwork):send(request))),status=Number(response.status??response.statusCode);
    if(engine==='google'&&status===429){const value=String(response.retryAfter||'').trim(),delay=/^\d+$/.test(value)?Number(value)*1000:Date.parse(value)-now();googleBackoffUntil=now()+Math.max(60000,Number.isFinite(delay)?delay:60000);googleBackoffRoute=response.route||'';throw googleLimitError()}
    if(engine==='google'&&(status<200||status>=300||!Number.isFinite(status)))throw failure('谷歌免密钥翻译接口返回 HTTP '+(Number.isFinite(status)?status:'错误')+'，请稍后重试或在练习设置切换翻译引擎。');
    if(status<200||status>=300||!Number.isFinite(status))throw failure('翻译服务返回 HTTP '+(Number.isFinite(status)?status:'错误')+'，请检查网络、凭据和额度。');
    const raw=typeof response.body==='string'?response.body:JSON.stringify(response.body);
    if(!raw||Buffer.byteLength(raw)>256*1024)throw failure('翻译响应为空或过大。');
    let data;try{data=JSON.parse(raw)}catch(_){throw failure('翻译服务返回格式异常，请切换引擎。')}
    const translation=readResult(engine,data),result={engine,text,translation,sourceLanguage:'en',targetLanguage:'zh-CN',cached:false,...(response.route?{route:response.route}:{})};
    cache.set(key,{at:now(),result});if(cache.size>300)cache.delete(cache.keys().next().value);return {...result};
   }catch(error){if(error.translationSafe)throw error;throw failure('翻译请求失败，请检查网络、凭据和服务权限。')}
   finally{pending.delete(key)}
  })();pending.set(key,work);return work;
 }
 async function pronounce(input){
  const text=typeof input?.text==='string'?input.text.trim():'';if(!text||text.length>200||!/[a-z]/i.test(text))throw failure('发音支持 1–200 个字符的英文单词或短语。');const accent=input.accent||'en-US';if(!['en-US','en-GB'].includes(accent))throw failure('请选择美式或英式发音。');const key=accent+'|'+text;if(audioCache.has(key))return {...audioCache.get(key),cached:true};if(audioPending.has(key))return audioPending.get(key);if(audioPending.size>=2)throw failure('发音正在准备，请稍后再试。');
  const work=(async()=>{try{const res=await (options.audioTransport||network.request)({url:'https://translate.google.com/translate_tts?'+form({ie:'UTF-8',client:'tw-ob',tl:accent,q:text}),method:'GET',binary:true},settings.googleNetwork);if(res.status!==200||!/^audio\//i.test(res.contentType)||!Buffer.isBuffer(res.body)||res.body.length<100||res.body.length>1024*1024)throw failure('谷歌未返回有效发音音频，请稍后重试或使用本机朗读。');const result={text,accent,base64:res.body.toString('base64'),mime:'audio/mpeg',source:'Google 在线发音',cached:false};audioCache.set(key,result);if(audioCache.size>100)audioCache.delete(audioCache.keys().next().value);return result}finally{audioPending.delete(key)}})();audioPending.set(key,work);return work;
 }
 return {providers:clone(PROVIDERS),config,translate,pronounce};
};
module.exports.providers=clone(PROVIDERS);

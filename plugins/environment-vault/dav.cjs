'use strict';
const http=require('http'),https=require('https'),{DOMParser}=require('@xmldom/xmldom');
const {parseName}=require('./backup-names.cjs');
const MAX=12*1024*1024;
/** 不跟随重定向，防止将认证信息带到其他服务器；仅操作用户指定目录的专属子目录。 */
class Dav {
 constructor(config){
  this.config=config;this.base=new URL(config.url);
  if(!['https:','http:'].includes(this.base.protocol)||this.base.username||this.base.password||this.base.search||this.base.hash)throw Error('WebDAV 地址必须是无账号参数的 HTTP/HTTPS 目录地址');
  this.base.pathname=this.base.pathname.replace(/\/?$/,'/');this.root=new URL('ztools-environment-v1/',this.base);
 }
 url(name=''){if(name&&!/^[^/\\\x00]+$/.test(name))throw Error('备份文件名无效');return new URL(encodeURIComponent(name),this.root);}
 request(method,url=this.root,body=null,headers={}){
  return new Promise((resolve,reject)=>{
   const auth=Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
   const req=(url.protocol==='https:'?https:http).request(url,{method,headers:{Authorization:`Basic ${auth}`,...headers,...(body?{'Content-Length':body.length}:{})}},res=>{
    const chunks=[];let length=0;
    res.on('data',chunk=>{length+=chunk.length;if(length>MAX){req.destroy(Error('响应超过 12 MB 限制'));return;}chunks.push(chunk);});
    res.on('error',()=>reject(Error('WebDAV 响应读取失败')));
    res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
   });
   const timeout=setTimeout(()=>req.destroy(Error('WebDAV 请求超时')),25000);
   req.on('close',()=>clearTimeout(timeout));req.on('error',error=>reject(Error(error.code==='ENOTFOUND'?'WebDAV 域名无法解析':error.message==='WebDAV 请求超时'?error.message:'WebDAV 网络连接失败')));
   if(body)req.write(body);req.end();
  });
 }
 check(result,allowed){if(!allowed.includes(result.status))throw Error(result.status===401||result.status===403?'WebDAV 认证失败或没有目录权限':`WebDAV 请求失败（HTTP ${result.status}）`);return result;}
 async ensure(){this.check(await this.request('MKCOL'),[200,201,204,405]);}
 async list(){
  await this.ensure();const xml=Buffer.from('<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/><d:getlastmodified/><d:resourcetype/></d:prop></d:propfind>');
  const r=this.check(await this.request('PROPFIND',this.root,xml,{Depth:'1','Content-Type':'application/xml'}),[207]);
  const text=r.body.toString('utf8');if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('WebDAV 返回了不支持的 XML');
  let malformed=false;const doc=new DOMParser({errorHandler:{warning:()=>{},error:()=>{malformed=true;},fatalError:()=>{malformed=true;}}}).parseFromString(text,'application/xml');
  if(malformed)throw Error('WebDAV 目录 XML 无法解析');
  const rows=[];
  for(const node of Array.from(doc.getElementsByTagNameNS('DAV:','response'))){
   const href=node.getElementsByTagNameNS('DAV:','href')[0]?.textContent;if(!href)continue;
   let url,name;try{url=new URL(href,this.root);if(url.origin!==this.root.origin||!url.pathname.startsWith(this.root.pathname))continue;name=decodeURIComponent(url.pathname.slice(this.root.pathname.length));}catch{continue;}
   const parsed=parseName(name);if(!parsed)continue;
   rows.push({...parsed,bytes:Number(node.getElementsByTagNameNS('DAV:','getcontentlength')[0]?.textContent)||0});
  }
  return rows.sort((a,b)=>b.name.localeCompare(a.name));
 }
 /** 删除限于本插件正式快照；服务端返回成功后再读取确认，不能把异步接受当作删除完成。 */
 async remove(name){
  if(!parseName(name))throw Error('备份文件名无效');
  this.check(await this.request('DELETE',this.url(name)),[200,202,204,404]);
  const verify=await this.request('GET',this.url(name));
  if(verify.status===200)throw Error('服务器仍保留该备份，删除尚未完成');
  this.check(verify,[404,410]);
 }
 async get(name){return this.check(await this.request('GET',this.url(name)),[200]).body;}
 /** 临时文件上传并回读校验，MOVE 发布为正式快照，列表不会列出未上传完的文件。 */
 async put(name,body){
  await this.ensure();const temporary=`${name}.uploading`;let published=false;
  try{
   this.check(await this.request('PUT',this.url(temporary),body,{'Content-Type':'application/zip','If-None-Match':'*'}),[200,201,204]);
   const checked=await this.get(temporary);if(!checked.equals(body))throw Error('上传回读校验失败');
   this.check(await this.request('MOVE',this.url(temporary),null,{Destination:this.url(name).href,Overwrite:'F'}),[200,201,204]);published=true;
   if(!(await this.get(name)).equals(body))throw Error('正式备份回读校验失败');
  }finally{if(!published)try{await this.request('DELETE',this.url(temporary));}catch{}}
 }
}
module.exports={Dav};

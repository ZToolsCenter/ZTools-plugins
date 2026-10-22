'use strict';
(function exposeParser(root){
 /** 固定三行键值格式，完整校验后才返回；凭据不裁剪、不解码、不写入任何存储。 */
 function parse(text){
  if(typeof text!=='string'||text.length>16384)throw Error('配置应为不超过 16 KB 的三行文本');
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))throw Error('配置包含不支持的控制字符');
  const lines=text.replace(/\r\n?/g,'\n').split('\n').filter(line=>line.trim()!=='');
  if(lines.length!==3)throw Error('请提供 url、user、password 三项，每项单独一行');
  const result={};
  for(const line of lines){
   // 分隔符后最多一个空格或 Tab 属于格式，其余字符均作为原始值保留。
   const match=line.match(/^(url|user|password):[ \t]?(.+)$/i);
   if(!match)throw Error('格式不正确，请使用 url:、user:、password: 三行，字段名和冒号必须为英文');
   const label=match[1].toLowerCase();const key=label==='user'?'username':label;
   if(Object.hasOwn(result,key))throw Error('url、user、password 各只能出现一次');
   if(!match[2].trim()||/[\t]/.test(match[2]))throw Error('地址、用户名和密码均不能为空，值中不支持 Tab');
   result[key]=match[2];
  }
  if(!['url','username','password'].every(key=>Object.hasOwn(result,key)))throw Error('缺少 url、user 或 password');
  if(!/^https?:\/\//i.test(result.url)||/\s/.test(result.url))throw Error('地址必须是完整的 HTTP 或 HTTPS URL，不能包含空白');
  let url;try{url=new URL(result.url);}catch{throw Error('WebDAV 地址不是有效的 URL');}
  if(!url.hostname||url.username||url.password||url.hash)throw Error('地址中不能携带账号、密码或 # 片段，请使用独立的用户名和密码行');
  return result;
 }
 const parser={parse};root.WebdavConfigParser=parser;
 if(typeof module==='object'&&module.exports)module.exports=parser;
})(globalThis);

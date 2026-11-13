'use strict';
const { validUrl } = require('./core.cjs');
const http = require('node:http'), https = require('node:https');
function download(target, signal, limit, redirects=0) {
  validUrl(target);
  return new Promise((resolve,reject)=>{
    const request=(target.startsWith('https:')?https:http).get(target,{signal,headers:{'User-Agent':'ZTools-Dock/0.1.7','Accept-Encoding':'identity'}},res=>{
      if(res.statusCode>=300&&res.statusCode<400&&res.headers.location) {
        res.resume(); if(redirects>=4) return reject(new Error('重定向次数过多'));
        try { resolve(download(new URL(res.headers.location,target).href,signal,limit,redirects+1)); } catch(e) { reject(e); } return;
      }
      if(res.statusCode!==200) {res.resume();return reject(new Error('网站未提供可用图标'));}
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>limit)res.destroy(new Error('图标或网页过大'));else chunks.push(chunk)});
      res.on('error',reject);res.on('end',()=>resolve({bytes:Buffer.concat(chunks),mime:String(res.headers['content-type']||'').split(';')[0],url:target}));
    });request.on('error',reject);
  });
}
function iconLinks(html, base) {
  const links=[];
  for(const tag of html.match(/<link\b[^>]*>/gi)||[]) {
    const attrs={};for(const m of tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[m[1].toLowerCase()]=m[2]??m[3]??m[4];
    if(/(?:^|\s)(?:icon|apple-touch-icon)(?:\s|$)/i.test(attrs.rel||'') && attrs.href) {
      try {const u=new URL(attrs.href.replace(/&amp;/g,'&'),base).href;validUrl(u);links.push(u);}catch{}
    }
  }
  return [...new Set(links)];
}
async function websiteIcon(target) {
  validUrl(target);
  const abort=new AbortController(), timer=setTimeout(()=>abort.abort(),8000);
  try {
    let links=[];
    try { const page=await download(target,abort.signal,512000);links=iconLinks(page.bytes.toString('utf8'),page.url); }catch{}
    links.push(new URL('/favicon.ico',target).href);
    for(const url of [...new Set(links)].slice(0,6)) {
      try {const image=await download(url,abort.signal,280000);if(!image.bytes.length)continue;
        if(image.mime && !image.mime.startsWith('image/') && image.mime!=='application/octet-stream')continue;
        const mime=image.mime.startsWith('image/')?image.mime:/\.svg(?:\?|$)/i.test(url)?'image/svg+xml':'image/x-icon';
        if(!['image/png','image/jpeg','image/webp','image/svg+xml','image/x-icon','image/vnd.microsoft.icon'].includes(mime))continue;
        return `data:${mime};base64,${image.bytes.toString('base64')}`;
      }catch{}
    }
    throw new Error('未获取到网站图标，可重试或选择本地图片');
  }finally {clearTimeout(timer);}
}
module.exports={websiteIcon,iconLinks};

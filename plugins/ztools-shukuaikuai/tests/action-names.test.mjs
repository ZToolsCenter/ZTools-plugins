import {test} from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {createServer} from 'node:http';
import {suggestedName} from '../src/action-name.js';
const {websiteName}=createRequire(import.meta.url)('../public/action-art.cjs');

test('selected targets supply readable default action names',()=>{
 assert.equal(suggestedName({type:'path',value:'C:\\资料\\月报.xlsx'}),'月报.xlsx');
 assert.equal(suggestedName({type:'path',value:'D:\\项目资料\\'}),'项目资料');
 assert.equal(suggestedName({type:'app',value:'C:\\Apps\\Snipaste.EXE'}),'Snipaste');
 assert.equal(suggestedName({type:'app',value:'C:\\工具\\截图工具.lnk'}),'截图工具');
 assert.equal(suggestedName({type:'url',value:'https://www.example.com/docs?q=1'}),'example.com');
 assert.equal(suggestedName({type:'url',value:'file:///C:/secret'}),'');
 assert.equal(suggestedName({type:'plugin',pluginTitle:'程序坞',value:'打开面板'}),'程序坞 · 打开面板');
 assert.equal(suggestedName({type:'key',value:'Ctrl+C'}),'');
});

test('website names use page titles and safely fall back when unavailable',async()=>{
 const server=createServer((req,res)=>{
  if(req.url==='/redirect'){res.writeHead(302,{Location:'/title'});res.end();return}
  if(req.url==='/fail'){res.writeHead(404);res.end();return}
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(req.url==='/title'?'<title> 工具 &amp; 资料 &#x7AD9;\n </title>':'<html>no title</html>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  assert.equal(await websiteName(base+'/title'),'工具 & 资料 站');
  assert.equal(await websiteName(base+'/redirect'),'工具 & 资料 站');
  assert.equal(await websiteName(base+'/empty'),'127.0.0.1');
  assert.equal(await websiteName(base+'/fail'),'127.0.0.1');
  await assert.rejects(websiteName('file:///C:/secret'));
 }finally{await new Promise(r=>server.close(r))}
});

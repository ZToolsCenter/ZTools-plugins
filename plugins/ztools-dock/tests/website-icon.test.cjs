const {test}=require('node:test');const assert=require('node:assert/strict');
const http=require('node:http');const {websiteIcon,iconLinks}=require('../public/runtime/website-icon.cjs');
test('网站图标处理相对路径、跳转和 favicon 回退；拒绝不支持的协议',async()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
 const server=http.createServer((req,res)=>{
  if(req.url==='/start'){res.writeHead(302,{location:'/page'});res.end();}
  else if(req.url==='/page'){res.setHeader('content-type','text/html');res.end('<link href="/img.png" rel="shortcut icon">');}
  else if(['/img.png','/favicon.ico'].includes(req.url)){res.setHeader('content-type','image/png');res.end(png);}
  else {res.writeHead(404);res.end();}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try {const root=`http://127.0.0.1:${server.address().port}`;assert.equal(await websiteIcon(root+'/start'),`data:image/png;base64,${png.toString('base64')}`);assert.ok((await websiteIcon(root+'/missing')).startsWith('data:image/png;'));assert.deepEqual(iconLinks('<link rel="icon" href="javascript:x">',root),[]);await assert.rejects(websiteIcon('file:///C:/secret'),/网址/);}
 finally{await new Promise(r=>server.close(r));}
});

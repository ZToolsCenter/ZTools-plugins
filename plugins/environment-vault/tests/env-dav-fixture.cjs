const http=require('http');
function createDav(){const files=new Map(),requests=[];const server=http.createServer((req,res)=>{const chunks=[];req.on('data',x=>chunks.push(x));req.on('end',()=>{const body=Buffer.concat(chunks),p=new URL(req.url,'http://local').pathname;requests.push({method:req.method,path:p});if(req.headers.authorization!=='Basic '+Buffer.from('tester:app-password').toString('base64')){res.writeHead(401);return res.end();}
 if(req.method==='MKCOL'){res.writeHead(201);return res.end();}
 if(req.method==='PUT'){if(files.has(p)&&req.headers['if-none-match']==='*'){res.writeHead(412);return res.end();}files.set(p,body);res.writeHead(201);return res.end();}
 if(req.method==='GET'){if(!files.has(p)){res.writeHead(404);return res.end();}return res.end(files.get(p));}
 if(req.method==='MOVE'){const dest=new URL(req.headers.destination).pathname;if(files.has(dest)){res.writeHead(412);return res.end();}if(!files.has(p)){res.writeHead(404);return res.end();}files.set(dest,files.get(p));files.delete(p);res.writeHead(201);return res.end();}
 if(req.method==='DELETE'){files.delete(p);res.writeHead(204);return res.end();}
 if(req.method==='PROPFIND'){res.writeHead(207,{'Content-Type':'application/xml'});return res.end('<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">'+[...files].filter(([name])=>name.startsWith(p)).map(([name,value])=>`<D:response><D:href>${name.replace(/&/g,'&amp;')}</D:href><D:propstat><D:prop><D:getcontentlength>${value.length}</D:getcontentlength></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`).join('')+'</D:multistatus>');}
 res.writeHead(405);res.end();});});return {server,files,requests};}
module.exports={createDav};

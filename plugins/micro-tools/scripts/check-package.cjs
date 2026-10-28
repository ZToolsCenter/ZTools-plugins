// Validate the explicit runtime list and smoke-test the actual ZPX, without host data.
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib'),{spawnSync}=require('node:child_process');

function validate(files){
 const manifest=JSON.parse(files.get('plugin.json')||'null');
 if(manifest?.name!=='micro-tools')throw Error('插件身份必须保持 micro-tools，避免切换本机存储空间');
 const datasets=JSON.parse(files.get('assets/data/journals/manifest.json')||'null');
 if(!datasets)throw Error('缺少期刊数据版本清单');
 for(const key of ['jcr','ccf']){
  const item=datasets[key],bytes=files.get(item.file);
  if(!bytes)throw Error('打包清单漏掉期刊数据：'+item.file);
  const sha=require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  if(sha!==item.sha256)throw Error('期刊数据哈希不符：'+item.file);
  if(JSON.parse(zlib.gunzipSync(bytes)).length!==item.records)throw Error('期刊数据条数不符：'+item.file);
 }
 if(datasets.ccf.linkedJcrSha256!==datasets.jcr.sha256)throw Error('CCF 下标与 JCR 快照未配对');
 const missing=new Set();
 function resolve(from,ref){
  if(/^(?:[a-z]+:|#|\/\/)/i.test(ref))return;
  const name=path.posix.normalize(path.posix.join(path.posix.dirname(from),ref.split(/[?#]/)[0]));
  const candidates=[name,...['.js','.cjs','.mjs','.json','/index.js'].map(ext=>name+ext)];
  if(candidates.some(n=>files.has(n)))return;
  const pkg=files.get(name+'/package.json');
  if(pkg){resolve(name+'/package.json',JSON.parse(pkg).main||'index.js');return}
  missing.add(from+' → '+ref);
 }
 for(const key of ['main','preload','logo'])if(manifest[key])resolve('plugin.json',manifest[key]);
 for(const [name,bytes]of files){
  if(/\.(?:js|cjs|mjs)$/.test(name)){
   const text=bytes.toString();
   for(const match of text.matchAll(/\b(?:require|import)\(\s*['"](\.[^'"]+)['"]\s*\)|\bfrom\s+['"](\.[^'"]+)['"]/g))resolve(name,match[1]||match[2]);
  }else if(name.endsWith('.html')){
   for(const match of bytes.toString().matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/g))resolve(name,match[1]);
  }
 }
 if(missing.size)throw Error('打包清单漏掉运行依赖：\n'+[...missing].join('\n'));
 return manifest;
}

function archive(file){
 const bytes=zlib.brotliDecompressSync(fs.readFileSync(file)),header=JSON.parse(bytes.subarray(16,16+bytes.readUInt32LE(12))),base=8+bytes.readUInt32LE(4),files=new Map();
 function walk(tree,prefix=''){for(const [name,item]of Object.entries(tree)){const key=prefix+name;if(item.files)walk(item.files,key+'/');else{if(path.posix.normalize(key)!==key||key.startsWith('../')||key.startsWith('/'))throw Error('安装包路径异常');const offset=base+Number(item.offset);if(!Number.isSafeInteger(offset)||offset<base||offset+item.size>bytes.length)throw Error('安装包文件偏移异常');files.set(key,bytes.subarray(offset,offset+item.size))}}}
 walk(header.files);return files;
}

function smoke(files){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'micro-tools-pack-check-'));
 try{
  for(const [name,bytes]of files){const target=path.join(dir,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes)}
  const result=spawnSync(process.execPath,['-e',`
   const assert=require('node:assert/strict'),path=require('node:path');
   const values=new Map(),registered={};
   global.window={ztools:{dbStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},registerTool:(k,fn)=>registered[k]=fn}};
   require(path.resolve('preload.js'));
   assert.equal(registered.search_journals({query:'Nature',limit:1}).items[0].name,'NATURE','期刊数据必须从安装清单中的版本目录载入');
   const api=window.englishApi;assert(api,'英语服务必须由 preload 完整载入');
   for(const method of ['list','communityList','communityGet','communityDownload','wordbooks','settings'])assert.equal(typeof api[method],'function',method);
   const seed=api.list()[0];api.saveProgress(seed.id,{seconds:37});assert.equal(api.progress(seed.id).seconds,37);
   assert.equal(typeof registered.list_english_lessons,'function');
   assert.equal(Object.keys(registered).length,Object.keys(require(path.resolve('plugin.json')).tools).length);
   console.log('✔ 安装包 preload、题库存取、广场 API 和 MCP 注册通过（隔离存储）');
  `],{cwd:dir,encoding:'utf8',timeout:20000});
  if(result.status!==0)throw Error('安装包启动检查失败：\n'+(result.stderr||result.error?.message||result.stdout));
  process.stdout.write(result.stdout);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
}

if(require.main===module)try{
 if(process.argv[2]==='--sources'){
  const [root,list,out]=process.argv.slice(3),files=new Map(fs.readFileSync(list,'utf8').trim().split('\n').map(name=>[name,fs.readFileSync(path.join(root,name))])),manifest=validate(files);
  const namedVersion=path.basename(out||'').match(/^micro-tools-v(\d+\.\d+\.\d+)\.zpx$/)?.[1];
  if(namedVersion&&namedVersion!==manifest.version)throw Error('输出文件名版本 '+namedVersion+' 与 plugin.json 的 '+manifest.version+' 不一致；请先更新 manifest，文件名不会改变插件版本');
  console.log('✔ 运行依赖与版本一致性检查通过');
 }else{const files=archive(process.argv[2]);validate(files);smoke(files)}
}catch(error){console.error('❌ '+error.message);process.exitCode=1}
module.exports={archive,validate,smoke};

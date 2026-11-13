const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {defaults}=require('../public/runtime/core.cjs');
const {prepareAddition}=require('../public/runtime/addition.cjs');
const {describeFile}=require('../public/runtime/file-actions.cjs');
test('应用移除执行/快捷方式后缀，文件与文件夹保留真实名称；混合复制默认分类且不写配置',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dock-add-unit-'));
 try {
  const names=['编辑器.EXE','快捷方式.lnk','应用.link','报告.txt','项目.v1'];
  for(const n of names.slice(0,4))fs.writeFileSync(path.join(dir,n),'fixture');fs.mkdirSync(path.join(dir,names[4]));
  const api={getFileIcon:()=>null},c=defaults(),before=JSON.stringify(c);
  assert.equal(describeFile(path.join(dir,names[0]),api).name,'编辑器');
  assert.equal(describeFile(path.join(dir,names[2]),api).name,'应用');
  const result=prepareAddition({payload:names.map(n=>({path:path.join(dir,n)}))},c,api);
  assert.deepEqual(result.entries.map(e=>e.categoryId),['tools','tools','tools','files','folders']);
  assert.equal(result.entries[3].name,'报告.txt');assert.equal(result.entries[4].name,'项目.v1');
  const url=prepareAddition({payload:'https://example.com/a'},c,api);
  assert.equal(url.entries[0].categoryId,'web');assert.equal(url.categories[0].name,'网址');
  assert.equal(JSON.stringify(c),before);
  c.categories=c.categories.filter(x=>x.id!=='tools');assert.equal(prepareAddition({payload:[{path:path.join(dir,names[0])}]},c,api).categories[0].id,'tools');
  assert.equal(prepareAddition({payload:'添加到程序坞'},defaults(),{...api,getCopyedFiles:()=>[]},()=> 'www.example.com').entries[0].target,'https://www.example.com');
 }finally{if(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(dir).startsWith('dock-add-unit-'))fs.rmSync(dir,{recursive:true,force:true});}
});

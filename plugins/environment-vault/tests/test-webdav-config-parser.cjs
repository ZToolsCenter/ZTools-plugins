'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('path');
const {parse}=require(path.resolve(process.env.VAULT_PACKAGE_ROOT||path.join(__dirname,'..'),'config-parser.js'));
test('英文键名完整识别，中文用户名、路径及密码特殊符号原样保留',()=>{
 const result=parse('url: https://dav.example.com:8443/文件/backup/\nuser: 张三@example.com\npassword: a:b：c=/+@#$"<&');
 assert.deepEqual(result,{url:'https://dav.example.com:8443/文件/backup/',username:'张三@example.com',password:'a:b：c=/+@#$"<&'});
});
test('Windows CRLF、英文标签大小写、任意顺序和空行可用',()=>{
 assert.deepEqual(parse('\r\nPASSWORD: app-pass\r\nURL: https://dav.example.com/backup/\r\nUSER: alice\r\n'),{password:'app-pass',url:'https://dav.example.com/backup/',username:'alice'});
});
test('只移除格式分隔空格，保留实际密码的首尾空格及原始编码',()=>{
 const p=parse('url: https://dav.example.com/%20/\nuser: alice\npassword:  p%40ss  ');
 assert.equal(p.password,' p%40ss  ');assert.equal(p.url,'https://dav.example.com/%20/');
});
test('缺项、重复别名、未知标签、额外说明、多行值和空值均拒绝',()=>{
 for(const text of ['url:https://example.com\nuser:alice','url:https://example.com\nurl:https://other.example\npassword:p','url:https://example.com\n账号：a\npassword:p','说明\nurl:https://example.com\nuser:a\npassword:p','url:https://example.com\nuser:a\npassword:\nnext-line','url:https://example.com\nuser:a\npassword:   '])assert.throws(()=>parse(text));
});
test('非 HTTP URL、内嵌凭据、空白、片段、控制字符和过长文本被拒绝，错误不回显输入',()=>{
 for(const url of ['ftp://dav.example.com','/relative','https://alice:private-secret@example.com','https://example.com/path#frag','https://example.com/a b','https://'])assert.throws(()=>parse(`url:${url}\nuser:alice\npassword:private-secret`),error=>!error.message.includes('private-secret'));
 assert.throws(()=>parse('url:https://example.com\nuser:a\npassword:one\x00two'));
 assert.throws(()=>parse('x'.repeat(16385)));assert.throws(()=>parse(null));
});
test('页面填入完整成功后清空粘贴区；失败原子保留三字段，其他配置始终不变',()=>{
 const fs=require('fs'),vm=require('vm');const app=fs.readFileSync(path.resolve(process.env.VAULT_PACKAGE_ROOT||path.join(__dirname,'..'),'app.js'),'utf8');
 const nodes=Object.fromEntries(['url','username','password','pasteConfig','pasteResult','configPanel','parseConfig','device','timed','remember'].map(id=>[id,{value:id,open:false,checked:false,addEventListener(){}}]));
 const sandbox={window:{WebdavConfigParser:{parse}},$:id=>nodes[id],busy:false};
 vm.runInNewContext(app.slice(app.indexOf('function updatePasteButton(')),sandbox);
 sandbox.fillPastedConfig('url:https://dav.example.com/\nuser:alice\npassword:a:b=123');
 assert.equal(nodes.url.value,'https://dav.example.com/');assert.equal(nodes.username.value,'alice');assert.equal(nodes.password.value,'a:b=123');assert.equal(nodes.pasteConfig.value,'');assert.equal(nodes.configPanel.open,true);assert.equal(nodes.parseConfig.disabled,true);
 sandbox.fillPastedConfig('url:https://wrong.example.com/\nuser:wrong');
 assert.equal(nodes.url.value,'https://dav.example.com/');assert.equal(nodes.username.value,'alice');assert.equal(nodes.password.value,'a:b=123');assert(nodes.pasteResult.textContent.includes('原表单未更改'));
 assert.equal(nodes.device.value,'device');assert.equal(nodes.timed.checked,false);assert.equal(nodes.remember.checked,false);
});
test('Electron 页面同时存在 CommonJS 时也向页面暴露解析器',()=>{
 const fs=require('fs'),vm=require('vm');const context={module:{exports:{}},URL};
 vm.runInNewContext(fs.readFileSync(path.resolve(process.env.VAULT_PACKAGE_ROOT||path.join(__dirname,'..'),'config-parser.js'),'utf8'),context);
 assert.equal(typeof context.WebdavConfigParser.parse,'function');assert.equal(context.module.exports,context.WebdavConfigParser);
});

test('中文键名和全角冒号拒绝；用户名与密码的中文不受影响',()=>{
 assert.throws(()=>parse('地址:https://dav.example.com/\nuser:alice\npassword:p'),/字段名和冒号必须为英文/);
 assert.throws(()=>parse('url：https://dav.example.com/\nuser:alice\npassword:p'),/字段名和冒号必须为英文/);
 assert.throws(()=>parse('url:https://dav.example.com/\nuser：张三\npassword:p'),/字段名和冒号必须为英文/);
 assert.equal(parse('url:https://dav.example.com/\nuser:张三\npassword:中文：密码').username,'张三');
});

test('仅接受 user 键名并映射到既有用户名字段',()=>{
 assert.equal(parse('url:https://dav.example.com/\nuser:张三\npassword:p').username,'张三');
 assert.throws(()=>parse('url:https://dav.example.com/\nusername:张三\npassword:p'),/字段名和冒号必须为英文/);
});

test('粘贴/编辑只启用识别按钮；点击按钮后才解析填入',()=>{
 const fs=require('fs'),vm=require('vm');const app=fs.readFileSync(path.resolve(process.env.VAULT_PACKAGE_ROOT||path.join(__dirname,'..'),'app.js'),'utf8');
 const listeners={};const nodes=Object.fromEntries(['url','username','password','pasteConfig','pasteResult','configPanel','parseConfig'].map(id=>[id,{value:'',open:false,addEventListener(name,fn){listeners[id+':'+name]=fn;}}]));
 nodes.url.value='https://old.example.com/';nodes.username.value='old';nodes.password.value='old-password';
 const sandbox={window:{WebdavConfigParser:{parse}},$:id=>nodes[id],busy:false};vm.runInNewContext(app.slice(app.indexOf('function updatePasteButton(')),sandbox);
 assert.equal(listeners['pasteConfig:paste'],undefined);assert.equal(nodes.parseConfig.disabled,true);
 nodes.pasteConfig.value='url:https://new.example.com/\nuser:张三\npassword:new-password';listeners['pasteConfig:input']();
 assert.equal(nodes.parseConfig.disabled,false);assert.equal(nodes.url.value,'https://old.example.com/');assert.equal(nodes.username.value,'old');assert.equal(nodes.password.value,'old-password');
 listeners['parseConfig:click']();assert.equal(nodes.url.value,'https://new.example.com/');assert.equal(nodes.username.value,'张三');assert.equal(nodes.password.value,'new-password');
});

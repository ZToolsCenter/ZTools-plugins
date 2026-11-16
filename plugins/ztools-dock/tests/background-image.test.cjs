const {test}=require('node:test'),assert=require('node:assert/strict');
const {defaults,validateConfig,pngSize}=require('../public/runtime/core.cjs');
test('背景字段迁移为空；仅接收有界PNG，不接受路径/网址/其他类型',()=>{
 const c=defaults();delete c.settings.backgroundImage;assert.equal(validateConfig(c).settings.backgroundImage,'');
 for(const backgroundImage of [null,123,'https://example.com/a.png','C:\\a.png','data:image/png;base64,AAAA']){const s=defaults();s.settings.backgroundImage=backgroundImage;assert.throws(()=>validateConfig(s),/背景图片/);}
 const bytes=Buffer.alloc(33);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);bytes.write('IHDR',12);bytes.writeUInt32BE(1600,16);bytes.writeUInt32BE(900,20);const data='data:image/png;base64,'+bytes.toString('base64');assert.equal(pngSize(data),null);assert.deepEqual(pngSize(data,1600),{width:1600,height:900});
 const s=defaults();s.settings.backgroundImage=data;assert.equal(validateConfig(s).settings.backgroundImage,data);
 bytes.writeUInt32BE(1601,16);s.settings.backgroundImage='data:image/png;base64,'+bytes.toString('base64');assert.throws(()=>validateConfig(s),/背景图片/);
});

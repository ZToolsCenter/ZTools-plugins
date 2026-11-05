// Pre-rendered Andrew audio. No network or synthesis; validates each content hash before use.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function validate(raw,sentences){
 if(!raw||raw.version!==1||raw.voice!=='andrew'||!raw.entries||Array.isArray(raw.entries))throw Error('配套音频格式无效');
 const entries=Object.entries(raw.entries);if(entries.length<1||entries.length>120)throw Error('配套音频数量无效');
 const expected=sentences&&new Set(sentences.map(s=>s.en));
 for(const [id,e] of entries){if(!e||typeof e.text!=='string'||e.text.length>1000||hash(e.text)!==id||typeof e.data!=='string'||e.data.length>1500000||!(/^[A-Za-z0-9+/]+={0,2}$/.test(e.data)))throw Error('配套音频内容无效');const b=Buffer.from(e.data,'base64');if(b.length<100||hash(b)!==e.sha256)throw Error('配套音频校验失败');if(expected&&!expected.delete(e.text))throw Error('配套音频与课程句子不一致');}
 if(expected?.size)throw Error('配套音频不完整');return raw;
}
module.exports=function createPreparedAudio({directory}={}){
 const entries=new Map();let loaded=false;
 function root(){return typeof directory==='function'?directory():directory}
 function load(){if(loaded)return;const local=path.join(__dirname,'../../assets/audio/english-starter-audio.json');if(fs.existsSync(local))for(const [k,v]of Object.entries(validate(JSON.parse(fs.readFileSync(local))).entries))entries.set(k,v.data);
  const dir=root();if(dir&&fs.existsSync(dir)){for(const file of fs.readdirSync(dir).filter(x=>/^[a-f0-9]{64}\.json$/.test(x))){try{const p=path.join(dir,file);if(fs.statSync(p).size>8*1024*1024)continue;const raw=validate(JSON.parse(fs.readFileSync(p)));for(const [k,v]of Object.entries(raw.entries))entries.set(k,v.data)}catch{/* Damaged cache can be downloaded again. */}}}loaded=true;
 }
 function get(text,voice='andrew'){if(voice!=='andrew'||typeof text!=='string')return null;load();return entries.get(hash(text))||null}
 function install(raw,sentences){load();validate(raw,sentences);const dir=root(),bytes=JSON.stringify(raw);if(dir){fs.mkdirSync(dir,{recursive:true});const dest=path.join(dir,hash(bytes)+'.json'),tmp=dest+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(tmp,bytes);fs.renameSync(tmp,dest)}finally{try{fs.unlinkSync(tmp)}catch{}}}for(const [k,v]of Object.entries(raw.entries))entries.set(k,v.data)}
 return {get,install,has:(text,voice='andrew')=>!!get(text,voice),available:(texts,voice='andrew')=>texts.filter(t=>get(t,voice))};
};
module.exports.validate=validate;

const {MsEdgeTTS,OUTPUT_FORMAT}=require('../../vendor/ms-edge-tts/english-speech-vendor.cjs');
const {voices}=require('./english-core.js');
const inflight=new Map();let active=0,cooldownUntil=0;const waiting=[];
const idle=[];
function acquire(voice){let i=idle.findIndex(x=>x.voice===voice);if(i>=0){const item=idle.splice(i,1)[0];clearTimeout(item.timer);return item.tts}if(idle.length){const old=idle.shift();clearTimeout(old.timer);old.tts.close()}return new MsEdgeTTS({connectionTimeoutMs:12000,synthesisTimeoutMs:30000})}
function release(tts,voice){const item={tts,voice};item.timer=setTimeout(()=>{const i=idle.indexOf(item);if(i>=0)idle.splice(i,1);tts.close()},30000);item.timer.unref?.();idle.push(item);while(idle.length>2){const old=idle.shift();clearTimeout(old.timer);old.tts.close()}}
const escape=s=>s.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
module.exports=async function speech(text,voice='andrew'){
 if(typeof text!=='string'||!text.trim()||text.length>1000)throw Error('语音句子需为 1–1000 字符');
 if(!Object.hasOwn(voices,voice))throw Error('不支持的微软语音');
 if(Date.now()<cooldownUntil)throw Error('微软语音请求过于频繁，请一分钟后重试。');
 const key=voice+'|'+text,selected=voices[voice];
 if(inflight.has(key))return inflight.get(key);
 const run=(async()=>{if(active>=2)await new Promise(r=>waiting.push(r));else active++;
 let tts,deadline,failed=false;
 try{tts=acquire(voice);if(Date.now()<cooldownUntil)throw Error('429');return await Promise.race([(async()=>{await tts.setMetadata(selected.id,OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const {audioStream}=tts.toStream(escape(text));return await new Promise((resolve,reject)=>{const chunks=[];let size=0;audioStream.on('data',b=>{size+=b.length;if(size>2000000){reject(Error('音频超过大小限制'));tts.close()}else chunks.push(b)});audioStream.on('error',reject);audioStream.on('end',()=>size>100?resolve(Buffer.concat(chunks).toString('base64')):reject(Error('未生成有效音频')))});
 })(),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('语音超时，请重试')),45000)})])}
 catch(e){failed=true;if(/429|Too Many Requests/i.test(e.message)){cooldownUntil=Date.now()+60000;throw Error('微软语音请求过于频繁，请一分钟后重试。')}throw Error(selected.label+'：'+speechError(e))}
 finally{clearTimeout(deadline);if(failed)tts?.close();else release(tts,voice);const next=waiting.shift();if(next)next();else active--}
 })();inflight.set(key,run);try{return await run}finally{inflight.delete(key)}
};

// Report actionable categories only; never expose signed URLs, query tokens or input text.
function speechError(error){
 const detail=[error?.message,error?.code,error?.cause?.message,error?.cause?.code].filter(Boolean).join(' ');
 const status=/Unexpected server response:\s*(\d{3})/i.exec(detail)?.[1];
 if(status&&status!=='403'&&status!=='401')return '微软语音握手异常（HTTP '+status+'，预期 101）。服务或网络没有建立语音连接。';
 if(/403|401/.test(detail))return '微软拒绝连接（HTTP 403/401）。请检查电脑日期、时间与时区；若正确，可能是服务端限制。';
 if(/ENOTFOUND|EAI_AGAIN/.test(detail))return '无法解析微软语音服务器（DNS）。请检查网络的 DNS 设置。';
 if(/CERT|certificate|TLS|SSL/i.test(detail))return '安全连接失败（TLS/证书）。请检查系统时间、证书和网络安全软件。';
 if(/timed?\s*out|timeout|ETIMEDOUT|超时/i.test(detail))return '连接或生成超时。请检查网络能否访问微软语音服务；插件连接不一定使用系统代理。';
 if(/ECONN|EHOST|ENET|socket|connection|WebSocket/i.test(detail))return '微软语音连接失败或中断。请检查网络、防火墙及代理设置。';
 if(/crypto|TextEncoder|not defined|not a function/i.test(detail))return '宿主运行环境不兼容，请更新 ZTools，并将其版本号反馈给开发者。';
 return '未生成有效音频，请重试；若持续失败，可暂时选择系统英语语音。';
}
module.exports.speechError=speechError;

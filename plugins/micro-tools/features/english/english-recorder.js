// PCM/WAV recorder: avoids MediaRecorder codec differences across Electron builds.
(function(root){
 function wav(chunks,sampleRate){const count=chunks.reduce((n,c)=>n+c.length,0),buffer=new ArrayBuffer(44+count*2),v=new DataView(buffer);function text(at,s){for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i))}text(0,'RIFF');v.setUint32(4,36+count*2,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,count*2,true);let offset=44;for(const c of chunks)for(const n of c){v.setInt16(offset,n,true);offset+=2}return buffer}
 async function start({deviceId='',onLevel=()=>{}}={}){
  const Context=root.AudioContext||root.webkitAudioContext;if(!Context)throw Error('当前环境不支持音频录制，请更新 ZTools');
  const ctx=new Context();let stream,source,processor,gain,url,stopped=false;const chunks=[];let peak=0,frames=0;
  function accept(input){if(stopped||!input?.length)return;const pcm=new Int16Array(input.length);let sum=0;for(let i=0;i<input.length;i++){const n=Math.max(-1,Math.min(1,input[i]));pcm[i]=n<0?n*32768:n*32767;sum+=n*n;peak=Math.max(peak,Math.abs(n))}frames+=pcm.length;chunks.push(pcm);onLevel(Math.sqrt(sum/input.length))}
  async function cleanup(){stream?.getTracks().forEach(t=>t.stop());source?.disconnect();processor?.disconnect();gain?.disconnect();if(url)URL.revokeObjectURL(url);await ctx.close().catch(()=>{})}
  try{await ctx.resume();stream=await navigator.mediaDevices.getUserMedia({audio:{...(deviceId?{deviceId:{exact:deviceId}}:{}),channelCount:1,echoCancellation:true,noiseSuppression:false,autoGainControl:true}});await ctx.resume();source=ctx.createMediaStreamSource(stream);gain=ctx.createGain();gain.gain.value=0;
   if(ctx.audioWorklet&&root.AudioWorkletNode){
    url=URL.createObjectURL(new Blob([`class Capture extends AudioWorkletProcessor {process(inputs){const channels=inputs[0];if(channels?.length&&channels[0].length){const out=new Float32Array(channels[0].length);for(const ch of channels)for(let i=0;i<out.length;i++)out[i]+=ch[i]/channels.length;this.port.postMessage(out,[out.buffer])}return true}}registerProcessor('english-capture',Capture);`],{type:'application/javascript'}));
    try{await ctx.audioWorklet.addModule(url);processor=new root.AudioWorkletNode(ctx,'english-capture');processor.port.onmessage=e=>accept(e.data)}catch{/* Older hosts can still capture PCM using the built-in processor. */}
   }
   if(!processor){processor=ctx.createScriptProcessor(4096,1,1);processor.onaudioprocess=e=>accept(e.inputBuffer.getChannelData(0))}
   source.connect(processor);processor.connect(gain);gain.connect(ctx.destination);
   return {state:'recording',async stop(){if(stopped)return null;stopped=true;this.state='inactive';await cleanup();if(!frames)throw Error('没有采集到声音，请检查麦克风权限和输入设备');return {blob:new Blob([wav(chunks,ctx.sampleRate)],{type:'audio/wav'}),peak,duration:frames/ctx.sampleRate}}};
  }catch(e){await cleanup();throw e}
 }
 const api={start,wav};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.EnglishRecorder=api;
})(typeof window!=='undefined'?window:globalThis);

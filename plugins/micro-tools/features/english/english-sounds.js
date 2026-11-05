// Local UI sounds. Lazy Web Audio, cached waveforms, no network or audio assets.
(function(root){
 'use strict';
 function create(){
  let context,master,config={enabled:true,typing:true,feedback:true,duringSpeech:true,volume:30,keySound:'soft'},epoch=0;
  const buffers=new Map(),sources=new Set(),last={};
  function stop(){epoch++;for(const source of sources){try{source.stop()}catch{}source.disconnect()}sources.clear()}
  function configure(value={}){
   if(!value||typeof value!=='object')value={};
   config={keySound:['soft','mechanical','typewriter','bubble'].includes(value.keySound)?value.keySound:'soft',enabled:value.enabled!==false,typing:value.typing!==false,feedback:value.feedback!==false,duringSpeech:value.duringSpeech!==false,volume:Number.isFinite(Number(value.volume))?Math.max(0,Math.min(100,Number(value.volume))):30};
   if(master)master.gain.setValueAtTime(config.volume/100,context.currentTime);
   if(!config.enabled||!config.volume)stop();return {...config};
  }
  function buffer(kind){
   const key=kind==='key'?kind+':'+config.keySound:kind;if(buffers.has(key))return buffers.get(key);
   const rate=context.sampleRate,duration=kind==='key'?({soft:.045,mechanical:.065,typewriter:.085,bubble:.10}[config.keySound]):{correct:.36,incorrect:.30}[kind],b=context.createBuffer(1,Math.ceil(rate*duration),rate),data=b.getChannelData(0);
   let seed=8191,low=0;
   for(let i=0;i<data.length;i++){
    const t=i/rate;
    if(kind==='key'){
     seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const noise=(seed>>>0)/2147483648-1;low+=.22*(noise-low);
     data[i]=(.24*low+.13*Math.sin(2*Math.PI*175*t))*Math.min(1,t/.0015)*Math.exp(-t/ .008)*Math.min(1,(duration-t)/.004);
     if(config.keySound==='mechanical')data[i]=(.27*noise+.2*Math.sin(2*Math.PI*850*t))*Math.min(1,t/.001)*Math.exp(-t/.012)*Math.min(1,(duration-t)/.004);
     if(config.keySound==='typewriter'){const tap=t-.028;data[i]=.26*noise*Math.exp(-t/.007)+.18*Math.sin(2*Math.PI*1700*t)*Math.exp(-t/.016)+(tap>0?.18*noise*Math.exp(-tap/.006):0);data[i]*=Math.min(1,t/.001)*Math.min(1,(duration-t)/.005)}
     if(config.keySound==='bubble')data[i]=.24*Math.sin(2*Math.PI*(700*t-2000*t*t))*Math.min(1,t/.005)*Math.exp(-t/.024)*Math.min(1,(duration-t)/.01);
    }else{
     const notes=kind==='correct'?[[0,659.25],[.075,830.61],[.15,987.77]]:[[0,293.66],[.095,246.94]];
     for(const[start,freq]of notes){const age=t-start;if(age<0||age>.19)continue;const envelope=Math.min(1,age/.008)*Math.exp(-age/.055)*Math.min(1,(.19-age)/.025);data[i]+=.2*envelope*(Math.sin(2*Math.PI*freq*age)+.15*Math.sin(4*Math.PI*freq*age))}
    }
   }
   buffers.set(key,b);return b;
  }
  async function play(kind){
   if(!['key','correct','incorrect'].includes(kind)||!config.enabled||!config.volume||!(kind==='key'?config.typing:config.feedback))return false;
   const now=Date.now(),gap=kind==='key'?28:180;if(now-(last[kind]||0)<gap)return false;last[kind]=now;
   const ticket=epoch;
   try{
    if(!context){const AudioContext=root.AudioContext||root.webkitAudioContext;if(!AudioContext)return false;context=new AudioContext();master=context.createGain();master.gain.value=config.volume/100;master.connect(context.destination)}
    if(context.state==='suspended')await context.resume();
    if(ticket!==epoch||context.state!=='running')return false;
    if(sources.size>=8)return false;
    const source=context.createBufferSource();source.buffer=buffer(kind);source.connect(master);sources.add(source);source.onended=()=>{sources.delete(source);source.disconnect()};source.start();return true;
   }catch{return false} // Sound feedback must never block answering or playback.
  }
  return {configure,play,stop};
 }
 root.EnglishSounds={create};
})(typeof window==='undefined'?globalThis:window);

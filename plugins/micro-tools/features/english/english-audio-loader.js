/* One background lane; foreground requests share in-flight work and get their own lane. */
class LessonAudioCache {
 constructor({read,write,request,onProgress}){Object.assign(this,{read,write,request,onProgress});this.inflight=new Map();this.batch=null;this.running=false;this.enabled=true;}
 key(text,voice){return 'speech-v2:'+voice+'|'+text;}
 async get(text,voice,{background=false}={}){
  const key=this.key(text,voice);
  if(this.inflight.has(key))return this.inflight.get(key).catch(error=>{if(!background&&error.code==='foreground_required'){this.inflight.delete(key);return this.get(text,voice)}throw error});
  const job=(async()=>{let blob;try{blob=await this.read(key)}catch{this.storageWarning=true;}if(!blob){blob=await this.request(text,voice,{background});try{await this.write(key,blob);}catch{this.storageWarning=true;}}return blob;})();
  this.inflight.set(key,job);
  try{return await job;}finally{if(this.inflight.get(key)===job)this.inflight.delete(key);}
 }
 set(texts,voice,enabled=true){this.enabled=enabled;this.rateLimited=false;this.consecutiveFailures=0;this.lastError='';this.batch={voice,items:[...new Set(texts)].map(text=>({text,status:'pending'}))};this.report();this.pump();}
 prioritize(text){if(!this.batch)return;const i=this.batch.items.findIndex(x=>x.text===text&&x.status==='pending');if(i>0)this.batch.items.unshift(this.batch.items.splice(i,1)[0]);}
 report(){const b=this.batch;if(!b)return;this.onProgress({total:b.items.length,ready:b.items.filter(i=>i.status==='ready').length,failed:b.items.filter(i=>i.status==='failed').length,enabled:this.enabled,storageWarning:!!this.storageWarning,rateLimited:!!this.rateLimited,lastError:this.lastError||''});}
 async pump(){if(this.running)return;this.running=true;try{while(this.enabled&&this.batch){const b=this.batch,item=b.items.find(i=>i.status==='pending');if(!item)break;item.status='loading';try{await this.get(item.text,b.voice,{background:true});item.status='ready';this.consecutiveFailures=0;this.lastError='';}catch(e){this.lastError=e.message;if(e.code==='foreground_required'){item.status='pending';this.enabled=false;this.report();break}item.status='failed';item.error=e.message;this.consecutiveFailures=(this.consecutiveFailures||0)+1;if(this.consecutiveFailures>=3)this.enabled=false;if(/请求过于频繁|429/.test(e.message)){this.enabled=false;this.rateLimited=true;}}this.report();}}finally{this.running=false;}}
 retry(){if(!this.batch)return;this.enabled=true;this.rateLimited=false;this.consecutiveFailures=0;this.lastError='';for(const i of this.batch.items)if(i.status==='failed')i.status='pending';this.report();this.pump();}
}
if(typeof module!=='undefined')module.exports=LessonAudioCache;else window.LessonAudioCache=LessonAudioCache;

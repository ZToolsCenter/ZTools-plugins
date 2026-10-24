/* Bounded, resumable AI batches. The caller supplies its existing model connection. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./english-core'));else root.EnglishGeneration=factory(root.EnglishCore)})(typeof window!=='undefined'?window:this,C=>{
 class Generation {
  constructor({api,call,parse=JSON.parse,cancel=()=>{},onProgress=()=>{},onDraft=()=>{}}){Object.assign(this,{api,call,parse,cancelModel:cancel,onProgress,onDraft});this.sentences=[];this.busy=false;this.cancelled=false;this.failedResponse='';}
  stop(){this.cancelled=true;this.cancelModel()}
  async start(input){this.input=JSON.parse(JSON.stringify(input));this.sentences=[];this.prepared=null;return this.run()}
  course(sentences=this.sentences){return {title:this.input.title||'我的科研素材',domain:this.input.domain,level:this.input.level,source:this.input.source,sentences}}
  async run(){
   if(this.busy)throw Error('正在整理，请先停止当前任务。');this.busy=true;this.cancelled=false;this.failedResponse='';
   try{
    this.onProgress({phase:'prepare',completed:this.sentences.length,total:this.input.count});
    this.prepared=await this.api.prepare(this.input);
    const p=this.prepared;
    if(this.cancelled)throw Error('已停止整理');
    if(this.sentences.length)await this.onDraft(this.course(),p.session_id,this.sentences.length<p.count);
    while(this.sentences.length<p.count){
     if(this.cancelled)throw Error('已停止整理');
     const offset=this.sentences.length,size=Math.min(6,p.count-offset),payload=C.batchPayload(p,offset,size,this.sentences.map(s=>s.en));
     this.onProgress({phase:'generate',completed:offset,total:p.count,batch:Math.floor(offset/6)+1,batches:Math.ceil(p.count/6),inputChars:JSON.stringify(payload).length,selected:p.material_stats});
     const messages=[{role:'system',content:C.prompt},{role:'user',content:JSON.stringify(payload)}];let validated;
     for(let attempt=0;attempt<2;attempt++){
      const answer=await this.call(messages);
      if(this.cancelled)throw Error('已停止整理');
      this.failedResponse=String(answer);const raw=this.parse(answer),sentences=Array.isArray(raw)?raw:raw.sentences;
      if(!Array.isArray(sentences)||sentences.length!==size)throw Error('本批需要 '+size+' 句，模型返回的句数不符。');
      try{
       const lesson=C.validateTeaching(C.clean(this.course(sentences)),{requireChunks:true});
       validated=await this.api.validateSession({session_id:p.session_id,lesson,partial:true});
       break;
      }catch(error){
       if(error.code!=='ENGLISH_TEACHING'||attempt===1)throw error;
       if(this.cancelled)throw Error('已停止整理');
       this.onProgress({phase:'repair',completed:offset,total:p.count,batch:Math.floor(offset/6)+1,batches:Math.ceil(p.count/6),issue:error.message});
       messages.push({role:'assistant',content:String(answer)},{role:'user',content:'请修订本批中不符合规则的句子，正确句子保持不变。仍输出完整的 '+size+' 句 JSON，保留对应 source_id 和原文事实。每句最多 22 词；chunks 每块 1–6 词并顺序完整覆盖该句。不要截断句子或删除必要的否定、数字、条件和比较对象。需要修正：\n'+error.message});
      }
     }
     if(this.cancelled)throw Error('已停止整理');
     this.sentences.push(...validated.sentences);this.failedResponse='';
     await this.onDraft(this.course(),p.session_id,this.sentences.length<p.count);
    }
    this.onProgress({phase:'done',completed:this.sentences.length,total:p.count});return this.course();
   }finally{this.busy=false}
  }
 }
 return Generation;
});

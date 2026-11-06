/* Small local paper filter. Keep source spelling and an untouched copy in the caller. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.EnglishMaterial=factory()})(typeof window!=='undefined'?window:this,()=>{
 const backmatter=/^(?:references|bibliography|literature cited|acknowledg(?:e)?ments?|author contributions?|authors?' contributions?|competing interests?|conflicts? of interest|funding(?: information)?|additional information|reporting summary|data availability(?: statement)?|code availability(?: statement)?|参考文献|致谢|作者贡献|利益冲突|数据可用性|代码可用性)$/i;
 const supplement=/^(?:(?:supplementary|supplemental|supporting) (?:information|materials?|appendi(?:x|ces))|appendi(?:x|ces)(?: [A-Z\d]+)?|补充材料|附录(?:[A-Z\d一二三四五六七八九十]+)?)$/i;
 const modes={raw:'原始全文',body:'正文（保留方法）',focus:'正文（略过方法）',abstract:'只看摘要',results:'只看结果',discussion:'只看讨论',methods:'只看方法'};
 const sectionPatterns={abstract:/^(?:abstract|摘要)$/i,introduction:/^(?:introduction|background|引言|背景)$/i,'results-discussion':/^(?:results (?:and|&) discussion|结果(?:与|和)讨论)$/i,results:/^(?:results|结果)$/i,discussion:/^(?:discussion|讨论)$/i,conclusion:/^(?:conclusions?|concluding remarks|结论)$/i,methods:/^(?:methods|materials? (?:and|&) methods|experimental (?:methods|procedures)|方法|材料与方法|实验方法)$/i};
 const sectionOf=title=>Object.keys(sectionPatterns).find(key=>sectionPatterns[key].test(title))||null;
 function heading(line){return line.trim().replace(/^\d+(?:\.\d+)*[.)]?\s+/,'').replace(/[:：]\s*$/,'').replace(/\s+/g,' ')}
 const fingerprint=line=>line.trim().replace(/\s+/g,' ').replace(/\b\d+\s*$/,'#');
 function prefilter(text,{mode='body',pages=[]}={}){
  if(typeof text!=='string')throw Error('素材正文必须是文本');
  if(!Object.hasOwn(modes,mode))throw Error('未知的素材筛选方式');
  const originalChars=text.length,removedSections=new Set();
  if(mode==='raw')return {text,originalChars,retainedChars:originalChars,removedChars:0,removedSections:[],removedHeaders:0};
  // Repeated page-edge text only. Never drop repeated phrases in the main body or figures.
  const edgeCounts=new Map();
  if(pages.length>=3)for(const page of pages){const lines=page.split('\n').map(l=>l.trim()).filter(Boolean),seen=new Set([...lines.slice(0,2),...lines.slice(-2)].filter(l=>l.length>=4&&l.length<=150&&!/[.!?]$/.test(l)&&!sectionOf(heading(l))&&!backmatter.test(heading(l))&&!supplement.test(heading(l))).map(fingerprint));for(const key of seen)edgeCounts.set(key,(edgeCounts.get(key)||0)+1)}
  const headers=new Set([...edgeCounts].filter(([,n])=>n>=Math.max(3,Math.ceil(pages.length*.6))).map(([s])=>s));
  const output=[],sectionOnly=['abstract','results','discussion','methods'].includes(mode);let offset=0,section=null,skip=false,removedHeaders=0,foundSection=false,combinedSection=false;
  for(const line of text.split('\n')){
   const at=offset;offset+=line.length+1;
   if(headers.has(fingerprint(line))){removedHeaders++;continue}
   const title=heading(line),nextSection=sectionOf(title);
   // Avoid treating a table of contents or a document title as the paper's back matter.
   if(at>=Math.min(2000,originalChars*.2)&&(backmatter.test(title)||supplement.test(title))){skip=true;section='backmatter';removedSections.add(title);continue}
   if(nextSection){section=nextSection;skip=mode==='focus'&&section==='methods';if(skip)removedSections.add(title)}
   const selected=!sectionOnly||section===mode||section==='results-discussion'&&['results','discussion'].includes(mode);
   if(sectionOnly&&selected){foundSection=true;if(section==='results-discussion')combinedSection=true}
   if(!skip&&selected)output.push(line);
  }
  let retained=output.join('\n').trim();
  // Unrecognized layouts stay available for manual selection rather than returning almost nothing.
  const fallback=!sectionOnly&&originalChars>1000&&retained.length<300;
  if(fallback)retained=text;
  return {text:retained,originalChars,retainedChars:retained.length,removedChars:originalChars-retained.length,removedSections:fallback?[]:[...removedSections],removedHeaders:fallback?0:removedHeaders,fallback,missingSection:sectionOnly&&!foundSection,combinedSection};
 }
 function readingBlocks(text){
  const blocks=[];let paragraph=[];
  const flush=()=>{if(paragraph.length){blocks.push({kind:'paragraph',text:paragraph.reduce((a,b)=>a+(a.endsWith('-')?'':' ')+b,'').trim()});paragraph=[]}};
  for(const raw of text.split('\n')){
   const line=raw.trim().replace(/[ \t]+/g,' ');if(!line){flush();continue}
   const title=heading(line);if(sectionOf(title)||backmatter.test(title)||supplement.test(title)){flush();blocks.push({kind:'heading',text:line});continue}
   paragraph.push(line);
  }
  flush();return blocks;
 }
 function suggestCount(text){
  const prose=readingBlocks(text).filter(b=>b.kind==='paragraph').map(b=>b.text).join(' '),words=(prose.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)||[]).length;
  if(words<5)return null;
  const available=[...new Intl.Segmenter('en',{granularity:'sentence'}).segment(prose)].filter(s=>(s.segment.match(/[A-Za-z]+/g)||[]).length>=5).length||1;
  const count=Math.min(available,60,Math.max(words>=600?6:1,Math.round(words/120/5)*5||1));
  return {count,min:Math.max(1,Math.floor(count*.75)),max:Math.min(120,available,Math.max(count,Math.ceil(count*1.3))),words};
 }
 return {prefilter,readingBlocks,suggestCount,modes};
});

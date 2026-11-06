// PDF.js is vendored with its license; extraction never uploads documents.
import * as pdfjs from '../../vendor/pdfjs/english-pdf-vendor.mjs';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('../../vendor/pdfjs/english-pdf-worker.mjs',import.meta.url).href;
// Text items are font/layout runs, not words. PDF.js also emits explicit spaces.
const ligatures={'ﬀ':'ff','ﬁ':'fi','ﬂ':'fl','ﬃ':'ffi','ﬄ':'ffl','ﬅ':'st','ﬆ':'st'};
export function textFromItems(items){
 let text='',previous=null;
 for(const item of items){
  if(typeof item.str!=='string')continue;
  const value=item.str.replace(/[\ufb00-\ufb06]/g,c=>ligatures[c]);
  if(value&&text&&!/\s$/.test(text)&&!/^\s/.test(value)){
   const a=previous?.transform,b=item.transform,em=Math.min(Math.abs(previous?.height||a?.[3]||0),Math.abs(item.height||b?.[3]||0));
   const horizontal=a&&b&&a[0]>0&&b[0]>0&&Math.abs(a[1])<.001&&Math.abs(b[1])<.001&&previous.dir!=='rtl'&&item.dir!=='rtl';
   const sameLine=horizontal&&em>0&&Math.abs(a[5]-b[5])<=em*.25;
   const gap=sameLine?b[4]-(a[4]+previous.width):NaN;
   // Join touching runs (e.g. in + ﬂ + uences); keep real spatial word gaps.
   if(!Number.isFinite(gap)||gap>Math.max(.15,em*.08))text+=' ';
  }
  text+=value;
  if(item.hasEOL){if(!text.endsWith('\n'))text+='\n';previous=null}else if(value)previous=item;
 }
 // Superscript citations can make PDF.js end a run before its trailing punctuation.
 // Join only one line break and a punctuation token; keep paragraph gaps and decimals.
 return text.replace(/(\S)[ \t]*\r?\n[ \t]*([.,;:!?，。；：！？])(?=[ \t]|\r?$)/gm,'$1$2');
}
export async function extractPDF(bytes,{onProgress=()=>{},onPages=()=>{}}={}){
 if(bytes.byteLength>10*1024*1024)throw Error('PDF 最大 10 MB，请截取要学习的章节。');
 const task=pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true});
 try{const doc=await task.promise;if(doc.numPages>120)throw Error('最多读取 120 页，请截取摘要或章节。');let text='';const pages=[];
 for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i),content=await page.getTextContent({disableNormalization:true});const pageText=textFromItems(content.items);pages.push(pageText);text+=pageText+'\n\n';page.cleanup();onProgress(i,doc.numPages);if(text.length>180000)throw Error('正文超过 18 万字符，请截取要学习的部分。')}
 if(!text.trim())throw Error('未提取到文字；扫描 PDF 请先 OCR 或粘贴正文。');onPages(pages);return text.trim();
 }finally{await task.destroy()}
}
